import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../electron/flow-native-settings.js', () => ({ applyNativeSettings: vi.fn(async () => ({ ok: true })) }))
import { createFlowAngular, _resetDomStageForTests } from '../../electron/ipc/flow-angular.js'
import { registerFlowAPIIPC } from '../../electron/ipc/flow-api.js'
import { createPassiveCapture } from '../../electron/flow-passive-capture.js'
import { downloadFlowImage } from '../../electron/flow-image-download.js'
import { typeFlowText } from '../../electron/flow-native-input.js'
import { applyNativeSettings } from '../../electron/flow-native-settings.js'
import { IMAGE_COMPOSER_KO } from '../fixtures/flow-live-dom-20260924.js'
import { request, PAGE, PROJECT, PROMPT, OLD, NEW, gallery, card } from '../fixtures/flow-passive-image.js'
beforeEach(() => { vi.useFakeTimers(); _resetDomStageForTests(); applyNativeSettings.mockClear() })
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })
function harness(options = {}) {
  document.body.innerHTML = IMAGE_COMPOSER_KO + gallery(card(OLD))
  const button = document.querySelector('button[type="submit"]'); button.removeAttribute('disabled'); button.classList.remove('mat-mdc-button-disabled')
  const wc = new EventEmitter(); let url = PAGE
  Object.assign(wc, { id: 7, session: {}, getURL: () => url, isDestroyed: () => false, isFocused: () => true,
    focus: vi.fn(), selectAll: vi.fn(), insertText: vi.fn(async text => { document.querySelector('.ProseMirror').textContent = text }),
    executeJavaScript: vi.fn(async () => { throw new Error('forbidden main world') }),
    executeJavaScriptInIsolatedWorld: vi.fn(async (_id, scripts) => {
      const code = scripts[0].code
      expect(code).not.toMatch(/window\.__autoflowcut|window\.fetch|XMLHttpRequest|dispatchEvent|execCommand/)
      return Function('document', 'location', `return ${code}`)(document, { href: url })
    }),
  })
  const observer = createPassiveCapture()
  const view = { webContents: wc, getBounds: () => ({ x: 0, y: 0, width: 1200, height: 900 }) }
  const submit = vi.fn(async () => {
    observer.before(request())
    if (options.foreign) observer.before(request({ id: 11, webContentsId: 88 }))
    if (options.httpError) observer.completed({ id: 10, statusCode: 403 })
    else observer.completed({ id: 10, statusCode: 200 })
    if (options.navigate) { url = PAGE + '?changed'; wc.emit('did-navigate-in-page') }
    if (options.renderDelay) {
      document.querySelector('main').insertAdjacentHTML('afterbegin', '<flow-image-tile class="pending-result"></flow-image-tile>')
      setTimeout(() => { document.querySelector('.pending-result').remove(); document.querySelector('main').insertAdjacentHTML('afterbegin', card(NEW)) }, 1000)
    } else if (!options.missing) document.querySelector('main').insertAdjacentHTML('afterbegin', card(NEW))
    if (options.excess) document.querySelector('main').insertAdjacentHTML('afterbegin', card('30000000-0000-4000-8000-000000000003'))
  })
  const net = { request: vi.fn(() => {
    const req = new EventEmitter(); req.abort = vi.fn()
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter(); res.statusCode = 200; res.headers = { 'content-type': ['image/png'] }
      req.emit('response', res); res.emit('data', Buffer.from('png')); res.emit('end')
      if (options.duringDownload) observer.before(request({ id: 12 }))
    })
    return req
  }) }
  const shield = { remove: vi.fn(() => { if (options.duringRestore) observer.invalidate('restore-race') }) }
  const deps = { isRpcCaptureEnabled: () => false, passiveCapture: observer, getFlowView: () => view,
    getCurrentMode: () => 'flow', getFlowAgentOn: () => false, pendingGenerations: new Map(), typeFlowText,
    nativeFlowSettings: true, createInputShield: vi.fn(() => shield), setAutomationKeyLock: vi.fn(),
    getMainWindow: () => ({ webContents: { focus: vi.fn() } }),
    downloadPassiveImage: (session, item, opts) => downloadFlowImage(net, session, item, opts),
    trustedClickOnFlowView: vi.fn(async (selector, opts = {}) => {
      const el = Function('document', `return ${selector}`)(document)
      if (!el || (opts.beforeDispatch && !await opts.beforeDispatch())) return { success: false }
      if (opts.step === 'compose-submit') await submit()
      else el.focus()
      return { success: true, dispatched: true }
    }),
  }
  const angular = createFlowAngular(deps)
  const handlers = new Map(); registerFlowAPIIPC({ handle: (k, h) => handlers.set(k, h) }, deps)
  return { wc, deps, observer, angular, net, submit, shield, handlers }
}
async function drive(h, payload = {}) {
  const p = h.angular.generateImage({ prompt: PROMPT, projectId: PROJECT, ...payload })
  await vi.runAllTimersAsync()
  return p
}
it('runs native input, passive request, isolated delta and main download with zero main-world execution', async () => {
  const h = harness()
  expect(await drive(h)).toMatchObject({ success: true, images: [{ mediaId: NEW, base64: 'data:image/png;base64,cG5n' }] })
  expect(h.wc.executeJavaScript).not.toHaveBeenCalled()
  expect(applyNativeSettings).toHaveBeenCalledOnce()
  expect(h.net.request).toHaveBeenCalledOnce()
  expect(h.deps.createInputShield).toHaveBeenCalledOnce()
  expect(h.shield.remove).toHaveBeenCalledOnce()
  expect(h.wc.eventNames()).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})
