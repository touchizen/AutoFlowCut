/**
 * StoryStepper — Story 파이프라인 4단계 진행 상태 표시 (스펙 §6).
 * ① 대본 → ② 씬 분리 → ③ 오디오 → ④ 프롬프트
 *
 * 프레젠테이션 컴포넌트 — 상태만 렌더. done 상태 스텝과 현재 진행 단계(currentStep)는
 * onStepClick으로 클릭해 해당 패널을 다시 볼 수 있다 — 진행 대기(pending)·진행 중인 현재
 * 단계도 다른 탭을 보다가 돌아올 수 있어야 하기 때문. (아직 시작 안 한 미래 단계만 비클릭.)
 */
export const STEP_ORDER = ['script', 'scenes', 'audio', 'prompts']

export const STEP_META = {
  script: { icon: '①', label: '대본' },
  scenes: { icon: '②', label: '씬 분리' },
  audio: { icon: '③', label: '오디오' },
  prompts: { icon: '④', label: '프롬프트' },
}

const STATUS_LABEL = { pending: '대기', running: '진행 중', done: '완료', error: '오류' }

export default function StoryStepper({ steps, currentStep, activeStep, t = (key, fallback) => fallback, onStepClick }) {
  // active(파란색)는 사용자가 보고 있는 스텝(activeStep=displayStep)을 따른다 — 클릭한 탭이 active.
  // 미지정이면 currentStep 폴백(하위호환).
  const activeKey = activeStep ?? currentStep
  return (
    <div className="story-stepper">
      {STEP_ORDER.map((key) => {
        const meta = STEP_META[key]
        const status = steps?.[key]?.status || 'pending'
        const label = t(`story.step.${key}`, meta.label)
        const clickable = (status === 'done' || key === currentStep) && typeof onStepClick === 'function'
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
              key === activeKey ? 'active' : '',
              clickable ? 'story-step-clickable' : '',
            ].filter(Boolean).join(' ')}
          >
            <span className="story-step-icon">{meta.icon}</span>
            <span className="story-step-name">{label}</span>
            <span className={`story-step-badge story-badge-${status}`}>
              {t(`story.status.${status}`, STATUS_LABEL[status] || status)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
