// @vitest-environment node
import { expect, it, vi } from 'vitest'
import fs from 'node:fs'
import * as capture from '../../electron/flow-passive-capture.js'
import { flowPagePolicy } from '../../electron/flow-page-policy.js'
import { request, PROJECT, PROMPT } from '../fixtures/flow-passive-image.js'
function network() {
  const handlers = {}
  const session = { webRequest: Object.fromEntries(['onBeforeRequest', 'onCompleted', 'onErrorOccurred'].map(k => [k, vi.fn((_filter, cb) => { handlers[k] = cb })])) }
  return { session, handlers }
}
it('binds one passive callback per event and preserves existing request observation unchanged', () => {
  const { session, handlers } = network(), observer = capture.createPassiveCapture(), previous = vi.fn()
  const dispose = capture.bindPassiveRequests(session, observer, previous)
  const lease = observer.begin({ webContentsId: 7, projectId: PROJECT, prompt: PROMPT, count: 1 }); lease.dispatch()
  const r = request(), original = Buffer.from(r.uploadData[0].bytes), callback = vi.fn()
  handlers.onBeforeRequest(r, callback)
  expect(callback).toHaveBeenCalledExactlyOnceWith({})
  expect(previous).toHaveBeenCalledWith(r)
  expect(r.uploadData[0].bytes).toEqual(original)
  handlers.onCompleted({ id: 10, statusCode: 200 }); expect(lease.state().complete).toBe(true)
  lease.release(true); dispose()
  expect(handlers.onBeforeRequest).toBeNull(); expect(handlers.onCompleted).toBeNull(); expect(handlers.onErrorOccurred).toBeNull()
})
it('always releases the request callback, even if an observer fails', () => {
  const { session, handlers } = network(), callback = vi.fn(), observer = capture.createPassiveCapture()
  capture.bindPassiveRequests(session, observer, () => { throw new Error('diagnostic') })
  handlers.onBeforeRequest(request(), callback)
  expect(callback).toHaveBeenCalledExactlyOnceWith({})
})
it('an old view disposer cannot detach a newer session observer', () => {
  const { session, handlers } = network()
  const old = capture.bindPassiveRequests(session, capture.createPassiveCapture())
  capture.bindPassiveRequests(session, capture.createPassiveCapture())
  const newer = handlers.onBeforeRequest; old()
  expect(handlers.onBeforeRequest).toBe(newer)
})
it('main wires passive requests and main session download into the default image lane', () => {
  const main = fs.readFileSync(new URL('../../electron/main.js', import.meta.url), 'utf8')
  expect(main).toContain('bindPassiveRequests(')
  expect(main).toContain('getPassiveCapture:')
  expect(main).toContain('downloadPassiveImage:')
  expect(main.match(/\.onBeforeRequest\(/g) || []).toHaveLength(0)
  const injection = main.match(/function injectRpcCapture\(view\) \{([\s\S]*?)\n\}/)[1]
  const wc = { executeJavaScript: vi.fn(), isDestroyed: () => false }
  Function('FLOW_PAGE_POLICY', 'view', injection)(flowPagePolicy({}), { webContents: wc })
  expect(wc.executeJavaScript).not.toHaveBeenCalled()
})
