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
import { useState, useEffect, useRef, useMemo } from 'react'
import { useI18n, I18nProvider } from '../../hooks/useI18n'
import { StopwatchIcon, ElapsedTime } from '../StopwatchIcon'
import PromptInput from '../PromptInput'
import { toast } from '../Toast'
import { useAudioPlayback } from '../../hooks/useAudioPlayback'
import { useStoryVoiceSelection } from '../../hooks/useStoryVoiceSelection'
import StoryStepper, { STEP_META } from './StoryStepper'
import VoicePicker from './VoicePicker'
import Modal from '../Modal'
import LiveTimeline from '../LiveTimeline'
import { buildStoryAudioPackage, buildStorySrtEntries } from '../../utils/storyAudioPackage'
import {
  DEFAULT_STORY_LLM,
  STORY_LLM_OPTIONS,
  findStoryLlmOptionById,
  hydrateStoryLlmSelection,
  normalizeStoryLlmOptions,
} from '../../utils/storyLlmCatalog'
import { isStoryTtsProvider } from '../../config/storyTtsProviders'
import { isNarratorSpeaker } from '../../utils/storyNarrationTracks'
import './StoryView.css'

// M2a-3: audio가 파이프라인 1급 스텝 — script→scenes→audio→prompts 순서로 진행한다.
const PROGRESSABLE_STEPS = ['script', 'scenes', 'audio', 'prompts']

// 세그먼트 감정 라벨 — SCENES_SCHEMA emotion(normal/happy/sad/angry). TTS(Typecast 등)에도 쓰인다.
const EMOTION_LABEL = { normal: '평범', happy: '기쁨', sad: '슬픔', angry: '화남' }

// 세그먼트 오디오 상태 라벨 (stepMachine이 세그먼트별 status를 pending/done/error로 기록).
const SEG_STATUS_LABEL = { pending: '대기', running: '진행 중', done: '완료', error: '오류' }

// M2b-5: SFX 소스 선택(세그먼트별). library는 아직 stub(생성 시 에러) — 인터페이스만 노출.
const SFX_SOURCES = ['elevenlabs', 'library']
const SFX_SOURCE_LABEL = { elevenlabs: 'ElevenLabs', library: 'Library' }
const DEFAULT_STORY_LENGTH_MINUTES = 10
const MAX_STORY_LENGTH_MINUTES = 60
const KOREAN_CHARS_PER_MINUTE = 330
const ENGLISH_WORDS_PER_MINUTE = 150
const STORY_LENGTH_MODE_UNIT = 'unit'
const STORY_LENGTH_UNITS = {
  ko: [
    { value: 'min', label: '분' },
    { value: 'chars', label: '자수' },
  ],
  en: [
    { value: 'min', label: 'min' },
    { value: 'words', label: 'words' },
    { value: 'chars', label: 'chars' },
  ],
}

function storyLengthUnitsForLanguage(language) {
  return language === 'en' ? STORY_LENGTH_UNITS.en : STORY_LENGTH_UNITS.ko
}

function storyLengthFactor(unit) {
  if (unit === 'chars') return KOREAN_CHARS_PER_MINUTE
  if (unit === 'words') return ENGLISH_WORDS_PER_MINUTE
  return 1
}

function coerceStoryLengthUnit(unit, language) {
  const allowed = storyLengthUnitsForLanguage(language).map((option) => option.value)
  if (allowed.includes(unit)) return unit
  if (unit === 'words') return 'chars'
  return 'min'
}

function normalizeStoryLengthValue(value, unit = 'min') {
  const raw = String(value ?? '').trim()
  const factor = storyLengthFactor(unit)
  const fallback = DEFAULT_STORY_LENGTH_MINUTES * factor
  const max = MAX_STORY_LENGTH_MINUTES * factor
  if (!raw) return String(fallback)
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return String(fallback)
  if (unit === 'min' && n < 1) return formatStoryLengthValue(Math.min(MAX_STORY_LENGTH_MINUTES, n))
  const rounded = Math.round(n)
  return String(Math.max(1, Math.min(max, rounded)))
}

function formatStoryLengthValue(value) {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(4).replace(/\.?0+$/, '')
}

function convertStoryLengthValue(value, fromUnit, toUnit) {
  const normalized = Number(normalizeStoryLengthValue(value, fromUnit))
  const minutes = Math.min(MAX_STORY_LENGTH_MINUTES, normalized / storyLengthFactor(fromUnit))
  return normalizeStoryLengthValue(minutes * storyLengthFactor(toUnit), toUnit)
}

function hydrateStoryLengthSettings(options = {}, language = 'ko') {
  const sourceUnit = ['min', 'chars', 'words'].includes(options?.lengthUnit) ? options.lengthUnit : 'min'
  const displayUnit = coerceStoryLengthUnit(sourceUnit, language)
  const isUnitMode = options?.lengthMode === STORY_LENGTH_MODE_UNIT
  const raw = String(options?.lengthValue ?? '').trim()
  const n = Number(raw)

  if (!isUnitMode && (sourceUnit === 'chars' || sourceUnit === 'words')) {
    if (Number.isFinite(n) && n >= 1 && n <= MAX_STORY_LENGTH_MINUTES) {
      return {
        lengthValue: convertStoryLengthValue(raw, 'min', displayUnit),
        lengthUnit: displayUnit,
      }
    }
  }

  return {
    lengthValue: sourceUnit === displayUnit
      ? normalizeStoryLengthValue(raw, displayUnit)
      : convertStoryLengthValue(raw, sourceUnit, displayUnit),
    lengthUnit: displayUnit,
  }
}

function storyLengthOptionValues(unit) {
  const factor = storyLengthFactor(unit)
  return Array.from({ length: MAX_STORY_LENGTH_MINUTES }, (_, i) => String((i + 1) * factor))
}

function storyLengthOptionLabel(value, unit, language) {
  if (unit === 'min') return language === 'en' ? `${value} min` : `${value}분`
  if (unit === 'words') return `${value} words`
  return language === 'en' ? `${value} chars` : `${value}자`
}

function storyLengthPlaceholder(unit, language) {
  if (unit === 'min') return language === 'en' ? 'min' : '분'
  if (unit === 'words') return 'words'
  return language === 'en' ? 'chars' : '자수'
}

function reasoningEffortFor(option, requestedReasoning = null) {
  const allowed = option?.reasoningEfforts || []
  if (!allowed.length) return ''
  return allowed.includes(requestedReasoning)
    ? requestedReasoning
    : (option.defaultReasoningEffort || allowed[0] || '')
}

const REVIEW_TARGET_LABEL = { script: '대본', scenes: '씬', prompts: '프롬프트' }
const REVIEW_TARGET_ORDER = ['script', 'scenes', 'prompts']

function defaultReviewRounds(target, model) {
  if (target === 'script') return String(model || '').startsWith('claude') ? 3 : 1
  return 1
}

