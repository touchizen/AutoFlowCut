import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseBatchexecuteResponse, parseImageGenerateResponse, normalizePrompt } from './flow-rpc-protocol.js'

const MAX_BYTES = 32 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const error = reason => new Error(`response-proof-${reason}`)

function parseLog(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw error('size')
  // Chromium's unbounded file exporter seeks back over its last event comma.
  // A FIFO cannot seek. Remove only array trailing commas OUTSIDE strings.
  let quoted = false, escaped = false, start = 0, quoteStart = 0, rootKey = null
  const stack = []
  const parts = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') {
        quoted = false
        if (stack.length === 1) rootKey = text.slice(quoteStart, i + 1) === '"events"' ? 'events' : null
      }
    } else if (ch === '"') { quoted = true; quoteStart = i }
    else if (ch === '{' || ch === '[') stack.push({ ch, events: ch === '[' && stack.length === 1 && rootKey === 'events' })
    else if (ch === '}' || ch === ']') stack.pop()
    else if (ch === ',') {
      let j = i + 1
      while (/\s/.test(text[j] || '') && j < text.length) j++
      if (text[j] === ']' && stack.at(-1)?.events) {
        if (parts.length) throw error('format')
        parts.push(text.slice(start, i)); start = i + 1
      }
    }
  }
  try { return JSON.parse(parts.length ? [...parts, text.slice(start)].join('') : text) }
  catch { throw error('format') }
}

export function netLogResponseBody(text, requestUrl) {
  const log = parseLog(text)
  const types = log?.constants?.logEventTypes
  if (!types || !Array.isArray(log.events) || log.events.length > 200000) throw error('format')
  const starts = log.events.filter(e => e.type === types.URL_REQUEST_START_JOB && e.phase === 1
    && e.params?.url === requestUrl && e.params?.method === 'POST')
  // Count starts, not only distinct source IDs: a restarted request is ambiguous.
  if (starts.length !== 1) throw error('request-ambiguous')
  const source = starts[0].source
  if (!Number.isInteger(source?.id) || source.type !== log.constants.logSourceType?.URL_REQUEST) throw error('source')
  const events = log.events.filter(e => e.source?.id === source.id && e.source?.type === source.type)
  const names = new Map(Object.entries(types).map(([name, code]) => [code, name]))
  if (events.some(e => /REDIRECT/.test(names.get(e.type) || '') || e.params?.net_error < 0)) throw error('transport')
  const headers = events.filter(e => e.type === types.HTTP_TRANSACTION_READ_RESPONSE_HEADERS)
  if (headers.length !== 1 || !Array.isArray(headers[0].params?.headers)) throw error('headers')
  const lines = headers[0].params.headers
  if (!lines.every(h => typeof h === 'string') || !/^HTTP\/\S+\s+200(?:\s|$)/i.test(lines[0] || '')) throw error('http')
  const filtered = events.filter(e => e.type === types.URL_REQUEST_JOB_FILTERED_BYTES_READ)
  let chunks = filtered
  if (!filtered.length) {
    const encoding = lines.filter(h => /^content-encoding\s*:/i.test(h)).map(h => h.split(':').slice(1).join(':').trim().toLowerCase())
    const filters = events.filter(e => e.type === types.URL_REQUEST_FILTERS_SET)
    if (encoding.some(v => v !== 'identity') || filters.some(e => e.params?.filters)) throw error('encoding')
    chunks = events.filter(e => e.type === types.URL_REQUEST_JOB_BYTES_READ)
  }
  if (!chunks.length) throw error('empty')
  let size = 0
  const buffers = chunks.map(e => {
    const value = e.params?.bytes
    if (typeof value !== 'string') throw error('bytes')
    const bytes = Buffer.from(value, 'base64')
    if (bytes.toString('base64') !== value || bytes.length !== e.params.byte_count) throw error('bytes')
    size += bytes.length
    if (size > MAX_BYTES) throw error('size')
    return bytes
  })
  return Buffer.concat(buffers).toString('utf8')
}

export function imageResultsFromNetLog(text, requestUrl, request) {
  const body = netLogResponseBody(text, requestUrl)
  let matches = 0, failed = false
  for (const line of body.split('\n')) {
    if (!line.startsWith('[')) continue
    let frames
    try { frames = JSON.parse(line) } catch { throw error('frames') }
    if (!Array.isArray(frames)) throw error('frames')
    for (const frame of frames) {
      if (!Array.isArray(frame)) continue
      if (frame[0] === 'er') failed = true
      if (frame[0] === 'wrb.fr' && frame[1] === 'ogiZ0b') matches++
    }
  }
  if (failed || matches !== 1) throw error('frames')
  let results
  try { results = parseImageGenerateResponse(parseBatchexecuteResponse(body, 'ogiZ0b')).results }
  catch { throw error('rpc') }
  if (!request || results.length !== request.count || new Set(results.map(r => r.mediaId)).size !== results.length
    || JSON.stringify(results.map(r => r.seed).sort()) !== JSON.stringify([...request.seeds].sort())) throw error('result-mismatch')
  return results.map((r, i) => {
    let url
    try { url = new URL(r.url) } catch { throw error('media-url') }
    if (!UUID.test(r.mediaId) || url.protocol !== 'https:' || url.hostname !== 'flow-content.google'
      || url.port || url.username || url.password || url.pathname !== `/image/${r.mediaId}`
      || normalizePrompt(r.echo.join(' ')) !== normalizePrompt(request.prompts[i])
      || r.refEcho?.length) throw error('result-mismatch')
    return { mediaId: r.mediaId, src: r.url, width: r.width, height: r.height }
  })
}

