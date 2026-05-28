/**
 * useVideoAutomation — user stop cleanup regression
 *
 * 회귀: polling 중 사용자가 stop 을 누르면 while 루프는 break 하지만, pending 에 남아 있던
 * in-flight 항목들은 'generating' 상태로 영원히 남고 generatingEndedAt 이 null 이라
 * ResultsTable 의 useElapsedTimer 가 무한 증가했다 (UI 상 "여전히 작업 중" 으로 오해).
 *
 * Fix: stop 분기에서 pending 항목들을 'error' (errorKind='stopped') 로 마무리.
 * generationId 는 보존 — 앱 재시작 시 videoRecovery 가 결과 회수, 또는 Flow 완료 후 Retry 다운로드.
 */

import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }) },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/services/videoRecovery', () => ({
  retryVideoDownload: vi.fn(),
}))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({})),
  buildVideoMetaPatch: vi.fn((item) => ({
    seed: item?.seed ?? null,
    model: item?.model ?? null,
  })),
}))

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function buildFlowAPI(overrides = {}) {
  return {
    generateVideoT2V: vi.fn(),
    generateVideoI2V: vi.fn(),
    checkVideoStatus: vi.fn(),
    upscaleVideo: vi.fn(),
    fetchMedia: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('token'),
    ...overrides,
  }
}

describe('useVideoAutomation — user stop cleanup', () => {
  it('polling 중 stop() 호출 시 pending 항목을 error/stopped 로 마무리 (generationId 보존)', async () => {
    // submit 성공 → polling 진입 → checkVideoStatus 가 계속 'pending' 반환 → stop 호출.
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen_user_stop' })
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: true,
      statuses: [{ status: 'pending' }],
    })
    const flowAPI = buildFlowAPI({ generateVideoT2V, checkVideoStatus })
    const onItemUpdate = vi.fn()

    const t = (k) => k
    const hook = renderHook(() => useVideoAutomation(flowAPI, t, null))

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'vscene_1', prompt: 'p', seed: 12345, model: 'veo-3' }],
        projectName: 'test', saveMode: 'folder',
        videoModel: 'veo-3', aspectRatio: '16:9', duration: 8,
        videoResolution: '1080', videoBatchCount: 1, seed: 12345,
        onItemUpdate,
      })
    })

    // submit 완료 + 한두 번 polling 돌게
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 1000) })

    // 사용자가 stop 누름
    act(() => { hook.result.current.stop() })

    // 다음 polling sleep 끝나면 break → cleanup
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 1000) })
    await startPromise

    // pending 항목이 error/stopped 로 마무리됐는지 검증
    const stoppedCall = onItemUpdate.mock.calls.find(
      ([_id, status, patch]) => status === 'error' && patch?.errorKind === 'stopped'
    )
    expect(stoppedCall).toBeTruthy()
    const [stoppedId, , stoppedPatch] = stoppedCall
    expect(stoppedId).toBe('vscene_1')
    expect(stoppedPatch.generationId).toBe('gen_user_stop')
    // 메시지가 비어 있지 않아야 한다 (사용자가 무엇이 일어났는지 알 수 있도록)
    expect(typeof stoppedPatch.error).toBe('string')
    expect(stoppedPatch.error.length).toBeGreaterThan(0)

    // 배치 자체도 stopped
    expect(hook.result.current.status).toBe('stopped')
  })

  it('정상 timeout 시에는 errorKind=stopped 가 아닌 timeout 메시지', async () => {
    // 회귀 가드: stop 이 아닌 자연 timeout 분기는 영향받지 않아야 한다.
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen_timeout' })
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: true,
      statuses: [{ status: 'pending' }],
    })
    const flowAPI = buildFlowAPI({ generateVideoT2V, checkVideoStatus })
    const onItemUpdate = vi.fn()

    const t = (k) => k
    const hook = renderHook(() => useVideoAutomation(flowAPI, t, null))

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'vscene_1', prompt: 'p' }],
        projectName: 'test', saveMode: 'folder',
        videoModel: 'veo-3', aspectRatio: '16:9', duration: 8,
        videoResolution: '1080', videoBatchCount: 1, seed: null,
        onItemUpdate,
      })
    })

    // 120 poll × 10s + 여유 = 21분 정도 (stop 없이 timeout 까지 가게)
    await act(async () => { await vi.advanceTimersByTimeAsync(22 * 60 * 1000) })
    await startPromise

    const timeoutCall = onItemUpdate.mock.calls.find(
      ([_id, status, patch]) => status === 'error' && /timeout/i.test(patch?.error || '')
    )
    expect(timeoutCall).toBeTruthy()
    // 자연 timeout 케이스는 errorKind='stopped' 가 아니어야 한다
    expect(timeoutCall[2].errorKind).not.toBe('stopped')
  })
})
