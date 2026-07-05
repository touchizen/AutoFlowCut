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
      'codex:gpt-5.5',
      'codex:gpt-5.4',
    ])
    expect(new Set(STORY_LLM_OPTIONS.map((o) => o.id)).size).toBe(STORY_LLM_OPTIONS.length)
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
      reasoningEffort: 'xhigh',
      language: 'ko',
    })
    expect(normalizeStoryLlmOptions({ engine: 'codex', model: 'gpt-5.4', reasoningEffort: 'minimal' })).toMatchObject({
      engine: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'minimal',
    })
    expect(normalizeStoryLlmOptions({ engine: 'codex', model: 'gpt-5.4', reasoningEffort: 'ultra' })).toMatchObject({
      engine: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
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
      reasoningEffort: 'xhigh',
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
