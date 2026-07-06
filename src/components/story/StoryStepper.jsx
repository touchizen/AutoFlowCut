/**
 * StoryStepper — Story 파이프라인 4단계 진행 상태 표시 (스펙 §6).
 * ① 대본 → ② 씬 분리 → ③ 오디오 → ④ 프롬프트
 *
 * 프레젠테이션 컴포넌트 — 상태만 렌더. done 상태 스텝과 현재 진행 단계(currentStep)는
 * onStepClick으로 클릭해 해당 패널을 다시 볼 수 있다 — 진행 대기(pending)·진행 중인 현재
 * 단계도 다른 탭을 보다가 돌아올 수 있어야 하기 때문. (아직 시작 안 한 미래 단계만 비클릭.)
 */
export const STEP_ORDER = ['script', 'scenes', 'audio', 'prompts']

// 설정(setup)은 실행 스텝이 아니라 진입 탭 — 상태 배지 없이 스텝퍼 맨 앞(0번)에 둔다.
export const SETUP_KEY = 'setup'
export const SETUP_META = { icon: '0', label: '설정' }

export const STEP_META = {
  script: { icon: '①', label: '대본' },
  scenes: { icon: '②', label: '씬 분리' },
  audio: { icon: '③', label: '오디오' },
  prompts: { icon: '④', label: '프롬프트' },
}

const STATUS_LABEL = { pending: '대기', running: '진행 중', done: '완료', error: '오류' }

// 자동 진행 대상 스텝(script/setup은 제외 — 대본은 사용자 설정/작성 필요).
const AUTO_STEPS = ['scenes', 'audio', 'prompts']

export default function StoryStepper({
  steps, currentStep, activeStep, t = (key, fallback) => fallback, onStepClick,
  autoSteps = null, onToggleAuto, onRunAll, canRunAll = false, autoRunning = false,
}) {
  // active(파란색)는 사용자가 보고 있는 스텝(activeStep=displayStep)을 따른다 — 클릭한 탭이 active.
  // 미지정이면 currentStep 폴백(하위호환).
  const activeKey = activeStep ?? currentStep
  const setupClickable = typeof onStepClick === 'function'
  const setupLabel = t(`story.step.${SETUP_KEY}`, SETUP_META.label)
  return (
    <div className="story-stepper">
      {/* 0번 설정 탭 — 실행 스텝이 아니라 진입 탭이라 상태 배지 없음, 항상 클릭 가능. */}
      <div
        key={SETUP_KEY}
        role={setupClickable ? 'button' : undefined}
        tabIndex={setupClickable ? 0 : undefined}
        aria-label={setupClickable ? setupLabel : undefined}
        onClick={setupClickable ? () => onStepClick(SETUP_KEY) : undefined}
        onKeyDown={setupClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onStepClick(SETUP_KEY) } : undefined}
        className={[
          'story-step-pill',
          'story-step-setup',
          SETUP_KEY === activeKey ? 'active' : '',
          setupClickable ? 'story-step-clickable' : '',
        ].filter(Boolean).join(' ')}
      >
        <span className="story-step-icon">{SETUP_META.icon}</span>
        <span className="story-step-name">{setupLabel}</span>
      </div>
      {STEP_ORDER.map((key) => {
        const meta = STEP_META[key]
        const status = steps?.[key]?.status || 'pending'
        const label = t(`story.step.${key}`, meta.label)
        const clickable = (status === 'done' || key === currentStep) && typeof onStepClick === 'function'
        const showAuto = autoSteps && AUTO_STEPS.includes(key) && typeof onToggleAuto === 'function'
        return (
          // pill(캡슐) + 그 아래 '자동' 체크박스를 한 열로 — '자동'을 캡슐 밖 둘째 줄에 둔다.
          <div key={key} className="story-step-col">
            <div
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
            {showAuto && (
              <label className="story-step-auto">
                <input
                  type="checkbox"
                  aria-label={t('story.auto.for', `${label} 자동`, { step: label })}
                  checked={!!autoSteps[key]}
                  onChange={() => onToggleAuto(key)}
                />
                <span>{t('story.auto.label', '자동')}</span>
              </label>
            )}
          </div>
        )
      })}
      {/* 스텝퍼 오른쪽 끝 — 자동=true 스텝들을 순서대로 자동 실행. */}
      {typeof onRunAll === 'function' && (
        <button
          type="button"
          className="story-step-runall"
          onClick={onRunAll}
          disabled={!canRunAll || autoRunning}
          aria-label={t('story.auto.runAll', '전체 진행')}
        >
          {autoRunning ? t('story.auto.running', '⏳ 자동 진행 중') : t('story.auto.runAllIcon', '▶ 전체 진행')}
        </button>
      )}
    </div>
  )
}
