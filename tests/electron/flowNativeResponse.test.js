// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { once, EventEmitter } from 'node:events'
import { netLogResponseBody, imageResultsFromNetLog, startFlowResponseCapture } from '../../electron/flow-native-response.js'
import { sample, samplePayload, respBodyFailure, respBodyWithPayload, maskedUuid, reencodeRequestBody } from '../fixtures/flow-batchexecute-samples.js'
import { s3, s3Payload, s3RequestBody } from '../fixtures/flow-m3-samples.js'
import { readImageRequest } from '../../electron/flow-passive-capture.js'
import { decodeFReqInner, extractSubmitPrompts, extractSubmitRefs, parseBatchexecuteResponse, parseVideoSubmitResponse } from '../../electron/flow-rpc-protocol.js'
import { PROJECT, PROMPT } from '../fixtures/flow-passive-image.js'

const URL = 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b&_reqid=123'
const types = { URL_REQUEST_START_JOB: 1, URL_REQUEST_JOB_FILTERED_BYTES_READ: 2,
  URL_REQUEST_JOB_BYTES_READ: 3, URL_REQUEST_FILTERS_SET: 4, HTTP_TRANSACTION_READ_RESPONSE_HEADERS: 5,
  URL_REQUEST_REDIRECTED: 6 }
const event = (type, params, extra = {}) => ({ source: { id: 22, type: 1 }, type: types[type], phase: 0, params, ...extra })
function log(body = sample('ogiZ0b').respBody, { identity = false, url = URL } = {}) {
  const bytes = Buffer.from(body)
  const chunks = [bytes.subarray(0, 73), bytes.subarray(73)]
  return { constants: { logEventTypes: types, logSourceType: { URL_REQUEST: 1 } }, events: [
    event('URL_REQUEST_START_JOB', { url, method: 'POST' }, { phase: 1 }),
    event('HTTP_TRANSACTION_READ_RESPONSE_HEADERS', { headers: ['HTTP/1.1 200 OK', ...(identity ? [] : ['Content-Encoding: gzip'])] }),
    ...(!identity ? [event('URL_REQUEST_FILTERS_SET', { filters: 'gzip' })] : []),
    ...chunks.map(b => event(identity ? 'URL_REQUEST_JOB_BYTES_READ' : 'URL_REQUEST_JOB_FILTERED_BYTES_READ', { bytes: b.toString('base64'), byte_count: b.length })),
    event('URL_REQUEST_START_JOB', { net_error: 0 }, { phase: 2 }),
  ] }
}
const encode = value => JSON.stringify(value)
const expected = { projectId: PROJECT, prompts: [PROMPT], seeds: [1687588041], count: 1 }

