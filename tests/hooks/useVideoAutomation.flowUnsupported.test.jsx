/**
 * useVideoAutomation — flow-feature-unsupported 는 종결 실패다 (R1#8)
 *
 * M1 의 flow.google.com 에서 check-video-status 는 fail-closed 스텁(flow-feature-unsupported:check-video-status)이다.
 * 훅이 이를 "일시 실패"로 보면 이전 세션에서 generating 으로 남은 항목을 10초 × 120회 폴링한다. 한 번 보면 끝낸다.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({ fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }) } }))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
vi.mock('../../src/utils/videoMetadata', () => ({ pickVideoMetadata: vi.fn(() => ({})), buildVideoMetaPatch: vi.fn(() => ({})) }))

beforeEach(() => { __resetQuotaStopForTests(); vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('useVideoAutomation — 폴링의 flow-feature-unsupported', () => {
  it('check-video-status 가 flow-feature-unsupported 면 즉시 종결: 폴 1회, 항목 전부 error(errorKind 유지), 120회 폴링 없음', async () => {
    const generateVideoT2V = vi.fn().mockImplementation(async () => ({ success: true, generationId: `gen_${Math.random()}` }))
    const checkVideoStatus = vi.fn().mockResolvedValue({ success: false, errorKind: 'flow-feature-unsupported', error: 'flow-feature-unsupported:check-video-status' })
    const genAPI = { generateVideoT2V, generateVideoI2V: vi.fn(), checkVideoStatus, upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('flow-session') }
    const onItemUpdate = vi.fn()
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow'))
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v', scenes: [{ id: 'vscene_1', prompt: 'p1' }, { id: 'vscene_2', prompt: 'p2' }],
        projectName: 'test', saveMode: 'folder', videoModel: 'veo-3', aspectRatio: '16:9', duration: 8, videoResolution: '720p', videoBatchCount: 1, seed: null,
        concurrency: 2, onItemUpdate,
      })
    })
    startPromise.catch(() => {})
    for (let i = 0; i < 5; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    await act(async () => { await startPromise })

    expect(checkVideoStatus).toHaveBeenCalledTimes(1)
    expect(hook.result.current.status).toBe('error')
    const errored = onItemUpdate.mock.calls.filter(([, s]) => s === 'error')
    expect(new Set(errored.map(([id]) => id))).toEqual(new Set(['vscene_1', 'vscene_2']))
    for (const [, , patch] of errored) expect(patch).toMatchObject({ errorKind: 'flow-feature-unsupported', error: 'flow-feature-unsupported:check-video-status' })
    expect(hook.result.current.statusMessage).not.toMatch(/Polling/)
  })
})
