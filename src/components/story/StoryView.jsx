/**
 * StoryView — Story 파이프라인 뷰 골격 (스펙 §6).
 *
 * 프레젠테이션 컴포넌트 — Task 9 useStoryPipeline() 훅을 직접 호출하지 않고
 * `{ state, streamingText, start, abort }`를 prop으로 받는다(테스트 용이성).
 * 진행 순서: ① 대본 → ② 씬 분리 → ③ 오디오(M1 미구현, M2 예정) → ④ 프롬프트.
 * 오디오 단계는 M1 진행 흐름에서 자동 스킵 — 씬 분리가 끝나면 바로 프롬프트로 넘어간다.
 *
 * 인라인 편집 · autoRun 토글은 M1 범위 밖(버튼 자리만 없음, 다음 마일스톤에서 추가).
 */
import { useState } from 'react'
import { useI18n } from '../../hooks/useI18n'
import StoryStepper, { STEP_META } from './StoryStepper'
import './StoryView.css'

// audio(M2)는 M1 진행 흐름에서 제외 — done 여부를 따지지 않고 건너뛴다.
const PROGRESSABLE_STEPS = ['script', 'scenes', 'prompts']

function computeCurrentStep(steps) {
  for (const key of PROGRESSABLE_STEPS) {
    if ((steps?.[key]?.status || 'pending') !== 'done') return key
  }
  return 'prompts'
}

// StoryView는 I18nProvider 없이도(단위 테스트) 렌더 가능해야 하는 프레젠테이션 컴포넌트다.
// useI18n()은 provider가 없으면 throw하므로 감싸서 안전한 t()로 노출하고, 키가 없으면(현재는
// 로케일 파일에 story.* 키가 없음) 항상 한국어 fallback 문자열을 그대로 보여준다.
function useSafeT() {
  let i18nT = null
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    i18nT = useI18n().t
  } catch {
    i18nT = null
  }
  return (key, fallback) => {
    if (!i18nT) return fallback
    const v = i18nT(key)
    return v === key ? fallback : v
  }
}

