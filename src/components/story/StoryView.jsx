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
import { useState, useEffect, useRef } from 'react'
import { useI18n, I18nProvider } from '../../hooks/useI18n'
import { StopwatchIcon, ElapsedTime } from '../StopwatchIcon'
import PromptInput from '../PromptInput'
import { toast } from '../Toast'
import StoryStepper, { STEP_META } from './StoryStepper'
import './StoryView.css'

// M2a-3: audio가 파이프라인 1급 스텝 — script→scenes→audio→prompts 순서로 진행한다.
const PROGRESSABLE_STEPS = ['script', 'scenes', 'audio', 'prompts']

// 세그먼트 오디오 상태 라벨 (stepMachine이 세그먼트별 status를 pending/done/error로 기록).
const SEG_STATUS_LABEL = { pending: '대기', running: '진행 중', done: '완료', error: '오류' }

/** 스텝 진행 중 표시 — (선택) 옵션·기준 요약 + 초시계 + 라벨 + 경과 시간(updatedAt 기준, 1초 갱신). */
function StoryRunning({ label, startedAt, detail }) {
  return (
    <div className="story-running" aria-live="polite">
      {detail && <div className="story-running-detail">{detail}</div>}
      <div className="story-running-main">
        <StopwatchIcon size={18} />
        <span className="story-running-label">{label}</span>
        <span className="story-running-elapsed"><ElapsedTime startedAt={startedAt || null} /></span>
      </div>
    </div>
  )
}

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

// 상위에 I18nProvider 가 이미 있는지 감지한다. 있으면(실제 앱: Shell.jsx 상위 provider) 편집기
// PromptInput 을 다시 감싸지 않고 상위 provider 를 재사용해 Header 언어 전환이 전파되게 하고,
// 없으면(단위 테스트 단독 렌더) 폴백으로만 감싼다.
function useHasI18n() {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useI18n()
    return true
  } catch {
    return false
  }
}

