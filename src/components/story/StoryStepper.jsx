/**
 * StoryStepper — Story 파이프라인 진행 상태 표시 (스펙 §6 + §v2.12 B + 리서치 spec §2.1).
 * 설정 · 리서치 · 시놉시스(진입 탭) │ 대본 → 씬 분리 → 오디오 → 프롬프트(실행 스텝)
 *
 * 프레젠테이션 컴포넌트 — 상태만 렌더. done 상태 스텝과 현재 진행 단계(currentStep)는
 * onStepClick으로 클릭해 해당 패널을 다시 볼 수 있다 — 진행 대기(pending)·진행 중인 현재
 * 단계도 다른 탭을 보다가 돌아올 수 있어야 하기 때문. (아직 시작 안 한 미래 단계만 비클릭.)
 *
 * ── UI: 진행 레일 ──
 * 진입 탭(설정/리서치/시놉시스)은 왼쪽에 조용한 텍스트 탭으로 두고, 실제 생성 스텝만 번호 + 연결선
 * 레일로 그린다 → 진입 탭과 실행 스텝의 위계가 생기고 진행 방향이 보인다. 상태는 별도 색 점이 아니라
 * 번호 자리가 직접 표현한다(완료=체크, 진행 중=파란 링, 오류=빨간 링). 칩마다 흩어져 있던 자동 토글은
 * 오른쪽 '자동 N' 하나로 모으고, 개별 스텝 on/off 는 그 팝오버 안에서 한다(기능 유지 + 칩 과밀 해소).
 */
import { useEffect, useRef, useState } from 'react'

export const STEP_ORDER = ['script', 'scenes', 'audio', 'prompts']

// 설정(setup)은 실행 스텝이 아니라 진입 탭 — 레일 앞 텍스트 탭으로 둔다.
export const SETUP_KEY = 'setup'
export const SETUP_META = { label: '설정' }

// 리서치(research)는 시놉시스 앞의 선택적 게이트 탭(리서치 spec §2.1/D1) — 시놉시스 §v2.12 B
// 패턴 미러로 자리를 항상 렌더하고, 활성/비활성은 researchEnabled prop이 가른다.
export const RESEARCH_KEY = 'research'
export const RESEARCH_META = { label: '리서치' }

// 시놉시스(synopsis)는 실행 스텝이 아닌 게이트 탭(script pre-phase, spec §v2.5)이지만
// §v2.12 B: 자리를 항상 렌더한다(숨김 폐지 — "설정 탭 진입 시 사라짐" 해소).
// 활성/비활성은 synopsisEnabled prop이 가른다(비활성 = 회색, 클릭 불가). 스텝머신 코어 불변.
export const SYNOPSIS_KEY = 'synopsis'
export const SYNOPSIS_META = { label: '시놉시스' }