export default function StoryView({ pipeline }) {
  const t = useSafeT()
  const { state, streamingText, start, abort, scenes = [] } = pipeline
  const steps = state?.steps || {}
  const currentStep = computeCurrentStep(steps)
  const stepData = steps[currentStep] || { status: 'pending' }
  const isRunning = stepData.status === 'running'
  const isError = stepData.status === 'error'

  // ① 제목 입력 폼 — M1은 편집 저장 없이 로컬 폼 상태만(대본 생성 시작 파라미터로 사용).
  const [title, setTitle] = useState('')
  const [genre, setGenre] = useState('')
  const [length, setLength] = useState('')
  const [language, setLanguage] = useState('ko')
  const [scriptDraft, setScriptDraft] = useState('')
  // M1 스펙 §1 2번 경로 — 대본을 직접 붙여넣어 LLM 호출 없이 바로 시작.
  const [pastedScript, setPastedScript] = useState('')

  // 버튼 aria-label(=접근성 이름)로 실제 라벨을 노출하고, 화면에 보이는 텍스트는 스텝 이름과
  // 겹치지 않는 짧은 문구로 둔다. 스테퍼의 단계명 텍스트(예: "대본")와 버튼 라벨(예: "대본 생성")이
  // 동시에 렌더되면 텍스트 검색(getByText)이 두 노드를 모두 찾아 모호해지기 때문.
  const actionAriaLabel = isError
    ? t('story.action.retry', '재실행')
    : currentStep === 'script'
      ? t('story.action.generateScript', '대본 생성')
      : t('story.action.run', `${STEP_META[currentStep].label} 실행`)

  const actionVisibleLabel = isError
    ? t('story.action.retryIcon', '↻ 다시 시도')
    : currentStep === 'script'
      ? t('story.action.generateIcon', '✨ 시작')
      : t('story.action.runIcon', '▶ 진행')

  const handlePrimaryAction = () => {
    if (currentStep === 'script') {
      // stepMachine.steps.script는 params.input(대본 생성 소재)과 params.options(LLM 호출
      // opts로 그대로 spread)를 분리해서 읽는다 — genre/length/language를 input에 섞으면
      // options로 전달되지 않아 LLM이 이를 무시하고(예: 한국어 입력에도 영어 대본) 버그가 된다.
      start('script', {
        input: { type: 'title', title },
        options: { genre: genre || undefined, targetMinutes: Number(length) || undefined, language },
      })
    } else {
      start(currentStep, {})
    }
  }

  const handlePasteStart = () => {
    start('script', { pastedScript, options: { language } })
  }

  return (
    <div className="story-view">
      <StoryStepper steps={steps} currentStep={currentStep} t={t} />

      {isError && (
        <div className="story-error-banner" role="alert">
          ⚠️ {t('story.error.prefix', '오류')}: {stepData.error}
        </div>
      )}

      <div className="story-step-panel">
        {currentStep === 'script' && (
          <div className="story-script-panel">
            <div className="story-title-form">
              <input
                className="story-input"
                placeholder={t('story.form.titlePlaceholder', '제목')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isRunning}
              />
              <input
                className="story-input"
                placeholder={t('story.form.genrePlaceholder', '장르')}
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                disabled={isRunning}
              />
              <input
                className="story-input"
                placeholder={t('story.form.lengthPlaceholder', '길이(분)')}
                value={length}
                onChange={(e) => setLength(e.target.value)}
                disabled={isRunning}
              />
              <input
                className="story-input"
                placeholder={t('story.form.languagePlaceholder', '언어')}
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isRunning}
              />
            </div>

            {isRunning ? (
              <div className="story-script-stream" aria-live="polite">{streamingText}</div>
            ) : (
              <textarea
                className="story-script-textarea"
                value={scriptDraft || streamingText}
                onChange={(e) => setScriptDraft(e.target.value)}
                placeholder={t('story.form.scriptPlaceholder', '대본이 여기에 표시됩니다')}
              />
            )}

            {!isRunning && (
              <div className="story-paste-form">
                <textarea
                  className="story-paste-textarea"
                  value={pastedScript}
                  onChange={(e) => setPastedScript(e.target.value)}
                  placeholder={t('story.form.pastePlaceholder', '대본을 직접 붙여넣기')}
                  disabled={isRunning}
                />
                <button
                  type="button"
                  className="story-btn-secondary"
                  onClick={handlePasteStart}
                  disabled={isRunning || !pastedScript.trim()}
                  aria-label={t('story.action.pasteStart', '대본으로 시작')}
                >
                  {t('story.action.pasteStartIcon', '📝 붙여넣기로 진행')}
                </button>
              </div>
            )}
          </div>
        )}

        {currentStep === 'scenes' && (
          <div className="story-scenes-panel">
            <table className="story-readonly-table">
              <thead>
                <tr>
                  <th>{t('story.scenes.no', '#')}</th>
                  <th>{t('story.scenes.speaker', '화자')}</th>
                  <th>{t('story.scenes.segment', '세그먼트')}</th>
                </tr>
              </thead>
              <tbody>
                {scenes.flatMap((sc, si) =>
                  (sc.segments || []).map((seg, gi) => (
                    <tr key={`${sc.storyId ?? si}-${gi}`}>
                      <td>{si + 1}</td>
                      <td>{seg.speaker}</td>
                      <td>{seg.text}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
            {scenes.length === 0 && (
              <div className="story-empty-hint">{t('story.scenes.empty', '씬 분리 결과가 아직 없습니다.')}</div>
            )}
          </div>
        )}

        {currentStep === 'prompts' && (
          <div className="story-prompts-panel">
            <table className="story-readonly-table">
              <thead>
                <tr>
                  <th>{t('story.prompts.no', '#')}</th>
                  <th>{t('story.prompts.image', '이미지 프롬프트')}</th>
                  <th>{t('story.prompts.video', '비디오 프롬프트')}</th>
                </tr>
              </thead>
              <tbody>
                {scenes.map((sc, i) => (
                  <tr key={sc.storyId ?? i}>
                    <td>{i + 1}</td>
                    <td>{sc.imagePrompt}</td>
                    <td>{sc.videoPrompt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {scenes.length === 0 && (
              <div className="story-empty-hint">{t('story.prompts.empty', '프롬프트 결과가 아직 없습니다.')}</div>
            )}
          </div>
        )}
      </div>

      <div className="story-controls">
        <button
          type="button"
          className={`story-btn-primary ${isError ? 'story-btn-error' : ''}`}
          onClick={handlePrimaryAction}
          disabled={isRunning}
          aria-label={actionAriaLabel}
        >
          {actionVisibleLabel}
        </button>
        {isRunning && (
          <button type="button" className="story-btn-secondary" onClick={() => abort()}>
            {t('story.action.abort', '⏹ 중단')}
          </button>
        )}
      </div>
    </div>
  )
}
