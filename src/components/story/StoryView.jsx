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
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { readTextFile } from '../../utils/decodeTextFile'
import { useI18n, I18nProvider } from '../../hooks/useI18n'
import { useAudioPreflight } from '../../hooks/useAudioPreflight'
import AudioKeyGateCard from './AudioKeyGateCard'
import { StopwatchIcon, ElapsedTime } from '../StopwatchIcon'
import PromptInput from '../PromptInput'
import { toast } from '../Toast'
import { useAudioPlayback } from '../../hooks/useAudioPlayback'
import { useStickToBottom } from '../../hooks/useStickToBottom'
import { useStoryVoiceSelection } from '../../hooks/useStoryVoiceSelection'
import StoryStepper, { STEP_META } from './StoryStepper'
import { UsageInline } from './StoryTokenUsage'
import VoicePicker from './VoicePicker'
import SpeakerAudioSource from './SpeakerAudioSource'
import SpeakerRegenConfirmModal from './SpeakerRegenConfirmModal'
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
import { clampInt } from '../../utils/clampInt'
import { normalizeStoryCharacter, resolveCharacterGender } from '../../services/storyCharacter'
import { isRosterGatedInputType, synopsisModeForInputType } from '../../services/storyInputTypes'
import { resolveDisplayError } from '../../utils/errorDisplay'
import CharacterCards from './CharacterCards'
import ResearchPanel from './ResearchPanel'
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

// synopsis는 라벨/기본값만 갖고 ORDER엔 없다 — 수동 전용이라 설정 탭에 노출하지 않는다(spec 2026-07-10).
const REVIEW_TARGET_LABEL = { synopsis: '시놉시스', script: '대본', scenes: '씬', prompts: '프롬프트' }
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

// 검수 채점 배지 — 텍스트창 하단. 라운드가 여럿이고 점수가 달라졌으면 첫→마지막 변화를 보인다.
function ReviewScore({ scores = [] }) {
  if (!scores.length) return null
  const first = scores[0]
  const last = scores[scores.length - 1]
  const moved = scores.length > 1 && first !== last
  return (
    <div className="story-review-score" data-testid="review-score" aria-live="polite">
      <span className="story-review-score-label">몰입감</span>
      {moved ? (
        <>
          <span className="story-review-score-from">{first}</span>
          <span className="story-review-score-arrow" aria-hidden="true">→</span>
          <span className={`story-review-score-to ${last > first ? 'up' : 'down'}`}>{last}</span>
        </>
      ) : (
        <span className="story-review-score-to">{last}</span>
      )}
    </div>
  )
}

function formatProgressLogTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** 스텝 진행 중 표시 — (선택) 옵션·기준 요약 + 초시계 + 라벨 + 경과 시간(updatedAt 기준, 1초 갱신). */
function StoryRunning({ label, startedAt, detail, thinking = false, log = [], usage = null, t = (k, fallback) => fallback ?? k }) {
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
        <UsageInline usage={usage} />
      </div>
      {thinking && (
        <div className="story-thinking-badge" role="status">
          {t('story.stream.thinking', '🧠 추론 중… (모델이 생각하는 동안 출력이 표시되지 않습니다)')}
        </div>
      )}
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

// 완료 결과 표의 DOM/layout은 그대로 두고, ghost 행이 생기는 동안에만 독립 스크롤 영역을 만든다.
function StreamingTableViewport({ active, step, containerRef, onScroll, children }) {
  if (!active) return children
  return (
    <div
      className={`story-stream-table story-stream-table-${step}`}
      ref={containerRef}
      onScroll={onScroll}
    >
      {children}
    </div>
  )
}

// ghost table의 자체 스크롤 바깥에 둔다. 내부 행이 auto-scroll돼도 진행률은 패널 상단에 남는다.
function StreamingProgressBar({ label, valueText, value = null, thinking = false, thinkingText = '' }) {
  const indeterminate = value == null
  return (
    <div
      className="story-stream-progress story-stream-progress-sticky"
      role="progressbar"
      aria-label={label}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={indeterminate ? undefined : value}
      aria-valuetext={valueText}
    >
      <span className="story-stream-progress-label">{valueText}</span>
      <span className="story-stream-progress-track" aria-hidden="true">
        <span
          className={`story-stream-progress-fill${indeterminate ? ' indeterminate' : ''}`}
          style={indeterminate ? undefined : { width: `${value}%` }}
        />
      </span>
      {thinking && (
        <div className="story-thinking-badge" role="status">
          {thinkingText}
        </div>
      )}
    </div>
  )
}

/** 생성 중 인라인 시계 — 스트리밍(시놉시스/대본)처럼 텍스트만 뜨는 뷰 하단 우측에 붙여
 *  "돌고 있음 + 경과 시간"을 보인다(초시계 애니메이션 + 1초 갱신). reasoning=max 등 첫 출력이
 *  늦을 때 화면이 텅 비어 멈춘 것처럼 보이던 문제를 해소. */
function GenClock({ startedAt, label, usage = null }) {
  return (
    <div className="story-gen-clock" aria-live="polite">
      <StopwatchIcon size={14} />
      {label && <span className="story-gen-clock-label">{label}</span>}
      <span className="story-running-elapsed"><ElapsedTime startedAt={startedAt || null} /></span>
      <UsageInline usage={usage} />
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
  return (key, fallback, params) => {
    // Two calling conventions land on this `t`: StoryView's own (key, koFallbackString, params)
    // and the real i18n signature (key, params) used by shared Settings components (ApiKeyField/
    // TtsApiKeyField/GenaiApiKeyField) that StoryView reuses via AudioKeyGateCard. Passing a
    // params object straight through as `fallback` silently dropped it (params defaulted to {}),
    // so `{label}` etc. rendered literally instead of interpolating — detect that shape here.
    const isParamsShorthand = fallback !== null && typeof fallback === 'object'
    const realParams = isParamsShorthand ? fallback : (params || {})
    const fallbackValue = isParamsShorthand ? key : interpolateFallback(fallback, realParams)
    if (!i18nT) return fallbackValue
    const v = i18nT(key, realParams)
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

// 이야기 유형(genre) — 프로젝트 출력 언어별 노출 옵션. yadam은 한국 야담(ko 전용), dark-history
// 가이드는 영어권(en 전용), bespoke는 언어별 공용(bespoke/<lang>). 값은 백엔드 프롬프트 키
// (metaPrompts.W3_FILES)와 반드시 일치해야 하므로 고정 — 라벨만 i18n한다.
const GENRE_BY_LANG = Object.freeze({
  ko: ['yadam', 'bespoke'],
  en: ['dark-history', 'bespoke'],
})
function genresForLanguage(language) {
  return GENRE_BY_LANG[language] || GENRE_BY_LANG.en
}
// genre 값(하이픈 포함) → i18n 키 세그먼트 + 한국어 폴백(useSafeT 폴백 정책).
const GENRE_I18N_KEY = Object.freeze({ yadam: 'yadam', 'dark-history': 'darkHistory', bespoke: 'bespoke' })
const GENRE_FALLBACK = Object.freeze({ yadam: '야담', 'dark-history': '다크 히스토리', bespoke: '맞춤형' })
function genreLabel(g, t) {
  return t(`story.form.genre.${GENRE_I18N_KEY[g] || g}`, GENRE_FALLBACK[g] || g)
}

// D24a: image-first에서 start()가 부작용 없이 거절하는 코드들 — 렌더러가 조용히 삼키면
// "눌러도 아무 일 없는 버튼"이 된다. fixed-scenes-stale은 여기 없다(아래 runStep 주석 참고).
const IMAGE_FIRST_REFUSALS = ['fixed-scenes-immutable', 'fixed-audio-required']

export default function StoryView({
  pipeline, voices = [], onClose = null, onTagGender = null, onVoiceSearch = null,
  // D24a 복구: fixedSceneError(임포트 중단/거절로 project·story 불일치)에서 image-set 전체를
  // 다시 임포트/취소하는 소유자 콜백. 미주입이면 해당 버튼은 렌더하지 않는다(죽은 버튼 금지).
  onReissueImageFirst = null, onCancelImageFirst = null,
  onReloadVoices = null,
}) {
  const t = useSafeT()
  const hasI18n = useHasI18n()
  const isKo = useSafeIsKo()
  const {
    state, streamingText, start, abort, scenes = [], openError, ttsPreview, segmentProgress = {}, previewScenes = {}, sceneThinking = false, scenesRevising = false, previewPrompts = {}, promptThinking = false, promptsRevising = false, reviewProgress = null, reviewThinking = false, reviewScores = null, progressLog = [], usage = null,
    // 슬라이스5(§v2.5): synopsis 게이트 상태 — useStoryPipeline(S4)이 공급.
    synopsisStreamingText = '', synopsisGenerating = false, synopsisError = null,
    // 시놉시스 검수(spec 2026-07-10) — generating과 분리(스트림 뷰 전환 방지).
    synopsisReviewing = false,
  } = pipeline

  // M3b-2b Task 2: 오디오 생성 pre-flight 키 게이트(spec §4.4). 진입점(아래 5곳)이 직접 start('audio', …)를
  // 부르지 않고 runAudioWithPreflight를 거친다 — main이 provider별 키를 다시 검사해 missing이 있으면
  // 실행하지 않고 게이트 카드를 인라인으로 띄운다. pipeline.audioPreflight가 없는 pipeline(구버전/단위
  // 테스트 목)은 게이트를 건너뛰고 바로 실행 — 이 훅은 M3b-2a에서 이미 커밋된 계약을 그대로 소비할 뿐,
  // 그 계약이 없는 호출부까지 깨뜨리지 않기 위한 하위호환이다.
  const preflight = useAudioPreflight(pipeline)
  const [audioGate, setAudioGate] = useState(null) // { missing, retry, paramsForRecheck } | null
  const [speakerRegenTarget, setSpeakerRegenTarget] = useState(null) // 우클릭 강제 재생성 confirm 대상 화자 | null
  const runAudioWithPreflight = useCallback(async (params, run) => {
    if (typeof pipeline.audioPreflight !== 'function') return run(params)
    const r = await preflight.check(params)
    if (!r.ok) {
      setAudioGate({ missing: r.missing, retry: () => run(params), paramsForRecheck: params })
      return { error: 'preflight-missing-key' }
    }
    setAudioGate(null)
    return run(params)
  }, [preflight, pipeline])

  const steps = state?.steps || {}
  const scenesStreaming = steps.scenes?.status === 'running' && steps.scenes?.reviewOnly !== true
  const promptsStreaming = steps.prompts?.status === 'running' && steps.prompts?.reviewOnly !== true
  const reviewActiveFor = (step) => (
    steps[step]?.status === 'running'
    && reviewProgress?.target === step
    && (reviewProgress.phase === 'reviewing' || reviewProgress.phase === 'revising')
  )
  const scenesReviewing = reviewActiveFor('scenes') && reviewProgress.phase === 'reviewing'
  const promptsReviewing = reviewActiveFor('prompts') && reviewProgress.phase === 'reviewing'
  const scenesReviewRevising = reviewActiveFor('scenes') && reviewProgress.phase === 'revising'
  const promptsReviewRevising = reviewActiveFor('prompts') && reviewProgress.phase === 'revising'
  const scenesPreviewActive = scenesStreaming || (steps.scenes?.status === 'running' && scenesRevising)
  const promptsPreviewActive = promptsStreaming || (steps.prompts?.status === 'running' && promptsRevising)
  const orderedPreviewScenes = Object.values(previewScenes)
    .filter((item) => item?.scene && Number.isInteger(item.chunkIndex) && Number.isInteger(item.localSceneNo))
    .sort((a, b) => a.chunkIndex - b.chunkIndex || a.localSceneNo - b.localSceneNo)
  const scenePreviewCount = orderedPreviewScenes.length
  const revisionPreviewScenesByIndex = new Map(
    orderedPreviewScenes
      .filter((item) => item.chunkIndex === 0)
      .map((item) => [item.localSceneNo, item]),
  )
  const sceneFrontierIndex = orderedPreviewScenes.length
    ? orderedPreviewScenes[orderedPreviewScenes.length - 1].localSceneNo
    : -1
  const promptPreviewCount = Object.keys(previewPrompts).length
  const promptFrontierIndex = scenes.reduce((frontier, scene, index) => (
    previewPrompts[scene.sceneNo] ? index : frontier
  ), -1)
  const currentStep = computeCurrentStep(steps)
  const stepData = steps[currentStep] || { status: 'pending' }
  const isRunning = stepData.status === 'running'
  // D24a image-first — 씬이 임포트한 이미지로 고정(fixed set)된 모드. script/scenes는 불변이고
  // prompts는 audio done을 선행 요구한다(machine.start가 부작용 없이 거절).
  const isImageFirst = state?.sceneMode === 'image-first'
  // D24b image-only: 스토리보드 CSV가 없어 대본(script)이 아직 없다 — roster(등장인물)가 성립하지
  // 않으므로 script done 전까지 roster-confirm 라우팅과 시놉시스 pill을 모두 막는다.
  const imageFirstRosterBlocked = isImageFirst
    && state?.imageFirstVariant === 'image-only'
    && steps.script?.status !== 'done'
  // 자동 진행 — 스텝별 '자동' 토글(오디오는 TTS 비용이라 기본 off) + '전체 진행'(자동=true 순차실행).
  const [autoSteps, setAutoSteps] = useState({ scenes: true, audio: false, prompts: true })
  // D24a 교착 방지: image-first는 prompts가 audio done을 요구한다. 기본값(audio:false)을 그대로
  // 쓰면 nextAutoStep이 prompts를 먼저 골라 fixed-audio-required로 거절당해 [전체 진행]이 교착한다.
  // 렌더 시점에 덮는다 — useEffect로 setAutoSteps하면 첫 렌더가 옛 맵으로 한 번 돌아 레이스가 난다.
  const effectiveAutoSteps = isImageFirst ? { ...autoSteps, audio: true } : autoSteps

  // D24a 거절 표면 — 파이프라인 진행(start) 액션의 단일 래퍼. machine이 부작용 없이 거절한
  // 경우에만 토스트를 띄우고 결과는 그대로 돌려준다(호출측 흐름 불변).
  // fixed-scenes-stale은 sceneMode 가드 *밖*에 둔다 — committed-but-unstaged(임포트가 project는
  // 커밋했지만 story는 아직 옛 audio-first)에서 story state.sceneMode는 여전히 audio-first다.
  // 가드 안에 넣으면 정작 이 케이스에서 영영 안 뜬다.
  // busy/unconfirmed 등 기존 audio-first 코드는 여기서 조용히 지나간다(기존 의미 보존).
  const runStep = async (step, params) => {
    const res = await start(step, params)
    const refused = res?.error === 'fixed-scenes-stale'
      || (isImageFirst && IMAGE_FIRST_REFUSALS.includes(res?.error))
    if (refused) toast.error(`${t('story.error.prefix')}: ${res.error}`)
    return res
  }

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
  const consumedSceneChars = orderedPreviewScenes.reduce((total, item) => (
    total + (item.scene.segments || []).reduce((sum, segment) => (
      sum + (typeof segment?.text === 'string' ? segment.text.length : 0)
    ), 0)
  ), 0)
  const sceneStreamPercent = scriptText.length > 0
    ? Math.min(99, Math.max(0, Math.round((consumedSceneChars / scriptText.length) * 100)))
    : null
  const sceneStreamProgress = sceneStreamPercent != null
    ? t('story.stream.sceneProgress', '씬 {count}개 · ~{percent}%', { count: scenePreviewCount, percent: sceneStreamPercent })
    : t('story.stream.sceneCount', '씬 {count}개', { count: scenePreviewCount })
  const promptStreamProgress = t('story.stream.promptProgress', '프롬프트 {count}/{total}', { count: promptPreviewCount, total: scenes.length })
  const promptStreamPercent = scenes.length > 0
    ? Math.min(100, Math.max(0, Math.round((promptPreviewCount / scenes.length) * 100)))
    : 0
  const sceneRevisionTotal = Math.max(scenes.length, scenePreviewCount)
  const sceneRevisionProgress = t('story.stream.sceneRevisionProgress', '씬 수정 {count}/{total}', {
    count: scenePreviewCount,
    total: sceneRevisionTotal,
  })
  const sceneRevisionPercent = sceneRevisionTotal > 0
    ? Math.min(100, Math.max(0, Math.round((scenePreviewCount / sceneRevisionTotal) * 100)))
    : 0
  const promptRevisionProgress = t('story.stream.promptRevisionProgress', '프롬프트 수정 {count}/{total}', {
    count: promptPreviewCount,
    total: scenes.length,
  })
  const reviewTopProgress = reviewProgress
    ? t('story.review.progress', '검수 {round}/{of}', { round: reviewProgress.round, of: reviewProgress.of })
    : ''
  const thinkingText = t('story.stream.thinking', '🧠 추론 중… (모델이 생각하는 동안 출력이 표시되지 않습니다)')

  // 재설계 §1 — script 스텝 2-phase. 재오픈 복원 시 scriptText가 있으면 바로 대본 작업
  // 화면(editor). setup→editor 승격은 명시 트리거(시작/붙여넣기 시작/스텝퍼 script 클릭)에서만.
  const [scriptPhase, setScriptPhase] = useState(pipeline.scriptText?.trim() ? 'editor' : 'setup')

  // 시놉시스 생성은 side action이라 steps.X.updatedAt 같은 시작시각이 없다 — 생성 시작 순간을 로컬로 잡아
  // 인라인 시계(GenClock)의 경과시간에 쓴다. 생성 끝나면 null.
  const [synopsisStartedAt, setSynopsisStartedAt] = useState(null)
  useEffect(() => { setSynopsisStartedAt(synopsisGenerating ? Date.now() : null) }, [synopsisGenerating])
  // 검수 로그창(StoryRunning)의 경과시간.
  const [synopsisReviewStartedAt, setSynopsisReviewStartedAt] = useState(null)
  useEffect(() => { setSynopsisReviewStartedAt(synopsisReviewing ? Date.now() : null) }, [synopsisReviewing])


  // 중단(⏹) 즉각 피드백 — SDK 취소는 몇 초 걸릴 수 있어(특히 reasoning=max) 버튼을 '중단 중…'으로
  // 바꿔 응답성을 준다. 생성/스텝이 실제로 멈추면(둘 다 not running) 해제.
  const [aborting, setAborting] = useState(false)
  const handleAbort = () => { setAborting(true); abort() }
  // 검수 중에는 synopsisGenerating/isRunning이 둘 다 false라 deps가 안 바뀐다 — synopsisReviewing을
  // 빼면 setAborting(true) 이후 영영 리셋되지 않아 [⏹ 중단]이 '중단 중…'에 박제된다(spec 2026-07-10).
  useEffect(() => {
    if (!synopsisGenerating && !synopsisReviewing && !isRunning) setAborting(false)
  }, [synopsisGenerating, synopsisReviewing, isRunning])

  // §4 이어쓰기 — 시작 시점의 대본 스냅샷. 생성 중 preview에 `baseScript + streamingText`로
  // 접두 표시하는 용도(완료 커밋은 main payload.scriptText — delta 재조립 금지, §0.3).
  const [baseScript, setBaseScript] = useState('')

  // SSE 스트리밍 뷰는 새 델타를 따라 내려가야 한다 — 안 그러면 텍스트가 접힌 아래로 쌓이고
  // 스크롤바만 줄어든다. 세 컨테이너가 서로 다른 분기에 있어 각각 자기 ref를 갖는다.
  const synopsisStream = useStickToBottom(synopsisStreamingText)
  const scriptEditorStream = useStickToBottom(baseScript + streamingText)
  const scriptPreviewStream = useStickToBottom(streamingText)
  const scenesTableRef = useRef(null)
  const promptsTableRef = useRef(null)
  const scenesStickToBottomRef = useRef(true)
  const promptsStickToBottomRef = useRef(true)
  const scenesAutoScrollTopRef = useRef(null)
  const promptsAutoScrollTopRef = useRef(null)
  const handleScenesTableScroll = () => {
    const el = scenesTableRef.current
    if (!el) return
    if (scenesAutoScrollTopRef.current === el.scrollTop) {
      scenesAutoScrollTopRef.current = null
      return
    }
    scenesAutoScrollTopRef.current = null
    scenesStickToBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
  }
  const handlePromptsTableScroll = () => {
    const el = promptsTableRef.current
    if (!el) return
    if (promptsAutoScrollTopRef.current === el.scrollTop) {
      promptsAutoScrollTopRef.current = null
      return
    }
    promptsAutoScrollTopRef.current = null
    promptsStickToBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
  }
  useEffect(() => {
    if (!scenesPreviewActive) {
      scenesStickToBottomRef.current = true
      scenesAutoScrollTopRef.current = null
      return
    }
    const el = scenesTableRef.current
    if (!el || !scenesStickToBottomRef.current) return
    if (!scenesRevising) {
      el.scrollTop = el.scrollHeight
      return
    }
    const frontierRow = el.querySelector('[data-scene-frontier]')
    if (!frontierRow) return
    const nextScrollTop = Math.max(0, frontierRow.offsetTop + frontierRow.offsetHeight - el.clientHeight)
    if (el.scrollTop === nextScrollTop) return
    scenesAutoScrollTopRef.current = nextScrollTop
    el.scrollTop = nextScrollTop
  }, [scenesPreviewActive, scenesRevising, sceneFrontierIndex, scenePreviewCount])
  useEffect(() => {
    if (!promptsPreviewActive) {
      promptsStickToBottomRef.current = true
      promptsAutoScrollTopRef.current = null
      return
    }
    const el = promptsTableRef.current
    if (!el || !promptsStickToBottomRef.current || promptFrontierIndex < 0) return
    const frontierRow = el.querySelector('[data-prompt-frontier]')
    if (!frontierRow) return
    const nextScrollTop = Math.max(0, frontierRow.offsetTop + frontierRow.offsetHeight - el.clientHeight)
    if (el.scrollTop === nextScrollTop) return
    promptsAutoScrollTopRef.current = nextScrollTop
    el.scrollTop = nextScrollTop
  }, [promptsPreviewActive, promptsRevising, promptFrontierIndex])

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

  // 슬라이스5(§v2.8 B1): synopsis 게이트 모드 — setup 시작 시 로컬로 확정(title/pasted),
  // 재오픈 hydrate는 durable input.type에서 파생(로컬 미지정 시 폴백).
  // D24a: image-first는 로컬 모드를 무시하고 durable input.type(storyboard→pasted)에 고정한다 —
  // 같은 마운트에서 title 경로를 시작한 뒤 임포트가 도착하면 stale한 'title'이 게이트를 제목
  // 입력 화면으로 되돌려버린다(등장인물 확정이 사라짐).
  const [synopsisLocalMode, setSynopsisLocalMode] = useState(null)
  const synopsisMode = isImageFirst
    ? (synopsisModeForInputType(state?.input?.type) ?? 'pasted')
    : (synopsisLocalMode ?? synopsisModeForInputType(state?.input?.type) ?? 'title')

  // 슬라이스5(§v2.11): 재오픈 hydrate phase 판정(3-state) —
  //   ① input.type∉{title,pasted} → 현행 그대로(synopsis 미적용)
  //   ② charactersConfirmed===true → 기존 규칙(script done→editor 등, 초기값 유지)
  //   ③ charactersConfirmed===false → synopsis phase(script done 여부 무관 — pasted 게이트 보존)
  //      리서치 spec §3.8(M6): 진행 중 리서치 draft(research 있음 + 미확정)가 있으면 research
  //      phase로 복원 — 검색/선택/자막을 이어간다(commit/skip 후엔 confirmed/null이라 synopsis).
  //   ④ undefined(legacy) → 기존 규칙 유지(FIX-1: 스텝머신 migrate 없음 — scriptText 기반
  //      초기 phase 규칙이 script done을 editor로 복원한다. synopsis 강제 안 함)
  // hydrate 1회 전용(ref 잠금) — in-session 확정→editor 전이가 늦게 도착한 stale
  // charactersConfirmed=false 이벤트로 되돌려지지 않게 한다.
  //   ⑤ D24a(image-first storyboard): input.type='storyboard'도 roster-gated다 — script/scenes가
  //      이미 done(스토리보드가 씬을 고정)이어도 미확정이면 progress step보다 roster 확정이 먼저다.
  //      D24b(image-only)는 대본이 나오기 전(script≠done)까지 이 route를 막고 ref도 잠그지 않는다
  //      (나중에 script done이 도착하면 그때 라우팅해야 하므로).
  const synopsisPhaseHydratedRef = useRef(false)
  useEffect(() => {
    if (synopsisPhaseHydratedRef.current) return
    if (pipeline.charactersConfirmed === undefined) return // ④ legacy/미도착 → 기존 규칙 유지
    const type = state?.input?.type
    if (!isRosterGatedInputType(type)) { // ① 현행 유지(imported/continue/manual)
      synopsisPhaseHydratedRef.current = true
      return
    }
    if (imageFirstRosterBlocked) return // ⑤ D24b: script done 전까지 보류(잠그지 않음)
    synopsisPhaseHydratedRef.current = true
    if (pipeline.charactersConfirmed === false) {
      setScriptPhase(pipeline.research && !pipeline.research.confirmed ? 'research' : 'synopsis') // ③ (②는 초기값 유지)
    }
  }, [pipeline.charactersConfirmed, state?.input?.type, imageFirstRosterBlocked]) // eslint-disable-line react-hooks/exhaustive-deps

  // 슬라이스5: 시놉시스 줄거리/등장인물 로컬 편집 상태 — scriptText 단일 상태 패턴 미러(§0.3).
  // main 저장값(synopsisText/characters)이 바뀌면 로컬 편집 상태를 그 값으로 커밋한다.
  const [synopsisDraft, setSynopsisDraft] = useState(pipeline.synopsisText || '')
  useEffect(() => {
    setSynopsisDraft(pipeline.synopsisText || '')
  }, [pipeline.synopsisText])
  const [characterDrafts, setCharacterDrafts] = useState(() => (pipeline.characters || []).map(normalizeStoryCharacter))
  useEffect(() => {
    setCharacterDrafts((pipeline.characters || []).map(normalizeStoryCharacter))
  }, [pipeline.characters])

  // 7-⑴: 스텝퍼에서 done 상태 스텝을 클릭하면 진행이 더 앞서가 있어도 해당 패널을 다시 볼 수
  // 있다 — 실행 버튼/러닝 상태 등 액션은 여전히 실제 진행 단계(currentStep) 기준으로 동작한다.
  const [viewedStep, setViewedStep] = useState(null)
  // M2a-3b/슬라이스3, Task 11: 화자별 엔진(provider)·목소리 선택 + VoicePicker 모달 상태.
  // useStoryVoiceSelection 훅으로 분리(순수 리팩터) — src/hooks/useStoryVoiceSelection.js 참고.
  const voiceSel = useStoryVoiceSelection({ speakers: state?.speakers || [], voices, onTagGender })
  /**
   * 이 화자의 오디오를 파일에서 가져오는가 — main의 isImportProvider와 같은 기준(화자로 판정).
   *
   * 세그먼트의 srcStartMs로 보면 안 된다: 그 구간은 ⑤가 매 실행마다 계산하고 영속하지 않아
   * renderer엔 절대 오지 않는다(= 항상 false인 죽은 판정이 된다).
   *
   * 화자 참조는 main의 findSpeakerByRef와 **같은 정규화**로 푼다 — id 완전일치로 보면 안 된다:
   * seg.speaker는 id가 아니라 이름이나 별칭일 수 있고(나레이터는 {id:'narrator', name:'나레이션'}로
   * 시딩된다), 그러면 주 화자에서 바로 어긋나 판정이 죽는다.
   */
  const refKey = (v) => (isNarratorSpeaker(v) ? 'narrator' : String(v || '').replace(/\s/g, '').toLowerCase())
  /**
   * 세그먼트의 화자 참조(id·이름·별칭) → 화자 객체. main의 findSpeakerByRef와 **같은 정규화**여야
   * 한다 — 어긋나면 같은 세그먼트를 main은 A에, UI는 B에 붙인다.
   *
   * 공백뿐인 참조는 뺀다(main과 같은 이유): refKey는 그걸 'narrator'로 접으므로, name이 '   '인
   * 인물이 나레이터 별칭을 갖게 되고 목록에서 나레이터보다 앞이면 **나레이터 세그먼트가 그 인물
   * 것으로** 잡힌다(진행 배지가 합쳐지고 나레이터 성우 버튼이 사라진다). 스키마가 공백 이름을 허용한다.
   */
  const speakerByRef = (speakerRef) => {
    const key = refKey(speakerRef)
    if (!key) return null
    const keysOf = (s) => [s.id, s.name].filter((v) => String(v || '').trim()).map(refKey)
    return (state?.speakers || []).find((s) => keysOf(s).includes(key)) || null
  }
  const isImportSpeaker = (speakerRef) => {
    const sp = speakerByRef(speakerRef)
    if (!sp) return false
    const src = voiceSel.importForSpeaker(sp)
    return !!(src?.mp3Path && src?.srtPath)
  }
  // M2b-5: sfx 세그먼트별 소스(로컬 오버라이드). 기본은 세그먼트 영속값(seg.sourceMode) > elevenlabs.
  const [sourceModeBySegment, setSourceModeBySegment] = useState({})
  // 화자별 오디오 출처 — 성우 행 전체가 드롭 타깃이다(칩 영역만 노리면 좁다). 행에 놓인 파일을
  // 그 화자의 SpeakerAudioSource(takeFiles)로 위임한다. 화자 id → 위젯 핸들.
  const srcDropHandles = useRef(new Map())
  // 지금 드래그가 올라온 성우 행 id(하나만 하이라이트). 놓거나 벗어나면 null.
  const [dragVoiceRowId, setDragVoiceRowId] = useState(null)
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
  // 스텝퍼 active pill: 대본 패널을 설정/리서치/시놉시스 phase로 보고 있으면 해당 게이트 탭이 active, 그 외엔 displayStep.
  const stepperActive = (displayStep === 'script' && scriptPhase === 'setup') ? 'setup'
    : (displayStep === 'script' && scriptPhase === 'synopsis') ? 'synopsis'
      : (displayStep === 'script' && scriptPhase === 'research') ? 'research'
        : displayStep

  // §v2.12 B: synopsis pill 자리는 항상 렌더(Stepper가 무조건 그림 — "설정 탭 진입 시 사라짐" 해소).
  // 활성(클릭 가능) 조건만 상태로 판단 — 기존 showSynopsis(§v2.10) 조건 그대로:
  // durable input.type ∈ {title,pasted} 신규(charactersConfirmed ≠ undefined — legacy 아님),
  // 또는 지금 게이트 안(scriptPhase='synopsis'). imported/continue/manual·legacy는 회색 비활성.
  // D24a: storyboard도 roster-gated(isRosterGatedInputType) — 시놉시스 pill이 roster-confirm 입구다.
  // D24b image-only는 script done 전까지 pill도 비활성(라우팅과 동일 조건).
  const synopsisInputType = state?.input?.type
  const synopsisEnabled = scriptPhase === 'synopsis'
    || (isRosterGatedInputType(synopsisInputType) && pipeline.charactersConfirmed !== undefined && !imageFirstRosterBlocked)

  // 리서치 spec §3.6(개정 2026-07-08): 리서치는 ① 첫 실행 스텝(설정 다음·시놉시스 앞)이고
  // 키워드로 검색하므로 제목·[✨ 시작]이 불필요하다 — 신규 title 경로는 setup phase(제목/시작 전)부터
  // 활성. 조건 3분기:
  //  (a) 게이트 안(scriptPhase==='research') — 진입 후 active 유지.
  //  (b) title 경로 신규(durable input.type==='title' && charactersConfirmed≠undefined) —
  //      재오픈/시작 후. synopsisEnabled 미러에서 pasted만 제외한 형태.
  //  (c) 순수 신규(durable input 없음 + 대본 없음) — 제목/시작 전 setup부터 진입 가능.
  //      scriptText는 로컬 상태(붙여넣기 입력 미러 §0.1) — setup에서 대본을 붙여넣는 즉시 비활성.
  // pasted/imported/legacy는 비활성 유지 — 이미 대본이 있어 리서치가 무의미하다(시놉시스의
  // imported 비활성 판정과 정합: legacy=charactersConfirmed undefined, imported=type∉{title,pasted}).
  const researchEnabled = scriptPhase === 'research'
    || (synopsisInputType === 'title' && pipeline.charactersConfirmed !== undefined)
    || (synopsisInputType == null && !scriptText.trim())

  // FIX-2(UI 이중 방어): 신규 roster-gated(title/pasted/storyboard) 미확정(charactersConfirmed===false)이면
  // synopsis 확정 전까지 하류(scenes/audio/prompts) 진행 UI를 disable — main start()의 'unconfirmed'
  // 가드와 이중(같은 판정자 isRosterGatedInputType를 쓴다). legacy(undefined)는 게이트 미적용(FIX-1).
  const unconfirmedGate = isRosterGatedInputType(synopsisInputType)
    && pipeline.charactersConfirmed === false

  const handleStepClick = (key) => {
    // 0번 설정 탭 — 대본 탭과 분리된 진입 탭. 설정 폼(scriptPhase='setup')으로. displayStep이
    // 'script'로 잡히도록 viewedStep='script'을 두고, 명시 진입이라 자동 editor 승격을 막는다.
    if (key === 'setup') {
      setViewedStep('script')
      userWentToSetupRef.current = true
      setScriptPhase('setup')
      return
    }
    // 시놉시스 게이트 탭 — generic 경로로 새면 scriptPhase가 clear되므로 명시 분기(setup 미러, §3.5).
    if (key === 'synopsis') {
      setViewedStep('script')
      setScriptPhase('synopsis')
      return
    }
    // 리서치 게이트 탭 — 시놉시스 분기 미러(리서치 spec §3.6).
    if (key === 'research') {
      setViewedStep('script')
      setScriptPhase('research')
      return
    }
    setViewedStep(key)
    // 대본 탭은 편집기(설정은 이제 0번 탭이 담당). FIX-6: 미확정(unconfirmedGate) 중엔 editor로
    // 열지 않고 synopsis phase로 라우팅 — editor의 다시쓰기/이어쓰기가 게이트를 우회하지 못한다(§v2.8 B1).
    if (key === 'script') setScriptPhase(unconfirmedGate ? 'synopsis' : 'editor')
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
  const [sceneGranularity, setSceneGranularity] = useState(hydrateOpts.sceneGranularity || 'scene') // 씬 분리 단위: scene(min~max초)/segment(문장별)
  // 씬 기준 목표 길이(초) — 사용자 조정. 편집 UX 위해 문자열 state, 옵션 구성 시 clampInt 로 정수화(기본 5/10).
  const [sceneMinSec, setSceneMinSec] = useState(hydrateOpts.sceneMinSec != null ? String(hydrateOpts.sceneMinSec) : '5')
  const [sceneMaxSec, setSceneMaxSec] = useState(hydrateOpts.sceneMaxSec != null ? String(hydrateOpts.sceneMaxSec) : '10')
  const initialReview = hydrateOpts.review || null
  const makeReviewSettings = (opts = {}, model = selectedLlm.model) => ({
    // 수동 전용 — enabled는 안 읽는다(handleManualReview가 항상 true로 넘긴다). rounds는
    // 세션 로컬: confirmSynopsis가 options를 저장하지 않아 재오픈 복원은 보장되지 않는다.
    synopsis: {
      enabled: false,
      rounds: clampReviewRounds(opts.review?.synopsis?.rounds ?? defaultReviewRounds('synopsis', model)),
    },
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
    const minSec = clampInt(sceneMinSec, 1, 120, 5)
    const maxSec = Math.max(minSec, clampInt(sceneMaxSec, 1, 120, 10))
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
      sceneMinSec: minSec,
      sceneMaxSec: maxSec,
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

  // 언어 전환(또는 hydrate)으로 현재 genre가 새 언어에 없는 값(yadam↔dark-history)이 되면
  // 기본 bespoke로 보정 — 유령 값이 select에 남거나 백엔드로 넘어가는 것 방지.
  useEffect(() => {
    if (!genresForLanguage(language).includes(genre)) setGenre('bespoke')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

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

  // 시놉시스는 side action이라 start(step)이 아니라 pipeline.reviewSynopsis를 탄다(spec 2026-07-10).
  // busy({error}) / 중단({aborted}) / 조기반환(undefined) 어느 것도 draft를 덮어쓰면 안 된다 —
  // {aborted:true}에는 error 키가 없어서 r.error만 보면 통과해버린다.
  // D24a: image-first에서 등장인물 명단은 stage(storyboard)가 시딩한 정본이다 — 시놉시스 재생성/
  // 검수가 돌려준 characters로 덮으면 fixed scenes의 화자와 어긋나고 confirm이
  // storyboard-roster-incomplete로 거절된다. 줄거리(synopsisMd)만 받는다.
  const applyReturnedCharacters = (characters) => {
    if (isImageFirst) return
    setCharacterDrafts((characters || []).map(normalizeStoryCharacter))
  }

  const handleSynopsisReview = async () => {
    const r = await pipeline.reviewSynopsis?.({
      synopsisMd: synopsisDraft,
      characters: characterDrafts.map(normalizeStoryCharacter),
      options: currentOptions(),
      review: { synopsis: { enabled: true, rounds: reviewSettings.synopsis.rounds } },
    })
    if (!r || r.error || r.aborted) return
    if (typeof r.synopsisMd !== 'string') return
    setSynopsisDraft(r.synopsisMd)
    applyReturnedCharacters(r.characters)
  }

  const handleManualReview = (target) => {
    if (target === 'synopsis') { handleSynopsisReview(); return }
    start(target, manualReviewParams(target))
    if (target === 'script') {
      setScriptPhase('editor')
      setViewedStep('script')
    } else {
      setScriptPhase(null)
      setViewedStep(target)
    }
  }

  const renderReviewControl = (target, { manual = false, disabled = false, canReview = true, autoToggle = true } = {}) => {
    // D24a: image-first에서 script/scenes/prompts 검수는 fixed set을 다시 쓰는 실행이라 machine이
    // 거절한다(script/scenes=immutable) — 렌더 자체를 하지 않는다(setup의 세 토글 포함).
    // 시놉시스 검수는 fixed set을 건드리지 않는 side action이라 그대로 둔다.
    if (isImageFirst && target !== 'synopsis') return null
    const label = t(`story.review.target.${target}`, REVIEW_TARGET_LABEL[target])
    const settings = reviewSettings[target]
    return (
      <div key={target} className="story-review-control">
        {autoToggle && (
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
        )}
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
    if (o.sceneMinSec != null) setSceneMinSec(String(o.sceneMinSec))
    if (o.sceneMaxSec != null) setSceneMaxSec(String(o.sceneMaxSec))
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
  // D24a: image-first의 재실행은 audio(다시 생성)만 허용한다 — 씬 재분리는 machine이 거절하고
  // (fixed-scenes-immutable) 프롬프트 재생성은 고정 씬을 다시 쓰는 액션이라 노출하지 않는다.
  const redoStep = (['scenes', 'audio', 'prompts'].includes(displayStep) && steps[displayStep]?.status === 'done' && !isRunning
    && !(isImageFirst && displayStep !== 'audio'))
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
    sceneMinSec: clampInt(hydrateOpts.sceneMinSec, 1, 120, 5),
    sceneMaxSec: Math.max(clampInt(hydrateOpts.sceneMinSec, 1, 120, 5), clampInt(hydrateOpts.sceneMaxSec, 1, 120, 10)),
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
  // D24a: image-first의 setup primary는 어떤 경우에도 실행할 수 없다 — [✨ 시작](script 생성)도
  // [↻ 변경사항으로 다시 시작](script 재생성)도 fixed-scenes-immutable로 거절된다. setupAlreadyApplied
  // (=script done) 여부와 무관하다: D24b 커밋 전(script pending)의 [✨ 시작]도 같이 막힌다.
  const imageFirstSetupBlocked = isImageFirst && isSetupActionView
  const setupActionDisabled = isRunning || !setupHasSeed || (setupAlreadyApplied && !setupDirty) || imageFirstSetupBlocked
  const showSetupClose = isSetupActionView && setupAlreadyApplied && !!onClose
  // 하단 primary가 실제로 부를 스텝 — setup 액션이면 'setup'(액션 없음).
  // image-first에서 합법인 건 audio(생성/재생성)와 아직 안 돈 prompts의 최초 진행뿐이다.
  // script/scenes(불변) · 이미 done인 prompts의 재생성 · setup은 렌더하지 않는다.
  const primaryTargetStep = isSetupActionView ? 'setup' : (redoStep ?? currentStep)
  const imageFirstPrimaryBlocked = isImageFirst && !(
    primaryTargetStep === 'audio'
    || (primaryTargetStep === 'prompts' && steps.prompts?.status !== 'done')
  )
  const showPrimaryAction = !(showSetupClose && !setupDirty)
    && !imageFirstSetupBlocked
    && !imageFirstPrimaryBlocked

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
        // 오디오 출처(mp3+SRT)를 지정한 화자는 TTS로 만들지 않는다 — ⑤가 자막에서 구간을 찾아
        // 그 파일을 잘라 쓴다. 성우 선택보다 우선한다(출처를 고른 건 명시적 의사표시다).
        const src = voiceSel.importForSpeaker(sp)
        if (src?.mp3Path && src?.srtPath) return { ...sp, voice: { provider: 'import', mp3Path: src.mp3Path, srtPath: src.srtPath } }
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

  /**
   * 확인이 필요한 조각 표식. 진행 로그로는 부족하다 — 메모리라 start() 마다 지워지고(전체 실행은
   * audio 완료 직후 prompts 를 시작한다) 재오픈하면 없다. 영속된 사실을 목록에 띄운다.
   *
   * 두 사유는 **다른 사실**이라 문구를 나눈다 — 합치면 툴팁이 거짓말이 된다:
   *   approx      — 자막에서 정확한 자리를 못 찾아 이웃 사이로 보간해 잘랐다.
   *   needsReview — 남의 대사가 어긋나 이 출처의 오디오가 남의 자리를 물어왔을 수 있다.
   */
  const renderSegmentMark = (seg) => {
    const hint = seg.approx
      ? t('story.audio.approxHint', '자막에서 정확한 자리를 못 찾아 근처로 잘랐습니다 — 들어보고 조정하세요')
      : seg.needsReview
        ? t('story.audio.needsReviewHint', '자막의 다른 화자 대사가 대본과 어긋나, 이 조각이 남의 자리 오디오일 수 있습니다 — 들어보세요')
        : null
    if (!hint) return null
    return <span className="story-seg-approx" data-testid={`seg-mark-${seg.id}`} title={hint}>≈</span>
  }

  // 세그먼트 셀 — 윗줄 대화. 감정은 화자(대사)만 아랫줄 (감정)으로, 나레이터는 제외.
  // 감정은 TTS·프롬프트 작성에도 쓰인다.
  const renderNarrationCell = (seg) => {
    if (isNarratorSpeaker(seg.speaker)) return <>{renderSegmentMark(seg)}{seg.text}</>
    const emo = seg.emotion || 'normal'
    return (
      <div className="story-seg-cell">
        <div className="story-seg-text">{renderSegmentMark(seg)}{seg.text}</div>
        <div className="story-seg-emotion">({t(`story.emotion.${emo}`, EMOTION_LABEL[emo] || EMOTION_LABEL.normal)})</div>
      </div>
    )
  }

  // M2a-3d/3c: 세그먼트 재생성(강제 re-TTS)·미리듣기.
  // 세그먼트 단위 재생성은 그 세그먼트 하나만 다시 만드는 국소 액션이라 audio 뷰에 머물러야 한다.
  // STEP_ORDER=[script,scenes,audio,prompts]라 audio가 done이어도 computeCurrentStep은 다음 미완료
  // (보통 prompts)를 가리킨다. 그래서 setViewedStep(null)이면 displayStep이 currentStep=prompts로
  // 떨어져 화면이 prompts로 새어나간다(재생성 성공이든 preflight 막힘이든 동일). 항상 'audio'로
  // 고정해 오디오 패널(성공 시 세그먼트 목록/재생성, 막힘 시 AudioKeyGateCard)을 유지한다.
  // (스텝 전체 redo인 handleStepRedo는 "다음으로 진행"이 맞아 별개로 null을 유지한다.)
  const regenerateSegment = async (segId) => {
    await runAudioWithPreflight(buildAudioParams([segId]), (p) => runStep('audio', p))
    setScriptPhase(null)
    setViewedStep('audio')
  }

  // 우클릭 강제 재생성 confirm 모달에 보여줄 그 화자의 narration 세그먼트 수. 세그먼트의 화자
  // 참조는 id·이름·별칭일 수 있어(narrator={id:'narrator',name:'나레이션'}) 백엔드 canonicalSpeaker와
  // 같은 정규화(speakerByRef)로 매칭해야 한다 — id 완전일치로 세면 별칭 화자에서 0개로 잘못 안내해
  // 파괴적 재생성의 동의 화면이 틀린다.
  const countSpeakerSegments = (sp) =>
    (scenes || []).flatMap((s) => s.segments || []).filter((g) => (g.type || 'narration') === 'narration' && speakerByRef(g.speaker)?.id === sp?.id).length
  // force=true면 그 화자의 이미 done인 세그먼트까지 강제 재생성(regenerateSpeaker). 좌클릭(force=false)은
  // 기존 "미생성분만 채우기".
  const runSpeakerAudio = async (sp, { force = false } = {}) => {
    const result = await runAudioWithPreflight({ ...buildAudioParams(), onlySpeaker: sp.id, ...(force ? { regenerateSpeaker: true } : {}) }, (p) => runStep('audio', p))
    // preflight가 막은 경우엔 게이트 카드가 이미 안내하므로 별도 토스트 없이 조용히 돌아간다.
    if (result?.error === 'preflight-missing-key') return
    // busy: 좌클릭 fill-missing은 실행 중 화자 맵이 안 보여 사용자가 만든 상황이 아니라 조용하다.
    // 하지만 우클릭 강제 재생성(force)은 confirm까지 거친 명시적 액션인데, 모달을 연 사이 다른 작업
    // (synopsis/research side action 등 — isRunning은 이걸 반영 못 함)이 시작돼 busy면 무반응으로
    // 보인다. force일 때만 피드백을 준다(파괴는 없다 — main이 이미 막았다).
    if (result?.error === 'busy') {
      if (force) toast.error(t('story.audio.busyRetry', 'Another task is running. Try again in a moment.'))
      return
    }
    // main 의 거절(대사 없는 화자 등)은 **사전검사라 스텝 상태를 일부러 안 건드린다**(완료 프로젝트의
    // done 을 지키려고). 그래서 오류 배너도 안 뜬다 — 여기서 안 띄우면 버튼이 무반응으로 보인다.
    if (result?.error) {
      toast.error(resolveDisplayError(t, result.error, result.error))
      return
    }
    if (result?.partialAudioRun) {
      const speaker = sp.name || sp.id
      toast.success(t(
        'story.audio.runThisSpeakerDone',
        '{speaker} generated — run the full step to complete the timeline',
        { speaker },
      ))
    }
  }

  // audio 타임라인 프리뷰 — story 세그먼트를 화자별 voices audioPackage로 변환해 기존 AudioTimeline
  // (LiveTimeline)에 넘긴다(디스크 재배치 없이 메모리 변환). 만들어진 오디오가 있으면 렌더 —
  // done 을 기다리면 부분 실행("이 화자만 생성")이 영영 확인이 안 된다.
  const storyAudioPkg = useMemo(() => buildStoryAudioPackage(scenes), [scenes])
  const storySrtEntries = useMemo(() => buildStorySrtEntries(scenes), [scenes])
  // Codex-Low: sfx만 있는 story(narration 없음)도 타임라인에 나오도록 sfx도 포함해 판정.
  const hasStoryAudio = storyAudioPkg.voices.some((v) => v.files.length > 0)
    || storyAudioPkg.sfx.some((s) => s.files.length > 0)

  // 슬라이스1: 세그먼트 단건 테스트 — 배치와 분리해 그 세그먼트만 합성(화자 매핑 반영) 후 바로 재생.
  // Finding3(리뷰): 배치(runAudioWithPreflight를 거치는 audio())와 달리 이 단건 테스트는 preflight
  // 없이 바로 ttsPreview를 불렀다 — 키가 없으면 IPC 거절이 errorKind 없이 raw 토스트로 샌다.
  // backend audioPreflight가 mode:'segmentTest'(stepMachine:1971)를 이미 지원하므로 여기서도
  // runAudioWithPreflight를 재사용해 같은 게이트 카드로 안내한다.
  // Finding1(2R 리뷰): 게이트가 뜬 뒤 "키 저장"은 AudioKeyGateCard.onKeySaved(~L2166)가
  // testSegment의 try/finally가 이미 끝난 뒤 audioGate.retry()로 별도(비동기) 재호출한다.
  // 그 retry가 원래처럼 raw ttsPreview 콜백을 그대로 부르면 previewBusy 가드도 catch도 없이
  // 실행돼, "존재하지만 무효한" 키에서 ttsPreview가 거부될 때 unhandled rejection +
  // 번역 안 된 토스트로 새고, 두 번째 트리거와 겹칠 수도 있다. 가드+에러 처리를 가진 실행부를
  // 별도 함수로 빼서 최초 호출과 retry가 항상 같은(가드된) 경로를 타게 한다.
  // §4.8 R3: story:tts-preview는 이제 auth/missing-key를 throw 대신 { error: errorKind, provider }
  // 로 돌려준다(electron/ipc/story-api.js) — 여기서 resolveDisplayError로 번역해 토스트한다.
  // throw 경로(네트워크 등 errorKind 없는 예외)는 기존처럼 raw message로 폴백.
  const previewBusyRef = useRef(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  // 화자 오디오 액션(좌클릭 fill-missing / 우클릭 강제 재생성)을 막아야 하는 통합 busy 신호.
  // step/preview 실행 + synopsis 생성·검수를 포함한다 — 이걸 무시하고 start()를 dispatch하면
  // 진행 중 progressLog/reviewProgress/reviewScores를 먼저 지운 뒤 main이 busy로 거절해 그 UI
  // 상태가 소실된다(research는 renderer 신호가 없어 busy 토스트가 방어). isRunning은 한 스텝만
  // 반영하므로 synopsis side action을 여기서 명시적으로 더한다.
  const speakerAudioBusy = isRunning || previewBusy || synopsisGenerating || synopsisReviewing
  const runSegmentTestGuarded = async (segId) => {
    if (previewBusyRef.current) return
    previewBusyRef.current = true
    setPreviewBusy(true)
    try {
      const ap = buildAudioParams()
      const r = await ttsPreview?.({ segmentIds: [segId], speakers: ap.speakers, sfxSources: ap.sfxSources })
      if (r?.busy) { toast.error(t('story.audio.busy')); return }
      if (r?.error) {
        toast.error(t('story.audio.testFailed', { error: resolveDisplayError(t, r.error, r.error) }))
        return
      }
      const seg = r?.segments?.find((s) => s.id === segId)
      if (seg?.audioPath) playAudio(seg.audioPath)
    } catch (e) {
      toast.error(t('story.audio.testFailed', { error: e?.message || e }))
    } finally {
      previewBusyRef.current = false
      setPreviewBusy(false)
    }
  }
  const testSegment = async (segId) => {
    if (previewBusyRef.current) return
    const ap = buildAudioParams()
    // run 콜백은 runSegmentTestGuarded 그대로 — runAudioWithPreflight가 이걸 audioGate.retry로도
    // 저장하므로(위 주석), 최초 실행과 키 저장 후 retry가 완전히 같은 가드된 경로를 탄다.
    return runAudioWithPreflight({ ...ap, mode: 'segmentTest', segmentIds: [segId] }, () => runSegmentTestGuarded(segId))
  }

  const startScriptFromTitle = () => {
    setBaseScript('')
    runStep('script', {
      input: { type: 'title', title },
      options: currentOptions(),
    })
    setScriptPhase('editor')
  }

  // ── 슬라이스5: 시놉시스 게이트(§v2.5/§v2.8 B1/§v2.9) ──────────────────────
  // 생성/역추출 side action 호출 + 완료 결과({synopsisMd, characters})로 로컬 편집 상태 채움.
  const runGenerateSynopsis = async (params) => {
    const r = await pipeline.generateSynopsis?.(params)
    if (r && !r.error) {
      if (r.synopsisMd !== undefined) setSynopsisDraft(r.synopsisMd || '')
      if (Array.isArray(r.characters)) applyReturnedCharacters(r.characters)
    }
    return r
  }

  // 제목 경로 setup [✨ 시작] — 대본을 바로 생성하지 않고 synopsis 게이트로 진입한다(§v2.8 B1).
  const startSynopsisFromTitle = () => {
    setBaseScript('')
    synopsisPhaseHydratedRef.current = true // in-session 전이 시작 — hydrate 판정이 덮지 않게 잠금
    setSynopsisLocalMode('title')
    setScriptPhase('synopsis')
    runGenerateSynopsis({ type: 'title', title, options: currentOptions() })
  }

  // 확정(§v2.9): confirm-synopsis가 title·pasted(D24a storyboard 포함) 공통 커밋 채널 —
  // 커밋이 재생성보다 선행. D24a: main confirmSynopsis는 payload의 fixed scene 신원이 project.json
  // 정본과 일치할 때만 커밋한다(불일치 → fixed-scenes-stale) — 안 실으면 roster 확정이 항상 죽는다.
  const confirmSynopsisParams = () => ({
    synopsisMd: synopsisDraft,
    characters: characterDrafts.map(normalizeStoryCharacter),
    ...(isImageFirst ? {
      sceneMode: 'image-first',
      imageFirstVariant: state?.imageFirstVariant,
      fixedSceneRevision: state?.fixedSceneRevision,
    } : {}),
  })

  // 확정 실패 표면(단일) — storyboard roster 미비(storyboard-roster-incomplete)는 어떤 화자가
  // 빠졌는지 speakers[]로 알려준다. 토스트는 정확히 한 번.
  const toastConfirmError = (r) => {
    if (!r?.error) return false
    const speakers = r.speakers?.join(', ')
    toast.error(`${t('story.error.prefix')}: ${r.error}${speakers ? `: ${speakers}` : ''}`)
    return true
  }

  const handleSynopsisConfirm = async () => {
    if (synopsisMode === 'pasted') {
      // pasted/storyboard [등장인물 확정] — script는 이미 done(재생성 없음, §v2.8 B1). 대본에서
      // 역추출한(편집 가능한) 시놉시스는 함께 저장한다.
      const r0 = await pipeline.confirmSynopsis?.(confirmSynopsisParams())
      if (toastConfirmError(r0)) return
      setScriptPhase('editor')
      return
    }
    // title [이 시놉시스로 대본 생성] — confirm(커밋) 완료 후 start('script') 순차 호출(§v2.10).
    const r = await pipeline.confirmSynopsis?.(confirmSynopsisParams())
    if (toastConfirmError(r)) return
    setBaseScript('')
    // 대본 화면(editor)으로 먼저 전환 — start('script')를 await 하면 생성이 끝날 때까지 화면이 안
    // 바뀌어 "대본 화면이 안 나온다". 전환 후 생성이 스트리밍으로 editor 뷰에 들어온다(§v2.10: confirm→start 순서 유지).
    setScriptPhase('editor')
    start('script', { input: { type: 'title', title }, options: currentOptions(), synopsis: synopsisDraft })
  }

  // 리서치 spec §3.6(M2/Q5 수동 주입): 시놉시스 게이트 "리서치 컨텍스트 포함" 토글 —
  // research.confirmed일 때만 노출, 켠 상태의 시놉시스 생성만 useResearch:true로 호출.
  const [useResearchContext, setUseResearchContext] = useState(false)

  // 리서치 선행 흐름(개정 2026-07-08): 리서치는 제목 없이 확정 가능하지만 시놉시스 생성
  // (generateSynopsis type:'title')과 확정(start script)은 제목이 필요하다 — title 모드에서
  // 제목이 비어 있으면 안내를 띄우고 생성/확정을 비활성한다(제목 강제 생성은 하지 않음 —
  // 사용자가 [설정으로]로 기존 setup 제목란에 입력 후 돌아온다). pasted 모드는 제목 불필요.
  const synopsisTitleMissing = synopsisMode !== 'pasted' && !title.trim()

  const handleSynopsisRegenerate = () => {
    const researchParams = useResearchContext && pipeline.research?.confirmed ? { useResearch: true } : {}
    if (synopsisMode === 'pasted') runGenerateSynopsis({ type: 'pasted', pastedScript: scriptText, options: currentOptions(), ...researchParams })
    else runGenerateSynopsis({ type: 'title', title, options: currentOptions(), ...researchParams })
  }


  // ── 리서치 게이트(리서치 spec §3.6/§3.8) ──────────────────────────────────
  // commit: research.json 저장(main) 후 시놉시스 phase로 전이. 자동 주입은 하지 않는다(M2) —
  // 시놉시스 게이트의 useResearchContext 토글이 유일 스위치. skip: draft 정리 후 리서치 없이 시놉시스로.
  const handleResearchCommit = async ({ analysis, verifiedClaims, adoptedIndices } = {}) => {
    // 개선4/m3: adoptedIndices(채택 체크 인덱스)가 오면 그대로 전달 — 미전달이면 main이 supported만 저장.
    const r = await pipeline.researchCommit?.({
      analysis,
      verifiedClaims,
      ...(adoptedIndices !== undefined ? { adoptedIndices } : {}),
    })
    if (r?.error) {
      toast.error(`${t('story.error.prefix')}: ${r.error}`)
      return r
    }
    setScriptPhase('synopsis')
    return r
  }

  const handleResearchSkip = async () => {
    const r = await pipeline.researchSkip?.()
    if (r?.error) {
      toast.error(`${t('story.error.prefix')}: ${r.error}`)
      return r
    }
    setUseResearchContext(false)
    setScriptPhase('synopsis')
    return r
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
      // M3b-2b: audio만 pre-flight 게이트를 거친다 — missing 키가 있으면 여기서 실행하지 않고
      // AudioKeyGateCard로 안내한다(그 외 스텝은 게이트 대상이 아니라 원래대로 직접 실행).
      if (currentStep === 'audio') {
        runAudioWithPreflight(buildStepParams(currentStep), (p) => runStep('audio', p))
      } else {
        runStep(currentStep, buildStepParams(currentStep))
      }
      // §1 — 다음 스텝(분리시작 등)을 실행하면 scriptPhase를 벗고 스텝퍼가 진행한다.
      setScriptPhase(null)
      // 진행 액션은 현재 단계로 화면을 되돌린다 — done 스텝을 보던 중이면 viewedStep이
      // 그 스텝에 고정돼 진행해도 화면이 안 따라온다(대기/진행 표시를 못 봄).
      setViewedStep(null)
    }
  }

  // B: 현재 보고 있는 done 스텝(audio/prompts)을 재실행. audio는 화자 매핑 반영, prompts는 params 없음.
  // Finding2(리뷰): audio 재실행이 preflight에 막히면(missing key) start()가 안 불려 steps.audio는
  // 여전히 done — regenerateSegment와 같은 이유로, 무조건 null 대신 막혔을 때만 'audio'로 고정해
  // AudioKeyGateCard가 보이는 오디오 패널을 유지한다.
  const handleStepRedo = async () => {
    if (redoStep === 'scenes') { handleSplit(); return } // 씬 재분리(제목 확정+분리, 자체 viewedStep 처리)
    if (redoStep === 'audio') {
      const result = await runAudioWithPreflight(buildStepParams(redoStep), (p) => runStep('audio', p))
      setViewedStep(result?.error === 'preflight-missing-key' ? 'audio' : null)
      return
    }
    runStep(redoStep, buildStepParams(redoStep))
    setViewedStep(null)
  }

  const manualReviewTarget = !isRunning && ['scenes', 'prompts'].includes(displayStep)
    ? displayStep
    : null

  const handlePasteStart = async () => {
    setBaseScript('')
    // 임포트/붙여넣기 시작도 현재 설정(genre/length/…)과 제목을 버리지 않고 전부 커밋한다 —
    // 안 그러면 재오픈 hydrate 시 기본값(bespoke/10분/제목없음)으로 되돌아간다.
    await start('script', {
      pastedScript: scriptText,
      input: { type: 'pasted', title },
      options: currentOptions(),
    })
    // §v2.8 B1: 대본 영속(start 선행, script done) 직후 synopsis 게이트로 — 등장인물 역추출·확인.
    synopsisPhaseHydratedRef.current = true
    setSynopsisLocalMode('pasted')
    setScriptPhase('synopsis')
    runGenerateSynopsis({ type: 'pasted', pastedScript: scriptText, options: currentOptions() })
  }

  // §3 제목 자동생성 — 제목이 비고 대본이 있으면 generateTitle로 확정. 반환 title을
  // 로컬 변수로 돌려줘 이어지는 start payload에 직접 쓴다(React state 순서 비의존).
  // 실패 시 toast + null 반환(호출측 진행 중단 — 제목 없이 분리/재생성 안 함).
  const resolveTitle = async () => {
    if (title.trim() || !scriptText.trim()) return title
    try {
      const res = await pipeline.generateTitle(scriptText, currentOptions())
      if (res?.aborted) return null // 겹친 호출/프로젝트 전환이 취소함 — toast 없이 조용히
      if (!res?.title) throw new Error(res?.error || 'empty-title')
      setTitle(res.title)
      return res.title
    } catch (err) {
      toast.error(`${t('story.error.titleGenFailed')}: ${err?.message || err}`)
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
    setScriptPhase(null)
    // 재분리에서는 currentStep이 audio 이후일 수 있어 null로 비우면 그 패널로 튄다.
    setViewedStep('scenes')
    try {
      const res = await runStep('scenes', { scriptOverride: scriptText, options: currentOptions(), title: resolved })
      setViewedStep(null)
      return !res?.error // busy 등 enqueue 실패면 false
    } catch {
      return false
    }
  }

  // ── 자동 진행 오케스트레이션 ──────────────────────────────────────────────
  const AUTO_ORDER = ['scenes', 'audio', 'prompts']
  const handleToggleAuto = (step) => setAutoSteps((m) => ({ ...m, [step]: !m[step] }))
  // 다음 실행할 자동 스텝: 순서상 자동=true & 아직 done/running 아닌 첫 스텝(자동=false는 건너뜀).
  // image-first는 effectiveAutoSteps(audio 강제 on)를 본다 — raw autoSteps를 보면 prompts가 먼저
  // 잡혀 fixed-audio-required로 교착한다.
  const nextAutoStep = () => AUTO_ORDER.find((s) => effectiveAutoSteps[s] && steps[s]?.status !== 'done' && steps[s]?.status !== 'running')
  // 전체 진행 가능: 대본 done + 남은 자동 스텝 존재 + 실행 중 아님 + 미확정 게이트 아님(FIX-2).
  const canRunAll = !unconfirmedGate && steps.script?.status === 'done' && !isRunning && !!nextAutoStep()
  // 스텝을 실행하되 enqueue 실패(제목 실패/busy)면 자동 진행을 멈춘다(stuck 방지, Codex).
  const triggerAutoStep = async (step) => {
    if (step === 'scenes') {
      const ok = await handleSplit()
      if (!ok) setAutoRunning(false)
      return
    }
    setScriptPhase(null); setViewedStep(null)
    // M3b-2b: audio는 pre-flight 게이트를 거친다 — missing 키면 'preflight-missing-key'가 res.error로
    // 와서 아래 stuck 방지 로직이 자동 진행을 멈춘다(키가 없는데 계속 재시도하면 안 됨).
    const res = step === 'audio'
      ? await runAudioWithPreflight(buildStepParams(step), (p) => runStep('audio', p))
      : await runStep(step, buildStepParams(step))
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
  // 슬라이스5(§v2.8 B1): 두 경로 모두 synopsis 게이트로 진입한다(pasted는 start 선행 후 역추출).
  const handleSetupStart = () => {
    const originalScript = pipeline.scriptText || ''
    const shouldUsePastedScript = scriptText.trim()
      && (hydrateInput?.type === 'pasted' || !title.trim() || scriptText !== originalScript)
    if (shouldUsePastedScript) handlePasteStart()
    else startSynopsisFromTitle()
  }

  // 대본 임포트 공통 — .txt/.md 파일만 FileReader 로 읽어 scriptText 에 채운다(그 외 무시).
  // drag&drop 과 파일 선택(picker) 이 같은 경로를 쓴다.
  const importFileRef = useRef(null)
  const readImportFile = (file) => {
    if (!file) return
    const name = (file.name || '').toLowerCase()
    if (!name.endsWith('.txt') && !name.endsWith('.md')) return
    // readAsText 는 인코딩을 안 주면 UTF-8 을 강제한다 — Windows 에서 저장한 대본(CP949/UTF-16)이
    //   에러 없이 깨진 글자로 들어온다. readTextFile 이 바이트를 보고 인코딩을 고른다.
    // 읽기 실패 시 기존 붙여넣은 대본을 빈 문자열로 덮지 않는다(옛 onloadend 회귀 방지).
    readTextFile(file)
      .then((text) => { if (text != null) setScriptText(String(text)) })
      .catch(() => {})
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
    : `${t('story.scenes.summaryScene', '씬 분리 단위: 씬 기준')} · ${sceneMinSec}~${sceneMaxSec}${t('story.form.sceneSecUnit', '초')}`
  const stepDisplayError = resolveDisplayError(t, stepData.errorKind, stepData.error)
  // 씬 기준 목표 길이(min~max초) 입력 — 설정 폼과 '씬 재분리' 바에서 공용. segment 모드에선 숨김.
  const renderSceneSec = () => sceneGranularity !== 'scene' ? null : (
    <div className="story-scene-sec">
      <input
        className="story-sec-input"
        aria-label={t('story.form.sceneMinSec', '씬 최소 길이(초)')}
        value={sceneMinSec}
        onChange={(e) => setSceneMinSec(e.target.value)}
        disabled={isRunning}
        inputMode="numeric"
      />
      <span className="story-sec-sep">~</span>
      <input
        className="story-sec-input"
        aria-label={t('story.form.sceneMaxSec', '씬 최대 길이(초)')}
        value={sceneMaxSec}
        onChange={(e) => setSceneMaxSec(e.target.value)}
        disabled={isRunning}
        inputMode="numeric"
      />
      <span className="story-sec-unit">{t('story.form.sceneSecUnit', '초')}</span>
    </div>
  )
  // 검수(reviewOnly) 실행인지 — main이 running 마킹과 같은 story:state에 실어 보낸다. 검수는
  // 델타가 없어 생성용 스트림 뷰로 갈아끼우면 빈 상자가 된다(대본이 사라졌다 돌아오는 증상).
  const isReviewRun = (step) => steps[step]?.status === 'running' && steps[step]?.reviewOnly === true
  const scriptReviewRun = isReviewRun('script')
  const scenesReviewRun = isReviewRun('scenes')
  const promptsReviewRun = isReviewRun('prompts')

  const scenesProgressLog = progressLog.filter((entry) => !entry.step || entry.step === 'scenes')
  const scriptProgressLog = progressLog.filter((entry) => entry.step === 'script')
  const promptsProgressLog = progressLog.filter((entry) => entry.step === 'prompts')
  // ⑤ 오디오 로그 — 파일 가져오기의 진단(화자별 정렬 결과, 자막이 안 맞는 위치)이 여기로 온다.
  const audioProgressLog = progressLog.filter((entry) => entry.step === 'audio')
  // 화자별 진행 — 행마다 "227/230"처럼 얼마나 완성됐는지. 하단 전체 초시계에 더해 화자 단위로 본다.
  // 상태 판정은 목록과 같은 규칙: 실시간(segmentProgress) > 영속(seg.status) > pending.
  // segId별로 오는 audio-segment 진행을 화자로 접어 카운트한다. sfx는 화자 오디오가 아니라 뺀다.
  const speakerSegProgress = useMemo(() => {
    const m = new Map() // 화자 id → { total, done, error }
    for (const sc of scenes) {
      for (const seg of sc.segments || []) {
        if ((seg.type || 'narration') === 'sfx' || !seg.speaker) continue
        // seg.speaker는 id가 아니라 이름/별칭일 수 있다 — 조회는 sp.id로 하므로 여기서 id로 접는다.
        // 원시값으로 키잉하면 나레이터({id:'narrator', name:'나레이션'})부터 어긋나 배지가 사라진다.
        const spId = speakerByRef(seg.speaker)?.id
        if (!spId) continue
        const cur = m.get(spId) || { total: 0, done: 0, error: 0 }
        cur.total += 1
        const st = segmentProgress[seg.id] || seg.status || 'pending'
        if (st === 'done') cur.done += 1
        else if (st === 'error') cur.error += 1
        m.set(spId, cur)
      }
    }
    return m
  }, [scenes, segmentProgress])
  // 해당 타겟의 검수 점수만 — 다른 스텝 점수가 새지 않게.
  const scoresFor = (target) => (reviewScores?.target === target ? reviewScores.scores : [])
  // 편집기 카운트 행(줄 수·자 수)에 얹는 검수 점수 + 세션 토큰. 둘 다 없으면 null 을 줘야
  // PromptInput 이 빈 footer span 을 안 만든다(안 그러면 실행 전에도 12px gap 이 뜬다).
  const hasUsage = !!(usage && (usage.input || usage.output))
  const stepFooter = (target) => {
    const scores = scoresFor(target)
    if (!scores.length && !hasUsage) return null
    return <>{scores.length ? <ReviewScore scores={scores} /> : null}<UsageInline usage={usage} /></>
  }
  // 검수 진행 표시 — 시놉시스 패널과 같은 모양(콘텐츠는 그대로 두고 하단에 시계+로그창).
  const reviewRunning = (step, log) => (
    <StoryRunning usage={usage}
      label={t('story.review.running', '검수 중')}
      startedAt={Date.parse(steps[step]?.updatedAt)}
      log={log}
    />
  )
  // 검수 로그 행은 step:'synopsis'로 찍힌다 — scenes 로그로 새지 않는다.
  const synopsisProgressLog = progressLog.filter((entry) => entry.step === 'synopsis')
  const activeLengthUnit = coerceStoryLengthUnit(lengthUnit, language)
  const lengthUnitOptions = storyLengthUnitsForLanguage(language)
  const lengthOptionValues = storyLengthOptionValues(activeLengthUnit)

  const scriptEditor = (
    <div className="story-script-editor">
      <PromptInput
        value={scriptText}
        onChange={setScriptText}
        // 검수 중 편집은 재작성 결과에 덮어써진다 — 시놉시스 게이트와 같은 이유로 동결한다.
        disabled={scriptReviewRun}
        references={[]}
        disableMentions
        showCharCount
        hideTip
        countLabelKey="prompt.lineCount"
        // 검수 점수·세션 토큰은 줄 수·자 수 행에 얹는다 — 별도 줄을 만들면 편집 영역만 좁아진다.
        footerExtra={stepFooter('script')}
        placeholder={t('story.form.scriptPlaceholder', '대본이 여기에 표시됩니다')}
      />
    </div>
  )

  // 시놉시스도 대본과 같은 편집기 — 라인번호 gutter + 하단 줄 수·자 수 행을 공짜로 얻는다.
  // 검수 점수도 같은 자리(카운트 행)에 얹어 두 화면의 모양을 맞춘다.
  const synopsisEditor = (
    <div className="story-synopsis-editor">
      <PromptInput
        value={synopsisDraft}
        onChange={setSynopsisDraft}
        disabled={synopsisReviewing}
        references={[]}
        disableMentions
        showCharCount
        hideTip
        countLabelKey="prompt.lineCount"
        ariaLabel={t('story.synopsis.editorLabel', '줄거리')}
        footerExtra={stepFooter('synopsis')}
        placeholder={t('story.synopsis.placeholder', '시놉시스가 여기에 표시됩니다')}
      />
    </div>
  )

  return (
    <div className="story-view">
      <StoryStepper steps={steps} currentStep={currentStep} activeStep={stepperActive} t={t} onStepClick={handleStepClick}
        autoSteps={effectiveAutoSteps} autoLockedSteps={isImageFirst ? ['audio'] : []}
        onToggleAuto={handleToggleAuto} onRunAll={handleRunAll} canRunAll={canRunAll} autoRunning={autoRunning}
        synopsisEnabled={synopsisEnabled} researchEnabled={researchEnabled}
        synopsisDone={pipeline.charactersConfirmed === true} researchDone={pipeline.research?.confirmed === true} />

      {openError && (
        <div className="story-open-error-banner" role="alert">
          ⚠️ {t('story.error.openFailed', '프로젝트 폴더를 열 수 없습니다')}: {openError}
        </div>
      )}

      {/* D24a 복구: 임포트가 중단·거절돼 project(이미지)와 story(씬)가 어긋난 채 durable로 남았다
          (state.fixedSceneError). 부분 복구는 없다 — image-set 전체를 다시 임포트하거나 취소한다. */}
      {state?.fixedSceneError && (
        <div className="story-error-banner story-fixed-scene-alert" role="alert" data-testid="story-fixed-scene-alert">
          <div>
            ⚠️ {t('story.fixedScene.staleTitle', '이미지 세트가 프로젝트와 어긋났습니다')}
          </div>
          <div className="story-fixed-scene-desc">
            {t('story.fixedScene.staleDesc', '임포트가 중단되거나 거절돼 씬이 반쯤 반영됐습니다. 이미지 세트를 통째로 다시 임포트해야 진행할 수 있습니다.')}
          </div>
          <div className="story-fixed-scene-actions">
            {onReissueImageFirst && (
              <button type="button" className="story-btn-primary" onClick={onReissueImageFirst}>
                {t('story.fixedScene.reissue', '이미지 세트 다시 임포트')}
              </button>
            )}
            {(onCancelImageFirst || onClose) && (
              <button type="button" className="story-btn-secondary" onClick={onCancelImageFirst || onClose}>
                {t('story.fixedScene.cancel', '취소')}
              </button>
            )}
          </div>
        </div>
      )}

      {isError && (
        <div className="story-error-banner" role="alert">
          ⚠️ {t('story.error.prefix')}: {stepDisplayError}
        </div>
      )}

      <div className="story-step-panel">
        {displayStep === 'script' && (
          <div className="story-script-panel">
            {scriptPhase === 'research' ? (
              // 리서치 spec §3.6: 리서치 게이트 패널 — 키워드 검색·카드 선택·자막 취득·구조분석·
              // 팩트체크·확정/건너뛰기. 하단 generic 컨트롤은 suppress(N2 게이트 우회 방지).
              <ResearchPanel
                t={t}
                research={pipeline.research}
                fetchProgress={pipeline.researchFetchProgress || {}}
                disabled={isRunning}
                // 개선3: 프로젝트 언어 — 카드 1차 언어 필터 + "설정 언어 자막 없음" 배지 기준.
                language={language}
                onSearch={pipeline.researchSearch}
                // M4(R1): 자막 취득도 현재 UI 언어 옵션을 전달 — main이 프로젝트 언어를 자막 1순위로
                // 골라야 언어 배지·분석이 정확하다(안 실으면 ko 고정).
                onFetch={(p) => pipeline.researchFetchTranscripts({ ...(p || {}), options: currentOptions() })}
                // M2(D10): 구조분석/팩트체크도 시놉시스·스크립트처럼 현재 UI 옵션을 매번 전달 —
                // 안 실으면 machine이 state.input.options 폴백(리서치는 시놉시스보다 앞서 대부분
                // null) → DEFAULT_STORY_LLM/ko 고정으로 엔진·언어 선택이 무시된다.
                // 팩트체크 엔진은 main이 Claude 강제(§3.5) — 여기 options에선 language만 소비된다.
                onAnalyze={(p) => pipeline.researchAnalyze({ ...(p || {}), options: currentOptions() })}
                onFactCheck={() => pipeline.researchFactCheck({ options: currentOptions() })}
                // m5: 수동 URL 카드·fetch 전 선택을 draft에 영속(탭전환/재오픈 유실 방지).
                onSelect={pipeline.researchSelect}
                // 상세 모달(2026-07-08): 카드 더블클릭 시 단일 영상 상세(구독자·게시일·바이럴).
                onVideoDetails={pipeline.researchVideoDetails}
                onCommit={handleResearchCommit}
                onSkip={handleResearchSkip}
                onAbort={() => abort()}
              />
            ) : scriptPhase === 'synopsis' ? (
              // 슬라이스5(§v2.5/§v2.8 B1): 시놉시스 게이트 패널 — 줄거리 편집(title 경로) +
              // 등장인물 카드 편집 + 확정/다시/설정으로. pasted 모드는 줄거리 편집 비노출
              // (등장인물 역추출·확인 중심). 하단 generic 컨트롤은 suppress(게이트 우회 방지).
              <div className="story-synopsis-phase" data-testid="story-synopsis">
                {synopsisError && (
                  <div className="story-error-banner" role="alert">
                    ⚠️ {t('story.error.prefix')}: {synopsisError}
                  </div>
                )}
                {/* title·pasted 공통 — 생성 중엔 스트림(pasted는 델타 없어 빈 채 시계만), 완료 후 편집 가능한
                    시놉시스. pasted도 대본에서 역추출한 시놉시스(로그라인/훅/구조)를 보여준다. */}
                {synopsisGenerating ? (
                  <div className="story-script-stream" aria-live="polite" ref={synopsisStream.ref} onScroll={synopsisStream.onScroll}>{synopsisStreamingText}</div>
                ) : (
                  // 검수 중에도 편집기를 유지한다(스트림 뷰로 바꾸면 정작 검수 대상이 안 보인다).
                  // 대신 disabled로 동결 — 검수 중 편집이 재작성 결과에 덮어써지는 걸 막는다.
                  hasI18n ? synopsisEditor : <I18nProvider>{synopsisEditor}</I18nProvider>
                )}
                {/* 생성 중 시계+경과 — 첫 출력(특히 reasoning=max)이 늦어도 진행 중임을 보인다. */}
                {synopsisGenerating && (
                  <GenClock startedAt={synopsisStartedAt} label={t('story.gen.generating', '생성 중')} usage={usage} />
                )}
                <div className="story-synopsis-characters">
                  <span className="story-opt-label">{t('story.synopsis.charactersTitle', '등장인물')}</span>
                  {/* 빈 roster만으로 narrator-only인지 visual-only인지 단정할 수 없다. 등록된 인물이
                      없다는 확인된 사실만 안내하고, 그대로 확정할 수 있음을 명시한다. */}
                  {characterDrafts.length === 0 && (
                    <p className="story-hint" data-testid="story-roster-empty">
                      {t('story.synopsis.rosterEmpty', '등록된 등장인물이 없습니다. 그대로 확정하고 진행하세요.')}
                    </p>
                  )}
                  <CharacterCards characters={characterDrafts} onChange={setCharacterDrafts} disabled={synopsisGenerating || synopsisReviewing} t={t} />
                </div>
                {/* 검수 진행 — scenes 패널 미러({reviewBadge} + StoryRunning). 배지는 error를 sticky로
                    남기고, StoryRunning이 시계+로그창을 제공한다(신규 컴포넌트/CSS 없음). */}
                {reviewBadge}
                {synopsisReviewing && (
                  <StoryRunning usage={usage}
                    label={t('story.review.running', '검수 중')}
                    startedAt={synopsisReviewStartedAt}
                    log={synopsisProgressLog}
                  />
                )}
                {/* 리서치 선행 흐름(개정): title 모드에서 제목이 비어 있으면 안내 — 리서치는
                    제목 없이 확정 가능하나 시놉시스 생성/확정은 제목이 필요하다(설정 탭 재사용). */}
                {synopsisTitleMissing && (
                  <div className="story-synopsis-title-hint" role="note">
                    {t('story.synopsis.titleRequired', '제목이 필요합니다 — [설정] 탭에서 제목을 입력한 뒤 시놉시스를 생성하세요')}
                  </div>
                )}
                {/* 리서치 spec §3.6(M2/Q5): 확정된 리서치가 있을 때만 수동 주입 토글 노출 —
                    켜면 시놉시스 생성이 useResearch:true로 research.json을 주입한다. */}
                {pipeline.research?.confirmed && (
                  <label className="story-research-use-toggle">
                    <input
                      type="checkbox"
                      aria-label={t('story.synopsis.useResearch', '리서치 컨텍스트 포함')}
                      checked={useResearchContext}
                      onChange={(e) => setUseResearchContext(e.target.checked)}
                      disabled={synopsisGenerating}
                    />
                    <span>{t('story.synopsis.useResearch', '리서치 컨텍스트 포함')}</span>
                  </label>
                )}
                <div className="story-synopsis-controls">
                  <button
                    type="button"
                    className="story-btn-primary"
                    onClick={handleSynopsisConfirm}
                    disabled={synopsisGenerating || synopsisReviewing || isRunning || synopsisTitleMissing || (synopsisMode !== 'pasted' && !synopsisDraft.trim())}
                  >
                    {synopsisMode === 'pasted'
                      ? t('story.synopsis.confirmCharacters', '등장인물 확정')
                      : t('story.synopsis.confirmTitle', '이 시놉시스로 대본 생성')}
                  </button>
                  <button
                    type="button"
                    className="story-btn-secondary"
                    onClick={handleSynopsisRegenerate}
                    disabled={synopsisGenerating || synopsisReviewing || isRunning || synopsisTitleMissing}
                  >
                    {t('story.synopsis.regenerate', '시놉시스 다시')}
                  </button>
                  {/* 수동 검수 — 자동검수 체크박스는 없다(게이트는 사람이 보고 확정하는 자리라
                      생성 직후 자동 재작성하면 게이트의 취지가 무너진다). */}
                  {renderReviewControl('synopsis', {
                    manual: true,
                    autoToggle: false,
                    disabled: synopsisGenerating || synopsisReviewing || isRunning,
                    canReview: !!synopsisDraft.trim(),
                  })}
                  {/* '설정으로' 버튼 제거 — 상단 스텝퍼의 [0 설정] 탭으로 이동하면 되므로 중복. */}
                  {/* FIX-4(§3.3 abort 대칭): 생성 중 중단 — main abort()가 synopsisController를
                      대칭 중단하므로 호출만 하면 된다. 검수도 같은 컨트롤러를 잡으므로 동일. */}
                  {(synopsisGenerating || synopsisReviewing) && (
                    <button type="button" className="story-btn-secondary" onClick={handleAbort} disabled={aborting}>
                      {aborting ? t('story.action.aborting', '⏹ 중단 중…') : t('story.action.abort', '⏹ 중단')}
                    </button>
                  )}
                </div>
              </div>
            ) : scriptPhase === 'editor' ? (
              // §1-B 대본 작업 화면 — 생성 중엔 스트리밍 preview(이어쓰기는 baseScript 접두),
              // 그 외 PromptInput 편집기 + 3버튼/설정으로.
              // PromptInput 은 useI18n() provider 를 요구한다. 실제 앱에선 상위(Shell.jsx)
              // provider 가 이미 있으므로 재사용해 Header 언어 전환이 그대로 전파되게 하고,
              // provider 가 없는 단위 테스트에서만 폴백으로 감싼다(중첩·중복 setLocale 방지).
              <div className="story-editor-phase" data-testid="story-editor">
                {reviewBadge}
                {/* 검수는 델타가 없다 — 생성용 스트림 뷰로 갈아끼우면 빈 상자가 뜨고 대본이 사라진다.
                    대본은 그대로 두고(동결) 하단에 로그창을 붙인다(시놉시스 패널 미러). */}
                {scriptRunning && !scriptReviewRun ? (
                  <>
                    <div className="story-script-stream" aria-live="polite" ref={scriptEditorStream.ref} onScroll={scriptEditorStream.onScroll}>
                      {baseScript ? baseScript + streamingText : streamingText}
                    </div>
                    {/* 생성 중 시계+경과 (대본) — 첫 출력이 늦어도 진행 중임을 보인다. */}
                    <GenClock startedAt={Date.parse(steps.script?.updatedAt)} label={t('story.gen.generating', '생성 중')} usage={usage} />
                  </>
                ) : (
                  <>
                    {hasI18n ? scriptEditor : <I18nProvider>{scriptEditor}</I18nProvider>}
                    {scriptReviewRun && reviewRunning('script', scriptProgressLog)}
                  </>
                )}
                <div className="story-editor-controls">
                  {/* 중단/3버튼 분기는 isRunning(currentStep) 기준 — script뿐 아니라 scenes/prompts가
                      도는 중에도 대본 탭에서 abort를 잃지 않도록(재리뷰3). stream 렌더 분기만 scriptRunning. */}
                  {isRunning ? (
                    <button type="button" className="story-btn-secondary" onClick={handleAbort} disabled={aborting}>
                      {aborting ? t('story.action.aborting', '⏹ 중단 중…') : t('story.action.abort', '⏹ 중단')}
                    </button>
                  ) : isImageFirst ? (
                    // D24a: 대본·씬이 임포트로 고정됐다 — 검수/다시쓰기/이어쓰기/분리시작은 모두
                    // machine이 거절하는(fixed-scenes-immutable) 액션이라 렌더하지 않는다.
                    // 진행은 스텝퍼(오디오·프롬프트/전체 진행)가 담당한다.
                    null
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
                        disabled={!scriptText.trim() || unconfirmedGate}
                      >
                        {t('story.action.split', '분리시작')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : scriptRunning ? (
              // 생성 중 스트리밍 preview (setup에서 시작 직후 등 editor 외 phase).
              <div className="story-script-stream" aria-live="polite" ref={scriptPreviewStream.ref} onScroll={scriptPreviewStream.onScroll}>{reviewBadge}{streamingText}</div>
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
                    {genresForLanguage(language).map((g) => (
                      <option key={g} value={g}>{genreLabel(g, t)}</option>
                    ))}
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
                  <div className="story-granularity-group">
                    <select
                      className="story-input story-granularity-select"
                      aria-label={t('story.form.granularityLabel', '씬 분리 단위')}
                      value={sceneGranularity}
                      onChange={(e) => setSceneGranularity(e.target.value)}
                      disabled={isRunning}
                    >
                      <option value="scene">{t('story.form.granularityScene', '씬 기준')}</option>
                      <option value="segment">{t('story.form.granularitySegment', '문장 기준')}</option>
                    </select>
                    {renderSceneSec()}
                  </div>
                </div>

                {/* D24a: image-first는 script/scenes/prompts 검수가 모두 불법 — 행 전체를 비운다. */}
                {!isImageFirst && (
                <div className="story-opt-row story-review-opt-row">
                  <span className="story-opt-label">{t('story.form.reviewLabel', '검수')}</span>
                  <div className="story-review-settings">
                    {REVIEW_TARGET_ORDER.map((target) => renderReviewControl(target, { disabled: isRunning }))}
                  </div>
                </div>
                )}

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
            {(scenesPreviewActive || scenesReviewing || scenesReviewRevising) && (
              <StreamingProgressBar
                label={scenesReviewing ? reviewTopProgress : (scenesRevising || scenesReviewRevising) ? sceneRevisionProgress : t('story.scenes.running', '씬 분리 진행 중')}
                valueText={scenesReviewing ? reviewTopProgress : (scenesRevising || scenesReviewRevising) ? sceneRevisionProgress : sceneStreamProgress}
                value={scenesReviewing ? null : (scenesRevising || scenesReviewRevising) ? sceneRevisionPercent : sceneStreamPercent}
                thinking={scenesReviewing && reviewThinking}
                thinkingText={thinkingText}
              />
            )}
            {/* 생성 중에도 테이블을 유지하고 streamed scene을 표시 전용 ghost 행으로 보여준다. */}
            {steps.scenes?.status === 'running' && !scenesReviewRun && (
              <>
                {reviewBadge}
                <StoryRunning usage={usage}
                  label={t('story.scenes.running', '씬 분리 진행 중')}
                  startedAt={Date.parse(steps.scenes.updatedAt)}
                  detail={splitSummary}
                  thinking={sceneThinking && scenePreviewCount === 0}
                  t={t}
                  log={scenesProgressLog}
                />
              </>
            )}
            {/* 10번: 씬 분리 탭에 필요한 옵션(씬 분리 단위)만 노출 — 바꾸고 하단 '씬 재분리'로 재분리.
                D24a: image-first는 씬이 고정이라 재분리가 없다 — 재분리 전용 바도 렌더하지 않는다. */}
            {!isImageFirst && !(steps.scenes?.status === 'running' && !scenesReviewRun) && (
              <div className="story-rerun-bar">
                <span className="story-opt-label">{t('story.form.granularityLabel', '씬 분리 단위')}</span>
                <select
                  className="story-input"
                  aria-label={t('story.scenes.rerunGranularity', '씬 분리 단위 (재분리)')}
                  value={sceneGranularity}
                  onChange={(e) => setSceneGranularity(e.target.value)}
                  disabled={isRunning}
                >
                  <option value="scene">{t('story.form.granularityScene', '씬 기준')}</option>
                  <option value="segment">{t('story.form.granularitySegment', '문장 기준')}</option>
                </select>
                {renderSceneSec()}
              </div>
            )}
            <StreamingTableViewport
              active={scenesPreviewActive}
              step="scenes"
              containerRef={scenesTableRef}
              onScroll={handleScenesTableScroll}
            >
              <table className="story-readonly-table">
                <thead>
                  <tr>
                    <th>{t('story.scenes.no', '#')}</th>
                    <th>{t('story.scenes.speaker', '화자')}</th>
                    <th>{t('story.scenes.segment', '세그먼트(감정)')}</th>
                  </tr>
                </thead>
                <tbody>
                  {scenesRevising
                    ? Array.from({ length: Math.max(scenes.length, sceneFrontierIndex + 1) }, (_, si) => {
                        const preview = revisionPreviewScenesByIndex.get(si)?.scene || null
                        const scene = preview || scenes[si]
                        const segments = scene?.segments || []
                        return segments.map((seg, gi) => {
                          const frontier = !!preview && si === sceneFrontierIndex && gi === segments.length - 1
                          const className = [
                            seg.type === 'sfx' ? 'story-sfx-row' : '',
                            frontier ? 'story-row-revising' : '',
                          ].filter(Boolean).join(' ') || undefined
                          return (
                            <tr
                              key={`${scenes[si]?.storyId ?? `revision-${si}`}-${gi}`}
                              className={className}
                              data-scene-frontier={frontier ? '' : undefined}
                            >
                              <td>{preview ? <span className="story-scene-ghost">{si + 1}</span> : si + 1}</td>
                              <td>{preview
                                ? <span className="story-scene-ghost">{seg.type === 'sfx' ? t('story.audio.sfxLabel', 'SFX') : seg.speaker}</span>
                                : (seg.type === 'sfx' ? t('story.audio.sfxLabel', 'SFX') : seg.speaker)}</td>
                              <td>{preview
                                ? <span className={`story-scene-ghost${seg.type === 'sfx' ? ' story-sfx-desc' : ''}`}>{seg.text}</span>
                                : (seg.type === 'sfx' ? <span className="story-sfx-desc">{seg.description}</span> : renderNarrationCell(seg))}</td>
                            </tr>
                          )
                        })
                      })
                    : scenesStreaming
                    ? orderedPreviewScenes.flatMap(({ chunkIndex, localSceneNo, scene }, si) =>
                        (scene.segments || []).map((seg, gi) => (
                          <tr key={`preview-${chunkIndex}-${localSceneNo}-${gi}`} className={seg.type === 'sfx' ? 'story-sfx-row' : undefined}>
                            <td><span className="story-scene-ghost">{si + 1}</span></td>
                            <td><span className="story-scene-ghost">{seg.type === 'sfx' ? t('story.audio.sfxLabel', 'SFX') : seg.speaker}</span></td>
                            <td><span className={`story-scene-ghost${seg.type === 'sfx' ? ' story-sfx-desc' : ''}`}>{seg.text}</span></td>
                          </tr>
                        )),
                      )
                    : scenes.flatMap((sc, si) =>
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
            </StreamingTableViewport>
            {steps.scenes?.status !== 'running' && scenes.length === 0 && (
              <div className="story-empty-hint">{t('story.scenes.empty', '씬 분리 결과가 아직 없습니다.')}</div>
            )}
            {scenesReviewRun && reviewRunning('scenes', scenesProgressLog)}
          </div>
        )}

        {displayStep === 'audio' && (
          <div className="story-audio-panel">
            {/* M3b-2b Task 2: pre-flight가 missing 키를 찾으면 실행 대신 여기 인라인으로 카드를
                띄운다(§4.4). onKeySaved는 best-effort로 그 provider 목소리 재조회 후 재검사 —
                통과하면 원래 하려던 실행(audioGate.retry)을 이어서 돈다.
                Finding1(리뷰): onVoiceSearch는 App의 handleTtsVoiceSearch로 이어지는데, 그건
                검색어 2자 미만이면 조용히 no-op하는 원격 "검색"이라 provider 목소리를 다시
                로드하지 못한다(prod no-op). onReloadVoices(=App.reloadTtsVoicesForProvider)가
                그 provider 슬라이스를 처음부터 다시 긁는 전용 경로다. */}
            {audioGate && (
              <AudioKeyGateCard
                missing={audioGate.missing}
                t={t}
                onKeySaved={async (provider) => {
                  try { await onReloadVoices?.(provider) } catch { /* best-effort — 재조회 실패해도 재검사는 진행 */ }
                  const r = await preflight.check(audioGate.paramsForRecheck)
                  if (r.ok) {
                    setAudioGate(null)
                    // Finding1(2R 리뷰): retry는 여기서 fire-and-forget으로 불리면 그 안에서
                    // 도는 실제 실행이 이 컴포넌트의 원래 호출부(testSegment 등)의 try/finally
                    // 밖에서 돈다 — await+catch로 감싸 unhandled rejection을 막는다. 세그먼트
                    // 테스트 경로는 retry 자체가 이미 가드+토스트를 갖고 있어(runSegmentTestGuarded)
                    // 안 던지지만, 다른 진입점(배치 실행 등)의 방어도 여기서 함께 확보한다.
                    try { await audioGate.retry?.() } catch { /* run 콜백이 이미 자체 처리 — 방어적 캐치 */ }
                  } else {
                    setAudioGate((g) => (g ? { ...g, missing: r.missing } : g))
                  }
                }}
              />
            )}
            {/* D: 생성 중엔 전체 진행(초시계) + 아래 세그먼트 목록을 함께 보여준다(실시간 진행).
                로그를 함께 넘긴다 — 파일 가져오기의 진단(정렬 결과, 자막이 안 맞는 위치)이 여기로
                온다. 안 넘기면 그 정보가 어디에도 안 보인다(오류 배너는 errorKind로 번역되면서
                상세 메시지를 버린다 — errorDisplay.js). */}
            {steps.audio?.status === 'running' && (
              <StoryRunning usage={usage}
                label={t('story.audio.running', '오디오 생성 중')}
                startedAt={Date.parse(steps.audio.updatedAt)}
                log={audioProgressLog}
              />
            )}
            {/* 실패했을 때도 로그를 남겨 둔다 — "자막이 안 맞는다"는 배너만 보고는 어디를 고칠지 모른다.
                로그가 비었으면(앱을 껐다 켠 뒤: 오류는 story.json에 영속되지만 progressLog는 메모리라
                open 시 비워진다) 영속된 원문 진단을 대신 보여준다 — 배너의 번역문은 상세를 버린다
                (errorDisplay.js). 안 그러면 "진행 로그를 보라"는 안내가 없는 로그를 가리킨다.

                **성공(done)했어도 경고가 있으면 남긴다.** 가져오기는 안 맞아도 막지 않고 대략 잘라
                놓고 경고하는 정책이라(사용자 결정), 그 실행은 done으로 끝난다 — 여기서 안 띄우면
                "어느 조각이 보간됐나 / 남의 자리를 물어왔나"가 완료되는 순간 사라져 확인할 방법이
                없어진다. 경고 없는 깨끗한 실행(ep02 실측: 237/237 exact)엔 안 띄운다 — 정상에
                소음을 얹으면 경고가 경고로 안 읽힌다. */}
            {(steps.audio?.status === 'error' || audioProgressLog.some((e) => e.level === 'warn' || e.level === 'error'))
              && (audioProgressLog.length > 0 || steps.audio?.error) && (
              <div className="story-progress-log" role="log" data-testid="audio-progress-log">
                {(audioProgressLog.length > 0
                  ? audioProgressLog
                  : [{ id: 'audio-error', level: 'error', at: steps.audio.updatedAt, message: steps.audio.error }]
                ).map((entry, i) => (
                  <div key={entry.id || `audio-log-${i}`} className={`story-progress-log-row ${entry.level || 'info'}`}>
                    <span className="story-progress-log-time">{formatProgressLogTime(entry.at)}</span>
                    <span className="story-progress-log-message">{entry.message}</span>
                  </div>
                ))}
              </div>
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
                      // C(성우 추천): gender 확정값(male/female) 우선, unknown이면 appearance 추정 폴백.
                      // 못 뽑으면 null → 배지·경고 없음(§v2.8 M5 / m1).
                      const charGender = resolveCharacterGender(sp)
                      // 캐릭터·성우 성별이 둘 다 확실하고 서로 다르면 불일치 경고.
                      const genderMismatch = charGender && selectedVoiceObj?.gender && charGender !== selectedVoiceObj.gender
                      // 이 화자의 오디오 출처(mp3+SRT). 짝이 다 맞아야 실제로 쓰인다.
                      const src = voiceSel.importForSpeaker(sp)
                      const hasSrc = !!(src?.mp3Path && src?.srtPath)
                      return (
                        <div
                          key={sp.id}
                          className={`story-voice-row${dragVoiceRowId === sp.id ? ' drag-over' : ''}`}
                          // 행 전체가 드롭 타깃 — 위젯 칩만이 아니라 이름·설명·성우 버튼 위에 놓아도 된다.
                          onDragOver={(e) => { if (isRunning) return; e.preventDefault(); setDragVoiceRowId(sp.id) }}
                          onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget)) return; setDragVoiceRowId((id) => (id === sp.id ? null : id)) }}
                          onDrop={(e) => {
                            if (isRunning) return
                            e.preventDefault()
                            setDragVoiceRowId(null)
                            // 위젯에 직접 놓았으면 그쪽이 stopPropagation으로 처리하고 여긴 안 온다.
                            srcDropHandles.current.get(sp.id)?.takeFiles(Array.from(e.dataTransfer?.files || []))
                          }}
                        >
                          <div className="story-voice-info">
                            <span className="story-voice-speaker">
                              {sp.name || sp.id}
                              {charGender && (
                                <span
                                  className={`story-voice-gender ${charGender}`}
                                  title={charGender === 'female' ? t('story.audio.genderFemale', '여성') : t('story.audio.genderMale', '남성')}
                                >
                                  {charGender === 'female' ? '♀' : '♂'}
                                </span>
                              )}
                            </span>
                            {/* A1: 캐릭터 특징(Ref prompt와 동일 소스) 표시 전용. 없으면 렌더 안 함. */}
                            {sp.appearance && (
                              <span className="story-voice-appearance">{sp.appearance}</span>
                            )}
                            {/* 화자별 진행 — 오디오가 돌았을 때만(그 전엔 0/N이 소음). 예: 227/230, 미완은 강조. */}
                            {(() => {
                              const prog = speakerSegProgress.get(sp.id)
                              if (!prog || !prog.total || !(steps.audio?.status === 'done' || prog.done > 0)) return null
                              const complete = prog.done === prog.total
                              return (
                                <span
                                  className={`story-voice-progress${complete ? ' done' : ''}${prog.error ? ' has-error' : ''}`}
                                  data-testid={`voice-progress-${sp.id}`}
                                  title={t('story.audio.speakerProgress', `${prog.done}/${prog.total}개 세그먼트 완성`, { done: prog.done, total: prog.total })}
                                >
                                  {prog.done}/{prog.total}
                                  {prog.error ? ` (⚠${prog.error})` : ''}
                                </span>
                              )
                            })()}
                          </div>
                          {/* Task 11: 드롭다운 3종(엔진/검색/목소리) → 버튼 1개 + VoicePicker 모달.
                              출처(mp3+SRT)를 지정한 화자는 TTS를 안 쓰므로 성우 선택을 잠근다 —
                              열어두면 고른 성우가 무시되는데 그 이유가 화면에 안 보인다. */}
                          <button
                            type="button"
                            className="story-input story-voice-picker-btn"
                            aria-label={t('story.audio.voiceFor', `${sp.name || sp.id} 목소리`, { speaker: sp.name || sp.id })}
                            onClick={() => voiceSel.openVoicePicker(sp)}
                            disabled={hasSrc}
                            title={hasSrc ? t('story.audio.source.voiceLocked', 'mp3에서 가져오는 중 — 성우 TTS를 쓰지 않습니다') : undefined}
                          >
                            🎙 {hasSrc ? t('story.audio.source.fromFile', '파일에서') : voiceLabel}
                            {!hasSrc && genderMismatch && (
                              <span
                                className="story-voice-gender-warn"
                                title={t('story.audio.genderMismatch', '캐릭터 성별과 성우 성별이 다릅니다')}
                              >
                                ⚠
                              </span>
                            )}
                          </button>
                          {/* 아이콘 하나로 — 라벨("이 화자만 생성"/"Generate this speaker")을 그대로 두면
                              열을 통째로 먹어 인물 특징 텍스트가 좁아진다. ✨는 이 앱이 이미 "생성"에
                              쓰는 기호다(시작 버튼). 설명은 툴팁으로, 이름은 aria-label로 남긴다 —
                              아이콘만 두면 스크린리더와 테스트가 버튼을 못 읽는다. */}
                          <button
                            type="button"
                            className="story-speaker-run-btn"
                            onClick={() => runSpeakerAudio(sp)}
                            // 우클릭: 이 화자 오디오 전체 강제 재생성(confirm 모달) — 좌클릭(미생성분 채우기)과 분리.
                            onContextMenu={(e) => { e.preventDefault(); if (!speakerAudioBusy) setSpeakerRegenTarget(sp) }}
                            // ✨ 가 보이는데 다른 작업이 도는 상태들: 미리듣기 중, audio:done + 다른 스텝
                            // running, synopsis 생성·검수(side action) 중. 누르면 start() 가 invoke 전에
                            // segmentProgress/progressLog 를 비워 **돌던 작업의 진행·경고가 증발**하고 main 의
                            // busy 는 조용히 무시된다. speakerAudioBusy 로 그 모든 경우를 막는다.
                            disabled={speakerAudioBusy}
                            aria-label={t('story.audio.runThisSpeakerFor', `${sp.name || sp.id}만 생성`, { speaker: sp.name || sp.id })}
                            title={`${t('story.audio.runThisSpeakerHint', '이 화자 세그먼트만 생성합니다. 나머지 화자는 그대로 두고, 결과를 먼저 확인할 수 있습니다.')} · ${t('story.audio.runThisSpeakerForceHint', '우클릭: 이 화자 오디오 전체 재생성')}`}
                          >
                            ✨
                          </button>
                          <div className="story-voice-source">
                            {/* 화자별 오디오 출처 — 위젯 자체도 드롭을 받지만, 위 행 전체가 위임한다. */}
                            <SpeakerAudioSource
                              ref={(h) => { if (h) srcDropHandles.current.set(sp.id, h); else srcDropHandles.current.delete(sp.id) }}
                              source={src}
                              disabled={isRunning}
                              onPick={pipeline.pickAudioImportFile}
                              onChange={(next) => voiceSel.setImportForSpeaker(sp.id, next)}
                              t={t}
                            />
                          </div>
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
                        initialGender={resolveCharacterGender(sp)}
                        onSelect={voiceSel.setPickerSelection}
                        onPreview={(voice) => voiceSel.preview.play(voice)}
                        onOverrideGender={voiceSel.handleOverrideGender}
                        onConfirm={voiceSel.confirmVoice}
                        onCancel={voiceSel.closeVoicePicker}
                        onVoiceSearch={onVoiceSearch}
                        onReloadVoices={onReloadVoices}
                        previewState={voiceSel.preview.state}
                        t={t}
                        isKo={isKo}
                      />
                    </Modal>
                  )
                })()}
                {/* done 게이트를 걷어냈다 — **일부라도 만들어졌으면 보여야 확인할 수 있다.**
                    "이 화자만 생성"은 설계상 조립을 건너뛰고 done 을 안 찍는다(반쪽 타임라인·manifest 가
                    생기면 안 되므로). done 을 요구하면 그 기능이 영영 타임라인을 못 봐 "나레이터만 먼저
                    확인"이라는 목적 자체가 무너진다. 부분재시도(다른 화자 TTS 실패)도 같다 —
                    실측(무한야담ep02): 나레이터 237개가 잘려 있는데 audio 는 pending 이라 화면이 비었다.
                    export 는 audio.status==='done' 을 따로 요구하므로(readAudioPackage) 미완성 타임라인이
                    결과물로 새지 않는다. hasStoryAudio 가 "만들어진 게 있나"를 판정한다. */}
                {hasStoryAudio && (
                  <div className="story-audio-timeline">
                    <LiveTimeline audioPackage={storyAudioPkg} scenes={[]} srtEntries={storySrtEntries} />
                  </div>
                )}
                <table className="story-readonly-table story-audio-table">
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
                          <td>
                            {(() => {
                              const st = segmentProgress[seg.id] || seg.status || 'pending'
                              return (
                                <span className={`story-status story-status-${st}`}>
                                  {t(`story.status.${st}`, SEG_STATUS_LABEL[st] || SEG_STATUS_LABEL.pending)}
                                </span>
                              )
                            })()}
                          </td>
                          <td className="story-audio-actions-cell">
                            <div className="story-audio-actions">
                              {/* 세그먼트 단건 테스트(배치와 분리) — narration은 TTS, sfx는 sfxFor로 단건 생성.
                                  파일에서 가져오는 화자의 세그먼트엔 안 띄운다: 합성 대상이 아니라 main이
                                  걸러내고 빈 결과를 돌려주므로, 눌러도 소리도 안 나고 알림도 없어 고장난
                                  버튼이 된다. 그 세그먼트는 ⑤가 mp3를 잘라 채운다.
                                  판정은 **화자**로 한다 — main과 같은 기준(isImportProvider). 세그먼트의
                                  src 구간으로 보면 안 된다: 그 필드는 영속되지 않아 renderer엔 절대 안 온다. */}
                              {!isImportSpeaker(seg.speaker) && (
                                <button
                                  type="button"
                                  className="story-seg-btn"
                                  aria-label={t('story.audio.test', `${seg.id} 테스트`, { id: seg.id })}
                                  onClick={() => testSegment(seg.id)}
                                  disabled={isRunning || previewBusy}
                                >
                                  ▶{t('story.audio.testLabel', '테스트')}
                                </button>
                              )}
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
                            </div>
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
            {(promptsPreviewActive || promptsReviewing || promptsReviewRevising) && (
              <StreamingProgressBar
                label={promptsReviewing ? reviewTopProgress : (promptsRevising || promptsReviewRevising) ? promptRevisionProgress : t('story.prompts.running', '프롬프트 생성 중')}
                valueText={promptsReviewing ? reviewTopProgress : (promptsRevising || promptsReviewRevising) ? promptRevisionProgress : promptStreamProgress}
                value={promptsReviewing ? null : promptStreamPercent}
                thinking={promptsReviewing && reviewThinking}
                thinkingText={thinkingText}
              />
            )}
            {/* 생성 중에도 splitScenes가 만든 정식 행은 유지하고, 값만 표시 전용 ghost로 덧칠한다. */}
            {steps.prompts?.status === 'running' && !promptsReviewRun && (
              <>
                {reviewBadge}
                <StoryRunning usage={usage}
                  label={t('story.prompts.running', '프롬프트 생성 중')}
                  startedAt={Date.parse(steps.prompts.updatedAt)}
                  thinking={promptThinking && promptPreviewCount === 0}
                  t={t}
                />
              </>
            )}
            <StreamingTableViewport
              active={promptsPreviewActive}
              step="prompts"
              containerRef={promptsTableRef}
              onScroll={handlePromptsTableScroll}
            >
              <table className="story-readonly-table">
                <thead>
                  <tr>
                    <th>{t('story.prompts.no', '#')}</th>
                    <th>{t('story.prompts.image', '이미지 프롬프트')}</th>
                    <th>{t('story.prompts.video', '비디오 프롬프트')}</th>
                  </tr>
                </thead>
                <tbody>
                  {scenes.map((sc, i) => {
                    const preview = promptsPreviewActive
                      ? previewPrompts[sc.sceneNo]
                      : null
                    const frontier = i === promptFrontierIndex
                    return (
                      <tr
                        key={sc.storyId ?? i}
                        className={promptsRevising && frontier ? 'story-row-revising' : undefined}
                        data-prompt-frontier={frontier ? '' : undefined}
                      >
                        <td>{i + 1}</td>
                        <td>{preview
                          ? <span className="story-prompt-ghost">{preview.imagePrompt}</span>
                          : sc.imagePrompt}</td>
                        <td>{preview
                          ? <span className="story-prompt-ghost">{preview.videoPrompt}</span>
                          : sc.videoPrompt}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </StreamingTableViewport>
            {scenes.length === 0 && (
              <div className="story-empty-hint">{t('story.prompts.empty', '프롬프트 결과가 아직 없습니다.')}</div>
            )}
            {/* 프롬프트는 편집기(카운트 행)가 없다 — 표 밑에 씬 수 + 세션 토큰을 한 줄로 얹는다. */}
            {scenes.length > 0 && (
              <div className="story-prompts-count-row">
                <span className="story-prompts-count">{t('story.prompts.sceneCount', '씬')} {scenes.length}</span>
                <UsageInline usage={usage} />
              </div>
            )}
            {promptsReviewRun && reviewRunning('prompts', promptsProgressLog)}
          </div>
        )}
      </div>

      {/* editor phase는 패널 내 전용 버튼(다시쓰기/이어쓰기/분리시작/설정으로·중단)을 쓴다 —
          하단 제네릭 컨트롤은 editor 밖(setup·scenes/prompts 진행)에서만 렌더.
          F1재검토: scriptPhase가 editor로 남아도 실제로 표시 중인 게 대본 editor가 아니면(재오픈 running →
          displayStep=scenes/prompts) 하단 컨트롤(중단)을 보여야 하므로 "실제 editor 표시 중"을 기준으로 판단.
          슬라이스5(§3.5): synopsis phase에서도 suppress — generic [대본 생성]이 게이트를 우회하지 못하게.
          리서치 spec §3.6(N2): research phase도 동일 suppress — 안 넣으면 게이트 누출 회귀. */}
      {!(displayStep === 'script' && (scriptPhase === 'editor' || scriptPhase === 'synopsis' || scriptPhase === 'research')) && (
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
              // FIX-2: 미확정이면 하류(scenes/audio/prompts) 진행·재실행을 disable — script 액션
              // (시작/대본 생성)은 게이트 전 단계라 허용.
              disabled={isSetupActionView
                ? setupActionDisabled
                : (isRunning || (unconfirmedGate && (redoStep != null || currentStep !== 'script')))}
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
            <button type="button" className="story-btn-secondary" onClick={handleAbort} disabled={aborting}>
              {aborting ? t('story.action.aborting', '⏹ 중단 중…') : t('story.action.abort', '⏹ 중단')}
            </button>
          )}
        </div>
      )}
      {speakerRegenTarget && (
        <SpeakerRegenConfirmModal
          speaker={speakerRegenTarget}
          segmentCount={countSpeakerSegments(speakerRegenTarget)}
          onConfirm={() => { const sp = speakerRegenTarget; setSpeakerRegenTarget(null); runSpeakerAudio(sp, { force: true }) }}
          onCancel={() => setSpeakerRegenTarget(null)}
          confirmDisabled={speakerAudioBusy}
          t={t}
        />
      )}
    </div>
  )
}
