/**
 * useVideoAutomation — onComplete({ completed }) (평점 카운터 게이트)
 *
 * 회귀 가드 (코드리뷰 Finding #2):
 *   "생성 시작" 버튼은 이미지뿐 아니라 비디오 탭(T2V/I2V/F→V)도 실행한다.
 *   비디오 배치가 100% 완료(status='done')되면 동일 generation 채널에 합산되어야 하므로
 *   onComplete({ completed:true }) 가 호출되어야 한다. 사용자 stop 시에는 호출되지 않는다.
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
  buildVideoMetaPatch: vi.fn((item) => ({ seed: item?.seed ?? null, model: item?.model ?? null })),
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

describe('useVideoAutomation — onComplete completed flag', () => {
  it('배치가 100% 도달(status=done)하면 onComplete({ completed:true })', async () => {
    // 서버가 즉시 'failed' 를 반환 → 항목은 error 로 마감되지만 배치는 100% 도달해
    // status='done' 으로 정상 종료된다(사용자/auth 중단 아님). DOM 다운로드 스택을
    // 흉내내지 않고도 "배치 완료" 경로를 결정적으로 통과시킨다.
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen_ok' })
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: true,
      statuses: [{ status: 'failed', error: 'server gen failed' }],
    })
    const flowAPI = buildFlowAPI({ generateVideoT2V, checkVideoStatus })
    const onComplete = vi.fn()

    const hook = renderHook(() => useVideoAutomation(flowAPI, (k) => k, null, onComplete))

    let p
    await act(async () => {
      p = hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'v1', prompt: 'p', seed: 1, model: 'veo-3' }],
        projectName: 'test', saveMode: 'folder',
        videoModel: 'veo-3', aspectRatio: '16:9', duration: 8,
        videoResolution: '1080', videoBatchCount: 1, seed: 1,
        onItemUpdate: vi.fn(),
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await p

    expect(hook.result.current.status).toBe('done')
    expect(onComplete).toHaveBeenCalledWith({ completed: true })
  })

  it('사용자 stop 시 onComplete 가 completed:true 로 호출되지 않음', async () => {
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen_stop' })
    const checkVideoStatus = vi.fn().mockResolvedValue({ success: true, statuses: [{ status: 'pending' }] })
    const flowAPI = buildFlowAPI({ generateVideoT2V, checkVideoStatus })
    const onComplete = vi.fn()

    const hook = renderHook(() => useVideoAutomation(flowAPI, (k) => k, null, onComplete))

    let p
    await act(async () => {
      p = hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'v1', prompt: 'p' }],
        projectName: 'test', saveMode: 'folder',
        videoModel: 'veo-3', aspectRatio: '16:9', duration: 8,
        videoResolution: '1080', videoBatchCount: 1, seed: null,
        onItemUpdate: vi.fn(),
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 1000) })
    act(() => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 1000) })
    await p

    expect(hook.result.current.status).toBe('stopped')
    expect(onComplete).not.toHaveBeenCalledWith({ completed: true })
  })
})
