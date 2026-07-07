/**
 * StoryStepper — Story 파이프라인 진행 상태 표시 (스펙 §6 + §v2.12 B + 리서치 spec §2.1).
 * ① 리서치 → ② 시놉시스 → ③ 시나리오 → ④ 씬 분리 → ⑤ 오디오 → ⑥ 프롬프트 (설정은 0번)
 *
 * 프레젠테이션 컴포넌트 — 상태만 렌더. done 상태 스텝과 현재 진행 단계(currentStep)는
 * onStepClick으로 클릭해 해당 패널을 다시 볼 수 있다 — 진행 대기(pending)·진행 중인 현재
 * 단계도 다른 탭을 보다가 돌아올 수 있어야 하기 때문. (아직 시작 안 한 미래 단계만 비클릭.)
 */
export const STEP_ORDER = ['script', 'scenes', 'audio', 'prompts']

// 설정(setup)은 실행 스텝이 아니라 진입 탭 — 상태 배지 없이 스텝퍼 맨 앞(0번)에 둔다.
export const SETUP_KEY = 'setup'
export const SETUP_META = { icon: '0', label: '설정' }

// 리서치(research)는 시놉시스 앞의 선택적 게이트 탭(리서치 spec §2.1/D1) — 시놉시스 §v2.12 B
// 패턴 미러로 정식 번호(①) 자리를 항상 렌더하고, 활성/비활성은 researchEnabled prop이 가른다.
export const RESEARCH_KEY = 'research'
export const RESEARCH_META = { icon: '①', label: '리서치' }

// 시놉시스(synopsis)는 실행 스텝이 아닌 게이트 탭(script pre-phase, spec §v2.5)이지만
// §v2.12 B: 정식 번호로 자리를 항상 렌더한다(숨김 폐지 — "설정 탭 진입 시 사라짐" 해소).
// 활성/비활성은 synopsisEnabled prop이 가른다(비활성 = 회색, 클릭 불가). 스텝머신 코어 불변.
// 리서치(①) 삽입으로 ②로 시프트(리서치 spec §2.1 — 라벨/키 불변, icon만).
export const SYNOPSIS_KEY = 'synopsis'
export const SYNOPSIS_META = { icon: '②', label: '시놉시스' }

export const STEP_META = {
  script: { icon: '③', label: '시나리오' },
  scenes: { icon: '④', label: '씬 분리' },
  audio: { icon: '⑤', label: '오디오' },
  prompts: { icon: '⑥', label: '프롬프트' },
}

const STATUS_LABEL = { pending: '대기', running: '진행 중', done: '완료', error: '오류' }

// 자동 진행 대상 스텝(script/setup은 제외 — 대본은 사용자 설정/작성 필요).
const AUTO_STEPS = ['scenes', 'audio', 'prompts']

export default function StoryStepper({
  steps, currentStep, activeStep, t = (key, fallback) => fallback, onStepClick,
  autoSteps = null, onToggleAuto, onRunAll, canRunAll = false, autoRunning = false,
  synopsisEnabled = false, researchEnabled = false,
}) {
  // active(파란색)는 사용자가 보고 있는 스텝(activeStep=displayStep)을 따른다 — 클릭한 탭이 active.
  // 미지정이면 currentStep 폴백(하위호환).
  const activeKey = activeStep ?? currentStep
  const setupClickable = typeof onStepClick === 'function'
  const setupLabel = t(`story.step.${SETUP_KEY}`, SETUP_META.label)
  const synopsisLabel = t(`story.step.${SYNOPSIS_KEY}`, SYNOPSIS_META.label)
  const synopsisClickable = synopsisEnabled && setupClickable
  const researchLabel = t(`story.step.${RESEARCH_KEY}`, RESEARCH_META.label)
  const researchClickable = researchEnabled && setupClickable
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
      {/* 리서치 스텝(①) — 리서치 spec §2.1/§3.6: 자리는 항상 렌더(설정 뒤·시놉시스 앞), 무배지(게이트 탭).
          신규 title/pasted 흐름에서만 활성(researchEnabled) — imported/legacy는 회색 비활성. */}
      <div
        key={RESEARCH_KEY}
        role={researchClickable ? 'button' : undefined}
        tabIndex={researchClickable ? 0 : undefined}
        aria-label={researchClickable ? researchLabel : undefined}
        aria-disabled={researchClickable ? undefined : true}
        onClick={researchClickable ? () => onStepClick(RESEARCH_KEY) : undefined}
        onKeyDown={researchClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onStepClick(RESEARCH_KEY) } : undefined}
        className={[
          'story-step-pill',
          'story-step-research',
          RESEARCH_KEY === activeKey ? 'active' : '',
          researchClickable ? 'story-step-clickable' : 'story-step-disabled',
        ].filter(Boolean).join(' ')}
      >
        <span className="story-step-icon">{RESEARCH_META.icon}</span>
        <span className="story-step-name">{researchLabel}</span>
      </div>
      {/* 시놉시스 스텝(②) — §v2.12 B: 자리는 항상 렌더(리서치 뒤·시나리오 앞), 무배지(게이트 탭).
          title/pasted 신규 경로만 활성(synopsisEnabled) — imported/legacy는 회색 비활성(클릭 불가). */}
      <div
        key={SYNOPSIS_KEY}
        role={synopsisClickable ? 'button' : undefined}
        tabIndex={synopsisClickable ? 0 : undefined}
        aria-label={synopsisClickable ? synopsisLabel : undefined}
        aria-disabled={synopsisClickable ? undefined : true}
        onClick={synopsisClickable ? () => onStepClick(SYNOPSIS_KEY) : undefined}
        onKeyDown={synopsisClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onStepClick(SYNOPSIS_KEY) } : undefined}
        className={[
          'story-step-pill',
          'story-step-synopsis',
          SYNOPSIS_KEY === activeKey ? 'active' : '',
          synopsisClickable ? 'story-step-clickable' : 'story-step-disabled',
        ].filter(Boolean).join(' ')}
      >
        <span className="story-step-icon">{SYNOPSIS_META.icon}</span>
        <span className="story-step-name">{synopsisLabel}</span>
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
