import { decodeFReqInner, extractSubmitPrompts, extractSubmitRefs, normalizePrompt } from './flow-rpc-protocol.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const READ_RPCS = new Set(['UpteDb', 'ngNC2', 'nzlxg', 'HTrJv', 'as29s', 'jwpduf', 'o30O0e', 'xI9TVb', 'WuwhI'])
const GALLERY_RPCS = new Set(['Zzl0ze'])
function envelope(details, maxBytes = 2 * 1024 * 1024) {
  try {
    const u = new URL(details.url)
    if (u.origin !== 'https://flow.google.com' || u.pathname !== '/_/AiSandboxAngularFrontend/data/batchexecute' || details.method !== 'POST') return null
    const chunks = details.uploadData
    if (!Array.isArray(chunks) || !chunks.length || chunks.some(c => !c?.bytes || c.file || c.blobUUID)) return null
    if (chunks.reduce((n, c) => n + c.bytes.byteLength, 0) > maxBytes) return null
    const bytes = Buffer.concat(chunks.map(c => Buffer.from(c.bytes)))
    const body = bytes.toString('utf8')
    const raw = JSON.parse(new URLSearchParams(body).get('f.req'))
    if (raw.length !== 1 || raw[0].length !== 1) return null
    const decoded = decodeFReqInner(body)
    if (!decoded || u.searchParams.get('rpcids') !== decoded.rpcid) return null
    return decoded
  } catch { return null }
}
export function readImageRequest(details, expected = {}, e = envelope(details)) {
  if (e?.rpcid !== 'ogiZ0b') return null
  const items = e.inner?.[1]
  const projectId = e.inner?.[3]?.[5]
  if (!UUID.test(projectId || '') || !Array.isArray(items) || items.length < 1 || items.length > 4) return null
  const prompts = extractSubmitPrompts(e.rpcid, e.inner).map(normalizePrompt)
  const refs = extractSubmitRefs(e.rpcid, e.inner)
  if (!refs || !inputsMatch(refs, expected) || prompts.length !== items.length || prompts.some(p => !p)) return null
  if (items.some(i => i?.[7]?.[5] !== projectId || !Number.isInteger(i[3]) || i[3] < 0)) return null
  return { projectId, prompts, seeds: items.map(i => i[3]), count: items.length, ...(refs.refs.length ? refs : {}) }
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
function inputsMatch(got, { refs = [], mentions = [] }) {
  return same([...got.refs].sort(), [...refs].sort()) && same(got.mentions, mentions)
}

function videoRequest(e, expected) {
  const { rpcid, inner } = e || {}
  if (!['YhhmEf', 'eb1hJf', 'MZZa6b'].includes(rpcid) || rpcid !== expected.rpcid) return null
  const projectId = inner?.[1]?.[5]
  const items = inner?.[0]
  const prompts = extractSubmitPrompts(rpcid, inner).map(normalizePrompt)
  if (!UUID.test(projectId || '') || !Array.isArray(items) || items.length !== 1 || prompts.length !== 1) return null
  const frame = rpcid === 'eb1hJf'
  // eb1hJf has a distinct start-frame layout; its response explicitly identifies the frame.
  const inputs = frame ? { refs: expected.refs, mentions: [] } : extractSubmitRefs(rpcid, inner)
  if (!inputs || !inputsMatch(inputs, expected) || (frame && expected.refs?.length !== 1)) return null
  const modelKey = frame ? undefined : items[0][rpcid === 'MZZa6b' ? 2 : 1]
  return { rpcid, projectId, prompts, ...inputs, modelKey, want: expected.want, count: 1 }
}

/** Main-process memory only. Call before() from the EXISTING session listener.
 * No observer method modifies, cancels or replays a request. Unowned submissions
 * quarantine even after HTTP completion: their gallery updates may arrive later. */
export function createPassiveCapture({ now = Date.now, gallerySettleMs = 2000 } = {}) {
  let active = null
  let uncertain = false
  const galleryRequests = new Set()
  let galleryRenderUnproven = false
  let galleryKey = null, galleryStableAt = 0
  const resetGallery = () => { galleryKey = null; galleryStableAt = now() }
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
      const e = batch ? envelope(details, active?.upload ? 20 * 1024 * 1024 : undefined) : null
      if (e && GALLERY_RPCS.has(e.rpcid)) {
        galleryRequests.add(details.id)
        resetGallery()
        // A refresh after our observed submit is normal. Before it, or from a
        // different view, the baseline cannot distinguish delayed old results.
        if (active && !active.expected.responseProof && (!active.request || details.webContentsId !== active.expected.webContentsId)) {
          active.error ||= 'gallery-request-overlap'; active.controller.abort()
        }
        return
      }
      if (e && READ_RPCS.has(e.rpcid)) return
      // Direct native response ownership does not depend on gallery/settings
      // RPCs. Known generation/upload traffic still remains exclusive.
      if (active?.expected.responseProof && e && !['ogiZ0b', 'YhhmEf', 'MZZa6b', 'eb1hJf', 'maseQ'].includes(e.rpcid)) return
      // Unknown RPCs are only tolerated outside an ownership window. Known
      // generation/upload requests outside it can publish delayed results.
      if (!active) {
        if (otherSubmit || !e || ['ogiZ0b', 'YhhmEf', 'MZZa6b', 'eb1hJf', 'maseQ'].includes(e.rpcid)) invalidate()
        return
      }
      if (active.upload && e?.rpcid === 'maseQ') {
        const up = active.upload
        if (up.id != null || !up.armed || details.webContentsId !== active.expected.webContentsId
          || e.inner?.[0]?.[5] !== active.expected.projectId || e.inner?.[2] !== 'image/png'
          || typeof e.inner?.[1] !== 'string' || !up.verify(Buffer.from(e.inner[1], 'base64'))) return invalidate('upload-mismatch')
        up.id = details.id
        up.url = details.url
        return
      }
      const r = !active.expected.rpcid || active.expected.rpcid === 'ogiZ0b' ? readImageRequest(details, active.expected, e) : videoRequest(e, active.expected)
      if (!active.prepared || active.request || details.webContentsId !== active.expected.webContentsId || !r
        || r.projectId !== active.expected.projectId || r.count !== active.expected.count
        || r.prompts.some(p => p !== normalizePrompt(active.expected.prompt))) return invalidate('request-mismatch')
      active.id = details.id
      active.requestUrl = details.url // main memory only; includes the exact transport query
      active.request = r
      active.sentAt = now()
    },
    completed(details) {
      // HTTP completion is not proof that Angular published all old cards.
      // Keep that missing evidence separate from the paid-submit quarantine:
      // no safetyStop/postClick is recorded for a refused baseline.
      if (galleryRequests.delete(details.id)) { galleryRenderUnproven = true; resetGallery() }
      if (active?.upload && active.upload.id === details.id) {
        if (details.statusCode !== 200 || details.fromCache) return invalidate('upload-failed')
        active.upload.complete = true
        return
      }
      if (!active?.request || active.id !== details.id) return
      if (details.statusCode !== 200 || details.fromCache) return invalidate('request-failed')
      active.complete = true
      active.completedAt = now()
    },
    failed(details) {
      galleryRequests.delete(details.id)
      if (active?.upload && active.upload.id === details.id) invalidate('upload-failed')
      if (active?.request && active.id === details.id) invalidate('request-failed')
    },
    invalidate,
    begin(expected) {
      if (uncertain) throw new Error('ownership-uncertain')
      if (active) throw new Error('capture-busy')
      if (galleryRequests.size && !expected.responseProof) throw new Error('gallery-request-pending')
      const rec = { expected, controller: new AbortController(), prepared: false, dispatched: false, request: null, complete: false, error: null }
      active = rec
      return {
        signal: rec.controller.signal,
        state: () => ({ request: rec.request, requestUrl: rec.requestUrl, complete: rec.complete, error: rec.error, sentAt: rec.sentAt, completedAt: rec.completedAt,
          galleryPending: galleryRequests.size > 0, galleryRenderUnproven }),
        armUpload(verify) {
          if (active !== rec || rec.error || rec.prepared || rec.upload) throw new Error('upload-busy')
          const up = { armed: true, verify }
          rec.upload = up
          return { state: () => up, release() { if (rec.upload === up) rec.upload = null } }
        },
        observeGallery(snapshot) {
          if (!snapshot?.ok || galleryRequests.size) { resetGallery(); return }
          const key = JSON.stringify([snapshot.revision, snapshot.items.map(i => [i.mediaId, i.src]).sort()])
          if (key !== galleryKey) { galleryKey = key; galleryStableAt = now() }
          else if (now() - galleryStableAt >= gallerySettleMs) galleryRenderUnproven = false
        },
        abort(reason) {
          rec.error ||= reason
          rec.controller.abort()
        },
        prepare() {
          if (active !== rec || rec.error || rec.prepared) throw new Error('ownership-uncertain')
          if (!expected.responseProof && (galleryRequests.size || galleryRenderUnproven)) throw new Error('gallery-render-unproven')
          rec.prepared = true
        },
        dispatch() {
          // The helper reports a click after it happened, possibly after an
          // abort. Record that fact even when observation has already stopped.
          if (active !== rec || rec.dispatched) throw new Error('ownership-uncertain')
          rec.prepared = true
          rec.dispatched = true
        },
        release(success = false) {
          if (active !== rec) return
          if (!success && (rec.dispatched || rec.request)) invalidate()
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
export function bindPassiveRequests(session, capture, observeExisting = () => {}, diagnostics = {}) {
  const token = {}
  bindings.set(session, token)
  const filter = { urls: ['*://*/*'] }
  session.webRequest.onBeforeRequest(filter, (details, callback) => {
    try { capture.before(details); observeExisting(details) }
    catch { capture.invalidate('observer-failed') }
    finally { callback({}) }
    // Diagnostic failures must never change traffic or ownership state.
    try { diagnostics.before?.(details) } catch {}
  })
  session.webRequest.onCompleted(filter, details => {
    capture.completed(details)
    try { diagnostics.completed?.(details) } catch {}
  })
  session.webRequest.onErrorOccurred(filter, details => {
    capture.failed(details)
    try { diagnostics.failed?.(details) } catch {}
  })
  return () => {
    capture.invalidate('view-destroyed')
    if (bindings.get(session) !== token) return
    bindings.delete(session)
    session.webRequest.onBeforeRequest(filter, null)
    session.webRequest.onCompleted(filter, null)
    session.webRequest.onErrorOccurred(filter, null)
  }
}