let active = false
async function bounded(promise, milliseconds, signal, reason) {
  if (signal?.aborted) throw error('aborted')
  let timer, abort
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(error(reason)), milliseconds)
      abort = () => reject(error('aborted'))
      signal?.addEventListener('abort', abort, { once: true })
    })])
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
/** Observe native network service events, without modifying page or traffic.
 * NetLog spans the app's network service, not only this partition. All raw bytes
 * stay in a private FIFO/memory, are bounded and discarded; never use the
 * maxFileSize option (Chromium would create raw scratch files on disk). */
export async function startFlowResponseCapture(session, { directory, signal, maxBytes = MAX_BYTES, timeoutMs = 130000,
  startTimeoutMs = 5000, cleanupTimeoutMs = 5000 } = {}) {
  if (process.platform === 'win32' || !session?.netLog || active || session.netLog.currentlyLogging
    || !directory || !path.isAbsolute(directory) || signal?.aborted) throw error('unavailable')
  active = true
  let dir, fifo, reader, timer, failure, started = false, ownPipeOpened = false, unblocking = false
  let stopPromise, closePromise, total = 0, startPromise = Promise.resolve()
  const chunks = []
  let resolveEnd
  const ended = new Promise(resolve => { resolveEnd = resolve })
  const discard = () => { for (const b of chunks) b.fill(0); chunks.length = 0 }
  const unblockReader = () => {
    unblocking = true
    if (!reader || !fifo) { resolveEnd(); return }
    try { const fd = fs.openSync(fifo, fs.constants.O_RDWR | fs.constants.O_NONBLOCK); fs.closeSync(fd) } catch { resolveEnd() }
  }
  const stop = () => {
    if (stopPromise) return stopPromise
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    closePromise = (async () => {
      // A late start still owns the lease and must be closed before reuse.
      await startPromise.catch(() => {})
      let writerClosed = !started && !ownPipeOpened
      try {
        if (started || ownPipeOpened) { await session.netLog.stopLogging(); writerClosed = true }
        else unblockReader()
      } catch { failure ||= error('stop'); discard() }
      // Never close a reader while the exporter may still be writing. Drain
      // even after the size cap; hold the app lease through exporter EOF.
      const eof = await ended
      // A read error is not EOF. When stop also fails, the writer lifetime is
      // unknown: keep the global lease poisoned until the app restarts.
      if (!eof && !writerClosed) return
      try { if (fifo) fs.unlinkSync(fifo); if (dir) fs.rmdirSync(dir) } catch { failure ||= error('cleanup') }
      active = false
    })()
    stopPromise = bounded(closePromise, cleanupTimeoutMs, null, 'cleanup-timeout').catch(e => {
      failure ||= e; discard(); throw failure
      // The underlying close continues to drain. active stays latched until
      // it completes; an unresponsive exporter cannot permit another submit.
    })
    return stopPromise
  }
  const abort = () => { failure ||= error('aborted'); discard(); void stop().catch(() => {}) }
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    dir = fs.mkdtempSync(path.join(directory, 'flow-response-'))
    fifo = path.join(dir, 'events.fifo')
    execFileSync('/usr/bin/mkfifo', ['-m', '600', fifo], { timeout: 3000 })
    reader = fs.createReadStream(fifo)
    reader.on('open', () => { if (!unblocking) ownPipeOpened = true })
    reader.on('data', chunk => {
      total += chunk.length
      if (total > maxBytes) {
        failure ||= error('size')
        discard()
        void stop().catch(() => {})
      } else if (!failure) chunks.push(chunk)
    })
    reader.on('end', () => resolveEnd(true))
    reader.on('error', () => { failure ||= error('read'); discard(); resolveEnd(false); void stop().catch(() => {}) })
    timer = setTimeout(() => { failure ||= error('timeout'); discard(); void stop().catch(() => {}) }, timeoutMs)
    timer.unref?.()
    signal?.addEventListener('abort', abort, { once: true })
    startPromise = Promise.resolve().then(async () => {
      await session.netLog.startLogging(fifo, { captureMode: 'everything' })
      started = true
    })
    await bounded(startPromise, startTimeoutMs, signal, 'start-timeout')
    if (failure || signal?.aborted) throw failure || error('aborted')
  } catch (e) {
    failure ||= e?.message?.startsWith('response-proof-') ? e : error('start')
    discard()
    // Bounded caller return; late start/close cleanup retains the global lease.
    void stop().catch(() => {})
    throw failure
  }
  return {
    assertReady() { if (failure) throw failure; if (!started || stopPromise) throw error('closed') },
    async finish(requestUrl, request) {
      try {
        await stop()
        if (failure) throw failure
        return imageResultsFromNetLog(Buffer.concat(chunks).toString('utf8'), requestUrl, request)
      } finally { discard() }
    },
    async cancel() { try { await stop() } finally { discard() } },
  }
}
