import { describe, it, expect, vi } from 'vitest'
import { createStoryLlmRouter } from '../../../../electron/api/llm/storyLlmRouter.js'
import * as llmClaude from '../../../../electron/api/llm/llmClaude.js'
import * as llmCodex from '../../../../electron/api/llm/llmCodex.js'

function adapters() {
  return {
    claude: {
      generateScript: vi.fn(async () => ({ scriptMd: 'claude script' })),
      splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
      writePrompts: vi.fn(async (scenes) => ({ scenes })),
      generateTitle: vi.fn(async () => ({ title: 'claude title' })),
      continueScript: vi.fn(async () => ({ scriptMd: 'claude continued' })),
      reviewScript: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
      reviseScript: vi.fn(async () => ({ scriptMd: 'claude revised' })),
      reviewSynopsis: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
      reviseSynopsis: vi.fn(async () => ({ synopsisMd: 'claude revised synopsis', characters: [] })),
      reviewScenes: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
      reviseScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
      reviewPrompts: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
      revisePrompts: vi.fn(async (scenes) => ({ scenes })),
      generateSynopsis: vi.fn(async () => ({ synopsisMd: 'claude synopsis', characters: [] })),
      analyzeResearch: vi.fn(async () => ({ structure: [], claims: [{ claim: 'claude claim', sources: [] }], commonThemes: [] })),
    },
    codex: {
      generateScript: vi.fn(async () => ({ scriptMd: 'codex script' })),
      splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
      writePrompts: vi.fn(async (scenes) => ({ scenes })),
      generateTitle: vi.fn(async () => ({ title: 'codex title' })),
      continueScript: vi.fn(async () => ({ scriptMd: 'codex continued' })),
      reviewScript: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
      reviseScript: vi.fn(async () => ({ scriptMd: 'codex revised' })),
      reviewSynopsis: vi.fn(async () => ({ verdict: 'revise', critique: 'codex synopsis fix' })),
      reviseSynopsis: vi.fn(async () => ({ synopsisMd: 'codex revised synopsis', characters: [{ name: '보라' }] })),
      reviewScenes: vi.fn(async () => ({ verdict: 'revise', critique: 'codex scene fix' })),
      reviseScenes: vi.fn(async () => ({ scenes: [{ sceneNo: 1 }], speakers: [] })),
      reviewPrompts: vi.fn(async () => ({ verdict: 'revise', critique: 'codex prompt fix' })),
      revisePrompts: vi.fn(async (scenes) => ({ scenes })),
      generateSynopsis: vi.fn(async () => ({ synopsisMd: 'codex synopsis', characters: [{ id: '강리안', name: '강리안' }] })),
      analyzeResearch: vi.fn(async () => ({ structure: [], claims: [{ claim: 'codex claim', sources: [] }], commonThemes: [] })),
    },
  }
}

