import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useStoryPipeline } from '../../src/hooks/useStoryPipeline.js'

beforeEach(() => {
  window.electronAPI = {
    storyOpen: vi.fn(async () => ({ projectToken: 'tok-stage', state: { steps: {} } })),
    storyGetState: vi.fn(async () => ({ steps: {} })),
    storyAbort: vi.fn(async () => ({})),
    storyStageImageFirst: vi.fn(async () => ({ success: false, error: 'storyboard-time-invalid', sourceRowIds: ['storyboard-row-2'] })),
    storyListLlmOptions: vi.fn(async () => ({ options: [] })),
    onStoryEvent: vi.fn(() => () => {}),
  }
})

describe('useStoryPipeline.stageImageFirst', () => {
  it('current projectToken과 params를 전달하고 IPC 결과를 verbatim 반환하며 toast를 소유하지 않는다', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    const params = {
      fixedSceneRevision: 'r-1',
      imageFirstVariant: 'storyboard',
      fixedScenes: [{ ordinal: 1, storyId: 's', rendererSceneId: 'r' }],
      storyboardCsv: 'scene,prompt,subtitle,speaker\n1,P,S,narrator',
    }

    let returned
    await act(async () => { returned = await result.current.stageImageFirst(params) })

    expect(window.electronAPI.storyStageImageFirst).toHaveBeenCalledWith({
      projectToken: 'tok-stage',
      ...params,
    })
    expect(returned).toBe(await window.electronAPI.storyStageImageFirst.mock.results[0].value)
    expect(returned).toEqual({
      success: false,
      error: 'storyboard-time-invalid',
      sourceRowIds: ['storyboard-row-2'],
    })
  })
})
