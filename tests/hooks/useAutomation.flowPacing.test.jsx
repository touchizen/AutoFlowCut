/**
 * useAutomation — Flow 반봇 페이싱 (씬 사이 7~15초 랜덤 대기) 복원
 *
 * Flow 모드(Agent OFF)는 단일 웹 패널 DOM 자동화라 빠른 연속 제출이 봇 감지/레이트리밋을
 * 유발한다. 그래서 제출 사이에 7~15초 랜덤 대기를 둔다. API 모드는 동시성 윈도우(대기 없음) 유지.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('n/a')),
  },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }))
vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn((prompt) => ({ styledPrompt: prompt || 'p', appliedStyle: null })),
}))
vi.mock('../../src/services/imageFinalize', () => ({ processAsyncSceneResult: vi.fn().mockResolvedValue(true) }))
vi.mock('../../src/utils/sceneFilters', () => ({ filterPendingScenes: vi.fn((scenes) => scenes) }))

function setupHook(scenes, { mode = 'api', completed = true } = {}) {
  let gid = 0
  const submitGeneration = vi.fn().mockImplementation(async () => ({ success: true, generationId: `gen-${++gid}` }))
  const genAPI = {
    submitGeneration,
    checkGeneration: vi.fn().mockResolvedValue({ completed }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ id: 'i', mediaId: 'm' }] }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('tok'),
  }
  const updateScene = vi.fn()
  const scenesHook = { scenes, references: [], updateScene, getMatchingReferences: vi.fn(() => []) }
  // 9번째 인자 = mode, 10번째 = flowProjectReady(true)
  const hook = renderHook(() => useAutomation(genAPI, scenesHook, null, null, null, (k) => k, null, null, null, mode, true))
  return { hook, submitGeneration }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0) // waitMs = 7000 + 0 = 7000
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const FOUR = [
  { id: 's1', prompt: 'a', status: 'pending' },
  { id: 's2', prompt: 'b', status: 'pending' },
  { id: 's3', prompt: 'c', status: 'pending' },
  { id: 's4', prompt: 'd', status: 'pending' },
]

describe('useAutomation Flow 페이싱', () => {
  it('Flow 모드: 제출 사이 7초 대기 — 5초로는 다음 제출 안 됨', async () => {
    const { hook, submitGeneration } = setupHook(FOUR, { mode: 'flow' })
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory', concurrency: 5 })
    })
    // s1 제출 후 7초 대기 중 — 5초로는 s2 가 아직 안 나감
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(submitGeneration).toHaveBeenCalledTimes(1)

    // 충분히 진행하면 4개 모두 제출 (4 * 7s = 28s 이상)
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    await startPromise
    expect(submitGeneration).toHaveBeenCalledTimes(4)
  })

  it('Flow 모드: concurrency 게이트 무시 — concurrency=1, 미완료여도 7~15초 페이싱으로 계속 제출', async () => {
    // checkGeneration 이 계속 미완료 → API 모드면 게이트가 1에서 막힘. Flow 는 게이트 무시 → 페이싱만.
    const { hook, submitGeneration } = setupHook(FOUR, { mode: 'flow', completed: false })
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory', concurrency: 1 })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(submitGeneration).toHaveBeenCalledTimes(1) // s1 제출 후 7초 대기 중
    // 30초 더 → 게이트(=1)에 안 막히고 4개 모두 제출(미완료여도)
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(submitGeneration).toHaveBeenCalledTimes(4)
    await act(async () => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(200000) })
    await startPromise
  })

  it('API 모드: 대기 없음 — 5초 안에 4개 모두 제출', async () => {
    const { hook, submitGeneration } = setupHook(FOUR, { mode: 'api' })
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory', concurrency: 5 })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await startPromise
    expect(submitGeneration).toHaveBeenCalledTimes(4)
  })
})
