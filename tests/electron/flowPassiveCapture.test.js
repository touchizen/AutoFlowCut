// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as capture from '../../electron/flow-passive-capture.js'
import { request, galleryRequest, PROJECT, PROMPT } from '../fixtures/flow-passive-image.js'
const setup = () => {
  const observer = capture.createPassiveCapture()
  const lease = observer.begin({ webContentsId: 7, projectId: PROJECT, prompt: PROMPT, count: 1 })
  return { observer, lease }
}
describe('passive image request ownership', () => {
  it('reads chunked upload bytes, prompt, count, seed and project without retaining tokens', () => {
    const r = request(); const bytes = r.uploadData[0].bytes
    r.uploadData = [{ bytes: bytes.subarray(0, 90) }, { bytes: bytes.subarray(90) }]
    expect(capture.readImageRequest(r)).toEqual({ projectId: PROJECT, prompts: [PROMPT], seeds: [1687588041], count: 1 })
    expect(JSON.stringify(capture.readImageRequest(r))).not.toContain('SECRET')
  })
  it.each([
    ['file upload', r => { r.uploadData = [{ file: '/secret' }] }],
    ['missing bytes', r => { r.uploadData = [] }],
    ['foreign host', r => { r.url = r.url.replace('flow.google.com', 'evil.example') }],
  ])('rejects %s', (_name, mutate) => { const r = request(); mutate(r); expect(capture.readImageRequest(r)).toBeNull() })
  it('requires one request after dispatch and successful completion', () => {
    const { observer, lease } = setup()
    lease.dispatch()
    observer.before(request())
    expect(lease.state().request).toMatchObject({ count: 1, seeds: [1687588041] })
    expect(lease.state().complete).toBe(false)
    observer.completed({ id: 99, statusCode: 200 })
    expect(lease.state().complete).toBe(false)
    observer.completed({ id: 10, statusCode: 200 })
    expect(lease.state().complete).toBe(true)
    lease.release(true)
    expect(() => setup()).not.toThrow()
  })
  it.each([
    ['before dispatch', (o) => o.before(request())],
    ['other tab', (o,l) => { l.dispatch(); o.before(request({ webContentsId: 9 })) }],
    ['duplicate', (o,l) => { l.dispatch(); o.before(request()); o.before(request({ id: 11 })) }],
    ['prompt mismatch', (o,l) => { l.dispatch(); o.before(request({}, i => { i[1][0][8][0][0][0] = 'foreign' })) }],
    ['count mismatch', (o,l) => { l.dispatch(); o.before(request({}, i => { i[1].push(i[1][0]) })) }],
    ['project mismatch', (o,l) => { l.dispatch(); o.before(request({}, i => { i[3][5] = 'other' })) }],
    ['reference request', (o,l) => { l.dispatch(); o.before(request({}, i => { i[1][0][2] = [['10000000-0000-4000-8000-000000000001']] })) }],
    ['mixed batch', (o,l) => { l.dispatch(); o.before(request({}, (_i,e) => { e[0].push(['YhhmEf', '[]']) })) }],
    ['HTTP failure', (o,l) => { l.dispatch(); o.before(request()); o.completed({ id: 10, statusCode: 403 }) }],
    ['network failure', (o,l) => { l.dispatch(); o.before(request()); o.failed({ id: 10 }) }],
  ])('quarantines %s and refuses another generation', (_name, act) => {
    const { observer, lease } = setup(); act(observer, lease)
    expect(lease.state().error).toBeTruthy()
    lease.release(false)
    expect(() => observer.begin({})).toThrow()
  })
  it('holds an exclusive lease and keeps abandoned sends quarantined after release', () => {
    const { observer, lease } = setup()
    expect(() => observer.begin({})).toThrow(/busy/)
    lease.dispatch(); lease.release(false)
    expect(() => observer.begin({})).toThrow(/uncertain/)
  })
  it('rejects existing in-flight submissions; read-only traffic does not bind', () => {
    const o = capture.createPassiveCapture(); o.before(request())
    expect(() => o.begin({})).toThrow()
    o.completed({ id: 10, statusCode: 200 })
    // A completed unowned request may still publish a delayed gallery result.
    expect(() => o.begin({})).toThrow()
  })
})
it('accepts the original masked wire recording, not only the synthetic request fixture', async () => {
  const { sample, reencodeRequestBody } = await import('../fixtures/flow-batchexecute-samples.js')
  const original = sample('ogiZ0b')
  expect(capture.readImageRequest({ ...request(), url: original.url, uploadData: [{ bytes: Buffer.from(reencodeRequestBody(original.reqBody)) }] }))
    .toMatchObject({ projectId: PROJECT, prompts: [PROMPT], count: 1, seeds: [1687588041] })
})
it('does not retain a successful lease and accepts the next exclusive request', () => {
  const { observer, lease } = setup(); lease.dispatch(); observer.before(request()); observer.completed({ id: 10, statusCode: 200 }); lease.release(true)
  const next = observer.begin({ webContentsId: 7, projectId: PROJECT, prompt: PROMPT, count: 1 })
  next.dispatch(); observer.before(request({ id: 11 })); observer.completed({ id: 11, statusCode: 200 })
  expect(next.state().complete).toBe(true); next.release(true)
})
it('ignores a proven read-only RPC without taking ownership', () => {
  const { observer, lease } = setup(); lease.dispatch()
  const read = request({ url: request().url.replace('ogiZ0b', 'nzlxg') }, (_i, e) => { e[0][0][0] = 'nzlxg' })
  observer.before(read)
  expect(lease.state()).toMatchObject({ error: null, request: null, complete: false })
})