it('keeps the async submit/check/collect contract while serializing the whole operation', async () => {
  const h = harness(); const r = await drive(h, { asyncMode: true })
  expect(r).toMatchObject({ success: true, submitted: true })
  expect(await h.handlers.get('flow:check-generation')({}, r)).toMatchObject({ completed: true, responseCount: 1 })
  expect(await h.handlers.get('flow:collect-generation')({}, r)).toMatchObject({ success: true, images: [{ mediaId: NEW }] })
  expect(h.deps.pendingGenerations.size).toBe(0)
})
it.each(['foreign', 'httpError', 'navigate', 'excess', 'missing', 'duringDownload'])('refuses %s and blocks retry', async kind => {
  const h = harness({ [kind]: true }); const r = await drive(h)
  expect(r).toMatchObject({ success: false, retryBlocked: true, postClick: true })
  expect(r.images).toBeUndefined()
  expect(await drive(h)).toMatchObject({ success: false, retryBlocked: true })
  expect(h.submit).toHaveBeenCalledOnce()
  expect(h.wc.eventNames()).toEqual([])
})
it.each([{ refs: [{ base64: 'eA==' }] }, { seed: 42 }, { batchCount: 5 }, { plan: { segments: [{ t: 'mention', ref: 0 }], attach: [] } }])('rejects unsupported inputs before any page work: %j', async payload => {
  const h = harness(); expect(await drive(h, payload)).toMatchObject({ success: false, retryBlocked: true })
  expect(h.wc.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  expect(h.submit).not.toHaveBeenCalled()
})
it('rejects an overlapping image handler before it edits the page', async () => {
  const h = harness(); const first = h.angular.generateImage({ prompt: PROMPT })
  const second = await h.angular.generateImage({ prompt: PROMPT })
  expect(second).toMatchObject({ success: false, retryBlocked: true })
  await vi.runAllTimersAsync(); expect(await first).toMatchObject({ success: true })
  expect(h.submit).toHaveBeenCalledOnce()
})
it('checks session readiness without WIZ, page XHR or hooks', async () => {
  const h = harness(); const p = h.handlers.get('flow:session-status')()
  await vi.runAllTimersAsync()
  expect(await p).toMatchObject({ ready: true })
  expect(h.wc.executeJavaScript).not.toHaveBeenCalled()
})

it('rechecks ownership after viewport restoration before returning downloaded images', async () => {
  const h = harness({ duringRestore: true })
  expect(await drive(h)).toMatchObject({ success: false, retryBlocked: true, postClick: true })
})
it('refuses before paying when an existing result card has not loaded its image', async () => {
  const h = harness()
  document.querySelector('main').insertAdjacentHTML('beforeend', `<a href="/project/${PROJECT}/edit/existing"></a>`)
  expect(await drive(h)).toMatchObject({ success: false, retryBlocked: true, reason: 'gallery-incomplete' })
  expect(h.submit).not.toHaveBeenCalled()
  expect(h.net.request).not.toHaveBeenCalled()
})

it('waits for the post-response Angular render before validating the stable gallery delta', async () => {
  const h = harness({ renderDelay: true })
  expect(await drive(h)).toMatchObject({ success: true, images: [{ mediaId: NEW }] })
  expect(h.submit).toHaveBeenCalledOnce()
})
