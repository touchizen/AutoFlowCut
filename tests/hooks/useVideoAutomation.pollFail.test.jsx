/**
 * useVideoAutomation — poll top-level fail quota check 회귀.
 *
 * 회귀: checkVideoStatus 가 batch 전체로 실패하면 ({ success: false, error: "...quota..." })
 * 우리 코드는 statuses[] 만 보고 그냥 next iteration 으로 갔다. quota 같은 영구 실패에서도
 * max polls 까지 polling 후 timeout 처리 — quota stop UX 가 안 동작.
 *
 * Fix: result.success === false 면 quota 검사 후 break.
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
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({})),
  buildVideoMetaPatch: vi.fn(() => ({})),
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

describe('useVideoAutomation — poll top-level fail quota', () => {
  it('checkVideoStatus 가 batch 전체 fail 로 quota 반환 시 즉시 break (max polls 안 감)', async () => {
    // submit 은 성공해서 polling 단계 진입
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
    // checkVideoStatus 는 batch 전체로 quota 실패 — statuses 없음
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: false,
      error: 'Resource has been exhausted (e.g. check quota).',
    })

    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      upscaleVideo: vi.fn(),
      fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }

    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'vscene_v1', prompt: 'p' }],
        projectName: 'test', saveMode: 'folder', videoModel: 'veo-3', aspectRatio: '16:9',
        duration: 8, videoResolution: '1080', videoBatchCount: 1, seed: null,
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await startPromise

    // 회귀 가드: poll 이 max iterations 까지 안 가고 한 번에 멈춤.
    // (max polls 까지 갔다면 checkVideoStatus 가 수십~수백 번 호출되었을 것)
    expect(checkVideoStatus.mock.calls.length).toBeLessThan(5)
    // quota stop UX
    expect(hook.result.current.status).toBe('stopped')
    expect(hook.result.current.statusMessage).toMatch(/quota|limit reached|한도/i)
  })

  it('서버 generation failed 는 progress.errorCount 에 반영됨 (Phase 2 실패 집계)', async () => {
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
    // 서버가 해당 item 을 'failed' 로 보고 (quota 아님)
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: true,
      statuses: [{ status: 'failed', error: 'Video generation failed' }],
    })
    const genAPI = {
      generateVideoT2V, generateVideoI2V: vi.fn(), checkVideoStatus,
      upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v', scenes: [{ id: 'vscene_v1', prompt: 'p' }],
        projectName: 'test', saveMode: 'folder', videoModel: 'veo-3', aspectRatio: '16:9',
        duration: 8, videoResolution: '1080', videoBatchCount: 1, seed: null,
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await startPromise

    expect(hook.result.current.progress.errorCount).toBe(1)
    // 완료 메시지가 실패를 숨기지 않음 (성공처럼 안 보이게)
    expect(hook.result.current.statusMessage).toMatch(/1 failed/)
    expect(hook.result.current.statusMessage).toContain('⚠️')
  })

  it('D2: 서버 failed status의 errorKind를 item error patch에 보존', async () => {
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: true,
      statuses: [{
        generationId: 'gen-1',
        status: 'failed',
        error: 'Opaque provider failure',
        errorKind: 'provider-failure',
      }],
    })
    const genAPI = {
      generateVideoT2V, generateVideoI2V: vi.fn(), checkVideoStatus,
      upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const onItemUpdate = vi.fn()
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))
    let startPromise

    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v', scenes: [{ id: 'vscene_v1', prompt: 'p' }],
        projectName: 'test', saveMode: 'memory', videoModel: 'veo-3', aspectRatio: '16:9',
        duration: 8, videoResolution: '720p', videoBatchCount: 1, seed: null,
        onItemUpdate,
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 1000) })
    await startPromise

    expect(onItemUpdate).toHaveBeenCalledWith(
      'vscene_v1',
      'error',
      expect.objectContaining({
        error: 'Opaque provider failure',
        errorKind: 'provider-failure',
      }),
    )
  })

  it('non-quota top-level 실패가 반복돼도 per-item 예산으로 종료 (무한루프 방지)', { timeout: 20000 }, async () => {
    // submit 은 성공 → polling 진입. 이후 checkVideoStatus 가 항상 non-quota 실패 반환.
    // quota/auth 가 아니므로 break 안 하고, statuses 도 없어 per-item polls 가 안 늘면 무한 폴링.
    const generateVideoT2V = vi.fn().mockImplementation(async () => ({
      success: true, generationId: `gen_${Math.random()}`
    }))
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: false,
      error: 'temporary server error 500',  // non-quota
    })
    const genAPI = {
      generateVideoT2V, generateVideoI2V: vi.fn(), checkVideoStatus,
      upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const onItemUpdate = vi.fn()
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'vscene_1', prompt: 'p1' }, { id: 'vscene_2', prompt: 'p2' }],
        projectName: 'test', saveMode: 'folder', videoModel: 'veo-3', aspectRatio: '16:9',
        duration: 8, videoResolution: '720p', videoBatchCount: 1, seed: null,
        concurrency: 2, onItemUpdate,
      })
    })
    startPromise.catch(() => {})

    // per-item 예산(VIDEO_MAX_POLL_COUNT=120) 초과하도록 폴링 사이클 advance
    for (let i = 0; i < 130; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    }

    // 무한루프면 status 가 'running' 으로 고정 → 여기서 실패(RED).
    expect(hook.result.current.status).not.toBe('running')
    // 2개 항목 모두 폴링 실패로 error 마감
    const erroredIds = new Set(
      onItemUpdate.mock.calls.filter(([, s]) => s === 'error').map(([id]) => id)
    )
    expect(erroredIds.size).toBe(2)

    await act(async () => { await startPromise })
  })
})
