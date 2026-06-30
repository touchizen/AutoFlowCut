/**
 * Flow 모드 뷰 수명 컨트롤러 (§3.4 레이아웃 분기 + §3.3.1 startup 게이트).
 *
 * mode:set('flow') → Flow WebContentsView lazy 생성 + contentView attach.
 * mode:set('api')  → detach (뷰 인스턴스는 보존 → Flow 세션/로그인 유지).
 * flow:set-startup-project → 렌더러가 저장 flowProjectId 유무 선언(자동생성 경합 방지).
 *
 * 뷰 생성(electron WebContentsView + flow-preload)은 main.js가 createFlowView 팩토리로
 * 주입한다 — 이 모듈은 electron import 없이 순수(수명 로직만) → 단위 테스트 가능.
 * Flow 페이지 DOM 자동화(부트스트랩/생성 fetch 캡처)는 M4(engineFlow).
 */
import { resolveStartupProjectDecision } from '../startupProject.js'

export function createModeController(getMainWindow, createFlowView) {
  let flowView = null
  let currentMode = 'api'
  let startupHint = undefined // undefined=미선언, null=없음, string=저장 id

  function register(ipcMain) {
    ipcMain.handle('mode:set', (_event, { mode } = {}) => {
      const win = getMainWindow()
      if (mode === 'flow') {
        if (!flowView) flowView = createFlowView()
        if (win && flowView) win.contentView.addChildView(flowView)
        currentMode = 'flow'
      } else {
        if (win && flowView) win.contentView.removeChildView(flowView)
        currentMode = 'api'
      }
      return { ok: true, mode: currentMode }
    })

    ipcMain.handle('flow:set-startup-project', (_event, payload = {}) => {
      startupHint = payload.flowProjectId || null
      return { ok: true }
    })
  }

  return {
    register,
    getFlowView: () => flowView,
    getCurrentMode: () => currentMode,
    getStartupDecision: () => resolveStartupProjectDecision(startupHint),
  }
}

export default createModeController
