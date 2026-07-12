/**
 * StoryStepper — Story 파이프라인 진행 상태 표시 (스펙 §6 + §v2.12 B + 리서치 spec §2.1).
 * ① 리서치 → ② 시놉시스 → ③ 대본 → ④ 씬 분리 → ⑤ 오디오 → ⑥ 프롬프트 (설정은 0번)
 *
 * 프레젠테이션 컴포넌트 — 상태만 렌더. done 상태 스텝과 현재 진행 단계(currentStep)는
 * onStepClick으로 클릭해 해당 패널을 다시 볼 수 있다 — 진행 대기(pending)·진행 중인 현재
 * 단계도 다른 탭을 보다가 돌아올 수 있어야 하기 때문. (아직 시작 안 한 미래 단계만 비클릭.)
 *
 * ── UI: 세그먼트 칩 ──
 * 칩을 한 줄(.story-stepper-track)에 두고 좌우 스크롤한다(줄바꿈 없음). 상태는 텍스트 배지 대신
 * 작은 색 점(.story-step-dot)으로, 자동 진행 토글은 둘째 줄 대신 칩 안 인라인(.story-step-auto)으로
 * 둔다 → 칩 높이 통일 + 폭 편차/2줄 줄바꿈 제거. 'Run all'은 track 밖 오른쪽에 고정한다.
 */
export const STEP_ORDER = ['script', 'scenes', 'audio', 'prompts']

// 설정(setup)은 실행 스텝이 아니라 진입 탭 — 상태 점 없이 스텝퍼 맨 앞(0번)에 둔다.
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
  script: { icon: '③', label: '대본' },
  scenes: { icon: '④', label: '씬 분리' },
  audio: { icon: '⑤', label: '오디오' },
  prompts: { icon: '⑥', label: '프롬프트' },
}

const STATUS_LABEL = { pending: '대기', running: '진행 중', done: '완료', error: '오류' }

// 자동 진행 대상 스텝(script/setup은 제외 — 대본은 사용자 설정/작성 필요).
const AUTO_STEPS = ['scenes', 'audio', 'prompts']

const onActivateKey = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() } }

export default function StoryStepper({
  steps, currentStep, activeStep, t = (key, fallback) => fallback, onStepClick,
  autoSteps = null, onToggleAuto, onRunAll, canRunAll = false, autoRunning = false,
  // D24a image-first: 자동 오디오는 끌 수 없다(prompts가 audio done을 요구 — 끄면 교착).
  // 잠긴 스텝은 checked 상태 그대로 disabled로 보여 "왜 못 끄는지"를 자리로 남긴다.
  autoLockedSteps = [],
  synopsisEnabled = false, researchEnabled = false,
  synopsisDone = false, researchDone = false,
}) {
  // active(파란색)는 사용자가 보고 있는 스텝(activeStep=displayStep)을 따른다 — 클릭한 탭이 active.
  // 미지정이면 currentStep 폴백(하위호환).
  const activeKey = activeStep ?? currentStep
  const clickableBase = typeof onStepClick === 'function'

  // 게이트 탭(설정/리서치/시놉시스) — 상태 점 없는 진입 탭. setup은 항상 활성, 나머지는 *Enabled가 가른다.
  const gateChips = [
    { key: SETUP_KEY, meta: SETUP_META, enabled: true, done: false },
    { key: RESEARCH_KEY, meta: RESEARCH_META, enabled: researchEnabled, done: researchDone },
    { key: SYNOPSIS_KEY, meta: SYNOPSIS_META, enabled: synopsisEnabled, done: synopsisDone },
  ]

  return (
    <div className="story-stepper">
      {/* 칩 한 줄 — 좌우 스크롤(줄바꿈 없음). */}
      <div className="story-stepper-track">
        {gateChips.map(({ key, meta, enabled, done }) => {
          const clickable = enabled && clickableBase
          const disabled = !enabled
          const label = t(`story.step.${key}`, meta.label)
          return (
            <div
              key={key}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={clickable ? label : undefined}
              aria-disabled={disabled ? true : undefined}
              onClick={clickable ? () => onStepClick(key) : undefined}
              onKeyDown={clickable ? onActivateKey(() => onStepClick(key)) : undefined}
              className={[
                'story-step-pill',
                `story-step-${key}`,
                key === activeKey ? 'active' : '',
                clickable ? 'story-step-clickable' : '',
                disabled ? 'story-step-disabled' : '',
              ].filter(Boolean).join(' ')}
            >
              <span className="story-step-icon">{meta.icon}</span>
              <span className="story-step-name">{label}</span>
              {/* 게이트 탭 완료 표시 — 리서치 확정·시놉시스 확정 시 done 점(대본 등 실행 스텝과 일관). */}
              {done && <span className="story-step-dot story-dot-done" title={t('story.status.done', '완료')} aria-label={t('story.status.done', '완료')} />}
            </div>
          )
        })}
        {STEP_ORDER.map((key) => {
          const meta = STEP_META[key]
          const status = steps?.[key]?.status || 'pending'
          const label = t(`story.step.${key}`, meta.label)
          const clickable = (status === 'done' || key === currentStep) && clickableBase
          const showAuto = autoSteps && AUTO_STEPS.includes(key) && typeof onToggleAuto === 'function'
          const statusText = t(`story.status.${status}`, STATUS_LABEL[status] || status)
          return (
            <div
              key={key}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={clickable ? label : undefined}
              onClick={clickable ? () => onStepClick(key) : undefined}
              onKeyDown={clickable ? onActivateKey(() => onStepClick(key)) : undefined}
              className={[
                'story-step-pill',
                `story-step-${status}`,
                key === activeKey ? 'active' : '',
                clickable ? 'story-step-clickable' : '',
              ].filter(Boolean).join(' ')}
            >
              <span className="story-step-icon">{meta.icon}</span>
              <span className="story-step-name">{label}</span>
              {/* 상태 = 텍스트 배지 대신 색 점(대기/진행/완료/오류). */}
              <span className={`story-step-dot story-dot-${status}`} title={statusText} aria-label={statusText} />
              {showAuto && (
                // 자동 토글 — 칩 안 인라인. 클릭이 칩(탭 이동)으로 버블링되지 않게 stopPropagation.
                <label
                  className={`story-step-auto${autoSteps[key] ? ' on' : ''}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    aria-label={t('story.auto.for', `${label} 자동`, { step: label })}
                    checked={!!autoSteps[key]}
                    disabled={autoLockedSteps.includes(key)}
                    onChange={() => onToggleAuto(key)}
                  />
                  <span>{t('story.auto.label', '자동')}</span>
                </label>
              )}
            </div>
          )
        })}
      </div>
      {/* 스텝퍼 오른쪽 끝(track 밖 고정) — 자동=true 스텝들을 순서대로 자동 실행. */}
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
