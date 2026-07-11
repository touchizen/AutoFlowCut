import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STORY_LLM,
  STORY_LLM_OPTIONS,
  findStoryLlmOption,
  findStoryLlmOptionById,
  hydrateStoryLlmSelection,
  normalizeStoryLlmOptions,
} from '../../../../electron/api/llm/storyLlmCatalog.js'

describe('storyLlmCatalog', () => {
  it('contains the initial Claude and Codex Story engines with stable ids', () => {
    expect(STORY_LLM_OPTIONS.map((o) => o.id)).toEqual([
      'claude:claude-opus-4-8',
      'claude:claude-sonnet-5',
      'claude:claude-fable-5',
      'claude:claude-haiku-4-5',
      'codex:gpt-5.5',
      'codex:gpt-5.4',
    ])
    expect(new Set(STORY_LLM_OPTIONS.map((o) => o.id)).size).toBe(STORY_LLM_OPTIONS.length)
  })

  it('Claude 옵션 라벨은 모두 "Claude"로 시작한다', () => {
    const claudeLabels = STORY_LLM_OPTIONS.filter((o) => o.engine === 'claude').map((o) => o.label)
    expect(claudeLabels).toEqual(['Claude Opus 4.8', 'Claude Sonnet 5', 'Claude Fable 5', 'Claude Haiku 4.5'])
  })

  // Haiku 4.5는 effort 파라미터를 지원하지 않는다(다른 Claude 모델과 달리 4.6 이전 세대).
  // reasoningEfforts를 비우면 normalizeStoryLlmOptions가 reasoningEffort를 아예 제거하고,
  // buildClaudeSdkOptions는 effort를 싣지 않는다.
  // Fable 5는 thinking을 끌 수 없다 — 'off'는 고를 수 있어도 아무 효과가 없는(그리고 API가 거부하는)
  // 선택지다. 목록에서 빼서 UI가 도달 불가능한 상태를 제시하지 않게 한다.
  it('Claude Fable 5는 off를 제공하지 않는다 (thinking을 끌 수 없다)', () => {
    const fable = findStoryLlmOptionById('claude:claude-fable-5')
    expect(fable.reasoningEfforts).toEqual(['low', 'medium', 'high', 'max'])
    expect(fable.defaultReasoningEffort).toBe('high')
  })

  it('저장돼 있던 Fable 5 + off는 기본값으로 승격된다', () => {
    const out = normalizeStoryLlmOptions({ engine: 'claude', model: 'claude-fable-5', reasoningEffort: 'off' })
    expect(out.reasoningEffort).toBe('high')
  })

  it('Claude Haiku 4.5는 effort 선택지를 노출하지 않는다', () => {
    const haiku = findStoryLlmOptionById('claude:claude-haiku-4-5')
    expect(haiku).toMatchObject({ engine: 'claude', model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' })
    expect(haiku.reasoningEfforts).toEqual([])
  })

  it('Haiku 4.5를 고르면 normalize가 reasoningEffort를 지운다', () => {
    const out = normalizeStoryLlmOptions({ engine: 'claude', model: 'claude-haiku-4-5', reasoningEffort: 'high' })
    expect(out).toMatchObject({ engine: 'claude', model: 'claude-haiku-4-5' })
    expect('reasoningEffort' in out).toBe(false)
  })

  it('Haiku 4.5도 id/engine+model 양쪽으로 hydrate된다', () => {
    expect(hydrateStoryLlmSelection({ model: 'claude:claude-haiku-4-5' })).toBe('claude:claude-haiku-4-5')
    expect(hydrateStoryLlmSelection({ engine: 'claude', model: 'claude-haiku-4-5' })).toBe('claude:claude-haiku-4-5')
  })

  it('keeps Claude Opus 4.8 as the compatibility default', () => {
    expect(DEFAULT_STORY_LLM).toMatchObject({
      id: 'claude:claude-opus-4-8',
      engine: 'claude',
      model: 'claude-opus-4-8',
      reasoningEfforts: ['off', 'low', 'medium', 'high', 'max'],
      defaultReasoningEffort: 'off',
    })
  })

  it('finds options by engine/model and id', () => {
    expect(findStoryLlmOption('codex', 'gpt-5.5')?.id).toBe('codex:gpt-5.5')
    expect(findStoryLlmOptionById('claude:claude-sonnet-5')?.model).toBe('claude-sonnet-5')
    expect(findStoryLlmOption('missing', 'x')).toBeNull()
    expect(findStoryLlmOptionById('missing:x')).toBeNull()
  })

  it('hydrates old model-only Claude state', () => {
    expect(hydrateStoryLlmSelection({ model: 'claude-sonnet-5' })).toBe('claude:claude-sonnet-5')
    expect(hydrateStoryLlmSelection({ model: 'claude-opus-4-8' })).toBe('claude:claude-opus-4-8')
  })

  it('hydrates new Codex state and invalid values safely', () => {
    expect(hydrateStoryLlmSelection({ engine: 'codex', model: 'gpt-5.5' })).toBe('codex:gpt-5.5')
    expect(hydrateStoryLlmSelection({ model: 'codex:gpt-5.4' })).toBe('codex:gpt-5.4')
    expect(hydrateStoryLlmSelection({ engine: 'codex', model: 'unknown' })).toBe(DEFAULT_STORY_LLM.id)
    expect(hydrateStoryLlmSelection({ model: 'gpt-5.5' })).toBe(DEFAULT_STORY_LLM.id)
  })

  it('normalizes Codex options with default/validated reasoning effort', () => {
    expect(normalizeStoryLlmOptions({ engine: 'codex', model: 'gpt-5.5', language: 'ko' })).toMatchObject({
      engine: 'codex',
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
      language: 'ko',
    })
    // 'minimal'은 어떤 codex 모델도 지원하지 않는다(model/list) — 이제 무효값이라 기본값으로 떨어진다.
    expect(normalizeStoryLlmOptions({ engine: 'codex', model: 'gpt-5.4', reasoningEffort: 'minimal' })).toMatchObject({
      engine: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
    })
    expect(normalizeStoryLlmOptions({ engine: 'codex', model: 'gpt-5.4', reasoningEffort: 'ultra' })).toMatchObject({
      engine: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
    })
  })

  it('strips SDK/runtime control fields from renderer options', () => {
    expect(normalizeStoryLlmOptions({
      engine: 'codex',
      model: 'gpt-5.5',
      language: 'ko',
      workingDirectory: '/tmp/hijack',
      sandboxMode: 'danger-full-access',
      networkAccessEnabled: true,
      webSearchMode: 'live',
      timeoutMs: 1,
      config: { mcp_servers: { local: {} } },
      env: { OPENAI_API_KEY: 'x' },
      apiKey: 'x',
      thinking: { type: 'enabled', budgetTokens: 20000 },
      effort: 'max',
      maxThinkingTokens: 20000,
      max_thinking_tokens: 20000,
    })).toEqual({
      engine: 'codex',
      model: 'gpt-5.5',
      language: 'ko',
      reasoningEffort: 'medium',
    })
  })

  it('normalizes Claude options with default/validated reasoning effort', () => {
    expect(normalizeStoryLlmOptions({ model: 'claude-sonnet-5', reasoningEffort: 'high', genre: 'yadam' })).toEqual({
      engine: 'claude',
      model: 'claude-sonnet-5',
      reasoningEffort: 'high',
      genre: 'yadam',
    })
    expect(normalizeStoryLlmOptions({ model: 'claude-sonnet-5', reasoningEffort: 'xhigh', genre: 'yadam' })).toMatchObject({
      engine: 'claude',
      model: 'claude-sonnet-5',
      reasoningEffort: 'off',
    })
    expect(normalizeStoryLlmOptions({ model: 'claude-opus-4-8', genre: 'yadam' })).toMatchObject({
      engine: 'claude',
      model: 'claude-opus-4-8',
      reasoningEffort: 'off',
    })
    expect(normalizeStoryLlmOptions({
      model: 'claude-sonnet-5',
      reasoningEffort: 'low',
      thinking: { type: 'enabled', budgetTokens: 20000 },
      effort: 'max',
      maxThinkingTokens: 20000,
      max_thinking_tokens: 20000,
    })).toEqual({
      engine: 'claude',
      model: 'claude-sonnet-5',
      reasoningEffort: 'low',
    })
  })

  it('preserves legacy Gemini model-only options for compatibility', () => {
    expect(normalizeStoryLlmOptions({ model: 'gemini-2.5-pro', reviewLoop: true })).toEqual({
      model: 'gemini-2.5-pro',
      reviewLoop: true,
    })
  })

  it('throws for unknown explicit engine/model instead of switching providers', () => {
    expect(() => normalizeStoryLlmOptions({ engine: 'codex', model: 'gpt-9' }))
      .toThrow(/Unknown Story LLM option/)
    expect(() => normalizeStoryLlmOptions({ engine: 'missing', model: 'x' }))
      .toThrow(/Unknown Story LLM option/)
  })
})
