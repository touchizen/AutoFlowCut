/**
 * storyViewUtils — StoryView의 순수 헬퍼/상수 모음.
 *
 * StoryView.jsx가 너무 커서(§ componentization) React·prop에 의존하지 않는 순수 로직을
 * 여기로 분리했다. 동작 변경 없음 — 기존 StoryView 내부 정의를 그대로 옮긴 것이다.
 */

// M2a-3: audio가 파이프라인 1급 스텝 — script→scenes→audio→prompts 순서로 진행한다.
export const PROGRESSABLE_STEPS = ['script', 'scenes', 'audio', 'prompts']

export const DEFAULT_STORY_LENGTH_MINUTES = 10
export const MAX_STORY_LENGTH_MINUTES = 60
export const KOREAN_CHARS_PER_MINUTE = 330
export const ENGLISH_WORDS_PER_MINUTE = 150
export const STORY_LENGTH_MODE_UNIT = 'unit'
export const STORY_LENGTH_UNITS = {
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

export function storyLengthUnitsForLanguage(language) {
  return language === 'en' ? STORY_LENGTH_UNITS.en : STORY_LENGTH_UNITS.ko
}

export function storyLengthFactor(unit) {
  if (unit === 'chars') return KOREAN_CHARS_PER_MINUTE
  if (unit === 'words') return ENGLISH_WORDS_PER_MINUTE
  return 1
}

export function coerceStoryLengthUnit(unit, language) {
  const allowed = storyLengthUnitsForLanguage(language).map((option) => option.value)
  if (allowed.includes(unit)) return unit
  if (unit === 'words') return 'chars'
  return 'min'
}

export function normalizeStoryLengthValue(value, unit = 'min') {
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

export function formatStoryLengthValue(value) {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(4).replace(/\.?0+$/, '')
}

export function convertStoryLengthValue(value, fromUnit, toUnit) {
  const normalized = Number(normalizeStoryLengthValue(value, fromUnit))
  const minutes = Math.min(MAX_STORY_LENGTH_MINUTES, normalized / storyLengthFactor(fromUnit))
  return normalizeStoryLengthValue(minutes * storyLengthFactor(toUnit), toUnit)
}

export function hydrateStoryLengthSettings(options = {}, language = 'ko') {
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

export function storyLengthOptionValues(unit) {
  const factor = storyLengthFactor(unit)
  return Array.from({ length: MAX_STORY_LENGTH_MINUTES }, (_, i) => String((i + 1) * factor))
}

export function storyLengthOptionLabel(value, unit, language) {
  if (unit === 'min') return language === 'en' ? `${value} min` : `${value}분`
  if (unit === 'words') return `${value} words`
  return language === 'en' ? `${value} chars` : `${value}자`
}

export function storyLengthPlaceholder(unit, language) {
  if (unit === 'min') return language === 'en' ? 'min' : '분'
  if (unit === 'words') return 'words'
  return language === 'en' ? 'chars' : '자수'
}

export function reasoningEffortFor(option, requestedReasoning = null) {
  const allowed = option?.reasoningEfforts || []
  if (!allowed.length) return ''
  return allowed.includes(requestedReasoning)
    ? requestedReasoning
    : (option.defaultReasoningEffort || allowed[0] || '')
}

export const REVIEW_TARGET_LABEL = { script: '시나리오', scenes: '씬', prompts: '프롬프트' }
export const REVIEW_TARGET_ORDER = ['script', 'scenes', 'prompts']

export function defaultReviewRounds(target, model) {
  if (target === 'script') return String(model || '').startsWith('claude') ? 3 : 1
  return 1
}

export function clampReviewRounds(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(5, Math.floor(n)))
}

export function formatProgressLogTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function computeCurrentStep(steps) {
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

export function stableSnapshot(value) {
  if (Array.isArray(value)) return value.map(stableSnapshot)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((acc, key) => {
    const next = stableSnapshot(value[key])
    if (next !== undefined) acc[key] = next
    return acc
  }, {})
}

export function stableJson(value) {
  return JSON.stringify(stableSnapshot(value))
}

export function interpolateFallback(value, params = {}) {
  return String(value).replace(/\{(\w+)\}/g, (match, key) => (
    params[key] !== undefined ? params[key] : match
  ))
}

// 저장된 성우 id가 길면(ElevenLabs shared voice 해시 등) "미로드" 라벨에 그대로 붙이기엔
// 너무 길어서 표시용으로만 줄인다.
export function shortVoiceId(id) {
  if (!id) return id
  return id.length > 12 ? `${id.slice(0, 10)}…` : id
}

// 이야기 유형(genre) — 프로젝트 출력 언어별 노출 옵션. yadam은 한국 야담(ko 전용), dark-history
// 가이드는 영어권(en 전용), bespoke는 언어별 공용(bespoke/<lang>). 값은 백엔드 프롬프트 키
// (metaPrompts.W3_FILES)와 반드시 일치해야 하므로 고정 — 라벨만 i18n한다.
const GENRE_BY_LANG = Object.freeze({
  ko: ['yadam', 'bespoke'],
  en: ['dark-history', 'bespoke'],
})
export function genresForLanguage(language) {
  return GENRE_BY_LANG[language] || GENRE_BY_LANG.en
}
// genre 값(하이픈 포함) → i18n 키 세그먼트 + 한국어 폴백(useSafeT 폴백 정책).
const GENRE_I18N_KEY = Object.freeze({ yadam: 'yadam', 'dark-history': 'darkHistory', bespoke: 'bespoke' })
const GENRE_FALLBACK = Object.freeze({ yadam: '야담', 'dark-history': '다크 히스토리', bespoke: '맞춤형' })
export function genreLabel(g, t) {
  return t(`story.form.genre.${GENRE_I18N_KEY[g] || g}`, GENRE_FALLBACK[g] || g)
}
