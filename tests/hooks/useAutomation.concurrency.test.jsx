/**
 * useAutomation — 동시성 윈도우 (Stage 2)
 *
 * Flow 반봇 페이싱(씬 사이 7~15초 대기)을 제거하고, 제출 전 동시성 게이트로
 * in-flight 를 concurrency 개로 제한한다. 공식 API 모드 전용.
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

function setupHook(scenes, overrides = {}) {
  const submitGenerationDOM = vi.fn().mockImplementation(async () => ({ success: true, generationId: `gen-${++gid}` }))
  let gid = 0
  const flowAPI = {
    submitGenerationDOM,
    checkGeneration: overrides.checkGeneration || vi.fn().mockResolvedValue({ completed: false }),
    collectGeneration: overrides.collectGeneration || vi.fn().mockResolvedValue({ success: true, images: [{ id: 'i', mediaId: 'm' }] }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('tok'),
  }
  const updateScene = vi.fn()
  const scenesHook = { scenes, references: [], updateScene, getMatchingReferences: vi.fn(() => []) }
  const hook = renderHook(() => useAutomation(flowAPI, scenesHook, null, null, null, (k) => k, null, null, null))
  return { hook, submitGenerationDOM, flowAPI, updateScene }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
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

describe('useAutomation 동시성 윈도우', () => {
  it('in-flight 가 concurrency 를 넘지 않음 (완료 없으면 추가 제출 차단)', async () => {
    // checkGeneration 이 계속 미완료 → window 가 concurrency 에서 멈춤
    const { hook, submitGenerationDOM } = setupHook(FOUR)
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory', concurrency: 2 })
    })
    // window 가 채워지고, 게이트가 더 이상 제출 안 함
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(submitGenerationDOM).toHaveBeenCalledTimes(2) // concurrency=2 에서 멈춤

    // 정리
    await act(async () => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(200000) })
    await startPromise
  })

  it('씬 사이 7~15초 대기 제거 — 즉시 완료되면 배치가 빠르게 끝남', async () => {
    // 모두 즉시 완료. 옛 코드면 (N-1)*~7s 대기가 필요했음.
    const { hook, submitGenerationDOM } = setupHook(FOUR, {
      checkGeneration: vi.fn().mockResolvedValue({ completed: true }),
      collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ id: 'i', mediaId: 'm' }] }),
    })
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory', concurrency: 5 })
    })
    // 4*7s=28s 보다 훨씬 짧은 5s 안에 완료돼야 함 (대기 제거 증명)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await startPromise
    expect(submitGenerationDOM).toHaveBeenCalledTimes(4)
    expect(hook.result.current.isRunning).toBe(false)
  })

  it('concurrency 미지정 → 기본 5 (4 씬 모두 한 번에 제출, 게이트 안 걸림)', async () => {
    const { hook, submitGenerationDOM } = setupHook(FOUR, {
      checkGeneration: vi.fn().mockResolvedValue({ completed: true }),
    })
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory' }) // concurrency 없음
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await startPromise
    expect(submitGenerationDOM).toHaveBeenCalledTimes(4)
  })

  it('pause 시간은 ITEM_TIMEOUT 에 포함되지 않음 (3분 pause 후 재개해도 timeout 아님)', async () => {
    let completed = false
    const checkGeneration = vi.fn().mockImplementation(async () => ({ completed }))
    const { hook, updateScene } = setupHook([{ id: 's1', prompt: 'a', status: 'pending' }], {
      checkGeneration,
      collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ id: 'i', mediaId: 'm' }] }),
    })
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory', concurrency: 1 })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) }) // s1 제출됨, pending
    await act(async () => { hook.result.current.togglePause() })
    // ITEM_TIMEOUT(2분)보다 긴 3분 pause
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000) })
    completed = true
    await act(async () => { hook.result.current.togglePause() }) // 재개
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    await startPromise

    // pause 시간이 보정돼 timeout 으로 안 떨어져야 함
    const timedOut = updateScene.mock.calls.find(([, upd]) => upd?.error === 'Generation timeout')
    expect(timedOut).toBeUndefined()
  })

  it('concurrency=0 (잘못된 값) → 무한대기 없이 기본 5 로 clamp', async () => {
    const { hook, submitGenerationDOM } = setupHook(FOUR, {
      checkGeneration: vi.fn().mockResolvedValue({ completed: true }),
    })
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory', concurrency: 0 })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await startPromise
    expect(submitGenerationDOM).toHaveBeenCalledTimes(4) // 0 이 1로 안 막히고 정상 진행
    expect(hook.result.current.isRunning).toBe(false)
  })
})
