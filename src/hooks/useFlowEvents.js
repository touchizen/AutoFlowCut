/**
 * useFlowEvents — Flow 관련 이벤트 리스너 통합
 *
 * Flow 로그인 만료, 레이아웃 보정 등 App 초기화 시 필요한 이벤트 처리
 */

import { useEffect } from 'react'

/**
 * @param {object} params
 * @param {Function} params.onLoginExpired - 로그인 만료 시 콜백
 */
export function useFlowEvents({ onLoginExpired }) {
  // Flow 로그인 만료 이벤트 수신
  useEffect(() => {
    const handler = () => onLoginExpired()
    window.addEventListener('flow-login-expired', handler)
    return () => window.removeEventListener('flow-login-expired', handler)
  }, [])

  // DOM 모드: 레이아웃이 'tab'이면 split으로 보정 (Flow UI가 보여야 함)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('layoutSettings')
      const layout = saved ? JSON.parse(saved) : {}
      if (!layout.mode || layout.mode === 'tab') {
        const splitLayout = { mode: 'split-left', ratio: 0.5 }
        localStorage.setItem('layoutSettings', JSON.stringify(splitLayout))
        window.electronAPI?.setLayout?.(splitLayout)
      }
    } catch (e) { /* ignore */ }
  }, [])
}
