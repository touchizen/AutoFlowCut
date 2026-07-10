const CLAUDE_REASONING_EFFORTS = Object.freeze(['off', 'low', 'medium', 'high', 'max'])
// Fable 5는 thinking이 항상 켜져 있어 끌 수 없다 — 'off'는 효과 없는 선택지라 제외한다.
const FABLE_REASONING_EFFORTS = Object.freeze(['low', 'medium', 'high', 'max'])
// app-server model/list 조회 실패 시의 폴백. 'minimal'은 gpt-5.5/5.4/5.4-mini 어느 것도
// 지원하지 않는다(2026-07-10 model/list 확인) — 고르면 깨지는 값이라 노출하지 않는다.
const CODEX_REASONING_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh'])
const EMPTY_REASONING_EFFORTS = Object.freeze([])

export const STORY_LLM_OPTIONS = Object.freeze([
  Object.freeze({
    id: 'claude:claude-opus-4-8',
    engine: 'claude',
    model: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    reasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: 'off',
  }),
  Object.freeze({
    id: 'claude:claude-sonnet-5',
    engine: 'claude',
    model: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    reasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: 'off',
  }),
  Object.freeze({
    id: 'claude:claude-fable-5',
    engine: 'claude',
    model: 'claude-fable-5',
    label: 'Claude Fable 5',
    reasoningEfforts: FABLE_REASONING_EFFORTS,
    defaultReasoningEffort: 'high',
  }),
  // Haiku 4.5는 4.6 이전 세대라 effort 파라미터를 받지 않는다(다른 Claude 옵션과 유일하게 다른 점).
  // 목록을 비워 두면 normalizeStoryLlmOptions가 reasoningEffort를 지우고 설정 UI도 선택지를 숨긴다.
  Object.freeze({
    id: 'claude:claude-haiku-4-5',
    engine: 'claude',
    model: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    reasoningEfforts: EMPTY_REASONING_EFFORTS,
    defaultReasoningEffort: '',
  }),
  Object.freeze({
    id: 'codex:gpt-5.5',
    engine: 'codex',
    model: 'gpt-5.5',
    label: 'Codex GPT-5.5',
    reasoningEfforts: CODEX_REASONING_EFFORTS,
    defaultReasoningEffort: 'xhigh',
  }),
  Object.freeze({
    id: 'codex:gpt-5.4',
    engine: 'codex',
    model: 'gpt-5.4',
    label: 'Codex GPT-5.4',
    reasoningEfforts: CODEX_REASONING_EFFORTS,
    defaultReasoningEffort: 'high',
  }),
])

export const DEFAULT_STORY_LLM = STORY_LLM_OPTIONS[0]

const STORY_LLM_RUNTIME_CONTROL_KEYS = Object.freeze([
  'workingDirectory',
  'additionalDirectories',
  'skipGitRepoCheck',
  'approvalPolicy',
  'sandboxMode',
  'networkAccessEnabled',
  'webSearchMode',
  'webSearchEnabled',
  'timeoutMs',
  'modelReasoningEffort',
  'codexPathOverride',
  'baseUrl',
  'apiKey',
  'config',
  'env',
  'authCheck',
  'thinking',
  'effort',
  'maxThinkingTokens',
  'max_thinking_tokens',
  'runtimeHomeFactory',
  'workingDirectoryFactory',
  'CodexImpl',
  'runText',
  'runJson',
  'outputSchema',
  'signal',
  // 카탈로그가 결정한다 — 호출측이 넘긴 값은 버린다.
  'resolvedModel',
])

function stripRuntimeControlOptions(options = {}) {
  const normalized = { ...(options || {}) }
  for (const key of STORY_LLM_RUNTIME_CONTROL_KEYS) delete normalized[key]
  return normalized
}

// 동적 카탈로그의 model 은 SDK 호출용 별칭('opus[1m]', 'sonnet')인데 프로젝트에 저장된 건 예전
// 정규 id('claude-opus-4-8')다. resolvedModel 로 이어 준다 — 컨텍스트 태그([1m])와 날짜 접미사
// (-20251001)는 같은 모델을 가리키므로 비교 전에 떼어낸다.
function canonicalModelId(model) {
  return String(model || '')
    .replace(/\[[^\]]*\]$/, '')
    .replace(/-\d{8}$/, '')
}

