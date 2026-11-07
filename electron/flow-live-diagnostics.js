import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { liveGalleryCode } from './flow-live-dom.js'
import { readImageRequest } from './flow-passive-capture.js'

const WORLD = 994
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const noop = () => {}

export function flowLiveProjectUrl(env = {}) {
  if (env.AUTOFLOWCUT_FLOW_LIVE_DIAGNOSTICS !== '1'
    || !UUID.test(env.AUTOFLOWCUT_FLOW_LIVE_PROJECT_ID || '')
    || !env.AUTOFLOWCUT_FLOW_LIVE_DIR || !path.isAbsolute(env.AUTOFLOWCUT_FLOW_LIVE_DIR)) return null
  return `https://flow.google.com/project/${env.AUTOFLOWCUT_FLOW_LIVE_PROJECT_ID}`
}

/** Local, opt-in test-project evidence. No response interception, headers,
 * request replay, page hooks, DOM writes or ownership decisions. */
export function createFlowLiveDiagnostics({ webContents: wc, env = process.env, io = fs,
  maxBytes = 20 * 1024 * 1024, maxDurationMs = 10 * 60 * 1000 } = {}) {
  const disabled = { sample: async () => {}, before: noop, completed: noop, failed: noop, dispose: noop }
  const project = env.AUTOFLOWCUT_FLOW_LIVE_PROJECT_ID
  const dir = env.AUTOFLOWCUT_FLOW_LIVE_DIR
  const projectUrl = flowLiveProjectUrl(env)
  if (!projectUrl || !wc) return disabled
  const token = `flowLive_${randomUUID()}`
  const file = path.join(dir, `flow-live-${Date.now()}-${randomUUID()}.jsonl`)
  let stopped = false, busy = false, bytes = 0, timer, lifetime, deadline, navigationEpoch = 0
  const requests = new Set()
  const inProject = () => !wc.isDestroyed?.() && [projectUrl, projectUrl + '/'].includes(wc.getURL())
  const cleanupObserver = () => {
    if (!wc.isDestroyed?.()) {
      try { Promise.resolve(wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: liveGalleryCode(token, 'stop') }])).catch(noop) } catch {}
    }
  }
  function raw(entry) {
    const line = JSON.stringify({ at: Date.now(), ...entry }) + '\n'
    const length = Buffer.byteLength(line)
    if (bytes + length > maxBytes) return false
    io.appendFileSync(file, line, { mode: 0o600 })
    bytes += length
    return true
  }
  function dispose(reason = 'disposed') {
    if (stopped) return
    stopped = true
    clearInterval(timer); clearTimeout(lifetime); clearTimeout(deadline)
    wc.removeListener('destroyed', destroyed)
    wc.removeListener('dom-ready', ready)
    wc.removeListener('did-navigate-in-page', scopeChanged)
    wc.removeListener('did-start-navigation', navigating)
    requests.clear()
    try { raw({ kind: 'stop', reason }) } catch {}
    cleanupObserver()
  }
  function write(entry) {
    if (stopped) return
    try {
      // Reserve room to record why evidence collection ended.
      if (bytes + Buffer.byteLength(JSON.stringify(entry)) + 550 > maxBytes) return dispose('size-limit')
      raw(entry)
    } catch { dispose('write-failed') }
  }
  async function sample() {
    if (stopped || busy || !inProject()) return
    busy = true
    const url = wc.getURL()
    const epoch = navigationEpoch
    deadline = setTimeout(() => dispose('read-timeout'), 5000)
    deadline.unref?.()
    try {
      const value = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: liveGalleryCode(token) }])
      if (!stopped && navigationEpoch === epoch && inProject() && wc.getURL() === url) {
        write({ kind: 'dom', snapshot: Array.isArray(value) ? value[0] : value })
      }
    } catch { if (!stopped) write({ kind: 'read-error' }) }
    finally {
      clearTimeout(deadline)
      busy = false
      // Disposal may precede an in-flight script installing its observer.
      if (stopped || navigationEpoch !== epoch || !inProject()) cleanupObserver()
    }
  }
  const destroyed = () => dispose('view-destroyed')
  const ready = () => { void sample() }
  const navigating = () => { navigationEpoch++ }
  const scopeChanged = () => { navigationEpoch++; if (!inProject()) cleanupObserver() }
  try {
    io.mkdirSync(dir, { recursive: true, mode: 0o700 })
    write({ kind: 'session', version: 1, projectId: project, webContentsId: wc.id })
    if (stopped) return disabled
    timer = setInterval(ready, 1000); timer.unref?.()
    lifetime = setTimeout(() => dispose('duration-limit'), maxDurationMs); lifetime.unref?.()
    wc.on('dom-ready', ready)
    wc.on('did-navigate-in-page', scopeChanged)
    wc.on('did-start-navigation', navigating)
    wc.once('destroyed', destroyed)
  } catch { dispose('open-failed'); return disabled }

  return { sample, dispose,
    before(details) {
      if (stopped || details.webContentsId !== wc.id || !inProject()) return
      try {
        const url = new URL(details.url)
        if (url.origin !== 'https://flow.google.com' || !url.pathname.endsWith('/data/batchexecute')) return
        const entry = { kind: 'request', requestId: details.id, method: details.method,
          url: url.origin + url.pathname, rpcid: url.searchParams.get('rpcids') }
        const chunks = details.uploadData
        if (Array.isArray(chunks) && chunks.every(c => c.bytes && !c.file && !c.blobUUID)
          && chunks.reduce((n, c) => n + c.bytes.length, 0) <= 2 * 1024 * 1024) {
          // f.req itself contains reCAPTCHA tokens. Retain only known image
          // facts and UUID candidates, never arbitrary envelope/context values.
          const form = new URLSearchParams(Buffer.concat(chunks.map(c => Buffer.from(c.bytes))).toString('utf8'))
          const payload = form.get('f.req') || ''
          JSON.parse(payload)
          entry.payloadUuids = [...new Set(payload.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [])].slice(0, 100)
          entry.imageRequest = readImageRequest(details)
        }
        if (requests.size >= 1000) return dispose('request-limit')
        requests.add(details.id)
        write(entry)
      } catch { write({ kind: 'request-unreadable', requestId: details.id }) }
    },
    completed(details) {
      if (!requests.delete(details.id) || stopped) return
      write({ kind: 'completed', requestId: details.id, statusCode: details.statusCode, fromCache: !!details.fromCache })
    },
    failed(details) {
      if (!requests.delete(details.id) || stopped) return
      write({ kind: 'failed', requestId: details.id, error: details.error })
    },
  }
}
