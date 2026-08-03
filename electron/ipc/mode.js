/**
 * 세션 뷰(Flow/ChatGPT) 수명 컨트롤러 (§3.4 레이아웃 분기 + §3.3.1 startup 게이트).
 *
 * route:set({mode, sessionTarget}) → 정규 route 단일 진입점. 대상 세션 WebContentsView를
 *   lazy 생성(파티션별 보존) 후 detach → attach → bounds 순서로 원자적 전환.
 * mode:set({mode}) → route:set의 legacy 래퍼. 기존 sessionTarget을 보존한 채 mode만 바꾼다
 *   (없으면 'flow'). 응답 형태 `{ok, mode}`는 그대로 유지.
 * mode:api → detach (뷰 인스턴스는 보존 → 세션/로그인 유지, 파티션당 1개).
 * flow:set-startup-project → 렌더러가 저장 flowProjectId 유무 선언(자동생성 경합 방지).
 *
 * 뷰 생성(electron WebContentsView + preload)은 main.js가 createFlowView/createSessionView
 * 팩토리로 주입한다 — 이 모듈은 electron import 없이 순수(수명 로직만) → 단위 테스트 가능.
 * 세션 페이지 DOM 자동화(부트스트랩/생성 fetch 캡처)는 M4(engineFlow) 이후.
 */
import { resolveStartupProjectDecision } from '../startupProject.js'
import { parseRoute } from '../../src/config/appRoute.js'

// Only sender-less legacy IPC unit harnesses receive this owner. Direct calls and
// real Electron IPC must provide the production-owned sessionJobs port.
const LEGACY_NO_SENDER_SESSION_JOBS = Object.freeze({
  cancelAll: async () => {},
  awaitIdle: async () => {},
})

const routesEqual = (left, right) => (
  left?.mode === right?.mode && left?.sessionTarget === right?.sessionTarget
)

export function isChatgptP2DevGateEnabled({
  platform,
  isPackaged,
  viteDevServerUrl,
  chatgptP2Flag,
} = {}) {
  // VITE_DEV_SERVER_URL is the canonical dev-launch signal. predev renames the Electron binary,
  // which can make app.isPackaged report true; retaining this OR is deliberate for the P2 spike.
  // The exact env value and darwin check still prevent ordinary packaged selectability (§10).
  return platform === 'darwin' &&
    (Boolean(viteDevServerUrl) || !isPackaged) &&
    chatgptP2Flag === '1'
}