describe('native NetLog response ownership', () => {
  it('reads only the exact URL and request source, reconstructing split UTF-8 response bytes', () => {
    const data = log()
    data.events.push(event('URL_REQUEST_START_JOB', { url: URL + '0', method: 'POST' }, { phase: 1, source: { id: 99, type: 1 } }))
    data.events.push(event('URL_REQUEST_JOB_FILTERED_BYTES_READ', { bytes: Buffer.from('foreign').toString('base64'), byte_count: 7 }, { source: { id: 99, type: 1 } }))
    expect(netLogResponseBody(encode(data), URL)).toBe(sample('ogiZ0b').respBody)
  })
  it('accepts the FIFO exporter final trailing comma without changing JSON string contents', () => {
    const data = log('body with ,] inside text 한글')
    data.events[0].params.url += '&literal=,]'
    const raw = encode(data).replace(/]}$/, ',]}')
    expect(netLogResponseBody(raw, URL + '&literal=,]')).toBe('body with ,] inside text 한글')
  })
  it('does not repair malformed nested arrays outside the exporter events boundary', () => {
    const data = log()
    data.constants.extra = [1]
    expect(() => netLogResponseBody(encode(data).replace('"extra":[1]', '"extra":[1,]'), URL)).toThrow()
  })
  it('accepts unfiltered identity bytes only after response headers prove identity encoding', () => {
    expect(netLogResponseBody(encode(log('identity 한글', { identity: true })), URL)).toBe('identity 한글')
    const data = log('compressed bytes', { identity: true })
    data.events[1].params.headers.push('Content-Encoding: br')
    expect(() => netLogResponseBody(encode(data), URL)).toThrow()
  })
  it.each(['same-source-restart', 'other-source-duplicate', 'missing-start', 'redirect', 'failed', 'broken-base64', 'wrong-byte-count', 'missing-headers', 'truncated'])('refuses %s evidence', kind => {
    const data = log()
    if (kind === 'same-source-restart') data.events.unshift(data.events[0])
    if (kind === 'other-source-duplicate') data.events.unshift({ ...data.events[0], source: { id: 99, type: 1 } })
    if (kind === 'missing-start') data.events.shift()
    if (kind === 'redirect') data.events.push(event('URL_REQUEST_REDIRECTED', { location: 'https://other.example/' }))
    if (kind === 'failed') data.events.at(-1).params.net_error = -3
    if (kind === 'broken-base64') data.events[3].params.bytes = 'invalid!'
    if (kind === 'wrong-byte-count') data.events[3].params.byte_count++
    if (kind === 'missing-headers') data.events.splice(1, 1)
    const text = kind === 'truncated' ? encode(data).slice(0, -20) : encode(data)
    expect(() => netLogResponseBody(text, URL)).toThrow()
  })
  it('returns response media IDs, independent of any old gallery cards', () => {
    expect(imageResultsFromNetLog(encode(log()), URL, expected)).toEqual([
      expect.objectContaining({ mediaId: maskedUuid(5), width: 1376, height: 768 }),
    ])
  })
  it('accepts the masked reference image response only when returned IDs echo the request refs', () => {
    const body = respBodyWithPayload('ogiZ0b', s3Payload(9))
    const input = s3RequestBody(9)
    const decoded = decodeFReqInner(input)
    const refs = extractSubmitRefs('ogiZ0b', decoded.inner)
    const prompts = extractSubmitPrompts('ogiZ0b', decoded.inner)
    const payload = s3Payload(9)
    const request = { projectId: decoded.inner[3][5], prompts, seeds: [payload[0][0][6][0][1]], count: 1,
      refs: refs.refs, mentions: refs.mentions }
    const results = imageResultsFromNetLog(encode(log(body)), URL, request)
    expect(results).toHaveLength(1)
    expect(() => imageResultsFromNetLog(encode(log(body)), URL, { ...request, refs: [maskedUuid(999)] })).toThrow()
  })
  // S3#19 is the saved real one-ref/two-mention wire sample. CupPalette and the
  // trailing single mention are a synthetic adaptation, not part of that recording.
  it('parses a synthetic trailing @CupPalette single-ref request/response adapted from saved S3#19', () => {
    const fixture = s3(19)
    const decoded = decodeFReqInner(s3RequestBody(19))
    const inner = structuredClone(decoded.inner)
    const refId = extractSubmitRefs('ogiZ0b', inner).refs[0]
    const promptText = 'A cobalt cup on a bright table'
    inner[1][0][8] = [[ [promptText], [null, [[refId, 'CupPalette']]] ]]
    const requestBody = `f.req=${encodeURIComponent(JSON.stringify([[['ogiZ0b', JSON.stringify(inner), null, 'generic']]]))}&at=SECRET&`
    const refs = extractSubmitRefs('ogiZ0b', inner)
    const request = readImageRequest({ id: 90, webContentsId: 7, method: 'POST', url: fixture.url,
      uploadData: [{ bytes: Buffer.from(requestBody) }] }, refs)
    expect(request).toMatchObject({ prompts: [promptText], refs: [refId], mentions: [refId], count: 1 })

    const response = s3Payload(19)
    response[0][0][6][0][15][2][0][2] = [[[promptText]]]
    const body = respBodyWithPayload('ogiZ0b', response)
    const result = imageResultsFromNetLog(encode(log(body, { url: fixture.url })), fixture.url, request)
    expect(result).toMatchObject([{ mediaId: maskedUuid(50), width: 768, height: 1376 }])
  })
  it('reports the server RPC rejection code without flattening it to a generic frame error', () => {
    expect(() => imageResultsFromNetLog(encode(log(respBodyFailure('ogiZ0b', 7))), URL, expected))
      .toThrowError(new Error('response-proof-rpc-code-7'))
  })
  it('reports a stable image payload path for malformed dimensions without exposing raw payload', () => {
    const payload = structuredClone(samplePayload('ogiZ0b'))
    payload[0][0][6][2] = [1376]
    const body = respBodyWithPayload('ogiZ0b', payload)
    let thrown
    try { imageResultsFromNetLog(encode(log(body)), URL, expected) } catch (e) { thrown = e }
    expect(thrown?.message).toBe('response-proof-shape:ogiZ0b@[0][0][6][2]')
    expect(thrown?.message).not.toContain(JSON.stringify(payload))
  })
  it.each(['duplicate-frame', 'late-error-frame', 'seed', 'prompt', 'id', 'http-url', 'wrong-path', 'count'])('refuses a mismatching %s response', kind => {
    const payload = structuredClone(samplePayload('ogiZ0b'))
    const record = payload[0][0][6][0]
    let body
    if (kind === 'seed') record[1]++
    if (kind === 'prompt') record[15][2][0][2] = [[['different prompt']]]
    if (kind === 'id') payload[0][0][0] = 'invalid'
    if (kind === 'http-url') record[13] = record[13].replace('https:', 'http:')
    if (kind === 'wrong-path') record[13] = 'https://flow-content.google/image/another-id'
    body = respBodyWithPayload('ogiZ0b', payload)
    if (kind === 'duplicate-frame') body += '\n' + body.split('\n').find(line => line.startsWith('['))
    if (kind === 'late-error-frame') body += '\n' + JSON.stringify([['er', null, null, null, null, 403, null, null, null, 16]])
    expect(() => imageResultsFromNetLog(encode(log(body)), URL, kind === 'count' ? { ...expected, count: 2 } : expected)).toThrow()
  })
})