it('refuses a baseline while an earlier gallery listing is in flight', () => {
  const observer = capture.createPassiveCapture()
  observer.before(galleryRequest())
  expect(() => observer.begin({})).toThrow('gallery-request-pending')
  observer.completed({ id: 20, statusCode: 200 })
  expect(() => observer.begin({})).toThrow('gallery-render-unproven')
})

it('rejects a gallery listing that starts during the ownership window', () => {
  const { observer, lease } = setup()
  observer.before(galleryRequest())
  expect(lease.state().error).toBe('gallery-request-overlap')
})

it('does not latch a pre-click listing overlap after that listing fails without rendering', () => {
  const { observer, lease } = setup()
  observer.before(galleryRequest())
  observer.failed({ id: 20 })
  lease.release(false)
  expect(() => observer.begin({})).not.toThrow()
})

it('clears failed gallery requests without treating them as submissions', () => {
  const observer = capture.createPassiveCapture()
  observer.before(galleryRequest())
  expect(() => observer.begin({})).toThrow('gallery-request-pending')
  observer.failed({ id: 20 })
  expect(() => observer.begin({})).not.toThrow()
})

it('releases prepared observation without quarantining an undispatched click', () => {
  const { observer, lease } = setup()
  lease.prepare()
  lease.release(false)
  expect(() => observer.begin({})).not.toThrow()
})

it('quarantines an observed request even before the click helper returns', () => {
  const { observer, lease } = setup()
  lease.prepare()
  observer.before(request())
  expect(lease.state().request).toMatchObject({ count: 1 })
  lease.release(false)
  expect(() => observer.begin({})).toThrow('ownership-uncertain')
})

it.each([false, true])('only quarantines cancellation if a click was dispatched: %s', dispatched => {
  const { observer, lease } = setup()
  lease.prepare()
  if (dispatched) lease.dispatch()
  lease.abort('capture-aborted')
  expect(lease.signal.aborted).toBe(true)
  lease.release(false)
  if (dispatched) expect(() => observer.begin({})).toThrow('ownership-uncertain')
  else expect(() => observer.begin({})).not.toThrow()
})

it('records a real dispatch reported after cancellation even without an observed request', () => {
  const { observer, lease } = setup()
  lease.prepare()
  lease.abort('capture-aborted')
  expect(() => lease.dispatch()).not.toThrow()
  lease.release(false)
  expect(() => observer.begin({})).toThrow('ownership-uncertain')
})