function clampReviewRounds(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(5, Math.floor(n)))
}

function formatProgressLogTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** 스텝 진행 중 표시 — (선택) 옵션·기준 요약 + 초시계 + 라벨 + 경과 시간(updatedAt 기준, 1초 갱신). */
function StoryRunning({ label, startedAt, detail, log = [] }) {
  const logRef = useRef(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log.length])
  return (
    <div className="story-running" aria-live="polite">
      {detail && <div className="story-running-detail">{detail}</div>}
      <div className="story-running-main">
        <StopwatchIcon size={18} />
        <span className="story-running-label">{label}</span>
        <span className="story-running-elapsed"><ElapsedTime startedAt={startedAt || null} /></span>
      </div>
      {log.length > 0 && (
        <div className="story-progress-log" ref={logRef} role="log" aria-live="polite">
          {log.map((entry, i) => (
            <div key={entry.id || `${entry.phase || 'log'}-${i}`} className={`story-progress-log-row ${entry.level || 'info'}`}>
              <span className="story-progress-log-time">{formatProgressLogTime(entry.at)}</span>
              <span className="story-progress-log-message">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function computeCurrentStep(steps) {
  // 진행 중인 스텝을 우선(자동 진행이 자동=false 스텝을 건너뛰어 뒤 스텝이 먼저 running일 수 있다 —
  // 그 경우에도 isRunning/디스플레이/중단 버튼이 실제 running 스텝을 가리키게).
  for (const key of PROGRESSABLE_STEPS) {
    if ((steps?.[key]?.status) === 'running') return key
  }
  for (const key of PROGRESSABLE_STEPS) {
    if ((steps?.[key]?.status || 'pending') !== 'done') return key
  }
  return 'prompts'
}

function stableSnapshot(value) {
  if (Array.isArray(value)) return value.map(stableSnapshot)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((acc, key) => {
    const next = stableSnapshot(value[key])
    if (next !== undefined) acc[key] = next
    return acc
  }, {})
}

function stableJson(value) {
  return JSON.stringify(stableSnapshot(value))
}

function interpolateFallback(value, params = {}) {
  return String(value).replace(/\{(\w+)\}/g, (match, key) => (
    params[key] !== undefined ? params[key] : match
  ))
}

// 저장된 성우 id가 길면(ElevenLabs shared voice 해시 등) "미로드" 라벨에 그대로 붙이기엔
// 너무 길어서 표시용으로만 줄인다.
function shortVoiceId(id) {
  if (!id) return id
  return id.length > 12 ? `${id.slice(0, 10)}…` : id
}

// StoryView는 I18nProvider 없이도(단위 테스트) 렌더 가능해야 하는 프레젠테이션 컴포넌트다.
// useI18n()은 provider가 없으면 throw하므로 감싸서 안전한 t()로 노출하고, 키가 없으면
// 한국어 fallback 문자열을 그대로 보여준다.
function useSafeT() {
  let i18nT = null
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    i18nT = useI18n().t
  } catch {
    i18nT = null
  }
  return (key, fallback, params = {}) => {
    const fallbackValue = interpolateFallback(fallback, params)
    if (!i18nT) return fallbackValue
    const v = i18nT(key, params)
    return v === key ? fallbackValue : v
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

// VoicePicker 등 자식 컴포넌트의 isKo 분기용. i18n provider가 없는 단독 렌더(테스트)에서는
// useSafeT 폴백 정책(한국어 기본 문자열)과 맞춰 true를 기본값으로 둔다.
function useSafeIsKo() {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useI18n().lang === 'ko'
  } catch {
    return true
  }
}

export default function StoryView({ pipeline, voices = [], onClose = null, onTagGender = null, onVoiceSearch = null }) {
  const t = useSafeT()
  const hasI18n = useHasI18n()
  const isKo = useSafeIsKo()
  const { state, streamingText, start, abort, scenes = [], openError, ttsPreview, segmentProgress = {}, reviewProgress = null, progressLog = [] } = pipeline
  const steps = state?.steps || {}
  const currentStep = computeCurrentStep(steps)
  const stepData = steps[currentStep] || { status: 'pending' }
  const isRunning = stepData.status === 'running'
  // 자동 진행 — 스텝별 '자동' 토글(오디오는 TTS 비용이라 기본 off) + '전체 진행'(자동=true 순차실행).
  const [autoSteps, setAutoSteps] = useState({ scenes: true, audio: false, prompts: true })
  const [autoRunning, setAutoRunning] = useState(false)
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
  // M2a-3b/슬라이스3, Task 11: 화자별 엔진(provider)·목소리 선택 + VoicePicker 모달 상태.
  // useStoryVoiceSelection 훅으로 분리(순수 리팩터) — src/hooks/useStoryVoiceSelection.js 참고.
  const voiceSel = useStoryVoiceSelection({ speakers: state?.speakers || [], voices, onTagGender })
  // M2b-5: sfx 세그먼트별 소스(로컬 오버라이드). 기본은 세그먼트 영속값(seg.sourceMode) > elevenlabs.
  const [sourceModeBySegment, setSourceModeBySegment] = useState({})
  // M2a-3c: 세그먼트 오디오 미리듣기(단일 재생 토글).
  const { playingFile, playAudio, stopAudio } = useAudioPlayback()
  // §1 표시 라우팅 (R3-1) — scriptPhase가 남아 있는 동안(setup/editor)은 script done이어도
  // displayStep을 'script'로 강제해 대본 작업 화면을 유지한다. 다음 스텝 실행(분리시작)이나
  // 스텝퍼에서 다른 스텝 클릭 시 scriptPhase를 벗고(null) scenes/prompts 패널로 진행.
  // F1: 재오픈 등으로 scenes/prompts가 running 상태로 복원됐고 사용자가 아직 탭을 안 눌렀으면(viewedStep null),
  // scriptPhase 초기값(scriptText 있으면 editor)이 진행 표시를 가리지 않도록 진행 화면(currentStep)을 우선한다.
  const hydratedRunning = viewedStep == null && currentStep !== 'script' && stepData.status === 'running'
  const displayStep = (scriptPhase && !hydratedRunning)
    ? 'script'
    : (viewedStep && steps[viewedStep]?.status === 'done') ? viewedStep : currentStep
  // 스텝퍼 active pill: 대본 패널을 설정 phase로 보고 있으면 0번 '설정' 탭이 active, 그 외엔 displayStep.
  const stepperActive = (displayStep === 'script' && scriptPhase === 'setup') ? 'setup' : displayStep

  const handleStepClick = (key) => {
    // 0번 설정 탭 — 대본 탭과 분리된 진입 탭. 설정 폼(scriptPhase='setup')으로. displayStep이
    // 'script'로 잡히도록 viewedStep='script'을 두고, 명시 진입이라 자동 editor 승격을 막는다.
    if (key === 'setup') {
      setViewedStep('script')
      userWentToSetupRef.current = true
      setScriptPhase('setup')
      return
    }
    setViewedStep(key)
    // 대본 탭은 항상 편집기(설정은 이제 0번 탭이 담당).
    if (key === 'script') setScriptPhase('editor')
    else setScriptPhase(null)
  }

  // ① 제목/옵션 폼 — R4-2 폼 hydrate: 재오픈 시 state.input.title/options에서 복원(없으면 기본값).
  const hydrateInput = pipeline.state?.input
  const hydrateOpts = hydrateInput?.options || {}
  const llmOptions = useMemo(
    () => (Array.isArray(pipeline.llmOptions) && pipeline.llmOptions.length ? pipeline.llmOptions : STORY_LLM_OPTIONS),
    [pipeline.llmOptions],
  )
  const defaultLlmOption = findStoryLlmOptionById(pipeline.defaultLlmOption?.id, llmOptions)
    || llmOptions[0]
    || DEFAULT_STORY_LLM
  const initialLlmSource = (hydrateOpts.engine || hydrateOpts.model) ? hydrateOpts : defaultLlmOption
  const initialLengthSettings = hydrateStoryLengthSettings(hydrateOpts, hydrateOpts.language || 'ko')
  const [title, setTitle] = useState(hydrateInput?.title || '')
  const [genre, setGenre] = useState(hydrateOpts.genre || 'bespoke') // story-engine 기본: 장르 불명확 시 bespoke(범용)
  const [length, setLength] = useState(() => initialLengthSettings.lengthValue)
  const [lengthUnit, setLengthUnit] = useState(() => initialLengthSettings.lengthUnit)
  const [selectedLlmId, setSelectedLlmId] = useState(() => hydrateStoryLlmSelection(initialLlmSource, llmOptions))
  const selectedLlm = findStoryLlmOptionById(selectedLlmId, llmOptions) || defaultLlmOption
  const [reasoningEffort, setReasoningEffort] = useState(() => reasoningEffortFor(selectedLlm, hydrateOpts.reasoningEffort))
  const [language, setLanguage] = useState(hydrateOpts.language || 'ko')
  const [sceneGranularity, setSceneGranularity] = useState(hydrateOpts.sceneGranularity || 'scene') // 씬 분리 단위: scene(5~10초)/segment(문장별)
  const initialReview = hydrateOpts.review || null
  const makeReviewSettings = (opts = {}, model = selectedLlm.model) => ({
    script: {
      enabled: !!(opts.review?.script?.enabled ?? (!opts.review && opts.reviewLoop)),
      rounds: clampReviewRounds(opts.review?.script?.rounds ?? defaultReviewRounds('script', model)),
    },
    scenes: {
      enabled: !!opts.review?.scenes?.enabled,
      rounds: clampReviewRounds(opts.review?.scenes?.rounds ?? defaultReviewRounds('scenes', model)),
    },
    prompts: {
      enabled: !!opts.review?.prompts?.enabled,
      rounds: clampReviewRounds(opts.review?.prompts?.rounds ?? defaultReviewRounds('prompts', model)),
    },
  })
  const [reviewSettings, setReviewSettings] = useState(() => makeReviewSettings(hydrateOpts, selectedLlm.model))
  const [reviewTouched, setReviewTouched] = useState(!!initialReview)
  const [legacyReviewLoop, setLegacyReviewLoop] = useState(!initialReview && !!hydrateOpts.reviewLoop)

  const setLlmSelection = (id, requestedReasoning = null) => {
    const option = findStoryLlmOptionById(id, llmOptions) || defaultLlmOption
    setSelectedLlmId(option.id)
    setReasoningEffort(reasoningEffortFor(option, requestedReasoning))
    setReviewSettings((settings) => (
      reviewTouched ? settings : { ...settings, script: { ...settings.script, rounds: defaultReviewRounds('script', option.model) } }
    ))
  }

  const currentOptions = () => {
    const resolvedLengthUnit = coerceStoryLengthUnit(lengthUnit, language)
    return normalizeStoryLlmOptions({
      genre: genre || undefined,
      language,
      engine: selectedLlm.engine,
      model: selectedLlm.model,
      reasoningEffort,
      lengthValue: normalizeStoryLengthValue(length, resolvedLengthUnit),
      lengthUnit: resolvedLengthUnit,
      ...(resolvedLengthUnit === 'min' ? {} : { lengthMode: STORY_LENGTH_MODE_UNIT }),
      sceneGranularity,
      ...(reviewTouched
        ? { review: reviewSettings }
        : { reviewLoop: legacyReviewLoop }),
    }, llmOptions)
  }

  const changeLengthUnit = (nextUnit) => {
    const resolvedNextUnit = coerceStoryLengthUnit(nextUnit, language)
    setLength(convertStoryLengthValue(length, lengthUnit, resolvedNextUnit))
    setLengthUnit(resolvedNextUnit)
  }

  const changeLanguage = (nextLanguage) => {
    const nextUnit = coerceStoryLengthUnit(lengthUnit, nextLanguage)
    setLanguage(nextLanguage)
    if (nextUnit !== lengthUnit) {
      setLength(convertStoryLengthValue(length, lengthUnit, nextUnit))
      setLengthUnit(nextUnit)
    }
  }

  const setReviewStage = (target, patch) => {
    setReviewTouched(true)
    setLegacyReviewLoop(false)
    setReviewSettings((settings) => ({
      ...settings,
      [target]: {
        ...settings[target],
        ...patch,
        ...(patch.rounds != null ? { rounds: clampReviewRounds(patch.rounds) } : {}),
      },
    }))
  }

  const manualReviewParams = (target) => ({
    reviewOnly: true,
    options: currentOptions(),
    ...(target === 'script' ? { scriptOverride: scriptText } : {}),
    review: { [target]: { enabled: true, rounds: reviewSettings[target].rounds } },
  })

  const handleManualReview = (target) => {
    start(target, manualReviewParams(target))
    if (target === 'script') {
      setScriptPhase('editor')
      setViewedStep('script')
    } else {
      setScriptPhase(null)
      setViewedStep(target)
    }
  }

  const renderReviewControl = (target, { manual = false, disabled = false, canReview = true } = {}) => {
    const label = t(`story.review.target.${target}`, REVIEW_TARGET_LABEL[target])
    const settings = reviewSettings[target]
    return (
      <div key={target} className="story-review-control">
        <label className="story-review-toggle">
          <input
            type="checkbox"
            aria-label={t('story.review.autoAria', `${label} 자동 검수`, { target: label })}
            checked={settings.enabled}
            onChange={(e) => setReviewStage(target, { enabled: e.target.checked })}
            disabled={disabled}
          />
          <span>
            {manual
              ? t('story.review.autoToggleShort', '자동검수')
              : t('story.review.toggleLabel', `${label} 검수`, { target: label })}
          </span>
        </label>
        <input
          type="number"
          className="story-input story-review-rounds"
          aria-label={t('story.review.roundsAria', `${label} 검수 횟수`, { target: label })}
          min="1"
          max="5"
          value={settings.rounds}
          onChange={(e) => setReviewStage(target, { rounds: e.target.value })}
          disabled={disabled}
        />
        {manual && (
          <button
            type="button"
            className="story-btn-secondary story-review-run"
            aria-label={t('story.review.runAria', `${label} 검수`, { target: label })}
            onClick={() => handleManualReview(target)}
            disabled={disabled || !canReview}
          >
            {t('story.review.run', '검수')}
          </button>
        )}
      </div>
    )
  }

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
    if (o.engine || o.model) {
      const id = hydrateStoryLlmSelection(o, llmOptions)
      setLlmSelection(id, o.reasoningEffort)
    }
    if (o.language) setLanguage(o.language)
    if (o.lengthValue != null || o.lengthUnit != null) {
      const settings = hydrateStoryLengthSettings(o, o.language || 'ko')
      setLength(settings.lengthValue)
      setLengthUnit(settings.lengthUnit)
    }
    if (o.sceneGranularity) setSceneGranularity(o.sceneGranularity)
    if (o.review) {
      setReviewSettings(makeReviewSettings(o, (findStoryLlmOptionById(hydrateStoryLlmSelection(o, llmOptions), llmOptions) || selectedLlm).model))
      setReviewTouched(true)
      setLegacyReviewLoop(false)
    } else if (o.reviewLoop != null) {
      setReviewSettings(makeReviewSettings(o, (findStoryLlmOptionById(hydrateStoryLlmSelection(o, llmOptions), llmOptions) || selectedLlm).model))
      setReviewTouched(false)
      setLegacyReviewLoop(!!o.reviewLoop)
    }
  }, [state, llmOptions])

  useEffect(() => {
    if (findStoryLlmOptionById(selectedLlmId, llmOptions)) return
    setLlmSelection(defaultLlmOption.id)
  }, [selectedLlmId, llmOptions, defaultLlmOption.id])

  // 버튼 aria-label(=접근성 이름)로 실제 라벨을 노출하고, 화면에 보이는 텍스트는 스텝 이름과
  // 겹치지 않는 짧은 문구로 둔다. 스테퍼의 단계명 텍스트(예: "대본")와 버튼 라벨(예: "대본 생성")이
  // 동시에 렌더되면 텍스트 검색(getByText)이 두 노드를 모두 찾아 모호해지기 때문.
  const currentStepLabel = t(`story.step.${currentStep}`, STEP_META[currentStep].label)
  const actionAriaLabel = isError
    ? t('story.action.retry', '재실행')
    : currentStep === 'script'
      ? t('story.action.generateScript', '대본 생성')
      : t('story.action.run', `${currentStepLabel} 실행`, { step: currentStepLabel })

  const actionVisibleLabel = isError
    ? t('story.action.retryIcon', '↻ 다시 시도')
    : currentStep === 'script'
      ? t('story.action.generateIcon', '✨ 시작')
      : t('story.action.runIcon', '▶ 진행')

  // B: done 스텝(audio/prompts)을 보고 있으면 하단 primary가 다음 스텝으로 새지 않고 "다시 생성"
  // (그 스텝 재실행)으로 동작한다 + '닫기'로 파이프라인을 나간다. audio 재실행은 canReuse가 엔진/
  // 성우 바뀐 세그먼트만 재생성. (script/scenes는 파이프라인 진행이라 제외.)
  // 보고 있는 done 스텝을 재실행하는 탭별 액션(하단 primary가 currentStep으로 새지 않게).
  // scenes 포함 — 씬분리 done 탭에서 '씬 재분리'(오디오로 안 샘), audio/prompts는 '다시 생성'.
  const redoStep = (['scenes', 'audio', 'prompts'].includes(displayStep) && steps[displayStep]?.status === 'done' && !isRunning)
    ? displayStep : null
  const isAudioRedo = redoStep != null // (닫기 버튼 노출 조건 겸용)

  const baselineLlmId = hydrateStoryLlmSelection(initialLlmSource, llmOptions)
  const baselineLlm = findStoryLlmOptionById(baselineLlmId, llmOptions) || defaultLlmOption
  const baselineLengthSettings = hydrateStoryLengthSettings(hydrateOpts, hydrateOpts.language || 'ko')
  const setupBaselineOptions = normalizeStoryLlmOptions({
    genre: hydrateOpts.genre || 'bespoke',
    language: hydrateOpts.language || 'ko',
    engine: baselineLlm.engine,
    model: baselineLlm.model,
    reasoningEffort: reasoningEffortFor(baselineLlm, hydrateOpts.reasoningEffort),
    lengthValue: baselineLengthSettings.lengthValue,
    lengthUnit: baselineLengthSettings.lengthUnit,
    ...(baselineLengthSettings.lengthUnit === 'min' ? {} : { lengthMode: STORY_LENGTH_MODE_UNIT }),
    sceneGranularity: hydrateOpts.sceneGranularity || 'scene',
    ...(hydrateOpts.review
      ? { review: makeReviewSettings(hydrateOpts, baselineLlm.model) }
      : { reviewLoop: !!hydrateOpts.reviewLoop }),
  }, llmOptions)
  const setupAlreadyApplied = steps.script?.status === 'done'
  const setupDirty = scriptText !== (pipeline.scriptText || '')
    || title !== (hydrateInput?.title || '')
    || stableJson(currentOptions()) !== stableJson(setupBaselineOptions)
  const setupHasSeed = !!(scriptText.trim() || title.trim())
  const isSetupActionView = displayStep === 'script'
    && scriptPhase === 'setup'
    && !isError
    && (currentStep === 'script' || userWentToSetupRef.current)
  const setupActionAriaLabel = setupAlreadyApplied
    ? setupDirty
      ? t('story.action.setupRestart', '변경사항으로 다시 시작')
      : t('story.action.setupComplete', '완료됨')
    : t('story.action.setupStart', '시작')
  const setupActionVisibleLabel = setupAlreadyApplied
    ? setupDirty
      ? t('story.action.setupRestartIcon', '↻ 변경사항으로 다시 시작')
      : t('story.action.setupComplete', '완료됨')
    : t('story.action.setupStartIcon', '✨ 시작')
  const setupActionDisabled = isRunning || !setupHasSeed || (setupAlreadyApplied && !setupDirty)
  const showSetupClose = isSetupActionView && setupAlreadyApplied && !!onClose
  const showPrimaryAction = !(showSetupClose && !setupDirty)

  // M2a-3b: 화자→목소리 매핑을 audio 스텝 params로. state.speakers가 없으면 {} (빈 speakers로
  // 덮어써 state.speakers를 지우는 것 방지 — 미배정은 backend defaultVoice 폴백). 선택 목소리는
  // 드롭다운(voiceBySpeaker) 우선, 없으면 기존 sp.voice 유지 — 로직은 useStoryVoiceSelection 훅으로 이전.
  // VoicePicker 모달에 넘길 목록만 여기서 유지(사용 가능한 provider로 필터).
  const storyVoices = voices.filter((v) => isStoryTtsProvider(v.provider))

  // M2b-5: sfx 세그먼트의 현재 소스 — 로컬 오버라이드 > 세그먼트 영속값 > elevenlabs.
  // Codex-Med: segId는 재분리/프로젝트 전환으로 재사용될 수 있다 — 오버라이드에 당시 description을
  // 함께 저장하고, 현재 세그먼트의 description과 일치할 때만 적용해 옛 선택이 다른 효과음에 새는 것을 막는다.
  const sfxOverrideForSeg = (seg) => {
    const o = sourceModeBySegment[seg.id]
    return o && o.desc === seg.description ? o.source : undefined
  }
  const sfxSourceForSeg = (seg) =>
    sfxOverrideForSeg(seg) ?? seg.sourceMode ?? 'elevenlabs'
  const setSfxSource = (seg, source) =>
    setSourceModeBySegment((m) => ({ ...m, [seg.id]: { source, desc: seg.description } }))

  const buildAudioParams = (regenerate = null) => {
    const params = {}
    const sps = state?.speakers || []
    if (sps.length) {
      params.speakers = sps.map((sp) => {
        const vid = voiceSel.voiceIdForSpeaker(sp)
        if (!vid) return { ...sp, voice: null } // '기본 성우' → backend defaultVoice 폴백
        return { ...sp, voice: { provider: voiceSel.providerForSpeaker(sp), voiceId: vid } }
      })
    }
    // 현재 sfx 세그먼트 중 로컬 오버라이드(description 일치)가 있는 것만 sfxSources로 전달.
    // 없으면 backend가 세그먼트 영속값/기본(elevenlabs) 사용.
    const sfxSources = {}
    for (const sc of scenes) {
      for (const seg of (sc.segments || [])) {
        if (seg.type !== 'sfx') continue
        const src = sfxOverrideForSeg(seg)
        if (src) sfxSources[seg.id] = src
      }
    }
    if (Object.keys(sfxSources).length) params.sfxSources = sfxSources
    if (regenerate?.length) params.regenerate = regenerate
    return params
  }

  const buildStepParams = (step) => {
    if (step === 'audio') return buildAudioParams()
    if (step === 'prompts') return { options: currentOptions() }
    return {}
  }

  // 세그먼트 셀 — 윗줄 대화. 감정은 화자(대사)만 아랫줄 (감정)으로, 나레이터는 제외.
  // 감정은 TTS·프롬프트 작성에도 쓰인다.
  const renderNarrationCell = (seg) => {
    if (isNarratorSpeaker(seg.speaker)) return seg.text
    const emo = seg.emotion || 'normal'
    return (
      <div className="story-seg-cell">
        <div className="story-seg-text">{seg.text}</div>
        <div className="story-seg-emotion">({t(`story.emotion.${emo}`, EMOTION_LABEL[emo] || EMOTION_LABEL.normal)})</div>
      </div>
    )
  }

  // M2a-3d/3c: 세그먼트 재생성(강제 re-TTS)·미리듣기.
  const regenerateSegment = (segId) => {
    start('audio', buildAudioParams([segId]))
    setScriptPhase(null)
    setViewedStep(null)
  }

  // audio 타임라인 프리뷰 — story 세그먼트를 화자별 voices audioPackage로 변환해 기존 AudioTimeline
  // (LiveTimeline)에 넘긴다(디스크 재배치 없이 메모리 변환). audio done일 때만 렌더.
  const storyAudioPkg = useMemo(() => buildStoryAudioPackage(scenes), [scenes])
  const storySrtEntries = useMemo(() => buildStorySrtEntries(scenes), [scenes])
  // Codex-Low: sfx만 있는 story(narration 없음)도 타임라인에 나오도록 sfx도 포함해 판정.
  const hasStoryAudio = storyAudioPkg.voices.some((v) => v.files.length > 0)
    || storyAudioPkg.sfx.some((s) => s.files.length > 0)

  // 슬라이스1: 세그먼트 단건 테스트 — 배치와 분리해 그 세그먼트만 합성(화자 매핑 반영) 후 바로 재생.
  const [previewBusy, setPreviewBusy] = useState(false)
  const testSegment = async (segId) => {
    if (previewBusy) return
    setPreviewBusy(true)
    try {
      const ap = buildAudioParams()
      const r = await ttsPreview?.({ segmentIds: [segId], speakers: ap.speakers, sfxSources: ap.sfxSources })
      if (r?.busy) { toast.error(t('story.audio.busy', '진행 중입니다. 잠시 후 다시 시도하세요.')); return }
      const seg = r?.segments?.find((s) => s.id === segId)
      if (seg?.audioPath) playAudio(seg.audioPath)
    } catch (e) {
      toast.error(t('story.audio.testFailed', `테스트 실패: ${e?.message || e}`, { error: e?.message || e }))
    } finally {
      setPreviewBusy(false)
    }
  }

  const startScriptFromTitle = () => {
    setBaseScript('')
    start('script', {
      input: { type: 'title', title },
      options: currentOptions(),
    })
    setScriptPhase('editor')
  }

  const handlePrimaryAction = async () => {
    if (currentStep === 'script') {
      // stepMachine.steps.script는 params.input(대본 생성 소재)과 params.options(LLM 호출
      // opts로 그대로 spread)를 분리해서 읽는다 — genre/length/language를 input에 섞으면
      // options로 전달되지 않아 LLM이 이를 무시하고(예: 한국어 입력에도 영어 대본) 버그가 된다.
      startScriptFromTitle()
    } else if (currentStep === 'scenes') {
      await handleSplit()
    } else {
      // M2a-3b: audio는 화자→목소리 매핑을 실어 보낸다(그 외 스텝은 params 없음).
      start(currentStep, buildStepParams(currentStep))
      // §1 — 다음 스텝(분리시작 등)을 실행하면 scriptPhase를 벗고 스텝퍼가 진행한다.
      setScriptPhase(null)
      // 진행 액션은 현재 단계로 화면을 되돌린다 — done 스텝을 보던 중이면 viewedStep이
      // 그 스텝에 고정돼 진행해도 화면이 안 따라온다(대기/진행 표시를 못 봄).
      setViewedStep(null)
    }
  }

  // B: 현재 보고 있는 done 스텝(audio/prompts)을 재실행. audio는 화자 매핑 반영, prompts는 params 없음.
  const handleStepRedo = () => {
    if (redoStep === 'scenes') { handleSplit(); return } // 씬 재분리(제목 확정+분리, 자체 viewedStep 처리)
    start(redoStep, buildStepParams(redoStep))
    setViewedStep(null)
  }

  const manualReviewTarget = !isRunning && ['scenes', 'prompts'].includes(displayStep)
    ? displayStep
    : null

  const handlePasteStart = () => {
    setBaseScript('')
    // 임포트/붙여넣기 시작도 현재 설정(genre/length/…)과 제목을 버리지 않고 전부 커밋한다 —
    // 안 그러면 재오픈 hydrate 시 기본값(bespoke/10분/제목없음)으로 되돌아간다.
    start('script', {
      pastedScript: scriptText,
      input: { type: 'pasted', title },
      options: currentOptions(),
    })
    // 임포트/붙여넣기 대본으로 시작 → editor phase (scriptText 유지).
    setScriptPhase('editor')
  }

  // §3 제목 자동생성 — 제목이 비고 대본이 있으면 generateTitle로 확정. 반환 title을
  // 로컬 변수로 돌려줘 이어지는 start payload에 직접 쓴다(React state 순서 비의존).
  // 실패 시 toast + null 반환(호출측 진행 중단 — 제목 없이 분리/재생성 안 함).
  const resolveTitle = async () => {
    if (title.trim() || !scriptText.trim()) return title
    try {
      const res = await pipeline.generateTitle(scriptText, currentOptions())
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
    if (resolved == null) return false // 제목 자동생성 실패 → 실행 안 함(자동 진행이 이걸로 멈춤)
    // resolveTitle이 생성한 title을 main source of truth에 커밋 — 없으면 재오픈 hydrate가 제목을 잃는다.
    const res = await start('scenes', { scriptOverride: scriptText, options: currentOptions(), title: resolved })
    // §1 — scenes 실행으로 scriptPhase를 벗고 스텝퍼가 진행한다.
    setScriptPhase(null)
    setViewedStep(null) // 씬 분리 진행 시 현재 단계(scenes) 패널로 화면 이동
    return !res?.error // busy 등 enqueue 실패면 false
  }

  // ── 자동 진행 오케스트레이션 ──────────────────────────────────────────────
  const AUTO_ORDER = ['scenes', 'audio', 'prompts']
  const handleToggleAuto = (step) => setAutoSteps((m) => ({ ...m, [step]: !m[step] }))
  // 다음 실행할 자동 스텝: 순서상 자동=true & 아직 done/running 아닌 첫 스텝(자동=false는 건너뜀).
  const nextAutoStep = () => AUTO_ORDER.find((s) => autoSteps[s] && steps[s]?.status !== 'done' && steps[s]?.status !== 'running')
  // 전체 진행 가능: 대본 done + 남은 자동 스텝 존재 + 실행 중 아님.
  const canRunAll = steps.script?.status === 'done' && !isRunning && !!nextAutoStep()
  // 스텝을 실행하되 enqueue 실패(제목 실패/busy)면 자동 진행을 멈춘다(stuck 방지, Codex).
  const triggerAutoStep = async (step) => {
    if (step === 'scenes') {
      const ok = await handleSplit()
      if (!ok) setAutoRunning(false)
      return
    }
    setScriptPhase(null); setViewedStep(null)
    const res = await start(step, buildStepParams(step))
    if (res?.error) setAutoRunning(false) // busy 등 상태전이 없음 → 멈춤
  }
  const handleRunAll = () => { if (canRunAll) setAutoRunning(true) }
  // 실행 중이면 대기, 완료되면 다음 자동 스텝, 에러/남은 스텝 없으면 종료.
  useEffect(() => {
    if (!autoRunning) return
    const anyRunning = ['script', ...AUTO_ORDER].some((s) => steps[s]?.status === 'running')
    if (anyRunning) return
    const anyError = ['script', ...AUTO_ORDER].some((s) => steps[s]?.status === 'error')
    if (anyError) { setAutoRunning(false); return }
    const next = nextAutoStep()
    if (!next) { setAutoRunning(false); return }
    triggerAutoStep(next)
  }, [autoRunning, steps]) // eslint-disable-line react-hooks/exhaustive-deps


  // §1-A setup primary [✨ 시작] — scriptText(임포트/붙여넣기) 있으면 임포트 경로, 없고 제목 있으면
  // 대본 생성 경로. 둘 다 없으면 버튼 자체가 disabled(아래)이므로 여기 도달하지 않는다.
  const handleSetupStart = () => {
    const originalScript = pipeline.scriptText || ''
    const shouldUsePastedScript = scriptText.trim()
      && (hydrateInput?.type === 'pasted' || !title.trim() || scriptText !== originalScript)
    if (shouldUsePastedScript) handlePasteStart()
    else startScriptFromTitle()
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
  // M3: 검토 루프 진행 배지 — 검토는 non-streaming이라 이게 없으면 멈춘 것처럼 보인다.
  const reviewBadge = reviewProgress ? (
    <div className={`story-review-badge${reviewProgress.phase === 'error' ? ' error' : ''}`} aria-live="polite">
      {reviewProgress.phase === 'error'
        ? t('story.review.stopped', '검토 중단')
        : reviewProgress.phase === 'revising'
          ? t('story.review.revising', `수정 중 ${reviewProgress.round}/${reviewProgress.of}`, { round: reviewProgress.round, of: reviewProgress.of })
          : t('story.review.reviewing', `검토 중 ${reviewProgress.round}/${reviewProgress.of}`, { round: reviewProgress.round, of: reviewProgress.of })}
    </div>
  ) : null

  const splitSummary = sceneGranularity === 'segment'
    ? t('story.scenes.summarySegment', '씬 분리 단위: 문장 기준 · 문장마다 씬 · 화자 전환 시 분리 · 짧은 조각 병합 · 10초↑ 분할')
    : t('story.scenes.summaryScene', '씬 분리 단위: 씬 기준 · 5~10초 의미 단위')
  const scenesProgressLog = progressLog.filter((entry) => !entry.step || entry.step === 'scenes')
  const activeLengthUnit = coerceStoryLengthUnit(lengthUnit, language)
  const lengthUnitOptions = storyLengthUnitsForLanguage(language)
  const lengthOptionValues = storyLengthOptionValues(activeLengthUnit)

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
      <StoryStepper steps={steps} currentStep={currentStep} activeStep={stepperActive} t={t} onStepClick={handleStepClick}
        autoSteps={autoSteps} onToggleAuto={handleToggleAuto} onRunAll={handleRunAll} canRunAll={canRunAll} autoRunning={autoRunning} />

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
                {reviewBadge}
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
                      {renderReviewControl('script', { manual: true, disabled: isRunning, canReview: !!scriptText.trim() })}
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
                    </>
                  )}
                </div>
              </div>
            ) : scriptRunning ? (
              // 생성 중 스트리밍 preview (setup에서 시작 직후 등 editor 외 phase).
              <div className="story-script-stream" aria-live="polite">{reviewBadge}{streamingText}</div>
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

                <div className="story-opt-row story-llm-row">
                  <span className="story-opt-label">{t('story.form.modelDesc', '생성 AI')}</span>
                  <div className="story-llm-controls">
                    <select
                      className="story-input story-model-select"
                      aria-label={t('story.form.modelLabel', '모델')}
                      value={selectedLlm.id}
                      onChange={(e) => setLlmSelection(e.target.value)}
                      disabled={isRunning}
                    >
                      {llmOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                    {!!(selectedLlm.reasoningEfforts || []).length && (
                      <label className="story-llm-reasoning">
                        <span className="story-opt-label story-llm-inline-label">{t('story.form.reasoningDesc', '추론 수준')}</span>
                        <select
                          className="story-input story-reasoning-select"
                          aria-label={t('story.form.reasoningLabel', '추론 수준')}
                          value={reasoningEffort || selectedLlm.defaultReasoningEffort || ''}
                          onChange={(e) => setReasoningEffort(e.target.value)}
                          disabled={isRunning}
                        >
                          {(selectedLlm.reasoningEfforts || []).map((effort) => (
                            <option key={effort} value={effort}>{effort}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </div>

                <div className="story-opt-row">
                  <span className="story-opt-label">{t('story.form.languageDesc', '출력 언어')}</span>
                  <select
                    className="story-input"
                    aria-label={t('story.form.languageLabel', '언어')}
                    value={language}
                    onChange={(e) => changeLanguage(e.target.value)}
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
                      aria-label={t('story.form.lengthValueLabel', '대본 분량 값')}
                      placeholder={storyLengthPlaceholder(activeLengthUnit, language)}
                      value={length}
                      onChange={(e) => setLength(e.target.value)}
                      disabled={isRunning}
                      inputMode="numeric"
                      list="story-length-minutes"
                    />
                    <select
                      className="story-input story-length-unit"
                      aria-label={t('story.form.lengthUnitLabel', '대본 분량 단위')}
                      value={activeLengthUnit}
                      onChange={(e) => changeLengthUnit(e.target.value)}
                      disabled={isRunning}
                    >
                      {lengthUnitOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <datalist id="story-length-minutes">
                      {lengthOptionValues.map((value) => (
                        <option
                          key={value}
                          value={value}
                          label={storyLengthOptionLabel(value, activeLengthUnit, language)}
                        >
                          {storyLengthOptionLabel(value, activeLengthUnit, language)}
                        </option>
                      ))}
                    </datalist>
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

                <div className="story-opt-row story-review-opt-row">
                  <span className="story-opt-label">{t('story.form.reviewLabel', '검수')}</span>
                  <div className="story-review-settings">
                    {REVIEW_TARGET_ORDER.map((target) => renderReviewControl(target, { disabled: isRunning }))}
                  </div>
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

              </div>
            )}
          </div>
        )}

        {displayStep === 'scenes' && (
          <div className="story-scenes-panel">
            {steps.scenes?.status === 'running' ? (
              <>
                {reviewBadge}
                <StoryRunning
                  label={t('story.scenes.running', '씬 분리 진행 중')}
                  startedAt={Date.parse(steps.scenes.updatedAt)}
                  detail={splitSummary}
                  log={scenesProgressLog}
                />
              </>
            ) : (
              <>
                {/* 10번: 씬 분리 탭에 필요한 옵션(씬 분리 단위)만 노출 — 바꾸고 하단 '씬 재분리'로 재분리. */}
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
                </div>
                <table className="story-readonly-table">
                  <thead>
                    <tr>
                      <th>{t('story.scenes.no', '#')}</th>
                      <th>{t('story.scenes.speaker', '화자')}</th>
                      <th>{t('story.scenes.segment', '세그먼트(감정)')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenes.flatMap((sc, si) =>
                      (sc.segments || []).map((seg, gi) => (
                        <tr key={`${sc.storyId ?? si}-${gi}`} className={seg.type === 'sfx' ? 'story-sfx-row' : undefined}>
                          <td>{si + 1}</td>
                          <td>{seg.type === 'sfx' ? t('story.audio.sfxLabel', 'SFX') : seg.speaker}</td>
                          <td>{seg.type === 'sfx' ? <span className="story-sfx-desc">{seg.description}</span> : renderNarrationCell(seg)}</td>
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
            {/* D: 생성 중엔 전체 진행(초시계) + 아래 세그먼트 목록을 함께 보여준다(실시간 진행). */}
            {steps.audio?.status === 'running' && (
              <StoryRunning
                label={t('story.audio.running', '오디오 생성 중')}
                startedAt={Date.parse(steps.audio.updatedAt)}
              />
            )}
            {/* 화자 매핑은 생성 중이 아닐 때만 노출(생성 중 변경 방지) */}
            {steps.audio?.status !== 'running' && (state?.speakers || []).length > 0 && (
                  <div className="story-voice-map">
                    {(state.speakers || []).map((sp) => {
                      const provider = voiceSel.providerForSpeaker(sp)
                      const selectedVoiceId = voiceSel.voiceIdForSpeaker(sp)
                      const selectedVoiceObj = selectedVoiceId
                        ? voices.find((v) => v.provider === provider && v.id === selectedVoiceId)
                        : null
                      // Codex 최종 리뷰 Finding 1: selectedVoiceId가 있는데 현재 voices 목록에 없으면
                      // (예: 이전 세션의 ElevenLabs shared voice가 이번 preload에 없음) "기본 성우"가
                      // 아니라 "저장은 됐지만 미로드"임을 구분해서 보여준다. buildAudioParams()는
                      // 여전히 저장된 voiceId를 그대로 내보내므로 라벨을 default로 보이면 안 된다.
                      const voiceLabel = !selectedVoiceId
                        ? t('story.audio.voiceDefault', '기본 성우')
                        : selectedVoiceObj
                          ? selectedVoiceObj.name
                          : t('story.audio.voiceUnloaded', `저장된 성우 (미로드) · ${shortVoiceId(selectedVoiceId)}`, { id: shortVoiceId(selectedVoiceId) })
                      return (
                        <div key={sp.id} className="story-voice-row">
                          <span className="story-voice-speaker">{sp.name || sp.id}</span>
                          {/* Task 11: 드롭다운 3종(엔진/검색/목소리) → 버튼 1개 + VoicePicker 모달 */}
                          <button
                            type="button"
                            className="story-input story-voice-picker-btn"
                            aria-label={t('story.audio.voiceFor', `${sp.name || sp.id} 목소리`, { speaker: sp.name || sp.id })}
                            onClick={() => voiceSel.openVoicePicker(sp)}
                          >
                            🎙 {voiceLabel}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
                {voiceSel.voicePickerSpeaker != null && (() => {
                  const sp = (state.speakers || []).find((s) => s.id === voiceSel.voicePickerSpeaker)
                  if (!sp) return null
                  return (
                    <Modal
                      isOpen
                      onClose={voiceSel.closeVoicePicker}
                      title={t('story.audio.voicePickerTitle', `${sp.name || sp.id} 성우 선택`, { speaker: sp.name || sp.id })}
                      className="voice-picker-modal"
                    >
                      <VoicePicker
                        voices={storyVoices}
                        selected={voiceSel.pickerSelection}
                        onSelect={voiceSel.setPickerSelection}
                        onPreview={(voice) => voiceSel.preview.play(voice)}
                        onOverrideGender={voiceSel.handleOverrideGender}
                        onConfirm={voiceSel.confirmVoice}
                        onCancel={voiceSel.closeVoicePicker}
                        onVoiceSearch={onVoiceSearch}
                        previewState={voiceSel.preview.state}
                        t={t}
                        isKo={isKo}
                      />
                    </Modal>
                  )
                })()}
                {steps.audio?.status === 'done' && hasStoryAudio && (
                  <div className="story-audio-timeline">
                    <LiveTimeline audioPackage={storyAudioPkg} scenes={[]} srtEntries={storySrtEntries} />
                  </div>
                )}
                <table className="story-readonly-table">
                  <thead>
                    <tr>
                      <th>{t('story.audio.no', '#')}</th>
                      <th>{t('story.audio.speaker', '화자')}</th>
                      <th>{t('story.audio.segment', '세그먼트(감정)')}</th>
                      <th>{t('story.audio.status', '상태')}</th>
                      <th>{t('story.audio.actions', '')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenes.flatMap((sc, si) =>
                      (sc.segments || []).map((seg, gi) => {
                       const isSfx = seg.type === 'sfx'
                       return (
                        <tr key={`${sc.storyId ?? si}-${gi}`} className={isSfx ? 'story-sfx-row' : undefined}>
                          <td>{si + 1}</td>
                          <td>{isSfx ? t('story.audio.sfxLabel', 'SFX') : seg.speaker}</td>
                          <td>
                            {isSfx ? (
                              <div className="story-sfx-cell">
                                <span className="story-sfx-desc">{seg.description}</span>
                                {/* M2b-5: 소스 선택(elevenlabs/library) — library는 아직 stub. 컴팩트 폭. */}
                                <select
                                  className="story-sfx-source"
                                  aria-label={t('story.audio.sfxSourceFor', `${seg.id} 소스`, { id: seg.id })}
                                  value={sfxSourceForSeg(seg)}
                                  onChange={(e) => setSfxSource(seg, e.target.value)}
                                >
                                  {SFX_SOURCES.map((s) => (
                                    <option key={s} value={s}>{SFX_SOURCE_LABEL[s] || s}</option>
                                  ))}
                                </select>
                              </div>
                            ) : renderNarrationCell(seg)}
                          </td>
                          <td>{t(`story.status.${segmentProgress[seg.id] || seg.status || 'pending'}`, SEG_STATUS_LABEL[segmentProgress[seg.id] || seg.status] || SEG_STATUS_LABEL.pending)}</td>
                          <td className="story-audio-actions">
                            {/* 세그먼트 단건 테스트(배치와 분리) — narration은 TTS, sfx는 sfxFor로 단건 생성 */}
                            <button
                              type="button"
                              className="story-seg-btn"
                              aria-label={t('story.audio.test', `${seg.id} 테스트`, { id: seg.id })}
                              onClick={() => testSegment(seg.id)}
                              disabled={isRunning || previewBusy}
                            >
                              ▶{t('story.audio.testLabel', '테스트')}
                            </button>
                            {/* M2a-3c 미리듣기 (오디오 있을 때) */}
                            {seg.audioPath && (
                              <button
                                type="button"
                                className="story-seg-btn"
                                aria-label={t('story.audio.preview', `${seg.id} 미리듣기`, { id: seg.id })}
                                onClick={() => (playingFile === seg.audioPath ? stopAudio() : playAudio(seg.audioPath))}
                                disabled={isRunning || previewBusy}
                              >
                                {playingFile === seg.audioPath ? '⏹' : '▶'}
                              </button>
                            )}
                            {/* M2a-3d 재생성 (한 번이라도 생성/실패한 세그먼트) */}
                            {(seg.status === 'done' || seg.status === 'error') && (
                              <button
                                type="button"
                                className="story-seg-btn"
                                aria-label={t('story.audio.regenerate', `${seg.id} 재생성`, { id: seg.id })}
                                onClick={() => regenerateSegment(seg.id)}
                                disabled={isRunning || previewBusy}
                              >
                                ↻
                              </button>
                            )}
                          </td>
                        </tr>
                       )
                      }),
                    )}
                  </tbody>
                </table>
                {scenes.length === 0 && (
                  <div className="story-empty-hint">{t('story.audio.empty', '세그먼트가 아직 없습니다. 씬 분리를 먼저 실행하세요.')}</div>
                )}
          </div>
        )}

        {displayStep === 'prompts' && (
          <div className="story-prompts-panel">
            {steps.prompts?.status === 'running' ? (
              <>
                {reviewBadge}
                <StoryRunning
                  label={t('story.prompts.running', '프롬프트 생성 중')}
                  startedAt={Date.parse(steps.prompts.updatedAt)}
                />
              </>
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
          {manualReviewTarget && renderReviewControl(manualReviewTarget, {
            manual: true,
            disabled: isRunning,
            canReview: scenes.length > 0,
          })}
          {showPrimaryAction && (
            <button
              type="button"
              className={`story-btn-primary ${isError ? 'story-btn-error' : ''}`}
              onClick={isSetupActionView ? handleSetupStart : redoStep ? handleStepRedo : handlePrimaryAction}
              disabled={isSetupActionView ? setupActionDisabled : isRunning}
              aria-label={isSetupActionView
                ? setupActionAriaLabel
                : redoStep === 'scenes' ? t('story.action.scenesRedo', '씬 재분리') : redoStep === 'prompts' ? t('story.action.promptsRedo', '프롬프트 다시 생성') : redoStep === 'audio' ? t('story.action.audioRedo', '오디오 다시 생성') : actionAriaLabel}
            >
              {isSetupActionView
                ? setupActionVisibleLabel
                : redoStep === 'scenes' ? t('story.action.scenesRedoIcon', '↻ 씬 재분리') : redoStep === 'prompts' ? t('story.action.promptsRedoIcon', '↻ 프롬프트 다시 생성') : redoStep === 'audio' ? t('story.action.audioRedoIcon', '↻ 오디오 다시 생성') : actionVisibleLabel}
            </button>
          )}
          {((isAudioRedo || showSetupClose) && onClose) && (
            <button type="button" className="story-btn-secondary" onClick={onClose}>
              {t('story.action.close', '닫기')}
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
