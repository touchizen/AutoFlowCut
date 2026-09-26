/**
 * main 병합(리뷰 A F1): Flow 모드는 씬 override(scene.generation.video.*)를 쓰지 않는다.
 *   override 의 API 모델(예 grok)이 Flow 설정 패널 드라이버로 가면 모델 메뉴에 없어 flow-settings-not-applied/model-not-offered 로 거부되고,
 *   같은 거부가 두 번 이어지면 배치 전체 거부로 번져 override 없는 씬까지 제출 없이 닫힌다(main 은 "모델은 배치 설정"이라 가정한다).
 *   Flow 모드는 main 처럼 모든 항목을 설정의 Flow 모델로 제출한다.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    saveVideo: vi.fn(async (_p, videoId) => ({ success: true, path: `/proj/videos/${videoId}.mp4` })),
  },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn(async () => ({ success: true })) }))
vi.mock('../../src/utils/videoMetadata', () => ({ pickVideoMetadata: vi.fn(() => ({})), buildVideoMetaPatch: vi.fn(() => ({})) }))

const SIGNED = 'https://flow-content.google/video/<uuid#11>?Expires=1&KeyName=k&Signature=SIG'

beforeEach(() => { __resetQuotaStopForTests(); vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0); vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('useVideoAutomation — Flow 모드는 씬 override 대신 설정의 Flow 모델', () => {
  it('override(grok) 씬 2개 + 일반 씬 2개 → 네 항목 모두 Omni Flash 로 제출, 설정 거부로 닫힌 항목 없음', async () => {
    let n = 0
    // 리뷰 B R2 F3: Flow 설정 드라이버처럼 모델 메뉴에 없는 모델은 클릭 전에 거부한다 — 그래야 아래 "거부로 닫힌 항목 없음"이 거짓일 수 있다.
    const generateVideoT2V = vi.fn(async (_prompt, model) => (model === 'Omni Flash'
      ? { success: true, generationId: `gen-${++n}`, creditsLeft: 1040 }
      : { success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason: 'model-not-offered' }))
    const checkVideoStatus = vi.fn(async (ids) => ({ success: true, statuses: ids.map((gid) => ({ generationId: gid, status: 'complete', mediaId: `media-${gid}`, videoUrl: SIGNED, error: null })) }))
    const genAPI = {
      generateVideoT2V, generateVideoI2V: vi.fn(), checkVideoStatus,
      downloadVideo: vi.fn(async () => ({ success: true, base64: 'data:video/mp4;base64,AQID' })),
      upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('flow-session'), flowSessionReason: vi.fn(() => null),
    }
    const onItemUpdate = vi.fn()
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow'))
    const grok = { generation: { video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } } } }
    const scenes = [
      { id: 'vscene_1', prompt: 'p1', ...grok },
      { id: 'vscene_2', prompt: 'p2', ...grok },
      { id: 'vscene_3', prompt: 'p3' },
      { id: 'vscene_4', prompt: 'p4' },
    ]
    const started = {}
    await act(async () => {
      started.promise = hook.result.current.start({
        mode: 't2v', scenes, onItemUpdate,
        projectName: 'proj', saveMode: 'folder', videoModel: 'Omni Flash', aspectRatio: '16:9', duration: 6, videoResolution: '720p',
        videoBatchCount: 1, seed: null, concurrency: 5, flowPacingMinMs: 1000, flowPacingMaxMs: 1000,
        generationSettings: { videoModelT2V: 'Omni Flash', generation: { video: { t2v: { provider: 'google' } } } },
      })
    })
    for (let t = 0; t < 60000; t += 500) await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    await act(async () => { await started.promise })

    expect(generateVideoT2V).toHaveBeenCalledTimes(4)
    expect(generateVideoT2V.mock.calls.map((c) => [c[0], c[1]])).toEqual([['p1', 'Omni Flash'], ['p2', 'Omni Flash'], ['p3', 'Omni Flash'], ['p4', 'Omni Flash']])
    const refused = onItemUpdate.mock.calls.filter((c) => c[2]?.errorKind === 'flow-settings-not-applied')
    expect(refused).toEqual([])
  })
})
