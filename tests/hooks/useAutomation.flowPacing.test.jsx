/**
 * useAutomation — Flow 반봇 페이싱 (씬 사이 기본 7~15초 랜덤 대기, 설정에서 조정)
 *
 * Flow 모드(Agent OFF)는 단일 웹 패널 DOM 자동화라 빠른 연속 제출이 봇 감지/레이트리밋을
 * 유발한다. 그래서 제출 사이에 랜덤 대기를 둔다(기본 7~15초). API 모드는 동시성 윈도우(대기 없음) 유지.
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
  presetTagForStyleId: vi.fn(() => null),
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
  vi.spyOn(Math, 'random').mockReturnValue(0) // waitMs = 7_000 (기본 min)
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
  it('Flow 모드: 제출 사이 최소 7초 대기 — 6초로는 다음 제출 안 됨', async () => {
    const { hook, submitGeneration } = setupHook(FOUR, { mode: 'flow' })
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory', concurrency: 5 })
    })
    // s1 제출 후 7초 대기 중 — 6초로는 s2 가 아직 안 나감
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(submitGeneration).toHaveBeenCalledTimes(1)

    // 충분히 진행하면 4개 모두 제출 (3 * 7s + collect poll 이상)
    await act(async () => { await vi.advanceTimersByTimeAsync(50000) })
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
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(submitGeneration).toHaveBeenCalledTimes(1) // s1 제출 후 7초 대기 중
    // 충분히 더 진행 → 게이트(=1)에 안 막히고 4개 모두 제출(미완료여도)
    await act(async () => { await vi.advanceTimersByTimeAsync(45000) })
    expect(submitGeneration).toHaveBeenCalledTimes(4)
    await act(async () => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(200000) })
    await startPromise
  })

  it('Flow 모드: 랜덤 상한은 15초 근처까지 늘어남', async () => {
    Math.random.mockReturnValue(0.99999) // waitMs = 15_000
    const { hook, submitGeneration } = setupHook(FOUR.slice(0, 2), { mode: 'flow', completed: false })
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory', concurrency: 5 })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(14000) })
    expect(submitGeneration).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(submitGeneration).toHaveBeenCalledTimes(2)
    await act(async () => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(200000) })
    await startPromise
  })

  it('Flow 모드: 설정 flowPacingMinMs/MaxMs 를 존중 — 고정 3초면 3초 대기', async () => {
    const { hook, submitGeneration } = setupHook(FOUR, { mode: 'flow' })
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        projectName: 'p', saveMode: 'memory', concurrency: 5,
        flowPacingMinMs: 3000, flowPacingMaxMs: 3000, // 고정 3초
      })
    })
    // 2초로는 아직 s2 안 나감 (기본 7초가 아니라 설정 3초가 적용됐는지 확인)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(submitGeneration).toHaveBeenCalledTimes(1)
    // 3초 넘기면 s2 제출 (기본 7초였다면 아직 1개여야 함 → 설정 반영 검증)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(submitGeneration).toHaveBeenCalledTimes(2)
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
