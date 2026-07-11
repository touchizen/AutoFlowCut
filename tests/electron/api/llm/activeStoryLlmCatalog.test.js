// @vitest-environment node
//
// 렌더러는 동적 카탈로그의 model('sonnet')을 보내는데 메인의 라우터/스텝머신이 정적 카탈로그로
// 검증하면 "Unknown Story LLM option"으로 던진다. 메인 전체가 같은 활성 카탈로그를 봐야 한다.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  STORY_LLM_OPTIONS,
  setActiveStoryLlmCatalog,
  getActiveStoryLlmCatalog,
  normalizeActiveStoryLlmOptions,
} from '../../../../electron/api/llm/storyLlmCatalog'

const DYNAMIC = [
  { id: 'claude:sonnet', engine: 'claude', model: 'sonnet', resolvedModel: 'claude-sonnet-5', reasoningEfforts: ['off', 'high'], defaultReasoningEffort: 'off' },
  { id: 'claude:haiku', engine: 'claude', model: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', reasoningEfforts: [], defaultReasoningEffort: '' },
]

describe('활성 story LLM 카탈로그', () => {
  beforeEach(() => setActiveStoryLlmCatalog(null))

  it('기본값은 정적 카탈로그', () => {
    expect(getActiveStoryLlmCatalog()).toBe(STORY_LLM_OPTIONS)
  })

  it('설정하면 그 카탈로그로 검증한다', () => {
    setActiveStoryLlmCatalog(DYNAMIC)
    expect(normalizeActiveStoryLlmOptions({ engine: 'claude', model: 'sonnet' }).model).toBe('sonnet')
  })

  it('동적 카탈로그에서도 레거시 id 가 통한다', () => {
    setActiveStoryLlmCatalog(DYNAMIC)
    expect(normalizeActiveStoryLlmOptions({ engine: 'claude', model: 'claude-sonnet-5' }).model).toBe('sonnet')
  })

  it('별칭 모델엔 resolvedModel 힌트가 붙는다', () => {
    setActiveStoryLlmCatalog(DYNAMIC)
    expect(normalizeActiveStoryLlmOptions({ engine: 'claude', model: 'haiku' }).resolvedModel)
      .toBe('claude-haiku-4-5-20251001')
  })

  it('비었거나 배열이 아니면 정적으로 되돌린다 (빈 카탈로그로 앱을 못 쓰게 만들지 않는다)', () => {
    setActiveStoryLlmCatalog([])
    expect(getActiveStoryLlmCatalog()).toBe(STORY_LLM_OPTIONS)
    setActiveStoryLlmCatalog('nope')
    expect(getActiveStoryLlmCatalog()).toBe(STORY_LLM_OPTIONS)
  })

  it('정적으로 되돌린 뒤엔 정적 모델 id 로 검증한다', () => {
    setActiveStoryLlmCatalog(DYNAMIC)
    setActiveStoryLlmCatalog(null)
    expect(normalizeActiveStoryLlmOptions({ engine: 'claude', model: 'claude-opus-4-8' }).model).toBe('claude-opus-4-8')
  })

  it('gemini 모델은 카탈로그와 무관하게 통과한다', () => {
    setActiveStoryLlmCatalog(DYNAMIC)
    expect(normalizeActiveStoryLlmOptions({ model: 'gemini-2.5-flash' }).model).toBe('gemini-2.5-flash')
  })
})