describe('storyLlmRouter', () => {
  it('engine이 없으면 Claude adapter로 라우팅한다', async () => {
    const a = adapters()
    const router = createStoryLlmRouter(a)
    const r = await router.generateScript({ title: 'T' }, { model: 'claude-opus-4-8' }, {})
    expect(r).toEqual({ scriptMd: 'claude script' })
    expect(a.claude.generateScript).toHaveBeenCalledWith({ title: 'T' }, expect.objectContaining({ engine: 'claude', model: 'claude-opus-4-8' }), {})
    expect(a.codex.generateScript).not.toHaveBeenCalled()
  })

  it('engine=codex면 Codex adapter로 라우팅하고 reasoningEffort를 보존한다', async () => {
    const a = adapters()
    const router = createStoryLlmRouter(a)
    const opts = { engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' }
    const r = await router.generateTitle('대본', opts, { signal: 's' })
    expect(r).toEqual({ title: 'codex title' })
    expect(a.codex.generateTitle).toHaveBeenCalledWith('대본', opts, { signal: 's' })
    expect(a.claude.generateTitle).not.toHaveBeenCalled()
  })

  it('선택된 adapter에 메서드가 없으면 명시적으로 실패한다', async () => {
    const a = adapters()
    delete a.codex.reviewScript
    const router = createStoryLlmRouter(a)
    await expect(router.reviewScript('대본', { engine: 'codex', model: 'gpt-5.5' }, {}))
      .rejects.toThrow(/does not implement reviewScript/)
  })

  it('새 review 메서드들의 옵션 인덱스를 유지하고 Codex로 라우팅한다', async () => {
    const a = adapters()
    const router = createStoryLlmRouter(a)
    const opts = { engine: 'codex', model: 'gpt-5.4', reasoningEffort: 'high' }
    await expect(router.reviewScenes('SCRIPT', [], [], opts, { signal: 's' })).resolves.toEqual({ verdict: 'revise', critique: 'codex scene fix' })
    await expect(router.reviseScenes('SCRIPT', [], [], 'fix', opts, { signal: 's' })).resolves.toEqual({ scenes: [{ sceneNo: 1 }], speakers: [] })
    await expect(router.reviewPrompts([], {}, opts, { signal: 's' })).resolves.toEqual({ verdict: 'revise', critique: 'codex prompt fix' })
    await expect(router.revisePrompts([], {}, 'fix', opts, { signal: 's' })).resolves.toEqual({ scenes: [] })
    expect(a.codex.reviewScenes).toHaveBeenCalledWith('SCRIPT', [], [], expect.objectContaining({ engine: 'codex', model: 'gpt-5.4', reasoningEffort: 'high' }), { signal: 's' })
    expect(a.codex.reviseScenes).toHaveBeenCalledWith('SCRIPT', [], [], 'fix', expect.objectContaining({ engine: 'codex', model: 'gpt-5.4', reasoningEffort: 'high' }), { signal: 's' })
    expect(a.codex.reviewPrompts).toHaveBeenCalledWith([], {}, expect.objectContaining({ engine: 'codex', model: 'gpt-5.4', reasoningEffort: 'high' }), { signal: 's' })
    expect(a.codex.revisePrompts).toHaveBeenCalledWith([], {}, 'fix', expect.objectContaining({ engine: 'codex', model: 'gpt-5.4', reasoningEffort: 'high' }), { signal: 's' })
    expect(a.claude.reviewScenes).not.toHaveBeenCalled()
  })

  it('reviewSynopsis(opts index 2) / reviseSynopsis(opts index 3)를 engine 기준으로 라우팅한다', async () => {
    const a = adapters()
    const router = createStoryLlmRouter(a)
    const chars = [{ name: '강리안' }]
    const opts = { engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' }

    await expect(router.reviewSynopsis('SYN', chars, opts, { signal: 's' }))
      .resolves.toEqual({ verdict: 'revise', critique: 'codex synopsis fix' })
    await expect(router.reviseSynopsis('SYN', chars, 'fix', opts, { signal: 's' }))
      .resolves.toEqual({ synopsisMd: 'codex revised synopsis', characters: [{ name: '보라' }] })

    expect(a.codex.reviewSynopsis).toHaveBeenCalledWith('SYN', chars, expect.objectContaining({ engine: 'codex', model: 'gpt-5.5' }), { signal: 's' })
    expect(a.codex.reviseSynopsis).toHaveBeenCalledWith('SYN', chars, 'fix', expect.objectContaining({ engine: 'codex', model: 'gpt-5.5' }), { signal: 's' })
    expect(a.claude.reviewSynopsis).not.toHaveBeenCalled()
    expect(a.claude.reviseSynopsis).not.toHaveBeenCalled()
  })

  it('engine 미지정 시 reviewSynopsis/reviseSynopsis는 Claude로 라우팅한다', async () => {
    const a = adapters()
    const router = createStoryLlmRouter(a)
    await router.reviewSynopsis('SYN', [], { model: 'claude-opus-4-8' }, {})
    await router.reviseSynopsis('SYN', [], 'fix', { model: 'claude-opus-4-8' }, {})
    expect(a.claude.reviewSynopsis).toHaveBeenCalled()
    expect(a.claude.reviseSynopsis).toHaveBeenCalled()
    expect(a.codex.reviewSynopsis).not.toHaveBeenCalled()
  })

  it('reviewSynopsis 미구현 adapter는 명확한 에러로 실패한다', async () => {
    const a = adapters()
    delete a.codex.reviewSynopsis
    const router = createStoryLlmRouter(a)
    await expect(router.reviewSynopsis('SYN', [], { engine: 'codex', model: 'gpt-5.5' }, {}))
      .rejects.toThrow(/does not implement reviewSynopsis/)
  })

  it('generateSynopsis를 노출하고 opts(index 1) 기준으로 engine dispatch한다', async () => {
    const a = adapters()
    const router = createStoryLlmRouter(a)
    const ctx = { onDelta: vi.fn(), signal: 's' }

    const r1 = await router.generateSynopsis({ type: 'title', title: 'T' }, { model: 'claude-opus-4-8' }, ctx)
    expect(r1).toEqual({ synopsisMd: 'claude synopsis', characters: [] })
    expect(a.claude.generateSynopsis).toHaveBeenCalledWith(
      { type: 'title', title: 'T' },
      expect.objectContaining({ engine: 'claude', model: 'claude-opus-4-8' }),
      ctx,
    )
    expect(a.codex.generateSynopsis).not.toHaveBeenCalled()

    const r2 = await router.generateSynopsis({ type: 'pasted', pastedScript: 'S' }, { engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' }, ctx)
    expect(r2).toEqual({ synopsisMd: 'codex synopsis', characters: [{ id: '강리안', name: '강리안' }] })
    expect(a.codex.generateSynopsis).toHaveBeenCalledWith(
      { type: 'pasted', pastedScript: 'S' },
      expect.objectContaining({ engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' }),
      ctx,
    )
  })

  it('generateSynopsis 미구현 adapter는 명확한 에러로 실패한다', async () => {
    const a = adapters()
    delete a.codex.generateSynopsis
    const router = createStoryLlmRouter(a)
    await expect(router.generateSynopsis({ type: 'title', title: 'T' }, { engine: 'codex', model: 'gpt-5.5' }, {}))
      .rejects.toThrow(/does not implement generateSynopsis/)
  })

  it('analyzeResearch를 노출하고 opts(index 1) 기준으로 engine dispatch한다 (D10)', async () => {
    const a = adapters()
    const router = createStoryLlmRouter(a)
    const ctx = { signal: 's' }

    const r1 = await router.analyzeResearch([{ videoId: 'v1', plainText: 'T' }], { model: 'claude-opus-4-8' }, ctx)
    expect(r1.claims[0].claim).toBe('claude claim')
    expect(a.claude.analyzeResearch).toHaveBeenCalledWith(
      [{ videoId: 'v1', plainText: 'T' }],
      expect.objectContaining({ engine: 'claude', model: 'claude-opus-4-8' }),
      ctx,
    )

    const r2 = await router.analyzeResearch([{ videoId: 'v1', plainText: 'T' }], { engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' }, ctx)
    expect(r2.claims[0].claim).toBe('codex claim')
    expect(a.codex.analyzeResearch).toHaveBeenCalledWith(
      [{ videoId: 'v1', plainText: 'T' }],
      expect.objectContaining({ engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high' }),
      ctx,
    )
  })

  it('analyzeResearch 미구현 adapter는 명확한 에러로 실패한다 (N1)', async () => {
    const a = adapters()
    delete a.codex.analyzeResearch
    const router = createStoryLlmRouter(a)
    await expect(router.analyzeResearch([], { engine: 'codex', model: 'gpt-5.5' }, {}))
      .rejects.toThrow(/does not implement analyzeResearch/)
  })

  it('실제 두 어댑터 모두 analyzeResearch를 구현한다 (N1 회귀)', () => {
    expect(typeof llmClaude.analyzeResearch).toBe('function')
    expect(typeof llmCodex.analyzeResearch).toBe('function')
  })

  it('M1: factCheckClaims는 라우터에 노출하지 않는다 (라우터 우회 — Claude 직접 호출)', () => {
    const router = createStoryLlmRouter(adapters())
    expect(router.factCheckClaims).toBeUndefined()
  })

  it('알 수 없는 explicit Codex 모델은 Claude로 fallback하지 않고 실패한다', async () => {
    const a = adapters()
    const router = createStoryLlmRouter(a)
    await expect(router.generateTitle('대본', { engine: 'codex', model: 'gpt-9' }, {}))
      .rejects.toThrow(/Unknown Story LLM option/)
    expect(a.claude.generateTitle).not.toHaveBeenCalled()
  })
})