export function createModeController(getMainWindow, createFlowView, options = {}) {
  const views = new Map()
  const startedSessionViews = new WeakSet()
  const targetRegistry = options.targetRegistry || null
  const configuredInitialRoute = parseRoute(options.initialRoute)
  let currentRoute = configuredInitialRoute || { mode: 'api', sessionTarget: 'flow' }
  let attachedView = options.initialAttachedView || null
  let routeRevision = Number.isInteger(options.initialRevision) ? options.initialRevision : 0
  let startupHint // undefined=미선언, null=없음, string=저장 id
  let routeRequestSequence = 0
  let transitionQueue = Promise.resolve()
  let rendererQuiesceOwner = null
  const pendingRendererQuiesce = new Map()
  const chatgptGenerationOwners = new Map()

  const createSessionView = options.createSessionView || ((target) => {
    if (target !== 'flow') throw new Error(`session-view-unavailable:${target}`)
    return createFlowView()
  })
  const updateViewBounds = options.updateViewBounds || (() => {})
  const hasSessionJobs = Object.hasOwn(options, 'sessionJobs')
  const sessionJobs = hasSessionJobs ? options.sessionJobs : null

  if (hasSessionJobs && (!sessionJobs || typeof sessionJobs.cancelAll !== 'function' || typeof sessionJobs.awaitIdle !== 'function')) {
    throw new TypeError('sessionJobs.cancelAll/awaitIdle are required')
  }
  if (attachedView && configuredInitialRoute?.mode === 'flow') {
    views.set(configuredInitialRoute.sessionTarget, attachedView)
  }

  if (targetRegistry?.table) {
    for (const target of Object.keys(targetRegistry.table)) {
      const definition = targetRegistry.get(target)
      definition?.onSessionStatusChanged?.((status) => {
        const sender = getMainWindow()?.webContents
        if (sender && typeof sender.send === 'function') {
          sender.send('session-target:status-changed', status)
        }
      })
    }
  }

  function getOrCreateView(target) {
    if (!views.has(target)) views.set(target, createSessionView(target))
    return views.get(target)
  }

  async function startInitialSessionLoad(target, view) {
    if (target !== 'chatgpt' || !view || startedSessionViews.has(view)) return
    if (!isChatgptP2DevGateEnabled(options.chatgptDevGate)) return
    const definition = targetRegistry?.get(target)
    if (!definition?.startUrl || typeof view.webContents?.loadURL !== 'function') return
    startedSessionViews.add(view)
    try {
      await view.webContents.loadURL(definition.startUrl)
      return true
    } catch (error) {
      // The view/session is deliberately preserved, but a transient navigation failure must not
      // poison it for the process lifetime. A later route entry or explicit reconnect can retry.
      startedSessionViews.delete(view)
      console.warn('[ChatGPT] initial load failed', {
        name: typeof error?.name === 'string' ? error.name : 'Error',
      })
      return false
    }
  }

  const getTargetDefinition = (target) => (
    typeof target === 'string' && targetRegistry?.has(target)
      ? targetRegistry.get(target)
      : null
  )

  const ensureSession = async (target = currentRoute.sessionTarget) => {
    const definition = getTargetDefinition(target)
    if (!definition || typeof definition.ensureSession !== 'function') return null
    return definition.ensureSession()
  }

  const getSessionStatus = (target = currentRoute.sessionTarget) => {
    const definition = getTargetDefinition(target)
    if (!definition || typeof definition.getSessionStatus !== 'function') return null
    return definition.getSessionStatus()
  }

  const adoptedResult = (extra = {}) => ({
    ...extra,
    route: { ...currentRoute },
    revision: routeRevision,
  })

  const requestRendererQuiesce = async (
    { requestId, fromRevision, to },
    required = Boolean(options.rendererAutomation || options.requireRendererQuiesce),
  ) => {
    if (!required) return
    const request = {
      requestId,
      from: { ...currentRoute },
      fromRevision,
      to: { ...to },
    }
    if (options.rendererAutomation) {
      if (typeof options.rendererAutomation.requestQuiesce !== 'function') {
        throw new TypeError('rendererAutomation.requestQuiesce is required')
      }
      await options.rendererAutomation.requestQuiesce(request)
      return
    }

    const sender = getMainWindow()?.webContents
    if (!sender || typeof sender.send !== 'function') {
      if (options.requireRendererQuiesce) throw new Error('route-quiesce-sender-unavailable')
      return
    }

    // Explicit owner unregister rejects immediately below. A renderer that disappears without
    // cleanup has no trustworthy receipt channel, so the bounded 30 s timeout intentionally stays
    // as a fail-closed last resort: no route/view commit occurs while ownership is ambiguous.
    const timeoutMs = Number.isFinite(options.quiesceTimeoutMs) ? options.quiesceTimeoutMs : 30_000
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRendererQuiesce.delete(requestId)
        reject(new Error('route-quiesce-timeout'))
      }, timeoutMs)
      pendingRendererQuiesce.set(requestId, {
        sender,
        fromRevision,
        resolve: () => {
          clearTimeout(timeout)
          pendingRendererQuiesce.delete(requestId)
          resolve()
        },
        reject: (error) => {
          clearTimeout(timeout)
          pendingRendererQuiesce.delete(requestId)
          reject(error)
        },
      })
      try {
        sender.send('route:quiesce-request', request)
      } catch (error) {
        clearTimeout(timeout)
        pendingRendererQuiesce.delete(requestId)
        reject(error)
      }
    })
  }

  const performRouteTransition = async (payload, sessionJobOwner, rendererQuiesceRequired) => {
    const envelope = payload && typeof payload === 'object' && !Array.isArray(payload) && payload.to
      ? payload
      : null
    let accepted = parseRoute(envelope ? envelope.to : payload)
    if (!accepted) return { ok: false, error: 'invalid-route' }
    const chatgptGateConfigured = Object.hasOwn(options, 'chatgptDevGate')
    if (accepted.sessionTarget === 'chatgpt' && chatgptGateConfigured &&
        !isChatgptP2DevGateEnabled(options.chatgptDevGate)) {
      if (envelope?.boot === true) {
        accepted = { ...accepted, sessionTarget: 'flow' }
      } else {
        return adoptedResult({ ok: false, error: 'session-target-disabled' })
      }
    }
    if (envelope && Number.isInteger(envelope.fromRevision) && envelope.fromRevision !== routeRevision) {
      return adoptedResult({ ok: true, stale: true })
    }

    const requestId = typeof envelope?.requestId === 'string' && envelope.requestId
      ? envelope.requestId
      : `route-${++routeRequestSequence}`
    const previousRoute = { ...currentRoute }
    const previousRevision = routeRevision
    const routeChanges = !routesEqual(previousRoute, accepted)

    if (routeChanges) {
      if (!sessionJobOwner) {
        return adoptedResult({ ok: false, error: 'route-session-jobs-required' })
      }
      try {
        await requestRendererQuiesce(
          { requestId, fromRevision: previousRevision, to: accepted },
          rendererQuiesceRequired,
        )
      } catch {
        return adoptedResult({ ok: false, error: 'route-quiesce-failed' })
      }
      try {
        await sessionJobOwner.cancelAll({ requestId, fromRevision: previousRevision, to: { ...accepted } })
        await sessionJobOwner.awaitIdle({ requestId, fromRevision: previousRevision, to: { ...accepted } })
      } catch {
        return adoptedResult({ ok: false, error: 'route-session-jobs-failed' })
      }
    }

    const win = getMainWindow()
    let nextView = null
    try {
      if (accepted.mode === 'flow') nextView = getOrCreateView(accepted.sessionTarget)
    } catch {
      return adoptedResult({ ok: false, error: 'session-view-unavailable' })
    }

    const previousView = attachedView
    const attachmentChanges = previousView !== nextView
    const assertRouteRevision = (expectedRoute, expectedRevision) => {
      if (!routesEqual(currentRoute, expectedRoute) || routeRevision !== expectedRevision) {
        throw new Error('stale-route-revision')
      }
    }
    try {
      assertRouteRevision(previousRoute, previousRevision)
      if (win && attachmentChanges && previousView) {
        win.contentView.removeChildView(previousView)
        attachedView = null
      }

      assertRouteRevision(previousRoute, previousRevision)
      currentRoute = accepted
      if (routeChanges) routeRevision += 1
      const committedRevision = routeRevision
      options.onRouteCommitted?.({ ...currentRoute }, routeRevision)

      assertRouteRevision(accepted, committedRevision)
      if (win && attachmentChanges && nextView) {
        win.contentView.addChildView(nextView)
        attachedView = nextView
      }
      assertRouteRevision(accepted, committedRevision)
      if (win && nextView) updateViewBounds(win, nextView)
      assertRouteRevision(accepted, committedRevision)
      if (nextView) void startInitialSessionLoad(accepted.sessionTarget, nextView)
    } catch {
      if (win && attachedView === nextView && nextView) {
        try { win.contentView.removeChildView(nextView) } catch {}
      }
      attachedView = null
      currentRoute = previousRoute
      routeRevision = previousRevision
      if (win && previousView) {
        try {
          win.contentView.addChildView(previousView)
          attachedView = previousView
          updateViewBounds(win, previousView)
        } catch {}
      }
      return adoptedResult({ ok: false, error: 'session-view-transition-failed' })
    }
    return adoptedResult({ ok: true })
  }

  function enqueueRoute(payload, sessionJobOwner, rendererQuiesceRequired) {
    const run = () => performRouteTransition(payload, sessionJobOwner, rendererQuiesceRequired)
    const pending = transitionQueue.then(run, run)
    transitionQueue = pending.then(() => undefined, () => undefined)
    return pending
  }

  function setRoute(payload) {
    return enqueueRoute(payload, sessionJobs)
  }

  function register(ipcMain) {
    const isTrustedRenderer = (event) => (
      Boolean(event?.sender) && event.sender === getMainWindow()?.webContents
    )
    const rendererQuiesceRequiredFor = (event) => (
      options.rendererAutomation
        ? true
        : Boolean(
          options.requireRendererQuiesce &&
          event?.sender &&
          event.sender === rendererQuiesceOwner
        )
    )
    ipcMain.on?.('route:quiesce-owner', (event, payload = {}) => {
      if (payload.present === true) {
        if (isTrustedRenderer(event)) rendererQuiesceOwner = event.sender
        return
      }
      if (payload.present !== false || event?.sender !== rendererQuiesceOwner) return
      rendererQuiesceOwner = null
      for (const pending of pendingRendererQuiesce.values()) {
        if (pending.sender === event.sender) {
          pending.reject(new Error('route-quiesce-owner-unregistered'))
        }
      }
    })
    ipcMain.on?.('route:quiesce-receipt', (event, payload = {}) => {
      const pending = pendingRendererQuiesce.get(payload.requestId)
      if (!pending) return
      if (event?.sender !== pending.sender || payload.fromRevision !== pending.fromRevision) return
      if (payload.ok === false) pending.reject(new Error(payload.error || 'route-quiesce-rejected'))
      else pending.resolve()
    })
    ipcMain.handle('route:set', async (event, payload) => {
      const owner = sessionJobs || (!event?.sender ? LEGACY_NO_SENDER_SESSION_JOBS : null)
      const result = await enqueueRoute(payload, owner, rendererQuiesceRequiredFor(event))
      if (event?.sender) return result
      if (result.ok) return { ok: true, route: result.route }
      const { route: _route, revision: _revision, ...legacyResult } = result
      return legacyResult
    })
    ipcMain.handle('mode:set', async (event, payload) => {
      if (!payload || typeof payload !== 'object' || !['flow', 'api'].includes(payload.mode)) {
        return { ok: false, error: 'invalid-route' }
      }
      const owner = sessionJobs || (!event?.sender ? LEGACY_NO_SENDER_SESSION_JOBS : null)
      const result = await enqueueRoute(
        { mode: payload.mode, sessionTarget: currentRoute.sessionTarget || 'flow' },
        owner,
        rendererQuiesceRequiredFor(event),
      )
      return result.ok ? { ok: true, mode: result.route.mode } : result
    })
    const isKnownTarget = (target) => (
      typeof target === 'string' && targetRegistry?.has(target) === true
    )
    ipcMain.handle('app:get-dev-flags', async (event) => ({
      chatgptTargetCombo: isTrustedRenderer(event) &&
        isChatgptP2DevGateEnabled(options.chatgptDevGate),
    }))
    ipcMain.handle('session-target:get-status', (event, target) => {
      if (!isTrustedRenderer(event) || !isKnownTarget(target)) return null
      return getSessionStatus(target)
    })
    ipcMain.handle('session-target:reconnect', async (event, target) => {
      if (!isTrustedRenderer(event) || !isKnownTarget(target)) return null
      const view = views.get(target)
      view?.webContents?.focus?.()
      await startInitialSessionLoad(target, view)
      return ensureSession(target)
    })
    const chatgptGenerationAdmission = (event) => {
      if (!isTrustedRenderer(event)) {
        return { success: false, errorKind: 'chatgpt-unauthorized-sender', error: 'ChatGPT generation sender is not authorized.' }
      }
      if (!isChatgptP2DevGateEnabled(options.chatgptDevGate)) {
        return { success: false, errorKind: 'chatgpt-target-disabled', error: 'ChatGPT generation is disabled outside the opted-in development route.' }
      }
      if (currentRoute.mode !== 'flow' || currentRoute.sessionTarget !== 'chatgpt') {
        return { success: false, errorKind: 'chatgpt-route-inactive', error: 'ChatGPT generation requires the active ChatGPT session target.' }
      }
      return null
    }
    const generationRouteChangedRefusal = () => ({
      success: false,
      errorKind: 'chatgpt-generation-route-changed',
      error: 'ChatGPT generation no longer belongs to the active route.',
    })
    const captureChatgptGenerationOwner = () => ({
      route: { ...currentRoute },
      revision: routeRevision,
      target: 'chatgpt',
    })
    const generationOwnerMatches = (owner) => (
      owner?.target === 'chatgpt' &&
      owner.revision === routeRevision &&
      routesEqual(owner.route, currentRoute) &&
      currentRoute.sessionTarget === owner.target
    )
    const admittedGenerationRefusal = (generationId) => {
      const owner = chatgptGenerationOwners.get(generationId)
      return owner && !generationOwnerMatches(owner) ? generationRouteChangedRefusal() : null
    }
    const chatgptAdapter = () => getTargetDefinition('chatgpt')?.createAdapter?.() || null
    ipcMain.handle('chatgpt:submit-generation', async (event, request = {}) => {
      const refused = chatgptGenerationAdmission(event)
      if (refused) return refused
      const admittedOwner = captureChatgptGenerationOwner()
      const referenceImages = request.referenceImages == null ? [] : request.referenceImages
      // Reference upload has no measured product surface; never silently discard these bytes.
      if (!Array.isArray(referenceImages) || referenceImages.length > 0) {
        return {
          success: false,
          errorKind: 'chatgpt-reference-images-unmeasured',
          error: 'ChatGPT reference image upload is not measured and remains unavailable.',
        }
      }
      if (!generationOwnerMatches(admittedOwner)) return generationRouteChangedRefusal()
      const adapter = chatgptAdapter()
      if (!adapter || typeof adapter.submit !== 'function') {
        return { success: false, errorKind: 'chatgpt-adapter-unavailable', error: 'ChatGPT image generation adapter is unavailable.' }
      }
      const result = await adapter.submit({ ...request, referenceImages })
      if (!generationOwnerMatches(admittedOwner)) {
        await adapter.cancelAll?.()
        return generationRouteChangedRefusal()
      }
      if (result?.success === true && typeof result.generationId === 'string') {
        chatgptGenerationOwners.set(result.generationId, admittedOwner)
      }
      return result
    })
    ipcMain.handle('chatgpt:observe-generation', async (event, generationId) => {
      const refused = chatgptGenerationAdmission(event)
      if (refused) return refused
      const ownershipRefused = admittedGenerationRefusal(generationId)
      if (ownershipRefused) return ownershipRefused
      const adapter = chatgptAdapter()
      return adapter?.observe?.(generationId) || {
        success: false, completed: true, errorKind: 'chatgpt-adapter-unavailable', error: 'ChatGPT image generation adapter is unavailable.',
      }
    })
    ipcMain.handle('chatgpt:collect-generation', async (event, generationId) => {
      const refused = chatgptGenerationAdmission(event)
      if (refused) return refused
      const ownershipRefused = admittedGenerationRefusal(generationId)
      if (ownershipRefused) return ownershipRefused
      const adapter = chatgptAdapter()
      const result = await adapter?.collect?.(generationId) || {
        success: false, errorKind: 'chatgpt-adapter-unavailable', error: 'ChatGPT image generation adapter is unavailable.',
      }
      if (result?.errorKind !== 'chatgpt-generation-pending') {
        chatgptGenerationOwners.delete(generationId)
      }
      return result
    })
    ipcMain.handle('chatgpt:clear-generations', async (event) => {
      const refused = chatgptGenerationAdmission(event)
      if (refused) return refused
      const adapter = chatgptAdapter()
      const result = await adapter?.clear?.() || {
        success: false, errorKind: 'chatgpt-adapter-unavailable', error: 'ChatGPT image generation adapter is unavailable.',
      }
      if (result?.success === true) chatgptGenerationOwners.clear()
      return result
    })
    ipcMain.handle('chatgpt:cancel-generations', async (event) => {
      const refused = chatgptGenerationAdmission(event)
      if (refused) return refused
      const adapter = chatgptAdapter()
      return adapter?.cancelAll?.() || {
        success: false, errorKind: 'chatgpt-adapter-unavailable', error: 'ChatGPT image generation adapter is unavailable.',
      }
    })
    ipcMain.handle('flow:set-startup-project', (_event, payload = {}) => {
      startupHint = payload.flowProjectId || null
      return { ok: true }
    })
  }

  const getActiveSessionView = (target = currentRoute.sessionTarget) => views.get(target) || null
  return {
    register,
    setRoute,
    getCurrentMode: () => currentRoute.mode,
    getSessionTarget: () => currentRoute.sessionTarget || 'flow',
    getCurrentRoute: () => ({ ...currentRoute }),
    ensureSession,
    getSessionStatus,
    getActiveSessionView,
    getFlowView: () => getActiveSessionView('flow'),
    isFlowTargetActive: () => currentRoute.mode === 'flow' && currentRoute.sessionTarget === 'flow',
    getRouteRevision: () => routeRevision,
    getStartupDecision: () => resolveStartupProjectDecision(startupHint),
  }
}

export default createModeController
