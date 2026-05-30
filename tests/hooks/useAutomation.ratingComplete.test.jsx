/**
 * useAutomation — onComplete({ completed }) 정확성 (평점 카운터 게이트)
 *
 * 회귀 가드 (코드리뷰 Finding #1):
 *   completed=true 는 "진행률 100% 도달" 일 때만이어야 한다.
 *   - 3회 연속 submit 실패로 조기 break → completedCount < total → completed:false
 *   - 사용자 stop → completed:false
 *   - 전 씬 성공 → completed:true
 * 과거 구현은 `!stopRequestedRef.current` 만 봐서, 조기 break(진행률 3/total) 에도
 * completed:true 가 되어 평점 모달이 잘못 트리거됐다.
 */

import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('unused')),
  },
}))
vi.mock('../../src/utils/flowDOMClient', () => ({
  resetDOMSession: vi.fn(),
  requestStopDOM: vi.fn(),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}))
vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn((prompt) => ({ styledPrompt: prompt || 'p', appliedStyle: null })),
}))
vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../src/utils/sceneFilters', () => ({
  filterPendingScenes: vi.fn((scenes) => scenes),
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0) // 인터-씬 대기 7000ms 고정
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function setup({ scenes, flowOverrides = {} }) {
  const submitGenerationDOM = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
  const checkGeneration = vi.fn().mockResolvedValue({ completed: true })
  const collectGeneration = vi.fn().mockResolvedValue({ success: true, images: [{ id: 'i', mediaId: 'm' }] })
  const clearGenerations = vi.fn().mockResolvedValue(undefined)
  const getAccessToken = vi.fn().mockResolvedValue('token')
  const flowAPI = {
    submitGenerationDOM, checkGeneration, collectGeneration, clearGenerations,
    uploadReference: vi.fn(), getAccessToken, ...flowOverrides,
  }
  const scenesHook = {
    scenes, references: [], updateScene: vi.fn(), getMatchingReferences: vi.fn(() => []),
  }
  const onComplete = vi.fn()
  const hook = renderHook(() =>
    useAutomation(flowAPI, scenesHook, null, null, null, (k) => k, null, null, onComplete)
  )
  return { hook, onComplete, submitGenerationDOM }
}

describe('useAutomation — onComplete completed flag', () => {
  it('전 씬 성공 시 completed:true', async () => {
    const { hook, onComplete } = setup({
      scenes: [
        { id: 's1', prompt: 'a', status: 'pending' },
        { id: 's2', prompt: 'b', status: 'pending' },
      ],
    })

    let p
    await act(async () => { p = hook.result.current.start({ projectName: 'p', saveMode: 'folder' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await p

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith({ completed: true })
  })

  it('3회 연속 submit 실패로 조기 종료 시 completed:false (진행률 < 100%)', async () => {
    // 4 씬: 처음 3개 submit 이 연속 실패 → break (completedCount=3 < total=4)
    const { hook, onComplete, submitGenerationDOM } = setup({
      scenes: [
        { id: 's1', prompt: 'a', status: 'pending' },
        { id: 's2', prompt: 'b', status: 'pending' },
        { id: 's3', prompt: 'c', status: 'pending' },
        { id: 's4', prompt: 'd', status: 'pending' },
      ],
    })
    submitGenerationDOM.mockResolvedValue({ success: false, error: 'boom (generic submit failure)' })

    let p
    await act(async () => { p = hook.result.current.start({ projectName: 'p', saveMode: 'folder' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await p

    // 4번째 씬은 제출 시도조차 안 됨 (3연속 실패 후 break)
    expect(submitGenerationDOM).toHaveBeenCalledTimes(3)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith({ completed: false })
  })

  it('사용자 stop 시 completed:false', async () => {
    // submit 성공하지만 결과가 영원히 pending → stop 으로 종료
    const { hook, onComplete } = setup({
      scenes: [
        { id: 's1', prompt: 'a', status: 'pending' },
        { id: 's2', prompt: 'b', status: 'pending' },
      ],
      flowOverrides: { checkGeneration: vi.fn().mockResolvedValue({ completed: false }) },
    })

    let p
    await act(async () => { p = hook.result.current.start({ projectName: 'p', saveMode: 'folder' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 1000) })
    act(() => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 1000) })
    await p

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith({ completed: false })
  })
})
