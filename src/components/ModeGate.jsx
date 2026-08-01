/**
 * ModeGate — mode 미선택이면 ModeSelector(첫 실행 피커)를, 선택됐으면 children(본 앱)을 렌더.
 *
 * 피커가 떠 있는 동안에는 Flow WebContentsView(네이티브 레이어 — CSS z-index 로 못 가림)를
 * useModalVisibility 로 숨긴다. 안 그러면 Flow 모드에서 피커를 다시 열 때 Flow 화면이 위를 가린다.
 */
import { useMode } from '../contexts/ModeContext'
import { useI18n } from '../hooks/useI18n'
import { useModalVisibility } from '../hooks/useModalVisibility'
import ModeSelector from './ModeSelector'
import { toast } from './Toast'

export default function ModeGate({ children }) {
  const { mode, sessionTarget = 'flow', setRoute } = useMode()
  const { t } = useI18n()
  useModalVisibility(!mode)
  const surfaceFailure = (error) => {
    toast.error(t('modeInfo.switchFailed', {
      error: error || 'route-set-failed',
    }))
  }
  const requestInitialRoute = async (nextMode) => {
    const nextRoute = { mode: nextMode, sessionTarget }
    if (typeof window.electronAPI?.setRoute !== 'function') {
      setRoute(nextRoute)
      return
    }
    try {
      const result = await window.electronAPI.setRoute(nextRoute)
      if (result?.ok === true && result.route) {
        setRoute(result.route)
      } else {
        surfaceFailure(result?.error || 'invalid-adopted-route')
      }
    } catch (error) {
      surfaceFailure(error?.message || 'route-set-failed')
    }
  }
  if (!mode) return <ModeSelector onSelect={requestInitialRoute} />
  return children
}
