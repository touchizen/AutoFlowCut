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

export function createModeController(getMainWindow, createFlowView, options = {}) {
  const views = new Map()
  let currentRoute = { mode: 'api', sessionTarget: 'flow' }
  let attachedView = null
  let startupHint // undefined=미선언, null=없음, string=저장 id

  const createSessionView = options.createSessionView || ((target) => {
    if (target !== 'flow') throw new Error(`session-view-unavailable:${target}`)
    return createFlowView()
  })
  const updateViewBounds = options.updateViewBounds || (() => {})

  function getOrCreateView(target) {
    if (!views.has(target)) views.set(target, createSessionView(target))
    return views.get(target)
  }

  function applyRoute(next) {
    const accepted = parseRoute(next)
    if (!accepted) return { ok: false, error: 'invalid-route' }

    const win = getMainWindow()
    let nextView = null
    try {
      if (accepted.mode === 'flow') nextView = getOrCreateView(accepted.sessionTarget)
    } catch {
      return { ok: false, error: 'session-view-unavailable' }
    }

    const previousView = attachedView
    const attachmentChanges = previousView !== nextView
    try {
      if (win && attachmentChanges && previousView) {
        win.contentView.removeChildView(previousView)
        attachedView = null
      }
      if (win && attachmentChanges && nextView) {
        win.contentView.addChildView(nextView)
        attachedView = nextView
      }
      if (win && nextView) updateViewBounds(win, nextView)
    } catch {
      if (win && attachmentChanges) {
        if (attachedView === nextView && nextView) {
          try { win.contentView.removeChildView(nextView) } catch {}
        }
        attachedView = null
        if (previousView) {
          try {
            win.contentView.addChildView(previousView)
            attachedView = previousView
            updateViewBounds(win, previousView)
          } catch {}
        }
      }
      return { ok: false, error: 'session-view-transition-failed' }
    }
    currentRoute = accepted
    return { ok: true, route: { ...currentRoute } }
  }

  function register(ipcMain) {
    ipcMain.handle('route:set', (_event, payload) => applyRoute(payload))
    ipcMain.handle('mode:set', (_event, payload) => {
      if (!payload || typeof payload !== 'object' || !['flow', 'api'].includes(payload.mode)) {
        return { ok: false, error: 'invalid-route' }
      }
      const result = applyRoute({ mode: payload.mode, sessionTarget: currentRoute.sessionTarget || 'flow' })
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
    getCurrentMode: () => currentRoute.mode,
    getSessionTarget: () => currentRoute.sessionTarget || 'flow',
    getCurrentRoute: () => ({ ...currentRoute }),
    getActiveSessionView,
    getFlowView: () => getActiveSessionView('flow'),
    isFlowTargetActive: () => currentRoute.mode === 'flow' && currentRoute.sessionTarget === 'flow',
    getStartupDecision: () => resolveStartupProjectDecision(startupHint),
  }
}

export default createModeController