export const STEP_META = {
  script: { label: '대본' },
  scenes: { label: '씬 분리' },
  audio: { label: '오디오' },
  prompts: { label: '프롬프트' },
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

  // 자동 스텝 팝오버 — 칩 안 인라인 토글을 대체한다. 바깥 클릭/Esc 로 닫는다.
  const [autoOpen, setAutoOpen] = useState(false)
  const autoWrapRef = useRef(null)
  const showAutoControl = autoSteps && typeof onToggleAuto === 'function'
  useEffect(() => {
    if (!autoOpen) return
    const onDocDown = (e) => { if (!autoWrapRef.current?.contains(e.target)) setAutoOpen(false) }
    const onEsc = (e) => { if (e.key === 'Escape') setAutoOpen(false) }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [autoOpen])
  // 팝오버를 닫는 재렌더(자동 제어가 사라짐)에서 열린 상태가 남지 않게 한다.
  useEffect(() => { if (!showAutoControl && autoOpen) setAutoOpen(false) }, [showAutoControl, autoOpen])
  const autoOnCount = showAutoControl ? AUTO_STEPS.filter((k) => autoSteps[k]).length : 0

  // 아직 통과하지 못한 게이트에 서 있는가. 임포트 경로는 대본을 먼저 저장(script done)한 뒤
  //   시놉시스 게이트로 들어가므로, 그 동안 레일을 채우면 "대본 끝나고 씬 분리로 넘어가는 중"이라는
  //   거짓 진행이 보인다. 확정한 시놉시스를 다시 열어본 경우는 해당 없음 — 흐름은 그대로 채운다.
  // 리서치는 넣지 않는다: 건너뛰기가 정상 경로라 파이프라인을 막지 않고, researchEnabled 는 단계와
  //   무관하게 참으로 남아(title 경로) 건너뛴 프로젝트의 흐름을 영원히 회색으로 만든다. 리서치 단계에
  //   있다면 시놉시스도 아직 미확정이라 아래 조건이 이미 덮는다.
  const parkedAtGate = synopsisEnabled && !synopsisDone

  // 진입 탭(설정/리서치/시놉시스) — 실행 상태가 없는 텍스트 탭. setup 은 항상 활성.
  const gateTabs = [
    { key: SETUP_KEY, meta: SETUP_META, enabled: true, done: false },
    { key: RESEARCH_KEY, meta: RESEARCH_META, enabled: researchEnabled, done: researchDone },
    { key: SYNOPSIS_KEY, meta: SYNOPSIS_META, enabled: synopsisEnabled, done: synopsisDone },
  ]

  return (
    <div className="story-stepper">
      {/* 진입 탭 — 레일 왼쪽. 실행 스텝과 구분선으로 분리한다. */}
      <div className="story-stepper-gates">
        {gateTabs.map(({ key, meta, enabled, done }) => {
          const clickable = enabled && clickableBase
          const label = t(`story.step.${key}`, meta.label)
          return (
            <div
              key={key}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={clickable ? label : undefined}
              aria-disabled={!enabled ? true : undefined}
              onClick={clickable ? () => onStepClick(key) : undefined}
              onKeyDown={clickable ? onActivateKey(() => onStepClick(key)) : undefined}
              className={[
                'story-gate-tab',
                `story-step-${key}`,
                key === activeKey ? 'active' : '',
                clickable ? 'story-step-clickable' : '',
                !enabled ? 'story-step-disabled' : '',
              ].filter(Boolean).join(' ')}
            >
              <span className="story-gate-name">{label}</span>
              {/* 게이트 완료 표시 — 리서치 확정·시놉시스 확정. */}
              {done && (
                <span className="story-gate-check" title={t('story.status.done', '완료')} aria-label={t('story.status.done', '완료')}>✓</span>
              )}
            </div>
          )
        })}
      </div>

      <div className="story-stepper-divider" />

      {/* 실행 스텝 — 번호 + 연결선 레일. 연결선은 앞 스텝이 done 이면 채워진다. */}
      <div className="story-stepper-rail">
        {STEP_ORDER.map((key, i) => {
          const meta = STEP_META[key]
          const status = steps?.[key]?.status || 'pending'
          const label = t(`story.step.${key}`, meta.label)
          const clickable = (status === 'done' || key === currentStep) && clickableBase
          const statusText = t(`story.status.${status}`, STATUS_LABEL[status] || status)
          const prevDone = i > 0 && !parkedAtGate && (steps?.[STEP_ORDER[i - 1]]?.status === 'done')
          return (
            <div className="story-rail-cell" key={key}>
              {i > 0 && <span className={`story-rail-line${prevDone ? ' filled' : ''}`} aria-hidden="true" />}
              <div
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-label={clickable ? label : undefined}
                onClick={clickable ? () => onStepClick(key) : undefined}
                onKeyDown={clickable ? onActivateKey(() => onStepClick(key)) : undefined}
                className={[
                  'story-rail-step',
                  `story-step-${status}`,
                  key === activeKey ? 'active' : '',
                  clickable ? 'story-step-clickable' : '',
                ].filter(Boolean).join(' ')}
              >
                {/* 상태는 별도 점이 아니라 번호 자리가 표현한다 — 완료는 체크, 나머지는 순번. */}
                <span className="story-rail-num" title={statusText} aria-label={statusText}>
                  {status === 'done' ? '✓' : i + 1}
                </span>
                {/* 좁은 폭에선 라벨이 줄거나 숨으므로(아래 CSS) 전체 이름은 title 로 남긴다. */}
                <span className="story-rail-label" title={label}>{label}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="story-stepper-actions">
        {/* 자동 스텝 — 요약 버튼 + 팝오버(개별 on/off). 칩 안 인라인 토글 대체. */}
        {showAutoControl && (
          <div className="story-auto-wrap" ref={autoWrapRef}>
            <button
              type="button"
              className={`story-auto-summary${autoOnCount > 0 ? ' on' : ''}`}
              aria-expanded={autoOpen}
              aria-label={t('story.auto.label', '자동')}
              onClick={() => setAutoOpen((v) => !v)}
            >
              {t('story.auto.label', '자동')} <span className="story-auto-count">{autoOnCount}</span>
            </button>
            {autoOpen && (
              <div className="story-auto-popover" role="group" aria-label={t('story.auto.label', '자동')}>
                {AUTO_STEPS.map((key) => {
                  const label = t(`story.step.${key}`, STEP_META[key].label)
                  return (
                    <label className="story-auto-item" key={key}>
                      <input
                        type="checkbox"
                        aria-label={t('story.auto.for', `${label} 자동`, { step: label })}
                        checked={!!autoSteps[key]}
                        disabled={autoLockedSteps.includes(key)}
                        onChange={() => onToggleAuto(key)}
                      />
                      <span>{label}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {/* 자동=true 스텝들을 순서대로 자동 실행. */}
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
    </div>
  )
}
