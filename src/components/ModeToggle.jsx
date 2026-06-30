/**
 * ModeToggle — 상단 바의 생성 모드 세그먼트 토글 (API ⇄ Flow).
 * 모드 미선택(null)이면 렌더 안 함.
 *
 * @param {{ busy?: boolean }} props
 *   busy: 배치 생성 진행 중이면 true → 비활성 모드 버튼 disabled (전환 차단).
 */
import { useMode } from '../contexts/ModeContext'
import { useI18n } from '../hooks/useI18n'
import { modeTooltip } from './modeInfo'
import './ModeToggle.css'

export default function ModeToggle({ busy = false }) {
  const { mode, setMode } = useMode()
  const { t } = useI18n()
  if (!mode) return null

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
        onClick={() => setMode('api')}
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
        onClick={() => setMode('flow')}
      >
        Flow
      </button>
    </div>
  )
}
