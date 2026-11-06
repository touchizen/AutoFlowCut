import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../electron/flow-native-settings.js', () => ({ applyNativeSettings: vi.fn(async () => ({ ok: true })) }))
vi.mock('electron', () => ({ screen: { getAllDisplays: () => [] } }))
import { createSharedHelpers } from '../../electron/ipc/shared.js'
import { createFlowSafetyIPC } from '../../electron/flow-safety-ipc.js'
import { inputShieldHarness } from '../fixtures/flow-input-shield.js'
import { createFlowAngular, _resetDomStageForTests } from '../../electron/ipc/flow-angular.js'
import { registerFlowAPIIPC } from '../../electron/ipc/flow-api.js'
import { createPassiveCapture } from '../../electron/flow-passive-capture.js'
import { downloadFlowImage } from '../../electron/flow-image-download.js'
import { typeFlowText } from '../../electron/flow-native-input.js'
import { applyNativeSettings } from '../../electron/flow-native-settings.js'
import { IMAGE_COMPOSER_KO } from '../fixtures/flow-live-dom-20260924.js'
import { request, galleryRequest, PAGE, PROJECT, PROMPT, OLD, NEW, gallery, card, responsiveComposer } from '../fixtures/flow-passive-image.js'
beforeEach(() => { vi.useFakeTimers(); _resetDomStageForTests(); applyNativeSettings.mockClear() })
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })
function harness(options = {}) {
  document.body.innerHTML = IMAGE_COMPOSER_KO + gallery(card(OLD))
  const button = document.querySelector('button[type="submit"]'); button.removeAttribute('disabled'); button.classList.remove('mat-mdc-button-disabled')
  const wc = new EventEmitter(); let url = PAGE
  const isolatedWorld = {}
  Object.assign(wc, { id: 7, session: {}, getURL: () => url, isDestroyed: () => false, isFocused: () => true,
    focus: vi.fn(), selectAll: vi.fn(), insertText: vi.fn(async text => { document.querySelector('.ProseMirror').textContent = text }),
    executeJavaScript: vi.fn(async () => { throw new Error('forbidden main world') }),
    executeJavaScriptInIsolatedWorld: vi.fn(async (_id, scripts) => {
      const code = scripts[0].code
      expect(code).not.toMatch(/window\.__autoflowcut|window\.fetch|XMLHttpRequest|dispatchEvent|execCommand/)
      return Function('document', 'location', 'globalThis', `return (${code})`)(document, { href: url }, isolatedWorld)
    }),
  })
  const observer = createPassiveCapture()
  let bounds = { x: 0, y: 0, width: options.narrow ? 597 : 1200, height: 900 }
  let zoom = options.zoom || 1
  const renderViewport = responsiveComposer(document)
  const relayout = () => renderViewport(bounds.width / zoom)
  Object.assign(wc, { getZoomFactor: () => zoom, setZoomFactor: vi.fn(value => { zoom = value; relayout() }) })
  relayout()
  const view = Object.assign(new EventEmitter(), { webContents: wc, getBounds: () => bounds, setBounds: b => { bounds = b; relayout(); view.emit('bounds-changed') } })
  const submit = vi.fn(async () => {
    if (options.beforeRequestPlaceholder) {
      document.querySelector('main').insertAdjacentHTML('afterbegin', '<flow-image-tile class="old-placeholder"></flow-image-tile>')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    if (options.beforeRequestCard || options.beforeRequestLoading) {
      if (options.beforeRequestLoading) document.querySelector('main').insertAdjacentHTML('beforeend', '<div role="progressbar"></div>')
      document.querySelector('main').insertAdjacentHTML('afterbegin', card(NEW))
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    observer.before(request({}, inner => {
      while (inner[1].length < (options.count || 1)) inner[1].push(structuredClone(inner[1][0]))
    }))
    if (options.refresh) observer.before(galleryRequest())
    if (options.foreign) observer.before(request({ id: 11, webContentsId: 88 }))
    if (options.httpError) observer.completed({ id: 10, statusCode: 403 })
    else observer.completed({ id: 10, statusCode: 200 })
    if (options.navigate) { url = PAGE + '?changed'; wc.emit('did-navigate-in-page') }
    if (options.renderDelay) {
      // The browser render task follows network submission; fake time must
      // distinguish the two. Same-millisecond ordering remains unproven.
      await new Promise(resolve => setTimeout(resolve, 10))
      document.querySelector('main').insertAdjacentHTML('afterbegin', '<flow-image-tile class="pending-result"></flow-image-tile>')
      setTimeout(() => { document.querySelector('.pending-result').remove(); document.querySelector('main').insertAdjacentHTML('afterbegin', card(NEW)) }, 1000)
    } else if (options.beforeRequestPlaceholder) {
      await new Promise(resolve => setTimeout(resolve, 10))
      document.querySelector('.old-placeholder').outerHTML = card(NEW)
    } else if (options.beforeRequestLoading) {
      await new Promise(resolve => setTimeout(resolve, 10))
      document.querySelector('[role="progressbar"]').remove()
    } else if (!options.missing && !options.beforeRequestCard) {
      await new Promise(resolve => setTimeout(resolve, 10))
      const ids = [NEW, '30000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004']
      for (const id of ids.slice(0, options.count || 1)) document.querySelector('main').insertAdjacentHTML('afterbegin', card(id))
    }
    if (options.excess) document.querySelector('main').insertAdjacentHTML('afterbegin', card('30000000-0000-4000-8000-000000000003'))
    if (options.refresh) observer.completed({ id: 20, statusCode: 200 })
  })
  const net = { request: vi.fn(() => {
    const req = new EventEmitter(); req.abort = vi.fn()
    req.end = () => queueMicrotask(() => {
      if (options.stallDownload) return
      const res = new EventEmitter(); res.statusCode = 200; res.headers = { 'content-type': ['image/png'] }
      req.emit('response', res); res.emit('data', Buffer.from('png')); res.emit('end')
      if (options.duringDownload) observer.before(request({ id: 12 }))
    })
    return req
  }) }
  const shield = { remove: vi.fn(() => options.duringRestore?.()) }
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
  const nativeShield = inputShieldHarness(view)
  if (options.cancellable) {
    deps.createInputShield = vi.fn(nativeShield.create)
    deps.getMainWindow = () => nativeShield.win
  }
  const angular = createFlowAngular(deps)
  if (options.nativeClickFailure || options.nativeClick) {
    button.getBoundingClientRect = () => ({ x: options.narrow ? 620 : 100, y: 100, width: 40, height: 40 })
    document.elementFromPoint = vi.fn(() => button)
    wc.sendInputEvent = vi.fn(event => { if (event.type === 'mouseUp') void submit() })
    const native = createSharedHelpers({ ...deps, constants: {}, isolatedFlowReads: true }).trustedClickOnFlowView
    const original = deps.trustedClickOnFlowView
    deps.trustedClickOnFlowView = vi.fn(async (selector, opts) => {
      if (opts.step !== 'compose-submit') return original(selector, opts)
      return native(selector, { ...opts, beforeDispatch: async () => {
        const go = await opts.beforeDispatch()
        if (options.nativeClickFailure === 'bounds') view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
        if (options.nativeClickFailure === 'timeout') await new Promise(resolve => setTimeout(resolve, 31000))
        return go
      } })
    })
  }
  const handlers = new Map()
  let ipc = { handle: (k, h) => handlers.set(k, h) }
  if (options.cancellable) {
    const safety = createFlowSafetyIPC(ipc, deps)
    deps.isFlowSafetyBlocked = () => !!safety.safety.blocked() || safety.isCurrentCancelled()
    ipc = safety.ipcMain
  }
  registerFlowAPIIPC(ipc, deps)
  return { wc, view, deps, observer, angular, net, submit, shield, handlers, nativeShield, isolatedWorld }
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
  expect(Object.keys(h.isolatedWorld)).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})
it.each([1, 1.25])('restores missing narrow composer controls and original zoom %s without covering app Stop', async zoom => {
  const h = harness({ narrow: true, cancellable: true, nativeClick: true, zoom })
  expect(document.querySelector('flow-agent-mode-toggle-chip')).toBeNull()
  const originalBounds = { ...h.view.getBounds() }
  expect(await drive(h)).toMatchObject({ success: true, images: [{ mediaId: NEW }] })
  expect(h.submit).toHaveBeenCalledOnce()
  const down = h.wc.sendInputEvent.mock.calls.find(([event]) => event.type === 'mouseDown')[0]
  expect(down.x).toBe(Math.round(640 * 597 / 700))
  expect(document.elementFromPoint).toHaveBeenCalledWith(640, 120)
  expect(h.view.getBounds()).toEqual(originalBounds)
  expect(h.wc.getZoomFactor()).toBe(zoom)
  expect(document.querySelector('flow-agent-mode-toggle-chip')).toBeNull()
  expect(h.nativeShield.surfaces).toHaveLength(0)
})
it('keeps the async submit/check/collect contract while serializing the whole operation', async () => {
  const h = harness(); const r = await drive(h, { asyncMode: true })
  expect(r).toMatchObject({ success: true, submitted: true })
  expect(await h.handlers.get('flow:check-generation')({}, r)).toMatchObject({ completed: true, responseCount: 1 })
  expect(await h.handlers.get('flow:collect-generation')({}, r)).toMatchObject({ success: true, images: [{ mediaId: NEW }] })
  expect(h.deps.pendingGenerations.size).toBe(0)
})
it('loads an initial project listing then generates and collects its own image', async () => {
  const h = harness()
  h.observer.before(galleryRequest())
  h.observer.completed({ id: 20, statusCode: 200 })
  const listed = '30000000-0000-4000-8000-000000000003'
  setTimeout(() => document.querySelector('main').insertAdjacentHTML('beforeend', card(listed)), 1000)
  const result = await drive(h, { asyncMode: true })
  expect(result).toMatchObject({ success: true, submitted: true })
  expect(await h.handlers.get('flow:check-generation')({}, result)).toMatchObject({ completed: true })
  expect(await h.handlers.get('flow:collect-generation')({}, result)).toMatchObject({ success: true, images: [{ mediaId: NEW }] })
  expect(h.net.request).toHaveBeenCalledOnce()
  expect(h.wc.executeJavaScript).not.toHaveBeenCalled()
})
it('accepts a normal gallery refresh immediately after its own submission', async () => {
  const h = harness({ refresh: true })
  expect(await drive(h)).toMatchObject({ success: true, images: [{ mediaId: NEW }] })
  expect(h.submit).toHaveBeenCalledOnce()
})
it('collects exactly three new images after an initial listing and normal refresh', async () => {
  const h = harness({ refresh: true, count: 3 })
  h.observer.before(galleryRequest())
  h.observer.completed({ id: 20, statusCode: 200 })
  const result = await drive(h, { batchCount: 3 })
  expect(result.success).toBe(true)
  expect(result.images).toHaveLength(3)
  expect(result.images.some(item => item.mediaId === OLD)).toBe(false)
  expect(h.net.request).toHaveBeenCalledTimes(3)
})
it('rejects an old card seen during initial settlement that disappears and reappears after submit', async () => {
  const h = harness({ refresh: true })
  h.observer.before(galleryRequest())
  h.observer.completed({ id: 20, statusCode: 200 })
  setTimeout(() => document.querySelector('main').insertAdjacentHTML('beforeend', card(NEW)), 500)
  setTimeout(() => document.querySelector(`img[data-media-id="${NEW}"]`).closest('a').remove(), 1000)
  expect(await drive(h)).toMatchObject({ success: false, reason: 'gallery-before-request' })
  expect(h.net.request).not.toHaveBeenCalled()
})
it.each(['excess', 'beforeRequestCard', 'beforeRequestLoading', 'beforeRequestPlaceholder'])('rejects ambiguous refresh results: %s', async kind => {
  const h = harness({ refresh: true, [kind]: true })
  const result = await drive(h)
  expect(result).toMatchObject({ success: false, postClick: true, retryBlocked: true,
    reason: kind === 'excess' ? 'gallery-count' : 'gallery-before-request' })
  expect(h.net.request).not.toHaveBeenCalled()
  expect(Object.keys(h.isolatedWorld)).toEqual([])
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

it.each([
  ['selected card removed', () => document.querySelector(`img[data-media-id="${NEW}"]`).closest('a').remove()],
  ['old card removed', () => document.querySelector(`img[data-media-id="${OLD}"]`).closest('a').remove()],
  ['extra card added', () => document.querySelector('main').insertAdjacentHTML('beforeend', card('30000000-0000-4000-8000-000000000003'))],
  ['selected URL changed', () => document.querySelector(`img[data-media-id="${NEW}"]`).setAttribute('src', 'https://flow.google.com/asb/replaced=s1600')],
  ['selected identity replaced', () => { document.querySelector(`img[data-media-id="${NEW}"]`).closest('a').outerHTML = card('30000000-0000-4000-8000-000000000003') }],
])('rechecks actual gallery DOM after viewport restoration: %s', async (_name, duringRestore) => {
  const h = harness({ duringRestore })
  const result = await drive(h, { asyncMode: true })
  expect(result).toMatchObject({ success: false, retryBlocked: true, postClick: true, reason: 'gallery-changed-during-restore' })
  expect(h.net.request).toHaveBeenCalledOnce()
  expect(h.deps.pendingGenerations.size).toBe(0)
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

it('refuses a late existing gallery card from a listing started before submission', async () => {
  const h = harness({ missing: true })
  h.observer.before(galleryRequest())
  setTimeout(() => {
    h.observer.completed({ id: 20, statusCode: 200 })
    document.querySelector('main').insertAdjacentHTML('beforeend', card(NEW))
  }, 1000)
  expect(await drive(h)).toMatchObject({ success: false, reason: 'gallery-request-pending' })
  expect(h.submit).not.toHaveBeenCalled()
  expect(h.net.request).not.toHaveBeenCalled()
})

it('settles a delayed initial listing without assigning its old card to the new submission', async () => {
  const h = harness({ missing: true })
  h.observer.before(galleryRequest())
  h.observer.completed({ id: 20, statusCode: 200 })
  setTimeout(() => document.querySelector('main').insertAdjacentHTML('beforeend', card(NEW)), 1000)
  const result = await drive(h)
  expect(result).toMatchObject({ success: false, postClick: true, reason: 'result-timeout' })
  expect(h.submit).toHaveBeenCalledOnce()
  expect(h.net.request).not.toHaveBeenCalled()
})

it.each(['bounds', 'timeout'])('does not record a paid submission when native click refuses after the final guard: %s', async nativeClickFailure => {
  const options = { nativeClickFailure }
  const h = harness(options)
  const result = await drive(h)
  expect(result).toMatchObject({ success: false })
  expect(result.postClick).toBeUndefined()
  expect(result.safetyStop).toBeUndefined()
  expect(h.wc.sendInputEvent.mock.calls.some(([event]) => event.type === 'mouseDown')).toBe(false)
  expect(h.submit).not.toHaveBeenCalled()
  options.nativeClickFailure = null
  h.view.setBounds({ x: 0, y: 0, width: 1200, height: 900 })
  expect(await drive(h)).toMatchObject({ success: true })
  expect(h.submit).toHaveBeenCalledOnce()
})

it.each([
  ['waiting', false], ['waiting', true], ['downloading', false], ['downloading', true],
])('app Stop reaches cancellation while %s with narrow=%s', async (phase, narrow) => {
  const h = harness({ cancellable: true, narrow, missing: phase === 'waiting', stallDownload: phase === 'downloading' })
  const stop = document.createElement('button')
  const cancel = vi.fn(() => h.handlers.get('flow:safety-cancel-pending')())
  stop.addEventListener('click', cancel)
  document.body.append(stop)
  let settled = false
  const pending = h.handlers.get('flow:generate-image')({}, { prompt: PROMPT, projectId: PROJECT }).then(r => { settled = true; return r })
  await vi.advanceTimersByTimeAsync(2500)
  expect(h.submit).toHaveBeenCalledOnce()
  expect(settled).toBe(false)
  expect(h.nativeShield.covers(100, 40)).toBe(true)
  // Native hit routing: an app DOM click cannot happen through a covering View.
  if (!h.nativeShield.covers(1800, 40)) stop.click()
  expect(cancel).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(500)
  expect(settled).toBe(true)
  expect(await pending).toMatchObject({ success: false, postClick: true })
  if (phase === 'downloading') expect(h.net.request.mock.results[0].value.abort).toHaveBeenCalledOnce()
  expect(h.nativeShield.surfaces).toHaveLength(0)
  expect(h.view.listenerCount('bounds-changed')).toBe(0)
})

it('cancels a stalled pre-click DOM read without permanently blocking another attempt', async () => {
  const h = harness({ cancellable: true })
  const originalRead = h.wc.executeJavaScriptInIsolatedWorld.getMockImplementation()
  let stalled = false
  h.wc.executeJavaScriptInIsolatedWorld.mockImplementation((id, scripts) => {
    if (id === 995 && !stalled) { stalled = true; return new Promise(() => {}) }
    return originalRead(id, scripts)
  })
  const pending = h.handlers.get('flow:generate-image')({}, { prompt: PROMPT })
  await vi.advanceTimersByTimeAsync(50)
  expect(stalled).toBe(true)
  h.handlers.get('flow:safety-cancel-pending')()
  await vi.advanceTimersByTimeAsync(500)
  const result = await pending
  expect(result).toMatchObject({ success: false })
  expect(result.postClick).toBeUndefined()
  expect(result.safetyStop).toBeUndefined()
  expect(h.submit).not.toHaveBeenCalled()
  expect(await drive(h)).toMatchObject({ success: true })
})

it('does not quarantine a navigation event before any submit click', async () => {
  const h = harness()
  h.deps.typeFlowText = vi.fn(async (...args) => {
    const result = await typeFlowText(...args)
    h.wc.emit('did-navigate-in-page')
    return result
  })
  const result = await drive(h)
  expect(result.success).toBe(false)
  expect(result.postClick).toBeUndefined()
  expect(h.submit).not.toHaveBeenCalled()
  h.deps.typeFlowText = typeFlowText
  expect(await drive(h)).toMatchObject({ success: true })
})
