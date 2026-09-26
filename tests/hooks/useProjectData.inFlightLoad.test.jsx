/**
 * loadProjectWithResources — 과금된 새 제출(generationId 있음 · mediaId null · videoPath null)에 옛 파일을 다시 붙이지 않는다 (M2-R4 I2, B1)
 * M2-R5 J1(A1 + B6): 가드에서 `mediaId == null` 항을 뺀다 — G1(b) 이후 제출된 항목의 **모든** Flow 종결 패치(stop·폴 타임아웃·폴 auth·not-found·권한 거부·다운로드 실패)가
 *   mediaId = generationId 를 쓰므로, mediaId 를 든 비완료 행(download-only)도 로더가 옛 t2v_N.mp4 를 붙여 complete 로 올리면 복구도 Phase 0 도 G 를 받지 않고 다음 Start 가
 *   재제출(10크레딧)한다. generationId 가 있고 videoPath 가 없는 비완료 행은 mediaId 유무와 무관하게 그대로 둔다(in-flight 든 download-only 든 Phase 0 몫). fp_2 회귀 핀은 뒤집는다.
 *
 * 돈 규칙(H3): Flow 의 제출된 항목은 YhhmEf 200 순간 과금됐고 generationId 가 곧 미디어 id — generationId 가 있고 videoPath 가 없으면 절대 새 제출이 아니다.
 * 재시작 경로의 구멍: 전체 Start(또는 Regenerate → Start)가 디스크에 t2v_N.mp4 가 있는 씬을 재생성하면 제출 패치는 {generating, generationId:G_new, mediaId:null,
 * videoPath:null} 을 남긴다. 완료 전에 앱/페이지가 다시 뜨면 로더의 remapVideoPath 가 videoSaveId 로 **옛 파일**을 찾아 videoPath 를 붙이고 status 를 complete 로 정규화했다
 * → triggerVideoRecovery 는 건너뛰고(!videoPath 아님), Phase 0 은 complete+videoPath 라 fresh → G_new 는 폴링되지 않고 옛 영상이 결과로 보이며 다음 Start 가 재제출(10크레딧).
 * 이제 그 모양(제출이 어떤 파일보다 새롭다)은 경로도 base64 도 붙이지 않고 complete 로도 올리지 않는다 — Phase 0(in-flight) 에 맡긴다.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadProjectWithResources } from '../../src/hooks/useProjectData'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    loadProjectData: vi.fn(),
    getResourcePath: vi.fn(),
    readResource: vi.fn(),
    readHistoryMetadata: vi.fn(),
    getHistory: vi.fn(),
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    saveVideo: vi.fn(async (_p, videoId) => ({ success: true, path: `/proj/videos/${videoId}.mp4` })),
  },
}))
vi.mock('../../src/services/mediaSync', () => ({ syncVideosIntoScenes: vi.fn() }))
vi.mock('../../src/services/videoRecovery', () => ({ recoverInFlightVideos: vi.fn(), retryVideoDownload: vi.fn(async () => ({ success: true })) }))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../src/utils/videoMetadata', () => ({ pickVideoMetadata: vi.fn(() => ({})), buildVideoMetaPatch: vi.fn(() => ({})) }))

import { fileSystemAPI } from '../../src/hooks/useFileSystem'
import { retryVideoDownload } from '../../src/services/videoRecovery'

const G_NEW = '11111111-2222-4333-8444-555555555555'   // Flow 모양(UUID)의 새 제출 id
const G_OLD = '99999999-2222-4333-8444-555555555555'
const OLD_FILE = '/proj/videos/t2v_1.mp4'
const SIGNED = 'https://flow-content.google/video/x?Expires=1&KeyName=k&Signature=SIG'
const OPTS = { mode: 't2v', projectName: 'proj', saveMode: 'folder', videoModel: 'Omni Flash', aspectRatio: '16:9', duration: 6, videoResolution: '720p', videoBatchCount: 1, seed: null, concurrency: 5, flowPacingMinMs: 1000, flowPacingMaxMs: 1000 }

function persist({ videoScenes = [], framePairs = [] }) {
  fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: { scenes: [], references: [], videoScenes, framePairs, srtTrack: [], schemaVersion: 2, settings: { aspectRatio: '16:9' } } })
  // 디스크엔 옛 파일이 있다 — videos/<videoSaveId> 와 videos/<id> 둘 다 찾힌다(옛 결과)
  fileSystemAPI.getResourcePath.mockImplementation(async (_p, kind, id) => (kind === 'videos' ? { success: true, path: `/proj/videos/${id}.mp4` } : { success: false }))
  fileSystemAPI.readResource.mockResolvedValue({ success: true, data: 'data:video/mp4;base64,OLD' })
  fileSystemAPI.getHistory.mockResolvedValue({ success: false })
  fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
}

function setupHook() {
  const generateVideoT2V = vi.fn(async () => ({ success: true, generationId: 'aaaaaaaa-2222-4333-8444-555555555555', creditsLeft: 1040 }))
  const checkVideoStatus = vi.fn(async (ids) => ({ success: true, statuses: ids.map((gid) => ({ generationId: gid, status: 'complete', mediaId: gid, videoUrl: SIGNED, error: null })) }))
  const downloadVideo = vi.fn(async () => ({ success: true, base64: 'data:video/mp4;base64,NEW' }))
  const genAPI = { generateVideoT2V, generateVideoI2V: vi.fn(), checkVideoStatus, downloadVideo, upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('flow-session'), flowSessionReason: vi.fn(() => null) }
  const onItemUpdate = vi.fn()
  const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow'))
  return { hook, genAPI, onItemUpdate, generateVideoT2V, checkVideoStatus, downloadVideo }
}
async function run(h, scenes, ms = 20000) {
  let p
  await act(async () => { p = h.hook.result.current.start({ ...OPTS, scenes, onItemUpdate: h.onItemUpdate }) })
  for (let t = 0; t < ms; t += 500) await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  await act(async () => { await p })
}
const last = (h, id) => h.onItemUpdate.mock.calls.filter((c) => c[0] === id).map((c) => [c[1], c[2] || {}]).at(-1)

beforeEach(() => { __resetQuotaStopForTests(); vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0); vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('loadProjectWithResources — 새 제출(generationId · mediaId null · videoPath null)은 옛 파일을 붙이지 않는다 (M2-R4 I2)', () => {
  it('T2V: 제출 패치 모양으로 저장된 씬 + 디스크의 옛 t2v_1.mp4 → 로드 결과는 pending·videoPath null·video 없음(complete 아님); 실제 훅이 그 항목을 폴링(재제출 없음)하고 새 영상을 받는다', async () => {
    persist({ videoScenes: [{ id: 'vscene_1', prompt: 'p1', videoSaveId: 't2v_1', status: 'generating', generationId: G_NEW, mediaId: null, videoPath: null, generatingStartedAt: 123 }] })
    const loaded = await loadProjectWithResources('proj')
    const vs = loaded.videoScenes[0]
    expect(vs).toMatchObject({ id: 'vscene_1', status: 'pending', generationId: G_NEW, mediaId: null, videoPath: null })
    expect(vs.video).toBeUndefined()
    expect(vs.status).not.toBe('complete')
    // 실제 로더 출력 → 실제 훅(Flow): in-flight 로 폴링, 제출 0, 다운로드 1, complete 패치는 G_new 의 미디어
    const h = setupHook()
    await run(h, loaded.videoScenes)
    expect(h.generateVideoT2V).not.toHaveBeenCalled()
    expect(retryVideoDownload).not.toHaveBeenCalled()
    expect(h.checkVideoStatus.mock.calls[0][0]).toEqual([G_NEW])
    expect(h.downloadVideo).toHaveBeenCalledTimes(1)
    expect(last(h, 'vscene_1')).toEqual(['complete', expect.objectContaining({ generationId: G_NEW, mediaId: G_NEW, videoPath: OLD_FILE })])   // 새 결과가 같은 t2v_1 자리에 저장된다
  })

  it('I2V(framePairs): 같은 모양 → videoPath 붙이지 않고 complete 로 올리지 않는다(pending), base64 없음', async () => {
    persist({ framePairs: [{ id: 'fp_1', startSceneId: 'scene_1', prompt: 'p', videoSaveId: 'i2v_1', status: 'generating', generationId: G_NEW, mediaId: null, videoPath: null }] })
    const loaded = await loadProjectWithResources('proj')
    expect(loaded.framePairs[0]).toMatchObject({ id: 'fp_1', status: 'pending', generationId: G_NEW, mediaId: null, videoPath: null })
    expect(loaded.framePairs[0].base64).toBeUndefined()
  })

  it('회귀 방지: mediaId 를 든 완료 항목(다운로드 끝남)의 옛 stale 경로는 그대로 현재 폴더로 리맵돼 complete — 정상 로드 경로 불변; pending + G + mediaId:G + videoPath:null 은 붙이지 **않는다**(M2-R5 J1 — 재시작이 남긴 download-only 모양, 디스크 파일은 옛 것)', async () => {
    persist({
      videoScenes: [{ id: 'vscene_2', prompt: 'p2', videoSaveId: 't2v_2', status: 'complete', generationId: G_OLD, mediaId: G_OLD, videoPath: '/old-folder/videos/t2v_2.mp4' }],
      framePairs: [{ id: 'fp_2', startSceneId: 'scene_2', prompt: 'p', videoSaveId: 'i2v_2', status: 'pending', generationId: G_OLD, mediaId: G_OLD, videoPath: null }],
    })
    const loaded = await loadProjectWithResources('proj')
    expect(loaded.videoScenes[0]).toMatchObject({ status: 'complete', videoPath: '/proj/videos/t2v_2.mp4', generationId: G_OLD, mediaId: G_OLD })
    expect(loaded.framePairs[0]).toMatchObject({ status: 'pending', generationId: G_OLD, mediaId: G_OLD, videoPath: null })
    expect(loaded.framePairs[0].base64).toBeUndefined()
    expect(loaded.framePairs[0].status).not.toBe('complete')
  })
})

// ── M2-R5 J1 (A1 + B6): mediaId 를 든 비완료 행도 그대로 — 그리고 남은 두 절(complete 제외 · videoPath 절)의 핀 ────────────────────────────────
describe('loadProjectWithResources — generationId 있고 videoPath 없는 비완료 행은 mediaId 유무와 무관하게 그대로 둔다 (M2-R5 J1)', () => {
  it('(a) 중단된 행 {error, stopped, G, mediaId:G, videoPath:null} + 디스크의 옛 t2v_1.mp4 → 로드 결과는 error·videoPath null·video 없음(complete 아님); 실제 훅은 제출 0·retryVideoDownload 1 — 옛 파일이 결과로 보이지 않는다', async () => {
    persist({ videoScenes: [{ id: 'vscene_1', prompt: 'p1', videoSaveId: 't2v_1', status: 'error', error: 'Stopped by user', errorKind: 'stopped', generationId: G_NEW, mediaId: G_NEW, videoPath: null }] })
    const loaded = await loadProjectWithResources('proj')
    const vs = loaded.videoScenes[0]
    expect(vs).toMatchObject({ id: 'vscene_1', status: 'error', errorKind: 'stopped', generationId: G_NEW, mediaId: G_NEW, videoPath: null })
    expect(vs.video).toBeUndefined()
    expect(vs.status).not.toBe('complete')
    // 실제 로더 출력 → 실제 훅(Flow): download-only — 제출 0, 폴 0, retryVideoDownload 1(G_new 의 미디어)
    const h = setupHook()
    await run(h, loaded.videoScenes)
    expect(h.generateVideoT2V).not.toHaveBeenCalled()
    expect(h.checkVideoStatus).not.toHaveBeenCalled()
    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
    expect(retryVideoDownload.mock.calls[0][0].item).toMatchObject({ id: 'vscene_1', generationId: G_NEW, mediaId: G_NEW })
  })

  it('(a2) I2V(framePairs) 같은 모양 {error, stopped, G, mediaId:G, videoPath:null} → videoPath 붙이지 않고 complete 로 올리지 않는다(error 유지), base64 없음', async () => {
    persist({ framePairs: [{ id: 'fp_1', startSceneId: 'scene_1', prompt: 'p', videoSaveId: 'i2v_1', status: 'error', errorKind: 'stopped', generationId: G_NEW, mediaId: G_NEW, videoPath: null }] })
    const loaded = await loadProjectWithResources('proj')
    expect(loaded.framePairs[0]).toMatchObject({ id: 'fp_1', status: 'error', errorKind: 'stopped', generationId: G_NEW, mediaId: G_NEW, videoPath: null })
    expect(loaded.framePairs[0].base64).toBeUndefined()
  })

  it('(b) 옛 complete + G + mediaId:null + videoPath:null(memory 모드 행) → 여전히 리맵돼 complete 유지 — complete 제외 절의 핀', async () => {
    persist({ videoScenes: [{ id: 'vscene_3', prompt: 'p3', videoSaveId: 't2v_3', status: 'complete', generationId: G_OLD, mediaId: null, videoPath: null }] })
    const loaded = await loadProjectWithResources('proj')
    expect(loaded.videoScenes[0]).toMatchObject({ id: 'vscene_3', status: 'complete', videoPath: '/proj/videos/t2v_3.mp4', generationId: G_OLD })
  })

  it('(c) error + G + mediaId:null + stale videoPath → 현재 폴더로 리맵된다 — videoPath 절의 핀', async () => {
    persist({ videoScenes: [{ id: 'vscene_4', prompt: 'p4', videoSaveId: 't2v_4', status: 'error', generationId: G_OLD, mediaId: null, videoPath: '/old-folder/videos/t2v_4.mp4' }] })
    const loaded = await loadProjectWithResources('proj')
    expect(loaded.videoScenes[0]).toMatchObject({ id: 'vscene_4', videoPath: '/proj/videos/t2v_4.mp4', generationId: G_OLD })
  })
})
