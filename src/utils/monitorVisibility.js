/**
 * 상단 프리뷰 모니터(PreviewPanel) 렌더 여부 결정 (순수).
 * 항상 inline(입력 프롬프트 왼쪽, API 모드와 동일 위치). flow 는 '프리뷰' 토글/재생으로 게이트만 한다.
 *
 *   - 'inline' : 표시 — API 모드(상시) 또는 Flow 모드에서 열렸을 때(overlayOpen).
 *   - null     : 표시 안 함 (audio 탭, 또는 flow+미오픈).
 *
 * @param {{ mode: string|null, activeTab: string, overlayOpen: boolean }} args
 * @returns {'inline'|null}
 */
export function monitorRenderMode({ mode, activeTab, overlayOpen }) {
  if (activeTab === 'audio') return null
  if (mode === 'api') return 'inline'
  if (mode === 'flow' && overlayOpen) return 'inline'
  return null
}
