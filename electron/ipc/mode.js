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

const NOOP_SESSION_JOBS = Object.freeze({
  cancelAll: async () => {},
  awaitIdle: async () => {},
})

const routesEqual = (left, right) => (
  left?.mode === right?.mode && left?.sessionTarget === right?.sessionTarget
)

export function createModeController(getMainWindow, createFlowView, options = {}) {
  const views = new Map()
  const configuredInitialRoute = parseRoute(options.initialRoute)
  let currentRoute = configuredInitialRoute || { mode: 'api', sessionTarget: 'flow' }
  let attachedView = options.initialAttachedView || null
  let routeRevision = Number.isInteger(options.initialRevision) ? options.initialRevision : 0
  let startupHint // undefined=미선언, null=없음, string=저장 id
  let routeRequestSequence = 0
  let transitionQueue = Promise.resolve()
  const pendingRendererQuiesce = new Map()

  const createSessionView = options.createSessionView || ((target) => {
    if (target !== 'flow') throw new Error(`session-view-unavailable:${target}`)
    return createFlowView()
  })
  const updateViewBounds = options.updateViewBounds || (() => {})
  const sessionJobs = Object.hasOwn(options, 'sessionJobs')
    ? options.sessionJobs
    : NOOP_SESSION_JOBS

  if (!sessionJobs || typeof sessionJobs.cancelAll !== 'function' || typeof sessionJobs.awaitIdle !== 'function') {
    throw new TypeError('sessionJobs.cancelAll/awaitIdle are required')
  }
  if (attachedView && configuredInitialRoute?.mode === 'flow') {
    views.set(configuredInitialRoute.sessionTarget, attachedView)
  }

  function getOrCreateView(target) {
    if (!views.has(target)) views.set(target, createSessionView(target))
    return views.get(target)
  }

  const adoptedResult = (extra = {}) => ({
    ...extra,
    route: { ...currentRoute },
    revision: routeRevision,
  })

  const requestRendererQuiesce = async ({ requestId, fromRevision, to }) => {
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
    if (!sender || typeof sender.send !== 'function') return

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

  const performRouteTransition = async (payload) => {
    const envelope = payload && typeof payload === 'object' && !Array.isArray(payload) && payload.to
      ? payload
      : null
    const accepted = parseRoute(envelope ? envelope.to : payload)
    if (!accepted) return { ok: false, error: 'invalid-route' }
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
      try {
        await requestRendererQuiesce({ requestId, fromRevision: previousRevision, to: accepted })
      } catch {
        return adoptedResult({ ok: false, error: 'route-quiesce-failed' })
      }
      try {
        await sessionJobs.cancelAll({ requestId, fromRevision: previousRevision, to: { ...accepted } })
        await sessionJobs.awaitIdle({ requestId, fromRevision: previousRevision, to: { ...accepted } })
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
    try {
      if (win && attachmentChanges && previousView) {
        win.contentView.removeChildView(previousView)
        attachedView = null
      }

      currentRoute = accepted
      if (routeChanges) routeRevision += 1
      options.onRouteCommitted?.({ ...currentRoute }, routeRevision)

      if (win && attachmentChanges && nextView) {
        win.contentView.addChildView(nextView)
        attachedView = nextView
      }
      if (win && nextView) updateViewBounds(win, nextView)
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

  function setRoute(payload) {
    const run = () => performRouteTransition(payload)
    const pending = transitionQueue.then(run, run)
    transitionQueue = pending.then(() => undefined, () => undefined)
    return pending
  }

  function register(ipcMain) {
    ipcMain.on?.('route:quiesce-receipt', (event, payload = {}) => {
      const pending = pendingRendererQuiesce.get(payload.requestId)
      if (!pending) return
      if (event?.sender !== pending.sender || payload.fromRevision !== pending.fromRevision) return
      if (payload.ok === false) pending.reject(new Error(payload.error || 'route-quiesce-rejected'))
      else pending.resolve()
    })
    ipcMain.handle('route:set', async (event, payload) => {
      const result = await setRoute(payload)
      if (event?.sender) return result
      if (result.ok) return { ok: true, route: result.route }
      const { route: _route, revision: _revision, ...legacyResult } = result
      return legacyResult
    })
    ipcMain.handle('mode:set', async (_event, payload) => {
      if (!payload || typeof payload !== 'object' || !['flow', 'api'].includes(payload.mode)) {
        return { ok: false, error: 'invalid-route' }
      }
      const result = await setRoute({ mode: payload.mode, sessionTarget: currentRoute.sessionTarget || 'flow' })
      return result.ok ? { ok: true, mode: result.route.mode } : result
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
    getActiveSessionView,
    getFlowView: () => getActiveSessionView('flow'),
    isFlowTargetActive: () => currentRoute.mode === 'flow' && currentRoute.sessionTarget === 'flow',
    getRouteRevision: () => routeRevision,
    getStartupDecision: () => resolveStartupProjectDecision(startupHint),
  }
}

export default createModeController
