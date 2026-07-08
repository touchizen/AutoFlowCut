const CLAUDE_REASONING_EFFORTS = Object.freeze(['off', 'low', 'medium', 'high', 'max'])
const CODEX_REASONING_EFFORTS = Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh'])

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
    label: 'Fable 5',
    reasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: 'off',
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
])

function stripRuntimeControlOptions(options = {}) {
  const normalized = { ...(options || {}) }
  for (const key of STORY_LLM_RUNTIME_CONTROL_KEYS) delete normalized[key]
  return normalized
}

export function findStoryLlmOption(engine, model, catalog = STORY_LLM_OPTIONS) {
  return catalog.find((o) => o.engine === engine && o.model === model) || null
}

export function findStoryLlmOptionById(id, catalog = STORY_LLM_OPTIONS) {
  return catalog.find((o) => o.id === id) || null
}

export function hydrateStoryLlmSelection(options = {}, catalog = STORY_LLM_OPTIONS) {
  const defaultId = (catalog[0] || DEFAULT_STORY_LLM).id
  if (!options || typeof options !== 'object') return defaultId

  const byExplicit = options.engine && options.model
    ? findStoryLlmOption(options.engine, options.model, catalog)
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
  if (options.engine && options.model && !findStoryLlmOption(options.engine, options.model, catalog)) {
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