export function findStoryLlmOption(engine, model, catalog = STORY_LLM_OPTIONS) {
  const exact = catalog.find((o) => o.engine === engine && o.model === model)
  if (exact) return exact
  const wanted = canonicalModelId(model)
  if (!wanted) return null
  // 항목의 정규 id 는 resolvedModel(동적) 또는 model(정적) 이다. 양쪽 다 태그를 떼고 비교한다.
  return catalog.find(
    (o) => o.engine === engine && canonicalModelId(o.resolvedModel || o.model) === wanted,
  ) || null
}

export function findStoryLlmOptionById(id, catalog = STORY_LLM_OPTIONS) {
  return catalog.find((o) => o.id === id) || null
}

// 저장된 model 이 별칭('opus[1m]')인데 지금 카탈로그가 정적 폴백이면 매칭이 깨진다.
// 함께 저장해 둔 정규 id(resolvedModel)로 이어 준다 — 없으면(옛 저장본) 단서가 없다.
function findStoryLlmOptionForOptions(options, catalog) {
  if (!options?.engine) return null
  return findStoryLlmOption(options.engine, options.model, catalog)
    || findStoryLlmOption(options.engine, options.resolvedModel, catalog)
}

export function hydrateStoryLlmSelection(options = {}, catalog = STORY_LLM_OPTIONS) {
  const defaultId = (catalog[0] || DEFAULT_STORY_LLM).id
  if (!options || typeof options !== 'object') return defaultId

  const byExplicit = options.engine && options.model
    ? findStoryLlmOptionForOptions(options, catalog)
    : null
  if (byExplicit) return byExplicit.id

  const model = options.model
  if (typeof model === 'string') {
    const byId = findStoryLlmOptionById(model, catalog)
    if (byId) return byId.id
    if (model.startsWith('claude-')) {
      const byClaudeModel = findStoryLlmOption('claude', model, catalog)
      if (byClaudeModel) return byClaudeModel.id
    }
  }

  return defaultId
}

export function normalizeStoryLlmOptions(options = {}, catalog = STORY_LLM_OPTIONS) {
  if (options.engine && options.model && !findStoryLlmOptionForOptions(options, catalog)) {
    throw new Error(`Unknown Story LLM option: ${options.engine}:${options.model}`)
  }
  const selectionId = hydrateStoryLlmSelection(options, catalog)
  const selected = findStoryLlmOptionById(selectionId, catalog) || catalog[0] || DEFAULT_STORY_LLM
  if (!options.engine && typeof options.model === 'string' && options.model.startsWith('gemini-')) {
    const normalized = stripRuntimeControlOptions(options)
    delete normalized.llmId
    delete normalized.id
    return normalized
  }
  const normalized = { ...stripRuntimeControlOptions(options), engine: selected.engine, model: selected.model }
  // model 이 SDK 별칭('haiku')이면 세대 판별용 정규 id 를 함께 넘긴다(claudeSdk 가 쓴다).
  // 둘이 같은 엔진(codex)에는 아무것도 붙지 않는다.
  if (selected.resolvedModel && selected.resolvedModel !== selected.model) {
    normalized.resolvedModel = selected.resolvedModel
  }
  delete normalized.llmId
  delete normalized.id

  const allowed = selected.reasoningEfforts || []
  if (allowed.length) {
    normalized.reasoningEffort = allowed.includes(options.reasoningEffort)
      ? options.reasoningEffort
      : selected.defaultReasoningEffort
  } else {
    delete normalized.reasoningEffort
  }
  return normalized
}

export default {
  STORY_LLM_OPTIONS,
  DEFAULT_STORY_LLM,
  findStoryLlmOption,
  findStoryLlmOptionById,
  hydrateStoryLlmSelection,
  normalizeStoryLlmOptions,
}
