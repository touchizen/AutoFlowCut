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

// 역방향: 동적 실행에서 별칭 model('opus[1m]')이 story.json 에 저장된 뒤, 나중에 조회가 실패해
// 정적 폴백으로 뜨면 매칭이 깨진다 → 렌더러는 첫 옵션으로 조용히 리셋되고, 메인은 예외를 던진다.
// 정규 id 를 함께 저장(resolvedModel)해 이어 준다.
describe('별칭 저장 → 정적 폴백 실행', () => {
  const STATIC = [
    { id: 'claude:claude-opus-4-8', engine: 'claude', model: 'claude-opus-4-8', reasoningEfforts: ['off', 'high'], defaultReasoningEffort: 'off' },
    { id: 'claude:claude-sonnet-5', engine: 'claude', model: 'claude-sonnet-5', reasoningEfforts: ['off', 'high'], defaultReasoningEffort: 'off' },
  ]
  const persisted = { engine: 'claude', model: 'opus[1m]', resolvedModel: 'claude-opus-4-8[1m]', reasoningEffort: 'off' }

  // opus 는 STATIC[0] 이라 기본값 폴백과 구분이 안 된다 — sonnet 케이스가 진짜 판별식이다.
  it('저장된 resolvedModel 로 정적 항목을 찾아낸다', () => {
    expect(findStoryLlmOption('claude', persisted.resolvedModel, STATIC)?.id).toBe('claude:claude-opus-4-8')
    expect(hydrateStoryLlmSelection(persisted, STATIC)).toBe('claude:claude-opus-4-8')
  })

  it('normalize 가 던지지 않고 정적 model 로 바꿔 준다', () => {
    expect(normalizeStoryLlmOptions(persisted, STATIC).model).toBe('claude-opus-4-8')
  })

  it('sonnet 을 골랐으면 opus 로 바뀌지 않는다', () => {
    const p = { engine: 'claude', model: 'sonnet', resolvedModel: 'claude-sonnet-5' }
    expect(hydrateStoryLlmSelection(p, STATIC)).toBe('claude:claude-sonnet-5')
  })

  // resolvedModel 없이 별칭만 저장된 옛 프로젝트는 이어 줄 단서가 없다. throw 는
  // "조용히 다른 프로바이더로 갈아타지 않는다"는 계약이라 유지한다 — 조용한 오작동보다 낫다.
  it('resolvedModel 이 없는 옛 저장본은 큰 소리로 실패한다 (조용한 프로바이더 전환 금지)', () => {
    const legacy = { engine: 'claude', model: 'opus[1m]' }
    expect(() => normalizeStoryLlmOptions(legacy, STATIC)).toThrow(/Unknown Story LLM option/)
  })

  it('진짜 모르는 모델은 여전히 던진다', () => {
    expect(() => normalizeStoryLlmOptions({ engine: 'claude', model: 'claude-nope-9' }, STATIC)).toThrow(/Unknown Story LLM option/)
  })
})

// 두 항목이 같은 정규 id 로 접힐 수 있다(opus 200k vs opus[1m]). 정규화 매칭이 먼저 걸리면
// 컨텍스트 윈도가 다른 모델을 조용히 고른다 — 정확 일치를 항상 우선해야 한다.
describe('정규화 충돌', () => {
  const COLLIDING = [
    { id: 'claude:opus', engine: 'claude', model: 'opus', resolvedModel: 'claude-opus-4-8', reasoningEfforts: [], defaultReasoningEffort: '' },
    { id: 'claude:opus[1m]', engine: 'claude', model: 'opus[1m]', resolvedModel: 'claude-opus-4-8[1m]', reasoningEfforts: [], defaultReasoningEffort: '' },
  ]

  it('저장된 resolvedModel 과 정확히 일치하는 항목을 고른다', () => {
    expect(findStoryLlmOption('claude', 'claude-opus-4-8[1m]', COLLIDING).id).toBe('claude:opus[1m]')
    expect(findStoryLlmOption('claude', 'claude-opus-4-8', COLLIDING).id).toBe('claude:opus')
  })

  it('hydrate 도 1m 프로젝트를 200k 로 강등하지 않는다', () => {
    const p = { engine: 'claude', model: 'opus[1m]', resolvedModel: 'claude-opus-4-8[1m]' }
    expect(hydrateStoryLlmSelection(p, COLLIDING)).toBe('claude:opus[1m]')
  })

  it('정확 일치가 없을 때만 정규화로 떨어진다', () => {
    expect(findStoryLlmOption('claude', 'claude-opus-4-8-20260101', COLLIDING).id).toBe('claude:opus')
  })
})
