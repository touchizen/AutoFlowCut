/**
 * useFlowEvents — Flow 관련 이벤트 리스너 통합
 *
 * Flow 로그인 만료, 레이아웃 보정 등 App 초기화 시 필요한 이벤트 처리
 */

import { useEffect } from 'react'

/**
 * @param {object} params
 * @param {Function} params.onLoginExpired - 로그인 만료 시 콜백
 * @param {string}   [params.mode]         - 현재 앱 모드 ('api' | 'flow'). 레이아웃 보정은 'flow' 모드에서만 실행.
 */
export function useFlowEvents({ onLoginExpired, mode }) {
  // Flow 로그인 만료 이벤트 수신
  // Codex #6 fix: in flow mode, the Flow WebContentsView handles its own login.
  // Opening the BYOK api-key modal in flow mode is wrong — skip the callback.
  useEffect(() => {
    const handler = () => {
      if (mode === 'flow') {
        // Flow mode: login expired is handled by the Flow view itself (Google login in webview).
        // Do NOT open the BYOK api-key modal.
        console.info('[FlowEvents] login-expired in flow mode — handled by Flow view, skipping api-key modal')
        return
      }
      onLoginExpired()
    }
    window.addEventListener('flow-login-expired', handler)
    return () => window.removeEventListener('flow-login-expired', handler)
  }, [mode, onLoginExpired])

  // DOM 모드: 레이아웃이 'tab'이면 split으로 보정 (Flow UI가 보여야 함).
  // Flow 모드에서만 실행 — API 모드에서는 FlowView를 표시하지 않으므로 레이아웃 덮어쓰지 않는다.
  useEffect(() => {
    if (mode !== 'flow') return
    try {
      const saved = localStorage.getItem('layoutSettings')
      const layout = saved ? JSON.parse(saved) : {}
      if (!layout.mode || layout.mode === 'tab') {
        const splitLayout = { mode: 'split-left', ratio: 0.5 }
        localStorage.setItem('layoutSettings', JSON.stringify(splitLayout))
        window.electronAPI?.setLayout?.(splitLayout)?.catch?.((e) => console.warn('[useFlowEvents] setLayout failed:', e?.message)) // #R21-7
      }
    } catch (e) { /* ignore */ }
  }, [mode])
}
