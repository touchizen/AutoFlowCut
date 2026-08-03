/**
 * useAutomation — ChatGPT 타깃 배치의 model 스탬프 (사용자 리포트 mislabel 수정)
 *
 * 버그: ChatGPT 타깃에서 생성한 이미지가 API 해석 모델(resolveSceneImageProvider →
 * 예: gemini-3.1-flash-image = "Nano banana 2")로 기록돼 ResultsTable 모델 컬럼이
 * 실제 생성 엔진과 다른 모델을 표시했다.
 *
 * 수정: 엔진과 같은 권위(sourceForStage(route,'image'))로 판정해 ChatGPT 경로는
 * 엔진 식별자('chatgpt')를 기록한다 — imageFinalize 의 Flow 'flow' 관례와 동일.
 * Flow/API 경로는 기존 그대로(positive control).
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
vi.mock('../../src/services/imageFinalize', () => ({ processAsyncSceneResult: vi.fn().mockResolvedValue(true) }))
vi.mock('../../src/utils/sceneFilters', () => ({ filterPendingScenes: vi.fn((scenes) => scenes) }))

import { processAsyncSceneResult } from '../../src/services/imageFinalize'

const API_MODEL = 'gemini-3.1-flash-image' // "Nano Banana 2" — 사용자가 본 오라벨

function setupHook({ mode, route, submitResult = null }) {
  let gid = 0
  const submitGeneration = vi.fn().mockImplementation(async () =>
    submitResult ?? { success: true, generationId: `gen-${++gid}` })
  const genAPI = {
    submitGeneration,
    checkGeneration: vi.fn().mockResolvedValue({ completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X', mediaId: 'm' }] }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('tok'),
  }
  const updateScene = vi.fn()
  const scenesHook = {
    scenes: [{ id: 's1', prompt: 'a hero', status: 'pending' }],
    references: [],
    updateScene,
    getMatchingReferences: vi.fn(() => []),
  }
  const hook = renderHook(() => useAutomation(
    genAPI, scenesHook, null, null, null, (k) => k, null, null, null,
    mode, true, false, null, null, false, null, undefined, null,
    route,
  ))
  return { hook, submitGeneration, updateScene }
}

async function runBatch(hook) {
  let p
  await act(async () => {
    p = hook.result.current.start({ projectName: 'p', saveMode: 'memory', concurrency: 5, imageModel: API_MODEL })
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  await p
}

beforeEach(() => { vi.useFakeTimers(); processAsyncSceneResult.mockClear() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('useAutomation — ChatGPT 타깃 model 스탬프', () => {
  it('ChatGPT 경로: pendingQueue 수집 결과에 API 모델이 아니라 엔진 식별자 "chatgpt" 기록', async () => {
    const { hook, submitGeneration } = setupHook({ mode: 'flow', route: { mode: 'flow', sessionTarget: 'chatgpt' } })
    await runBatch(hook)

    expect(processAsyncSceneResult).toHaveBeenCalledTimes(1)
    const finalizeArgs = processAsyncSceneResult.mock.calls[0][0]
    expect(finalizeArgs.model).toBe('chatgpt')
    expect(finalizeArgs.model).not.toBe(API_MODEL)
    // 제출 옵션도 같은 값 — 엔진이 model 을 무시하지만 API 모델명을 실어 보내지 않는다.
    expect(submitGeneration.mock.calls[0][2].model).toBe('chatgpt')
  })

  it('ChatGPT 경로: 동기 결과 분기(images 즉시 반환)도 "chatgpt" 기록', async () => {
    const { hook } = setupHook({
      mode: 'flow',
      route: { mode: 'flow', sessionTarget: 'chatgpt' },
      submitResult: { success: true, images: [{ base64: 'X' }] },
    })
    await runBatch(hook)

    expect(processAsyncSceneResult).toHaveBeenCalledTimes(1)
    expect(processAsyncSceneResult.mock.calls[0][0].model).toBe('chatgpt')
  })

  it('POSITIVE CONTROL — Flow 경로: 해석된 모델 그대로 기록 (chatgpt 로 오염 금지)', async () => {
    const { hook, submitGeneration } = setupHook({ mode: 'flow', route: { mode: 'flow', sessionTarget: 'flow' } })
    await runBatch(hook)

    expect(processAsyncSceneResult).toHaveBeenCalledTimes(1)
    expect(processAsyncSceneResult.mock.calls[0][0].model).toBe(API_MODEL)
    expect(submitGeneration.mock.calls[0][2].model).toBe(API_MODEL)
  })

  it('POSITIVE CONTROL — API 경로: 해석된 API 모델 그대로 기록', async () => {
    const { hook, submitGeneration } = setupHook({ mode: 'api', route: { mode: 'api', sessionTarget: 'flow' } })
    await runBatch(hook)

    expect(processAsyncSceneResult).toHaveBeenCalledTimes(1)
    expect(processAsyncSceneResult.mock.calls[0][0].model).toBe(API_MODEL)
    expect(submitGeneration.mock.calls[0][2].model).toBe(API_MODEL)
  })
})