export default function StoryView({ pipeline, voices = [] }) {
  const t = useSafeT()
  const hasI18n = useHasI18n()
  const { state, streamingText, start, abort, scenes = [], openError } = pipeline
  const steps = state?.steps || {}
  const currentStep = computeCurrentStep(steps)
  const stepData = steps[currentStep] || { status: 'pending' }
  const isRunning = stepData.status === 'running'
  // script 패널(대본 스트리밍/편집기·중단)은 "지금 진행 스텝(currentStep)"이 아니라 "script 스텝 자체"의
  // running 여부로 판단해야 한다 — 안 그러면 scenes/prompts running 중 대본 탭에서 빈 스트리밍이 뜬다(F2재검토).
  const scriptRunning = steps.script?.status === 'running'
  const isError = stepData.status === 'error'

  // 재설계 §0.1 — 대본 단일 source of truth. pipeline.scriptText(main이 story/script.md에서
  // 복원/커밋한 값)를 초기값으로 하는 controlled state. 편집(PromptInput)·붙여넣기(setup)가
  // 모두 이 하나를 쓴다(기존 scriptDraft/pastedScript 혼재 제거).
  const [scriptText, setScriptText] = useState(pipeline.scriptText || '')
  // §0.3 — 생성 완료/재오픈 지연 도착 시 main 저장값이 진실. pipeline.scriptText가 바뀌면
  // 로컬 편집 상태를 그 값으로 커밋한다(편집 중에는 pipeline 값이 안 바뀌므로 안 덮음).
  useEffect(() => {
    setScriptText(pipeline.scriptText || '')
  }, [pipeline.scriptText])

  // 재설계 §1 — script 스텝 2-phase. 재오픈 복원 시 scriptText가 있으면 바로 대본 작업
  // 화면(editor). setup→editor 승격은 명시 트리거(시작/붙여넣기 시작/스텝퍼 script 클릭)에서만.
  const [scriptPhase, setScriptPhase] = useState(pipeline.scriptText?.trim() ? 'editor' : 'setup')

  // §4 이어쓰기 — 시작 시점의 대본 스냅샷. 생성 중 preview에 `baseScript + streamingText`로
  // 접두 표시하는 용도(완료 커밋은 main payload.scriptText — delta 재조립 금지, §0.3).
  const [baseScript, setBaseScript] = useState('')

  // 재오픈 phase 승격 — open() 응답이 마운트 뒤 도착해 pipeline.scriptText가 늦게 채워지면
  // 초기 phase가 setup으로 굳어 있다. 사용자가 [⚙ 설정으로]를 눌러 명시적으로 setup에 온
  // 경우(ref)가 아니면 editor로 승격해 재오픈 복원(§1 초기 규칙)과 일치시킨다.
  const userWentToSetupRef = useRef(false)
  useEffect(() => {
    if (!pipeline.scriptText?.trim()) {
      // 프로젝트 전환 등으로 대본이 비면 다음 프로젝트의 지연 도착분을 다시 승격할 수 있게 해제.
      userWentToSetupRef.current = false
      return
    }
    if (scriptPhase === 'setup' && !userWentToSetupRef.current) setScriptPhase('editor')
  }, [pipeline.scriptText]) // eslint-disable-line react-hooks/exhaustive-deps

  // 7-⑴: 스텝퍼에서 done 상태 스텝을 클릭하면 진행이 더 앞서가 있어도 해당 패널을 다시 볼 수
  // 있다 — 실행 버튼/러닝 상태 등 액션은 여전히 실제 진행 단계(currentStep) 기준으로 동작한다.
  const [viewedStep, setViewedStep] = useState(null)
  // M2a-3b: 화자별 목소리 선택(로컬). 초기값은 state.speakers[].voice.voiceId, 사용자가 드롭다운으로 덮어씀.
  const [voiceBySpeaker, setVoiceBySpeaker] = useState({})
  // §1 표시 라우팅 (R3-1) — scriptPhase가 남아 있는 동안(setup/editor)은 script done이어도
  // displayStep을 'script'로 강제해 대본 작업 화면을 유지한다. 다음 스텝 실행(분리시작)이나
  // 스텝퍼에서 다른 스텝 클릭 시 scriptPhase를 벗고(null) scenes/prompts 패널로 진행.
  // F1: 재오픈 등으로 scenes/prompts가 running 상태로 복원됐고 사용자가 아직 탭을 안 눌렀으면(viewedStep null),
  // scriptPhase 초기값(scriptText 있으면 editor)이 진행 표시를 가리지 않도록 진행 화면(currentStep)을 우선한다.
  const hydratedRunning = viewedStep == null && currentStep !== 'script' && stepData.status === 'running'
  const displayStep = (scriptPhase && !hydratedRunning)
    ? 'script'
    : (viewedStep && steps[viewedStep]?.status === 'done') ? viewedStep : currentStep

  const handleStepClick = (key) => {
    setViewedStep(key)
    if (key === 'script') {
      // 대본이 아직 없는(fresh/pending) 상태에서 대본 탭을 누르면 setup(제목/옵션/파일선택)을 유지한다.
      // scriptText가 있거나 script done일 때만 editor로 복귀 — 무조건 editor면 setup이 사라지고 빈 편집기만 남는다.
      setScriptPhase(scriptText.trim() || steps.script?.status === 'done' ? 'editor' : 'setup')
    } else {
      setScriptPhase(null)
    }
  }

  // ① 제목/옵션 폼 — R4-2 폼 hydrate: 재오픈 시 state.input.title/options에서 복원(없으면 기본값).
  const hydrateInput = pipeline.state?.input
  const hydrateOpts = hydrateInput?.options || {}
  const [title, setTitle] = useState(hydrateInput?.title || '')
  const [genre, setGenre] = useState(hydrateOpts.genre || 'bespoke') // story-engine 기본: 장르 불명확 시 bespoke(범용)
  const [length, setLength] = useState(hydrateOpts.lengthValue || '10')          // 길이 값
  const [lengthUnit, setLengthUnit] = useState(hydrateOpts.lengthUnit || 'min') // 길이 단위
  const [model, setModel] = useState(hydrateOpts.model || 'claude-opus-4-8')
  const [language, setLanguage] = useState(hydrateOpts.language || 'ko')
  const [sceneGranularity, setSceneGranularity] = useState(hydrateOpts.sceneGranularity || 'scene') // 씬 분리 단위: scene(5~10초)/segment(문장별)

  // open()/getState() 응답은 마운트 뒤에 도착한다(useStoryAutoOpen이 story 뷰 표시와 동시에
  // open을 호출) — state.input이 늦게 오면 한 번만 폼을 hydrate한다. 이미 초기값으로 hydrate된
  // 경우에도 같은 값을 다시 세팅할 뿐이라 무해하고, 이후 사용자의 폼 편집은 덮지 않는다.
  const hydratedRef = useRef(!!hydrateInput)
  useEffect(() => {
    const input = state?.input
    if (!input) {
      // 프로젝트 전환 등으로 state가 리셋되면 다음 도착분을 다시 hydrate할 수 있게 해제.
      if (!state) hydratedRef.current = false
      return
    }
    if (hydratedRef.current) return
    hydratedRef.current = true
    if (input.title) setTitle(input.title)
    const o = input.options || {}
    if (o.genre) setGenre(o.genre)
    if (o.model) setModel(o.model)
    if (o.language) setLanguage(o.language)
    if (o.lengthValue) setLength(o.lengthValue)
    if (o.lengthUnit) setLengthUnit(o.lengthUnit)
    if (o.sceneGranularity) setSceneGranularity(o.sceneGranularity)
  }, [state])

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

  // M2a-3b: 화자→목소리 매핑을 audio 스텝 params로. state.speakers가 없으면 {} (빈 speakers로
  // 덮어써 state.speakers를 지우는 것 방지 — 미배정은 backend defaultVoice 폴백). 선택 목소리는
  // 드롭다운(voiceBySpeaker) 우선, 없으면 기존 sp.voice 유지.
  const buildAudioParams = () => {
    const sps = state?.speakers || []
    if (!sps.length) return {}
    return {
      speakers: sps.map((sp) => {
        const vid = voiceBySpeaker[sp.id] ?? sp.voice?.voiceId ?? ''
        if (!vid) return { ...sp, voice: sp.voice ?? null }
        const v = voices.find((x) => x.id === vid)
        return { ...sp, voice: v ? { provider: v.provider || 'typecast', voiceId: v.id } : (sp.voice ?? null) }
      }),
    }
  }

  const handlePrimaryAction = () => {
    if (currentStep === 'script') {
      // stepMachine.steps.script는 params.input(대본 생성 소재)과 params.options(LLM 호출
      // opts로 그대로 spread)를 분리해서 읽는다 — genre/length/language를 input에 섞으면
      // options로 전달되지 않아 LLM이 이를 무시하고(예: 한국어 입력에도 영어 대본) 버그가 된다.
      setBaseScript('') // 이어쓰기 아님 — preview 접두 초기화
      start('script', {
        input: { type: 'title', title },
        options: { genre: genre || undefined, language, model, lengthValue: length, lengthUnit, sceneGranularity },
      })
      // §1 전환 — '시작' 명시 트리거로 대본 작업 화면(editor)에 진입.
      setScriptPhase('editor')
    } else {
      // M2a-3b: audio는 화자→목소리 매핑을 실어 보낸다(그 외 스텝은 params 없음).
      start(currentStep, currentStep === 'audio' ? buildAudioParams() : {})
      // §1 — 다음 스텝(분리시작 등)을 실행하면 scriptPhase를 벗고 스텝퍼가 진행한다.
      setScriptPhase(null)
      // 진행 액션은 현재 단계로 화면을 되돌린다 — done 스텝을 보던 중이면 viewedStep이
      // 그 스텝에 고정돼 진행해도 화면이 안 따라온다(대기/진행 표시를 못 봄).
      setViewedStep(null)
    }
  }

  const handlePasteStart = () => {
    setBaseScript('')
    // 임포트/붙여넣기 시작도 현재 설정(genre/length/…)과 제목을 버리지 않고 전부 커밋한다 —
    // 안 그러면 재오픈 hydrate 시 기본값(bespoke/10분/제목없음)으로 되돌아간다.
    start('script', {
      pastedScript: scriptText,
      input: { type: 'pasted', title },
      options: { genre: genre || undefined, language, model, lengthValue: length, lengthUnit, sceneGranularity },
    })
    // 임포트/붙여넣기 대본으로 시작 → editor phase (scriptText 유지).
    setScriptPhase('editor')
  }

  // §2 editor 핸들러 공통 — options는 "현재 설정 반영"(R3-3): 폼의 현재 값을 그대로 싣는다.
  const currentOptions = () => ({ genre, language, model, lengthValue: length, lengthUnit, sceneGranularity })

  // §3 제목 자동생성 — 제목이 비고 대본이 있으면 generateTitle로 확정. 반환 title을
  // 로컬 변수로 돌려줘 이어지는 start payload에 직접 쓴다(React state 순서 비의존).
  // 실패 시 toast + null 반환(호출측 진행 중단 — 제목 없이 분리/재생성 안 함).
  const resolveTitle = async () => {
    if (title.trim() || !scriptText.trim()) return title
    try {
      const res = await pipeline.generateTitle(scriptText)
      if (!res?.title) throw new Error(res?.error || 'empty-title')
      setTitle(res.title)
      return res.title
    } catch (err) {
      toast.error(`${t('story.error.titleGenFailed', '제목 자동생성 실패')}: ${err?.message || err}`)
      return null
    }
  }

  // §5 다시쓰기 — 현재 제목/옵션으로 재생성(스트리밍). 성공 시 main 커밋으로 교체, 실패 시 옛 대본 유지.
  const handleRewrite = async () => {
    const resolved = await resolveTitle()
    if (resolved == null) return
    setBaseScript('')
    start('script', { input: { type: 'title', title: resolved }, options: currentOptions() })
  }

  // §4 이어쓰기 — 시작 시점 대본을 스냅샷하고 continue로 스트리밍.
  const handleContinue = () => {
    const base = scriptText
    setBaseScript(base)
    start('script', { continue: base, options: currentOptions() })
  }

  // §0.4 분리시작 — 편집본 저장 + 씬 분리 단일 액션. 제목 비면 자동생성 먼저(§3).
  const handleSplit = async () => {
    const resolved = await resolveTitle()
    if (resolved == null) return
    // resolveTitle이 생성한 title을 main source of truth에 커밋 — 없으면 재오픈 hydrate가 제목을 잃는다.
    start('scenes', { scriptOverride: scriptText, options: currentOptions(), title: resolved })
    // §1 — scenes 실행으로 scriptPhase를 벗고 스텝퍼가 진행한다.
    setScriptPhase(null)
    setViewedStep(null) // 씬 분리 진행 시 현재 단계(scenes) 패널로 화면 이동
  }

  const handleGoSetup = () => {
    userWentToSetupRef.current = true
    setScriptPhase('setup')
  }

  // §1-A setup primary [✨ 시작] — scriptText(임포트/붙여넣기) 있으면 임포트 경로, 없고 제목 있으면
  // 대본 생성 경로. 둘 다 없으면 버튼 자체가 disabled(아래)이므로 여기 도달하지 않는다.
  const handleSetupStart = () => {
    if (scriptText.trim()) handlePasteStart()
    else handlePrimaryAction() // currentStep==='script' → 제목 생성 경로
  }

  // 대본 임포트 공통 — .txt/.md 파일만 FileReader 로 읽어 scriptText 에 채운다(그 외 무시).
  // drag&drop 과 파일 선택(picker) 이 같은 경로를 쓴다.
  const importFileRef = useRef(null)
  const readImportFile = (file) => {
    if (!file) return
    const name = (file.name || '').toLowerCase()
    if (!name.endsWith('.txt') && !name.endsWith('.md')) return
    const reader = new FileReader()
    // onload 는 성공 시에만 온다 — onloadend 를 쓰면 읽기 실패(result=null)에도 불려
    // 기존 붙여넣은 대본을 빈 문자열로 덮어버린다. null 가드까지 이중 방어.
    reader.onload = () => {
      if (reader.result != null) setScriptText(String(reader.result))
    }
    reader.readAsText(file)
  }
  const handleImportDrop = (e) => {
    e.preventDefault()
    readImportFile(e.dataTransfer?.files?.[0])
  }
  const handleFilePick = (e) => {
    readImportFile(e.target.files?.[0])
    e.target.value = '' // 같은 파일 재선택도 change 가 다시 발화하도록 초기화
  }

  // 씬 분리 진행 표시용 — 그 탭에 필요한 옵션(씬 분리 단위)과 기준 요약만 보여준다.
  const splitSummary = sceneGranularity === 'segment'
    ? t('story.scenes.summarySegment', '씬 분리 단위: 문장 기준 · 문장마다 씬 · 화자 전환 시 분리 · 짧은 조각 병합 · 10초↑ 분할')
    : t('story.scenes.summaryScene', '씬 분리 단위: 씬 기준 · 5~10초 의미 단위')

  const scriptEditor = (
    <div className="story-script-editor">
      <PromptInput
        value={scriptText}
        onChange={setScriptText}
        references={[]}
        disableMentions
        showCharCount
        hideTip
        countLabelKey="prompt.lineCount"
        placeholder={t('story.form.scriptPlaceholder', '대본이 여기에 표시됩니다')}
      />
    </div>
  )

  return (
    <div className="story-view">
      <StoryStepper steps={steps} currentStep={currentStep} t={t} onStepClick={handleStepClick} />

      {openError && (
        <div className="story-open-error-banner" role="alert">
          ⚠️ {t('story.error.openFailed', '프로젝트 폴더를 열 수 없습니다')}: {openError}
        </div>
      )}

      {isError && (
        <div className="story-error-banner" role="alert">
          ⚠️ {t('story.error.prefix', '오류')}: {stepData.error}
        </div>
      )}

      <div className="story-step-panel">
        {displayStep === 'script' && (
          <div className="story-script-panel">
            {scriptPhase === 'editor' ? (
              // §1-B 대본 작업 화면 — 생성 중엔 스트리밍 preview(이어쓰기는 baseScript 접두),
              // 그 외 PromptInput 편집기 + 3버튼/설정으로.
              // PromptInput 은 useI18n() provider 를 요구한다. 실제 앱에선 상위(Shell.jsx)
              // provider 가 이미 있으므로 재사용해 Header 언어 전환이 그대로 전파되게 하고,
              // provider 가 없는 단위 테스트에서만 폴백으로 감싼다(중첩·중복 setLocale 방지).
              <div className="story-editor-phase" data-testid="story-editor">
                {scriptRunning ? (
                  <div className="story-script-stream" aria-live="polite">
                    {baseScript ? baseScript + streamingText : streamingText}
                  </div>
                ) : (
                  hasI18n ? scriptEditor : <I18nProvider>{scriptEditor}</I18nProvider>
                )}
                <div className="story-editor-controls">
                  {/* 중단/3버튼 분기는 isRunning(currentStep) 기준 — script뿐 아니라 scenes/prompts가
                      도는 중에도 대본 탭에서 abort를 잃지 않도록(재리뷰3). stream 렌더 분기만 scriptRunning. */}
                  {isRunning ? (
                    <button type="button" className="story-btn-secondary" onClick={() => abort()}>
                      {t('story.action.abort', '⏹ 중단')}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="story-btn-secondary"
                        onClick={handleRewrite}
                        disabled={!scriptText.trim()}
                      >
                        {t('story.action.rewrite', '다시쓰기')}
                      </button>
                      <button
                        type="button"
                        className="story-btn-secondary"
                        onClick={handleContinue}
                        disabled={!scriptText.trim()}
                      >
                        {t('story.action.continue', '이어쓰기')}
                      </button>
                      <button
                        type="button"
                        className="story-btn-primary"
                        onClick={handleSplit}
                        disabled={!scriptText.trim()}
                      >
                        {t('story.action.split', '분리시작')}
                      </button>
                      <button type="button" className="story-btn-secondary" onClick={handleGoSetup}>
                        {t('story.action.toSetup', '⚙ 설정으로')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : scriptRunning ? (
              // 생성 중 스트리밍 preview (setup에서 시작 직후 등 editor 외 phase).
              <div className="story-script-stream" aria-live="polite">{streamingText}</div>
            ) : (
              // §1-A 설정 화면 — 세로 옵션(라벨+설명) + 제목 + 대본 임포트(drag&drop/붙여넣기) + [✨ 시작].
              <div className="story-setup-phase" data-testid="story-setup">
                <div className="story-opt-row">
                  <span className="story-opt-label">{t('story.form.genreDesc', '이야기 유형')}</span>
                  <select
                    className="story-input"
                    aria-label={t('story.form.genreLabel', '장르')}
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    disabled={isRunning}
                  >
                    <option value="yadam">yadam (야담)</option>
                    <option value="dark-history">dark-history</option>
                    <option value="bespoke">bespoke</option>
                  </select>
                </div>

                <div className="story-opt-row">
                  <span className="story-opt-label">{t('story.form.modelDesc', '생성 AI')}</span>
                  <select
                    className="story-input"
                    aria-label={t('story.form.modelLabel', '모델')}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={isRunning}
                  >
                    <option value="claude-opus-4-8">Opus 4.8</option>
                    <option value="claude-sonnet-5">Sonnet 5</option>
                  </select>
                </div>

                <div className="story-opt-row">
                  <span className="story-opt-label">{t('story.form.languageDesc', '출력 언어')}</span>
                  <select
                    className="story-input"
                    aria-label={t('story.form.languageLabel', '언어')}
                    value={language}
                    onChange={(e) => {
                      // 언어 변경 시 길이 단위를 새 언어 허용 목록(en: min/words, 그 외: min/chars)으로
                      // 정규화 — 안 하면 옛 단위(chars↔words)가 남아 영어 대본에 "약 N자" 같은 불일치가 생긴다.
                      const v = e.target.value
                      setLanguage(v)
                      if (v === 'en' && lengthUnit === 'chars') setLengthUnit('words')
                      else if (v !== 'en' && lengthUnit === 'words') setLengthUnit('chars')
                    }}
                    disabled={isRunning}
                  >
                    <option value="ko">한국어 (ko)</option>
                    <option value="en">English (en)</option>
                  </select>
                </div>

                <div className="story-opt-row">
                  <span className="story-opt-label">{t('story.form.lengthDesc', '대본 분량')}</span>
                  <div className="story-length-group">
                    <input
                      className="story-input story-length-value"
                      aria-label={t('story.form.lengthValueLabel', '길이 값')}
                      placeholder={t('story.form.lengthPlaceholder', '길이')}
                      value={length}
                      onChange={(e) => setLength(e.target.value)}
                      disabled={isRunning}
                    />
                    <select
                      className="story-input story-length-unit"
                      aria-label={t('story.form.lengthUnitLabel', '길이 단위')}
                      value={lengthUnit}
                      onChange={(e) => setLengthUnit(e.target.value)}
                      disabled={isRunning}
                    >
                      <option value="min">{language === 'en' ? 'min' : '분'}</option>
                      <option value={language === 'en' ? 'words' : 'chars'}>{language === 'en' ? 'words' : '자'}</option>
                    </select>
                  </div>
                </div>

                <div className="story-opt-row">
                  <span className="story-opt-label">{t('story.form.granularityLabel', '씬 분리 단위')}</span>
                  <select
                    className="story-input"
                    aria-label={t('story.form.granularityLabel', '씬 분리 단위')}
                    value={sceneGranularity}
                    onChange={(e) => setSceneGranularity(e.target.value)}
                    disabled={isRunning}
                  >
                    <option value="scene">{t('story.form.granularityScene', '씬 기준 (5~10초)')}</option>
                    <option value="segment">{t('story.form.granularitySegment', '문장 기준')}</option>
                  </select>
                </div>

                <div className="story-opt-row">
                  <span className="story-opt-label">{t('story.form.titleLabel', '제목')}</span>
                  <input
                    className="story-input story-title-input"
                    placeholder={t('story.form.titlePlaceholder', '제목')}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={isRunning}
                  />
                </div>

                <div
                  className="story-import-drop"
                  data-testid="story-import-drop"
                  onDrop={handleImportDrop}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <textarea
                    className="story-paste-textarea"
                    value={scriptText}
                    onChange={(e) => setScriptText(e.target.value)}
                    placeholder={t('story.form.pastePlaceholder', '대본을 붙여넣거나 .txt/.md 파일을 끌어다 놓으세요')}
                    disabled={isRunning}
                  />
                  <div className="story-import-actions">
                    <button
                      type="button"
                      className="story-btn-secondary"
                      onClick={() => importFileRef.current?.click()}
                      disabled={isRunning}
                    >
                      📁 {t('story.form.pickFile', '파일 선택')}
                    </button>
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".txt,.md"
                      data-testid="story-file-input"
                      style={{ display: 'none' }}
                      onChange={handleFilePick}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="story-btn-primary story-setup-start"
                  onClick={handleSetupStart}
                  disabled={isRunning || (!scriptText.trim() && !title.trim())}
                  aria-label={t('story.action.setupStart', '시작')}
                >
                  {t('story.action.setupStartIcon', '✨ 시작')}
                </button>
              </div>
            )}
          </div>
        )}

        {displayStep === 'scenes' && (
          <div className="story-scenes-panel">
            {steps.scenes?.status === 'running' ? (
              <StoryRunning
                label={t('story.scenes.running', '씬 분리 진행 중')}
                startedAt={Date.parse(steps.scenes.updatedAt)}
                detail={splitSummary}
              />
            ) : (
              <>
                {/* 10번: 씬 분리 탭에 필요한 옵션(씬 분리 단위)만 노출 — 바꿔서 다시 분리. */}
                <div className="story-rerun-bar">
                  <span className="story-opt-label">{t('story.form.granularityLabel', '씬 분리 단위')}</span>
                  <select
                    className="story-input"
                    aria-label={t('story.scenes.rerunGranularity', '씬 분리 단위 (재분리)')}
                    value={sceneGranularity}
                    onChange={(e) => setSceneGranularity(e.target.value)}
                    disabled={isRunning}
                  >
                    <option value="scene">{t('story.form.granularityScene', '씬 기준 (5~10초)')}</option>
                    <option value="segment">{t('story.form.granularitySegment', '문장 기준')}</option>
                  </select>
                  <button
                    type="button"
                    className="story-btn-secondary"
                    onClick={handleSplit}
                    disabled={isRunning || !scriptText.trim()}
                  >
                    {t('story.scenes.rerun', '다시 분리')}
                  </button>
                </div>
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
              </>
            )}
          </div>
        )}

        {displayStep === 'audio' && (
          <div className="story-audio-panel">
            {steps.audio?.status === 'running' ? (
              <StoryRunning
                label={t('story.audio.running', '오디오 생성 중')}
                startedAt={Date.parse(steps.audio.updatedAt)}
              />
            ) : (
              <>
                {/* M2a-3b: 화자별 목소리 매핑 — ttsListVoices로 채운 voices에서 선택. 미배정은 backend 기본 성우. */}
                {(state?.speakers || []).length > 0 && (
                  <div className="story-voice-map">
                    {(state.speakers || []).map((sp) => (
                      <div key={sp.id} className="story-voice-row">
                        <span className="story-voice-speaker">{sp.name || sp.id}</span>
                        <select
                          className="story-input"
                          aria-label={t('story.audio.voiceFor', `${sp.name || sp.id} 목소리`)}
                          value={voiceBySpeaker[sp.id] ?? sp.voice?.voiceId ?? ''}
                          onChange={(e) => setVoiceBySpeaker((m) => ({ ...m, [sp.id]: e.target.value }))}
                        >
                          <option value="">{t('story.audio.voiceDefault', '기본 성우')}</option>
                          {voices.map((v) => (
                            <option key={v.id} value={v.id}>{v.name}{v.language ? ` (${v.language})` : ''}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
                <table className="story-readonly-table">
                  <thead>
                    <tr>
                      <th>{t('story.audio.no', '#')}</th>
                      <th>{t('story.audio.speaker', '화자')}</th>
                      <th>{t('story.audio.segment', '세그먼트')}</th>
                      <th>{t('story.audio.status', '상태')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenes.flatMap((sc, si) =>
                      (sc.segments || []).map((seg, gi) => (
                        <tr key={`${sc.storyId ?? si}-${gi}`}>
                          <td>{si + 1}</td>
                          <td>{seg.speaker}</td>
                          <td>{seg.text}</td>
                          <td>{t(`story.status.${seg.status || 'pending'}`, SEG_STATUS_LABEL[seg.status] || SEG_STATUS_LABEL.pending)}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
                {scenes.length === 0 && (
                  <div className="story-empty-hint">{t('story.audio.empty', '세그먼트가 아직 없습니다. 씬 분리를 먼저 실행하세요.')}</div>
                )}
              </>
            )}
          </div>
        )}

        {displayStep === 'prompts' && (
          <div className="story-prompts-panel">
            {steps.prompts?.status === 'running' ? (
              <StoryRunning
                label={t('story.prompts.running', '프롬프트 생성 중')}
                startedAt={Date.parse(steps.prompts.updatedAt)}
              />
            ) : (
              <>
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
              </>
            )}
          </div>
        )}
      </div>

      {/* editor phase는 패널 내 전용 버튼(다시쓰기/이어쓰기/분리시작/설정으로·중단)을 쓴다 —
          하단 제네릭 컨트롤은 editor 밖(setup·scenes/prompts 진행)에서만 렌더.
          F1재검토: scriptPhase가 editor로 남아도 실제로 표시 중인 게 대본 editor가 아니면(재오픈 running →
          displayStep=scenes/prompts) 하단 컨트롤(중단)을 보여야 하므로 "실제 editor 표시 중"을 기준으로 판단. */}
      {!(displayStep === 'script' && scriptPhase === 'editor') && (
        <div className="story-controls">
          {/* 설정 화면(신규 대본 생성)에서는 in-panel [✨ 시작]이 primary — 하단 제네릭 버튼을 감춘다.
              script done(씬 분리 진행) · 에러(재실행)에서는 그대로 노출. */}
          {!(scriptPhase === 'setup' && currentStep === 'script' && !isError) && (
            <button
              type="button"
              className={`story-btn-primary ${isError ? 'story-btn-error' : ''}`}
              onClick={handlePrimaryAction}
              disabled={isRunning}
              aria-label={actionAriaLabel}
            >
              {actionVisibleLabel}
            </button>
          )}
          {isRunning && (
            <button type="button" className="story-btn-secondary" onClick={() => abort()}>
              {t('story.action.abort', '⏹ 중단')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
