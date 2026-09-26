/**
 * useVideoAutomation — quota stop status race regression
 *
 * 회귀: 첫 video submit 이 quota 로 실패 → emitQuotaStop → 모달 뜸 → 사용자가
 * 모달을 매우 빨리 dismiss → notifyQuotaModalDismissed() → isQuotaBlocked()=false →
 * submissions.length === 0 branch 가 quota 인지 판단 못 해 status='done'/'All failed'
 * 로 표시되는 race.
 *
 * Fix: hook-level quotaStoppedRef 가 batch 동안 유지되어 race 제거.
 */

import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import {
  __resetQuotaStopForTests,
  notifyQuotaModalDismissed,
  subscribeQuotaStop,
} from '../../src/utils/quotaStop'

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
  buildVideoMetaPatch: vi.fn(() => ({})),
}))

function setupHook(overrides = {}) {
  const generateVideoT2V = vi.fn().mockResolvedValue({
    success: false,
    error: 'Too Many Requests',
    errorKind: 'quota',
  })
  const genAPI = {
    generateVideoT2V,
    generateVideoI2V: vi.fn(),
    checkVideoStatus: vi.fn(),
    upscaleVideo: vi.fn(),
    fetchMedia: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('token'),
    ...(overrides.genAPI || {}),
  }

  const t = (k) => k
  const hook = renderHook(() => useVideoAutomation(genAPI, t, null))
  return { hook, genAPI, generateVideoT2V }
}

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useVideoAutomation — quota stop race regression', () => {
  it('K3: failed poll status errorKind quota stops on non-matching error text', async () => {
    // submit 은 성공 → poll 단계 진입 → poll 중 quota 감지로 멈춤.
    const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: true,
      statuses: [{ status: 'failed', error: 'Too Many Requests', errorKind: 'quota' }],
    })
    const { hook } = setupHook({
      genAPI: { generateVideoT2V, generateVideoI2V: vi.fn(), checkVideoStatus, upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('token') },
    })

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

    expect(hook.result.current.status).toBe('stopped')
    // poll-path 도 quotaStopped 문구 (status.stopped 가 아님)
    expect(hook.result.current.statusMessage).toMatch(/quota|limit reached|한도/i)
  })

  it('K3: submit result errorKind quota stops even when the modal is dismissed immediately', async () => {
    const { hook } = setupHook()

    // listener 가 호출되자마자 사용자가 dismiss 한다고 시뮬레이션 — race 극단값.
    subscribeQuotaStop(() => {
      notifyQuotaModalDismissed()
    })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'vscene_v1', prompt: 'p' }],
        projectName: 'test',
        saveMode: 'folder',
        videoModel: 'veo-3',
        aspectRatio: '16:9',
        duration: 8,
        videoResolution: '1080',
        videoBatchCount: 1,
        seed: null,
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await startPromise

    // race 가드: 모달 dismiss 가 빨라도 status 는 'stopped' (구현은 quotaStoppedRef 로 판단)
    expect(hook.result.current.status).toBe('stopped')
    expect(hook.result.current.statusMessage).toMatch(/quota|limit reached|한도/i)
  })

  it('K3: submit result errorKind other overrides quota-looking text', async () => {
    const generateVideoT2V = vi.fn().mockResolvedValue({
      success: false,
      error: 'Resource has been exhausted (e.g. check quota).',
      errorKind: 'other',
    })
    const { hook } = setupHook({ genAPI: { generateVideoT2V } })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({
        mode: 't2v',
        scenes: [
          { id: 'vscene_v1', prompt: 'p1' },
          { id: 'vscene_v2', prompt: 'p2' },
        ],
        projectName: 'test', saveMode: 'folder', videoModel: 'veo-3', aspectRatio: '16:9',
        duration: 8, videoResolution: '1080', videoBatchCount: 1, seed: null,
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await startPromise

    expect(generateVideoT2V).toHaveBeenCalledTimes(2)
    expect(hook.result.current.status).not.toBe('stopped')
  })
})
