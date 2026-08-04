/**
 * ModeToggle — 상단 바의 생성 모드 세그먼트 토글 (API ⇄ Flow).
 * 모드 미선택(null)이면 렌더 안 함.
 *
 * @param {{ busy?: boolean, onRouteRequest?: (route: object) => Promise<object> }} props
 *   busy: 배치 생성 진행 중이면 true → 비활성 모드 버튼 disabled (전환 차단).
 */
import { useMode } from '../contexts/ModeContext'
import { useI18n } from '../hooks/useI18n'
import { modeTooltip } from './modeInfo'
import { toast } from './Toast'
import './ModeToggle.css'

export default function ModeToggle({ busy = false, onRouteRequest = null }) {
  const { mode, sessionTarget = 'flow', setRoute } = useMode()
  const { t } = useI18n()
  if (!mode) return null

  const surfaceFailure = (error) => {
    toast.error(t('modeInfo.switchFailed', {
      error: error || 'route-set-failed',
    }))
  }

  const requestMode = async (nextMode) => {
    if (nextMode === mode) return
    const nextRoute = { mode: nextMode, sessionTarget }
    try {
      if (onRouteRequest) {
        const result = await onRouteRequest(nextRoute)
        if (result?.ok !== true) surfaceFailure(result?.error)
        return
      }
      if (typeof window.electronAPI?.setRoute === 'function') {
        const result = await window.electronAPI.setRoute(nextRoute)
        if (result?.ok === true && result.route) {
          setRoute(result.route)
        } else {
          surfaceFailure(result?.error || 'invalid-adopted-route')
        }
        return
      }
      // Browser-only/component-test compatibility. Packaged Electron always owns
      // adoption through route:set (preload exposes setRoute).
      setRoute(nextRoute)
    } catch (error) {
      surfaceFailure(error?.message || 'route-set-failed')
    }
  }

  const busyTitle = t('modeInfo.busySwitch')
  // 각 버튼은 전환 대상 모드의 장단점을 hover 툴팁(멀티라인)으로 노출.
  // 단, 생성 중이라 전환 차단된 버튼은 안내 메시지를 우선 표시.
  const titleFor = (target) => (busy && mode !== target ? busyTitle : modeTooltip(target, t))

  return (
    <div className="mode-toggle" role="group" aria-label="생성 모드">
      <button
        type="button"
        data-testid="mode-toggle-api"
        className={`mode-toggle-btn ${mode === 'api' ? 'active' : ''}`}
        aria-pressed={mode === 'api'}
        disabled={busy && mode !== 'api'}
        title={titleFor('api')}
        onClick={() => { void requestMode('api') }}
      >
        API
      </button>
      <button
        type="button"
        data-testid="mode-toggle-flow"
        className={`mode-toggle-btn ${mode === 'flow' ? 'active' : ''}`}
        aria-pressed={mode === 'flow'}
        disabled={busy && mode !== 'flow'}
        title={titleFor('flow')}
        onClick={() => { void requestMode('flow') }}
      >
        Flow
      </button>
    </div>
  )
}
