import { EventEmitter } from 'node:events'
import { expect, vi } from 'vitest'
import { createSharedHelpers } from '../../electron/ipc/shared.js'
import { createFlowSafetyIPC } from '../../electron/flow-safety-ipc.js'
import { inputShieldHarness } from './flow-input-shield.js'
import { createFlowAngular } from '../../electron/ipc/flow-angular.js'
import { registerFlowAPIIPC } from '../../electron/ipc/flow-api.js'
import { createPassiveCapture } from '../../electron/flow-passive-capture.js'
import { downloadFlowImage } from '../../electron/flow-image-download.js'
import { typeFlowText } from '../../electron/flow-native-input.js'
import { IMAGE_COMPOSER_KO } from './flow-live-dom-20260924.js'
import { request, galleryRequest, PAGE, NEW, OLD, gallery, card, responsiveComposer } from './flow-passive-image.js'

export function harness(options = {}) {
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
  const ipcEvents = new EventEmitter()
  let ipc = Object.assign(ipcEvents, { handle: (k, h) => handlers.set(k, h) })
  if (options.cancellable) {
    const safety = createFlowSafetyIPC(ipc, deps)
    deps.isFlowSafetyBlocked = () => !!safety.safety.blocked() || safety.isCurrentCancelled()
    ipc = safety.ipcMain
  }
  registerFlowAPIIPC(ipc, deps)
  return { wc, view, deps, observer, angular, net, submit, shield, handlers, nativeShield, isolatedWorld, ipcEvents }
}
