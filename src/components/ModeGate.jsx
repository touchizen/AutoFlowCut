/**
 * ModeGate — mode 미선택이면 ModeSelector(첫 실행 피커)를, 선택됐으면 children(본 앱)을 렌더.
 *
 * 피커가 떠 있는 동안에는 Flow WebContentsView(네이티브 레이어 — CSS z-index 로 못 가림)를
 * useModalVisibility 로 숨긴다. 안 그러면 Flow 모드에서 피커를 다시 열 때 Flow 화면이 위를 가린다.
 */
import { useMode } from '../contexts/ModeContext'
import { useModalVisibility } from '../hooks/useModalVisibility'
import ModeSelector from './ModeSelector'

export default function ModeGate({ children }) {
  const { mode, setMode } = useMode()
  useModalVisibility(!mode)
  if (!mode) return <ModeSelector onSelect={setMode} />
  return children
}
