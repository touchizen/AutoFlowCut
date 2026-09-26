/**
 * videoRecovery.recoverInFlightVideos — failed 분기의 모양 (M2-R3 H2, A2 + B1 일부)
 *
 * 로드 시 복구가 `{failed, flow-video-fetch-failed | flow-video-not-found, mediaId}` 를 받으면(프로젝트를 여러 번 다시 열어 main 의 as29s/no-record
 * 4회 유계에 닿는다) 옛 분기는 error 문구만 남기고 mediaId·errorKind 를 버렸다 — 과금된 미디어가 `error + generationId + mediaId:null` 로 남아
 * 다음 Start 가 재제출(10크레딧)한다. G3 의 retryVideoDownload failed 분기와 같은 모양(errorKind ?? null · errorParams · mediaId(답에 있을 때) ·
 * generationId 유지)이어야 useProjectData 의 `{...vs, ...patch}` 머지 뒤 download-only 로 분류돼 다음 start() 가 retryVideoDownload 로 간다.
 * 실제 recoverInFlightVideos → 실제 훅 start() 로 끝까지 본다(retryVideoDownload 는 같은 모듈의 실제 함수를 스파이로 감쌌다).
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }), saveVideo: vi.fn() },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../src/utils/videoMetadata', () => ({ pickVideoMetadata: vi.fn(() => ({})), buildVideoMetaPatch: vi.fn(() => ({})) }))
vi.mock('../../src/services/videoRecovery', async (importOriginal) => {
  const m = await importOriginal()
  return { ...m, retryVideoDownload: vi.fn(m.retryVideoDownload) }
})

import { recoverInFlightVideos, retryVideoDownload } from '../../src/services/videoRecovery'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

const G = '12345678-1234-1234-1234-123456789abc'   // Flow generationId = mediaId(UUID — mode:'flow' 의 엔진 필터를 지난다)
/** engineFlow.checkVideoStatus 의 index-zip 모양(main 의 {failed, kind, mediaId} 통과). */
const failedStatus = (kind) => ({ success: true, statuses: [{ generationId: G, status: 'failed', errorKind: kind, error: kind, mediaId: G, videoUrl: G, progress: null }] })

beforeEach(() => { __resetQuotaStopForTests(); vi.spyOn(Math, 'random').mockReturnValue(0) })
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('recoverInFlightVideos — failed 분기는 G3 의 retryVideoDownload 와 같은 모양 (M2-R3 H2)', () => {
  it.each(['flow-video-fetch-failed', 'flow-video-not-found'])('%s + mediaId → 패치에 errorKind·mediaId·generationId → 머지 뒤 download-only → 다음 start() 는 retryVideoDownload, generateVideoT2V 없음', async (kind) => {
    // 재시작 뒤 resetGeneratingItem 모양: generating → pending, mediaId 는 제출 패치가 null 로 지운 상태
    const persisted = { id: 'vscene_1', prompt: 'p1', status: 'pending', generationId: G, mediaId: null, videoPath: null }
    const checkVideoStatus = vi.fn().mockResolvedValue(failedStatus(kind))
    const patches = []
    const res = await recoverInFlightVideos({
      framePairs: [persisted], projectName: 'proj', mode: 'flow', checkVideoStatus, downloadVideo: vi.fn(),
      onFramePairUpdate: (id, patch) => patches.push([id, patch]),
    })
    expect(res).toMatchObject({ total: 1, recovered: 0, expired: 1 })
    expect(patches).toHaveLength(1)
    const [id, patch] = patches[0]
    expect(id).toBe('vscene_1')
    expect(patch).toMatchObject({ status: 'error', error: kind, errorKind: kind, mediaId: G, generationId: G })
    expect(patch).not.toHaveProperty('errorParams')
    // useProjectData.applyVideoScenePatch 와 같은 머지 → download-only(error + generationId + mediaId + !videoPath)
    const merged = { ...persisted, ...patch }
    expect(merged).toMatchObject({ status: 'error', generationId: G, mediaId: G, videoPath: null })

    const genAPI = { generateVideoT2V: vi.fn(), generateVideoI2V: vi.fn(), checkVideoStatus, downloadVideo: vi.fn(), upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('flow-session') }
    const onItemUpdate = vi.fn()
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow'))
    await act(async () => {
      await hook.result.current.start({ mode: 't2v', scenes: [merged], projectName: 'proj', saveMode: 'folder', videoModel: 'Omni Flash', aspectRatio: '16:9', duration: 6, videoResolution: '720p', onItemUpdate })
    })
    expect(genAPI.generateVideoT2V).not.toHaveBeenCalled()
    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
    expect(retryVideoDownload.mock.calls[0][0].item).toMatchObject({ id: 'vscene_1', generationId: G, mediaId: G })
    expect(checkVideoStatus).toHaveBeenLastCalledWith([G])   // download-only 경로의 상태 확인(재제출 아님)
    expect(hook.result.current.isRunning).toBe(false)
  })

  it('kind 없는 failed(옛 Veo 경로) 는 errorKind:null, mediaId 없음, generationId 유지 — F1/G3 과 같은 꼴', async () => {
    const patches = []
    await recoverInFlightVideos({
      framePairs: [{ id: 'fp_1', prompt: 'p', status: 'pending', generationId: 'models/veo/operations/op1', mediaId: null, videoPath: null }],
      projectName: 'proj', mode: 'api', checkVideoStatus: vi.fn().mockResolvedValue({ success: true, statuses: [{ status: 'failed', error: 'Video generation failed' }] }), downloadVideo: vi.fn(),
      onFramePairUpdate: (id, patch) => patches.push([id, patch]),
    })
    expect(patches[0][1]).toMatchObject({ status: 'error', error: 'Video generation failed', errorKind: null, generationId: 'models/veo/operations/op1' })
    expect(patches[0][1]).not.toHaveProperty('mediaId')
  })
})
