/**
 * StoryStepper — Story 파이프라인 4단계 진행 상태 표시 (스펙 §6).
 * ① 대본 → ② 씬 분리 → ③ 오디오(M1: 미구현, "M2 예정" 비활성) → ④ 프롬프트
 *
 * 프레젠테이션 컴포넌트 — 상태만 렌더. done 상태 스텝은 onStepClick으로 클릭해
 * 해당 패널을 다시 볼 수 있다(미완료 스텝은 아직 데이터가 없어 클릭 불가).
 */
export const STEP_ORDER = ['script', 'scenes', 'audio', 'prompts']

export const STEP_META = {
  script: { icon: '①', label: '대본' },
  scenes: { icon: '②', label: '씬 분리' },
  audio: { icon: '③', label: '오디오' },
  prompts: { icon: '④', label: '프롬프트' },
}

const STATUS_LABEL = { pending: '대기', running: '진행 중', done: '완료', error: '오류' }

export default function StoryStepper({ steps, currentStep, t = (key, fallback) => fallback, onStepClick }) {
  return (
    <div className="story-stepper">
      {STEP_ORDER.map((key) => {
        const meta = STEP_META[key]
        const isAudio = key === 'audio'
        const status = steps?.[key]?.status || 'pending'
        const label = t(`story.step.${key}`, meta.label)
        const clickable = !isAudio && status === 'done' && typeof onStepClick === 'function'
        return (
          <div
            key={key}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            aria-label={clickable ? label : undefined}
            onClick={clickable ? () => onStepClick(key) : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onStepClick(key) } : undefined}
            className={[
              'story-step-pill',
              `story-step-${status}`,
              key === currentStep ? 'active' : '',
              isAudio ? 'story-step-future' : '',
              clickable ? 'story-step-clickable' : '',
            ].filter(Boolean).join(' ')}
          >
            <span className="story-step-icon">{meta.icon}</span>
            <span className="story-step-name">{label}</span>
            <span className={`story-step-badge story-badge-${isAudio ? 'future' : status}`}>
              {isAudio
                ? t('story.step.audioFuture', 'M2 예정')
                : t(`story.status.${status}`, STATUS_LABEL[status] || status)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
