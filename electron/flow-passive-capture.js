import { decodeFReqInner, extractSubmitPrompts, extractSubmitRefs, normalizePrompt } from './flow-rpc-protocol.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const READ_RPCS = new Set(['UpteDb', 'ngNC2', 'Zzl0ze', 'nzlxg', 'HTrJv', 'as29s', 'jwpduf', 'o30O0e', 'xI9TVb', 'WuwhI'])
function envelope(details) {
  try {
    const u = new URL(details.url)
    if (u.origin !== 'https://flow.google.com' || u.pathname !== '/_/AiSandboxAngularFrontend/data/batchexecute' || details.method !== 'POST') return null
    const chunks = details.uploadData
    if (!Array.isArray(chunks) || !chunks.length || chunks.some(c => !c?.bytes || c.file || c.blobUUID)) return null
    const bytes = Buffer.concat(chunks.map(c => Buffer.from(c.bytes)))
    if (bytes.length > 2 * 1024 * 1024) return null
    const body = bytes.toString('utf8')
    const raw = JSON.parse(new URLSearchParams(body).get('f.req'))
    if (raw.length !== 1 || raw[0].length !== 1) return null
    const decoded = decodeFReqInner(body)
    if (!decoded || u.searchParams.get('rpcids') !== decoded.rpcid) return null
    return decoded
  } catch { return null }
}
export function readImageRequest(details) {
  const e = envelope(details)
  if (e?.rpcid !== 'ogiZ0b') return null
  const items = e.inner?.[1]
  const projectId = e.inner?.[3]?.[5]
  if (!UUID.test(projectId || '') || !Array.isArray(items) || items.length < 1 || items.length > 4) return null
  const prompts = extractSubmitPrompts(e.rpcid, e.inner).map(normalizePrompt)
  const refs = extractSubmitRefs(e.rpcid, e.inner)
  if (!refs || refs.refs.length || refs.mentions.length || prompts.length !== items.length || prompts.some(p => !p)) return null
  if (items.some(i => i?.[7]?.[5] !== projectId || !Number.isInteger(i[3]) || i[3] < 0)) return null
  return { projectId, prompts, seeds: items.map(i => i[3]), count: items.length }
}

/** Main-process memory only. Call before() from the EXISTING session listener.
 * No observer method modifies, cancels or replays a request. Unowned submissions
 * quarantine even after HTTP completion: their gallery updates may arrive later. */
export function createPassiveCapture({ now = Date.now } = {}) {
  let active = null
  let uncertain = false
  function invalidate(reason = 'ownership-uncertain') {
    uncertain = true
    if (active) { active.error ||= reason; active.controller.abort() }
  }
  return {
    before(details) {
      let u
      try { u = new URL(details.url) } catch { return }
      const batch = u.origin === 'https://flow.google.com' && u.pathname.endsWith('/data/batchexecute') && details.method === 'POST'
      const otherSubmit = /(?:flow\.google\.com|aisandbox[^.]*\.googleapis\.com)$/.test(u.hostname)
        && /generate|streamChat|upload/i.test(u.pathname) && details.method === 'POST'
      if (!batch && !otherSubmit) return
      const e = batch ? envelope(details) : null
      if (e && READ_RPCS.has(e.rpcid)) return
      // Unknown RPCs are only tolerated outside an ownership window. Known
      // generation/upload requests outside it can publish delayed results.
      if (!active) {
        if (otherSubmit || !e || ['ogiZ0b', 'YhhmEf', 'MZZa6b', 'eb1hJf', 'maseQ'].includes(e.rpcid)) invalidate()
        return
      }
      const r = readImageRequest(details)
      if (!active.dispatched || active.request || details.webContentsId !== active.expected.webContentsId || !r
        || r.projectId !== active.expected.projectId || r.count !== active.expected.count
        || r.prompts.some(p => p !== normalizePrompt(active.expected.prompt))) return invalidate('request-mismatch')
      active.id = details.id
      active.request = r
      active.sentAt = now()
    },
    completed(details) {
      if (!active?.request || active.id !== details.id) return
      if (details.statusCode !== 200 || details.fromCache) return invalidate('request-failed')
      active.complete = true
      active.completedAt = now()
    },
    failed(details) { if (active?.request && active.id === details.id) invalidate('request-failed') },
    invalidate,
    begin(expected) {
      if (uncertain) throw new Error('ownership-uncertain')
      if (active) throw new Error('capture-busy')
      const rec = { expected, controller: new AbortController(), dispatched: false, request: null, complete: false, error: null }
      active = rec
      return {
        signal: rec.controller.signal,
        state: () => ({ request: rec.request, complete: rec.complete, error: rec.error, sentAt: rec.sentAt, completedAt: rec.completedAt }),
        dispatch() {
          if (active !== rec || rec.error || rec.dispatched) throw new Error('ownership-uncertain')
          rec.dispatched = true
        },
        release(success = false) {
          if (active !== rec) return
          if (!success && rec.dispatched) invalidate()
          rec.controller.abort()
          active = null
        },
      }
    },
  }
}

const bindings = new WeakMap()
/** Electron keeps only the last listener for each event, so compose the old
 * project/diagnostic observer here instead of installing a second listener. */
export function bindPassiveRequests(session, capture, observeExisting = () => {}) {
  const token = {}
  bindings.set(session, token)
  const filter = { urls: ['*://*/*'] }
  session.webRequest.onBeforeRequest(filter, (details, callback) => {
    try { capture.before(details); observeExisting(details) }
    catch { capture.invalidate('observer-failed') }
    finally { callback({}) }
  })
  session.webRequest.onCompleted(filter, details => capture.completed(details))
  session.webRequest.onErrorOccurred(filter, details => capture.failed(details))
  return () => {
    capture.invalidate('view-destroyed')
    if (bindings.get(session) !== token) return
    bindings.delete(session)
    session.webRequest.onBeforeRequest(filter, null)
    session.webRequest.onCompleted(filter, null)
    session.webRequest.onErrorOccurred(filter, null)
  }
}
