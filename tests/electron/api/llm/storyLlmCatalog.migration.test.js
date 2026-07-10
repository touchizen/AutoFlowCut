// @vitest-environment node
//
// 카탈로그가 동적(supportedModels())이 되면 model 이 'claude-opus-4-8' → 'opus[1m]' 로 바뀐다.
// 기존 프로젝트 project.json 에는 예전 id 가 박혀 있다. 매칭에 실패하면 사용자가 고른 모델이
// 말없이 첫 옵션으로 리셋된다 — resolvedModel 로 이어줘야 한다.
import { describe, it, expect } from 'vitest'
import {
  findStoryLlmOption,
  hydrateStoryLlmSelection,
  normalizeStoryLlmOptions,
} from '../../../../src/utils/storyLlmCatalog'
import { buildClaudeStoryLlmOptions } from '../../../../electron/api/llm/storyLlmDiscovery'

const DYNAMIC = buildClaudeStoryLlmOptions([
  { value: 'opus[1m]', resolvedModel: 'claude-opus-4-8[1m]', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['low', 'high', 'xhigh'], supportsAdaptiveThinking: true },
  { value: 'claude-fable-5[1m]', resolvedModel: 'claude-fable-5', displayName: 'Fable', supportsEffort: true, supportedEffortLevels: ['low', 'high'], supportsAdaptiveThinking: true },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet', supportsEffort: true, supportedEffortLevels: ['low', 'high'], supportsAdaptiveThinking: true },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku' },
])

const LEGACY = ['claude-opus-4-8', 'claude-sonnet-5', 'claude-fable-5', 'claude-haiku-4-5']

describe('레거시 모델 id → 동적 카탈로그 매칭', () => {
  it.each(LEGACY)('findStoryLlmOption 이 %s 를 찾는다', (model) => {
    expect(findStoryLlmOption('claude', model, DYNAMIC)).toBeTruthy()
  })

  it.each(LEGACY)('%s 는 첫 옵션으로 리셋되지 않는다', (model) => {
    const id = hydrateStoryLlmSelection({ engine: 'claude', model }, DYNAMIC)
    expect(findStoryLlmOption('claude', model, DYNAMIC).id).toBe(id)
  })

  it('claude-sonnet-5 를 고른 프로젝트가 opus 로 바뀌지 않는다', () => {
    const id = hydrateStoryLlmSelection({ engine: 'claude', model: 'claude-sonnet-5' }, DYNAMIC)
    expect(id).toBe('claude:sonnet')
  })

  it('normalizeStoryLlmOptions 가 레거시 id 를 새 value 로 바꿔 준다 (SDK 는 value 를 받는다)', () => {
    const out = normalizeStoryLlmOptions({ engine: 'claude', model: 'claude-opus-4-8' }, DYNAMIC)
    expect(out.model).toBe('opus[1m]')
  })

  it('레거시 id 는 던지지 않는다 (Unknown Story LLM option)', () => {
    expect(() => normalizeStoryLlmOptions({ engine: 'claude', model: 'claude-opus-4-8' }, DYNAMIC)).not.toThrow()
  })

  it('진짜 모르는 모델은 여전히 던진다', () => {
    expect(() => normalizeStoryLlmOptions({ engine: 'claude', model: 'claude-nope-9' }, DYNAMIC)).toThrow(/Unknown Story LLM option/)
  })

  it('정확 일치(value)가 resolvedModel 매칭보다 우선한다', () => {
    expect(findStoryLlmOption('claude', 'sonnet', DYNAMIC).id).toBe('claude:sonnet')
  })

  it('resolvedModel 이 없는 정적 카탈로그에서도 그대로 동작한다', () => {
    const STATIC = [{ id: 'claude:claude-opus-4-8', engine: 'claude', model: 'claude-opus-4-8', reasoningEfforts: [] }]
    expect(findStoryLlmOption('claude', 'claude-opus-4-8', STATIC).id).toBe('claude:claude-opus-4-8')
    expect(findStoryLlmOption('claude', 'sonnet', STATIC)).toBeNull()
  })
})

// buildClaudeSdkOptions 는 세대 판별에 정규 id 가 필요하다. 별칭('haiku')만으론 판별이 안 된다.
// model 과 resolvedModel 이 다를 때만 힌트를 붙인다 — codex 는 둘이 같아 아무것도 안 붙는다.
describe('normalizeStoryLlmOptions — resolvedModel 힌트', () => {
  it('별칭 모델이면 resolvedModel 을 함께 넘긴다', () => {
    const out = normalizeStoryLlmOptions({ engine: 'claude', model: 'claude-haiku-4-5' }, DYNAMIC)
    expect(out.model).toBe('haiku')
    expect(out.resolvedModel).toBe('claude-haiku-4-5-20251001')
  })

  it('model 과 resolvedModel 이 같으면 붙이지 않는다 (codex 경로 오염 방지)', () => {
    const CODEX = [{ id: 'codex:gpt-5.5', engine: 'codex', model: 'gpt-5.5', resolvedModel: 'gpt-5.5', reasoningEfforts: ['high'], defaultReasoningEffort: 'high' }]
    const out = normalizeStoryLlmOptions({ engine: 'codex', model: 'gpt-5.5' }, CODEX)
    expect(out).not.toHaveProperty('resolvedModel')
  })

  it('정적 카탈로그(resolvedModel 없음)에서는 붙이지 않는다', () => {
    const STATIC = [{ id: 'claude:claude-opus-4-8', engine: 'claude', model: 'claude-opus-4-8', reasoningEfforts: [] }]
    expect(normalizeStoryLlmOptions({ engine: 'claude', model: 'claude-opus-4-8' }, STATIC)).not.toHaveProperty('resolvedModel')
  })

  it('호출측이 넘긴 가짜 resolvedModel 은 카탈로그 값으로 덮어쓴다', () => {
    const out = normalizeStoryLlmOptions({ engine: 'claude', model: 'sonnet', resolvedModel: 'claude-opus-4-8' }, DYNAMIC)
    expect(out.resolvedModel).toBe('claude-sonnet-5')
  })
})