describe('native video response ownership', () => {
  it.each([
    ['T2V', 'YhhmEf', sample('YhhmEf').respBody, 'abra_t2v_6s', { model: 'Omni Flash', duration: 6, ratio: '16:9', resolution: '720p', kind: 't2v' }],
    ['R2V', 'MZZa6b', s3(10).respBody, 'abra_r2v_4s', { model: 'Omni Flash', duration: 4, ratio: '9:16', resolution: '720p', kind: 'r2v' }],
  ])('returns the response media ID for a masked %s request and checks its refs/model', async (_label, rpcid, body, modelKey, want) => {
    const fixture = rpcid === 'MZZa6b' ? s3(10) : sample(rpcid)
    const encoded = rpcid === 'MZZa6b' ? s3RequestBody(10) : reencodeRequestBody(fixture.reqBody)
    const decoded = decodeFReqInner(encoded)
    const refs = extractSubmitRefs(rpcid, decoded.inner)
    const request = { rpcid, projectId: PROJECT,
      prompts: extractSubmitPrompts(rpcid, decoded.inner), refs: refs.refs, mentions: refs.mentions, want,
      modelKey: rpcid === 'MZZa6b' ? 'abra_r2v_4s' : 'abra_t2v_6s' }
    const url = `https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=${rpcid}&_reqid=123`
    const { videoResultFromNetLog } = await import('../../electron/flow-native-response.js')
    const result = videoResultFromNetLog(encode(log(body, { url })), url, request)
    expect(result).toMatchObject({ mediaId: expect.any(String) })
    expect(() => videoResultFromNetLog(encode(log(body, { url })), url, { ...request, modelKey: 'abra_t2v_wrong' })).toThrow()
    if (request.refs.length) expect(() => videoResultFromNetLog(encode(log(body, { url })), url, { ...request, refs: [] })).toThrow()
  })
  it('validates the masked I2V eb1hJf response against the requested start-frame identity and model', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { videoResultFromNetLog } = await import('../../electron/flow-native-response.js')
    const path = fileURLToPath(new globalThis.URL('../../docs/handoffs/evidence/2026-10-30-flow-i2v-eb1hJf.masked.jsonl', import.meta.url))
    const fixture = JSON.parse(readFileSync(path, 'utf8'))
    const body = fixture.respBody.replace(/<uuid#(\d+)>/g, (_m, n) => maskedUuid(Number(n)))
    const rpcid = 'eb1hJf'
    const url = `${fixture.url}&_reqid=123`
    const parsed = parseVideoSubmitResponse(parseBatchexecuteResponse(body, rpcid), rpcid)
    const request = { rpcid, projectId: maskedUuid(4), prompts: parsed.echo, refs: [maskedUuid(5)], mentions: [],
      want: { model: 'Omni Flash', duration: 4, ratio: '9:16', resolution: '720p', kind: 'i2v' }, modelKey: parsed.modelKey }
    expect(videoResultFromNetLog(encode(log(body, { url })), url, request)).toMatchObject({ mediaId: parsed.mediaId })
    expect(() => videoResultFromNetLog(encode(log(body, { url })), url, { ...request, refs: [] })).toThrow()
  })
})

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function fifoSession({ lateStart = null, stopFailure = false } = {}) {
  let writer
  const netLog = { currentlyLogging: false,
    async startLogging(file, options) {
      expect(options).toEqual({ captureMode: 'everything' }) // maxFileSize would persist raw scratch files
      if (lateStart) await lateStart
      writer = fs.createWriteStream(file)
      await once(writer, 'open')
      netLog.currentlyLogging = true
      writer.write(encode(log()))
    },
    async stopLogging() {
      netLog.currentlyLogging = false
      const closed = once(writer, 'close')
      writer.end()
      await closed
      if (stopFailure) throw new Error('synthetic stop failure')
    },
  }
  return { netLog }
}
async function directory() {
  const root = path.resolve('.work/native-response-tests')
  fs.mkdirSync(root, { recursive: true })
  return fs.mkdtempSync(path.join(root, 'case-'))
}
describe('native response FIFO lifecycle', () => {
  it('keeps raw bytes in a FIFO, cleans it after finish and releases the single capture lease', async () => {
    const dir = await directory()
    let capture
    try {
      const session = fifoSession()
      capture = await startFlowResponseCapture(session, { directory: dir })
      expect(fs.lstatSync(path.join(dir, fs.readdirSync(dir)[0], 'events.fifo')).isFIFO()).toBe(true)
      expect(capture.assertReady()).toBeUndefined()
      expect(await capture.finish(URL, expected)).toHaveLength(1)
      expect(fs.readdirSync(dir)).toEqual([])
      const next = await startFlowResponseCapture(session, { directory: dir })
      await next.cancel()
      expect(fs.readdirSync(dir)).toEqual([])
    } finally { await capture?.cancel().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }) }
  })
  it('returns before click when start is aborted and cleans up a late successful start', async () => {
    const dir = await directory()
    let release
    const late = new Promise(resolve => { release = resolve })
    const controller = new AbortController()
    const session = fifoSession({ lateStart: late })
    const pending = startFlowResponseCapture(session, { directory: dir, signal: controller.signal })
    const outcome = pending.then(capture => ({ capture }), () => ({ rejected: true }))
    controller.abort()
    try {
      expect(await Promise.race([outcome, delay(100).then(() => 'unbounded')])).toEqual({ rejected: true })
    } finally {
      release()
      const final = await outcome
      await final.capture?.cancel()
      for (let i = 0; i < 30 && fs.readdirSync(dir).length; i++) await delay(10)
      expect(fs.readdirSync(dir)).toEqual([])
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
  it('exposes an early byte-cap failure to the final native dispatch guard and still drains', async () => {
    const dir = await directory()
    let capture
    try {
      capture = await startFlowResponseCapture(fifoSession(), { directory: dir, maxBytes: 100 })
      await delay(20)
      expect(() => capture.assertReady()).toThrow(/response-proof-size/)
      await capture.cancel().catch(() => {})
      expect(fs.readdirSync(dir)).toEqual([])
    } finally { await capture?.cancel().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }) }
  })
  it('rejects stop failure, removes the drained FIFO, and never returns unproven results', async () => {
    const dir = await directory()
    try {
      const capture = await startFlowResponseCapture(fifoSession({ stopFailure: true }), { directory: dir })
      await expect(capture.finish(URL, expected)).rejects.toThrow()
      expect(fs.readdirSync(dir)).toEqual([])
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
  it('keeps the lease poisoned when reader error and unconfirmed exporter stop happen together', async () => {
    const dir = await directory()
    const reader = new EventEmitter()
    const spy = vi.spyOn(fs, 'createReadStream').mockReturnValue(reader)
    const session = { netLog: { currentlyLogging: false, startLogging: vi.fn(async () => {}),
      stopLogging: vi.fn(async () => { throw new Error('synthetic unconfirmed stop') }) } }
    let first, second
    try {
      first = await startFlowResponseCapture(session, { directory: dir })
      reader.emit('error', new Error('synthetic reader failure'))
      await delay(20)
      second = await startFlowResponseCapture(session, { directory: dir }).then(capture => ({ capture }), e => ({ error: e.message }))
      expect(second).toEqual({ error: 'response-proof-unavailable' })
      expect(session.netLog.startLogging).toHaveBeenCalledOnce()
    } finally {
      reader.emit('end') // close the synthetic test pipes even when the assertion fails
      await first?.cancel().catch(() => {})
      await second?.capture?.cancel().catch(() => {})
      spy.mockRestore()
      fs.rmSync(dir, { recursive: true, force: true })
      // This is intentionally the last lifecycle test: only an app restart
      // can recover the production module's unconfirmed exporter lease.
    }
  })
})
