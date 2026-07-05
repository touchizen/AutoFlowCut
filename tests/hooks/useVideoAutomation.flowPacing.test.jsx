/**
 * useVideoAutomation — Flow 반봇 페이싱 (제출 사이 20~40초) + concurrency 게이트 무시
 *
 * Flow(Agent OFF)는 단일 웹 패널이라 빠른 연속 제출이 봇 감지/레이트리밋을 유발 → 제출 사이
 * 20~40초 랜덤 대기. concurrency 윈도우 대신 페이싱이 throttle. API 모드는 동시성 윈도우(대기 없음).
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }), saveVideo: vi.fn().mockResolvedValue({ success: true, path: '/x.mp4' }) },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
vi.mock('../../src/services/videoDownload', () => ({ downloadVideoBase64: vi.fn().mockResolvedValue({ success: true, base64: 'vid_b64' }) }))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({})),
  buildVideoMetaPatch: vi.fn((item) => ({ seed: item?.seed ?? null, model: item?.model ?? null })),
}))

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0) // waitMs = 20_000
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const makeScenes = (n) => Array.from({ length: n }, (_, i) => ({ id: `vscene_${i + 1}`, prompt: `p${i + 1}`, seed: i, model: 'veo-3' }))

function setup(appMode) {
  let submitCount = 0
  const generateVideoT2V = vi.fn().mockImplementation(async () => ({ success: true, generationId: `gen_${++submitCount}` }))
  const checkVideoStatus = vi.fn().mockResolvedValue({ success: true, statuses: [] }) // 항상 미완료(빈 statuses)
  const genAPI = {
    generateVideoT2V, generateVideoI2V: vi.fn(), checkVideoStatus,
    upscaleVideo: vi.fn(), fetchMedia: vi.fn().mockResolvedValue({ success: true, base64: 'b', mediaId: 'm' }),
    downloadVideo: vi.fn().mockResolvedValue({ success: true, base64: 'b64' }),
    getAccessToken: vi.fn().mockResolvedValue('token'),
  }
  const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, appMode, true))
  return { hook, generateVideoT2V }
}

describe('useVideoAutomation — Flow 페이싱', () => {
  it('Flow: concurrency=1 이어도 게이트 무시 + 최소 20초 페이싱으로 3개 모두 제출', { timeout: 20000 }, async () => {
    const { hook, generateVideoT2V } = setup('flow')
    let p
    await act(async () => {
      p = hook.result.current.start({
        mode: 't2v', scenes: makeScenes(3), projectName: 'test', saveMode: 'folder',
        videoModel: 'veo-3', aspectRatio: '16:9', duration: 8, videoResolution: '720p',
        videoBatchCount: 1, seed: null, concurrency: 1, onItemUpdate: vi.fn(),
      })
    })
    // s1 제출 후 20초 대기 — 19초로는 s2 안 나감
    await act(async () => { await vi.advanceTimersByTimeAsync(19000) })
    expect(generateVideoT2V).toHaveBeenCalledTimes(1)
    // 충분히 진행하면 게이트(=1) 무시하고 3개 전부 제출(미완료여도)
    await act(async () => { await vi.advanceTimersByTimeAsync(25000) })
    expect(generateVideoT2V).toHaveBeenCalledTimes(3)
    await act(async () => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(300000) })
    await act(async () => { await p })
  })

  it('Flow: 랜덤 상한은 40초 근처까지 늘어남', { timeout: 20000 }, async () => {
    Math.random.mockReturnValue(0.99999) // waitMs = 40_000
    const { hook, generateVideoT2V } = setup('flow')
    let p
    await act(async () => {
      p = hook.result.current.start({
        mode: 't2v', scenes: makeScenes(2), projectName: 'test', saveMode: 'folder',
        videoModel: 'veo-3', aspectRatio: '16:9', duration: 8, videoResolution: '720p',
        videoBatchCount: 1, seed: null, concurrency: 5, onItemUpdate: vi.fn(),
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(39000) })
    expect(generateVideoT2V).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(generateVideoT2V).toHaveBeenCalledTimes(2)
    await act(async () => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(300000) })
    await act(async () => { await p })
  })
})
