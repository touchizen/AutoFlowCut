import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStoryPipeline } from '../../src/hooks/useStoryPipeline.js'

let cleanupSpies

beforeEach(() => {
  cleanupSpies = []
  window.electronAPI = {
    storyListLlmOptions: vi.fn(async () => ({ options: [], defaultOption: null })),
    storyOpen: vi.fn(async () => ({ projectToken: 'story-token', state: { steps: {} } })),
    storyGetState: vi.fn(async () => ({ steps: {}, scenes: [] })),
    storyAbort: vi.fn(async () => ({ ok: true })),
    onStoryEvent: vi.fn(() => {
      const off = vi.fn()
      cleanupSpies.push(off)
      return off
    }),
  }
})

describe('useStoryPipeline workflow gate', () => {
  it('disabled면 Story listener와 LLM 조회를 arm하지 않는다', () => {
    renderHook(() => useStoryPipeline({ projectPath: null, enabled: false }))

    expect(window.electronAPI.onStoryEvent).not.toHaveBeenCalled()
    expect(window.electronAPI.storyListLlmOptions).not.toHaveBeenCalled()
  })

  it('story에서 disabled로 전환하면 등록된 모든 Story listener를 해제한다', async () => {
    const { rerender } = renderHook(
      ({ projectPath, enabled }) => useStoryPipeline({ projectPath, enabled }),
      { initialProps: { projectPath: '/A', enabled: true } },
    )
    expect(cleanupSpies.length).toBeGreaterThan(0)

    await act(async () => {
      rerender({ projectPath: null, enabled: false })
    })

    expect(cleanupSpies.every((off) => off.mock.calls.length === 1)).toBe(true)
  })
})
