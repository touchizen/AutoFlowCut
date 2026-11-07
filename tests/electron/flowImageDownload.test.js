// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import * as dl from '../../electron/flow-image-download.js'
import { NEW } from '../fixtures/flow-passive-image.js'
afterEach(() => vi.useRealTimers())
function harness() {
  const req = new EventEmitter(); req.end = vi.fn(); req.abort = vi.fn()
  const net = { request: vi.fn(() => req) }, session = {}
  const res = new EventEmitter(); res.statusCode = 200; res.headers = { 'content-type': ['image/png'] }
  const signal = new AbortController()
  const start = opts => dl.downloadFlowImage(net, session, { mediaId: NEW, src: `https://flow.google.com/api/trpc/media.getMediaUrlRedirect?name=${NEW}` }, { signal: signal.signal, ...opts })
  return { req, net, session, res, signal, start }
}
it('uses main net with the owning session cookies and removes listeners on success', async () => {
  const h = harness(); const result = h.start()
  h.req.emit('response', h.res); h.res.emit('data', Buffer.from('png')); h.res.emit('end')
  expect(await result).toMatchObject({ mediaId: NEW, base64: 'data:image/png;base64,cG5n' })
  expect(h.net.request).toHaveBeenCalledWith(expect.objectContaining({ session: h.session, useSessionCookies: true, method: 'GET' }))
  expect(h.req.eventNames()).toEqual([]); expect(h.res.eventNames()).toEqual([])
})
it('waits for the response when Electron closes the finished request writable first', async () => {
  const h = harness(); const result = h.start()
  // Electron 36 ClientRequest is an auto-destroying Writable. Its GET side can
  // close before the native URLLoader delivers the response body.
  h.req.emit('finish'); h.req.emit('close')
  h.req.emit('response', h.res); h.res.emit('data', Buffer.from('original')); h.res.emit('end')
  expect(await result).toMatchObject({ mediaId: NEW, base64: 'data:image/png;base64,b3JpZ2luYWw=' })
  expect(h.req.abort).not.toHaveBeenCalled()
})
it('registers end before enabling a buffered response to flow', async () => {
  const h = harness()
  const on = h.res.on
  h.res.on = function (name, listener) {
    on.call(this, name, listener)
    if (name === 'data') { this.emit('data', Buffer.from('png')); this.emit('end') }
    return this
  }
  const result = h.start({ timeoutMs: 100 })
  h.req.emit('response', h.res)
  expect(await result).toMatchObject({ base64: 'data:image/png;base64,cG5n' })
  expect(h.req.eventNames()).toEqual([]); expect(h.res.eventNames()).toEqual([])
})
it('rejects a response stream that closes before end', async () => {
  const h = harness(); const result = h.start()
  const rejected = expect(result).rejects.toThrow('download-incomplete')
  h.req.emit('response', h.res); h.res.emit('data', Buffer.from('partial')); h.res.emit('close')
  await rejected
  expect(h.req.abort).toHaveBeenCalledOnce()
})
it('absorbs the response error queued after an Electron request error', async () => {
  const h = harness(); const result = h.start()
  const rejected = expect(result).rejects.toThrow('download-network')
  h.req.emit('response', h.res); h.res.emit('data', Buffer.from('partial'))
  h.req.emit('error', new Error('ERR_INCOMPLETE_CHUNKED_ENCODING'))
  await rejected
  // URLLoader error destroys the response on nextTick and synchronously errors
  // its already-closed request Writable first. The response must stay handled.
  expect(() => h.res.emit('error', new Error('ERR_INCOMPLETE_CHUNKED_ENCODING'))).not.toThrow()
  h.res.emit('close')
  expect(h.req.eventNames()).toEqual([]); expect(h.res.eventNames()).toEqual([])
})
it.each(['timeout', 'cancel', 'network', 'stream', 'http', 'mime', 'size', 'close', 'empty'])('aborts and cleans up on %s', async kind => {
  vi.useFakeTimers()
  const h = harness(); const result = h.start({ timeoutMs: 100, maxBytes: 4 })
  const rejected = expect(result).rejects.toThrow()
  if (kind === 'timeout') await vi.advanceTimersByTimeAsync(101)
  else if (kind === 'cancel') h.signal.abort()
  else if (kind === 'network') h.req.emit('error', new Error('network'))
  else {
    if (kind === 'http') h.res.statusCode = 403
    if (kind === 'mime') h.res.headers = { 'content-type': ['text/html'] }
    h.req.emit('response', h.res)
    if (kind === 'stream') h.res.emit('error', new Error('stream'))
    if (kind === 'size') h.res.emit('data', Buffer.from('12345'))
    if (kind === 'close') h.res.emit('aborted')
    if (kind === 'empty') h.res.emit('end')
  }
  h.res.emit('close') // Native abort/error destroys the response stream.
  await rejected
  expect(h.req.abort).toHaveBeenCalledOnce()
  expect(h.req.eventNames()).toEqual([]); expect(h.res.eventNames()).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})
it('refuses foreign URLs and pre-cancelled work before starting a request', async () => {
  const h = harness()
  await expect(dl.downloadFlowImage(h.net, h.session, { mediaId: NEW, src: 'https://evil.example/image.png' })).rejects.toThrow()
  h.signal.abort(); await expect(h.start()).rejects.toThrow()
  expect(h.net.request).not.toHaveBeenCalled()
})
it('resolves an opaque thumbnail media ID through the existing original-media redirect', async () => {
  const h = harness()
  const p = dl.downloadFlowImage(h.net, h.session, { mediaId: NEW, src: 'https://flow.google.com/asb/thumb=s160' })
  h.req.emit('response', h.res); h.res.emit('data', Buffer.from('original')); h.res.emit('end')
  await p
  expect(h.net.request.mock.calls[0][0].url).toBe(`https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${NEW}`)
})
