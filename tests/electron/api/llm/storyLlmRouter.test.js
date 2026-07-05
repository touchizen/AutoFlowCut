import { describe, it, expect, vi } from 'vitest'
import { createStoryLlmRouter } from '../../../../electron/api/llm/storyLlmRouter.js'

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
    },
    codex: {
      generateScript: vi.fn(async () => ({ scriptMd: 'codex script' })),
      splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
      writePrompts: vi.fn(async (scenes) => ({ scenes })),
      generateTitle: vi.fn(async () => ({ title: 'codex title' })),
      continueScript: vi.fn(async () => ({ scriptMd: 'codex continued' })),
      reviewScript: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
      reviseScript: vi.fn(async () => ({ scriptMd: 'codex revised' })),
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

  it('알 수 없는 explicit Codex 모델은 Claude로 fallback하지 않고 실패한다', async () => {
    const a = adapters()
    const router = createStoryLlmRouter(a)
    await expect(router.generateTitle('대본', { engine: 'codex', model: 'gpt-9' }, {}))
      .rejects.toThrow(/Unknown Story LLM option/)
    expect(a.claude.generateTitle).not.toHaveBeenCalled()
  })
})
