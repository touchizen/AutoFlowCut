/**
 * 낮은 해상도 저장 알림을 다시 받기(retryVideoDownload)·프로젝트 열 때 복구(recoverInFlightVideos)도 돌려준다 — Codex R2 #5.
 *   호출자(App 개별 다시 받기 · 훅 Phase 0 · useProjectData 복구)가 한 번 알린다. 메타데이터에는 실제 해상도와 사유가 남는다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../src/hooks/useFileSystem', () => ({ fileSystemAPI: { saveVideo: vi.fn(async (_p, id) => ({ success: true, path: `/proj/videos/${id}.mp4` })) } }))

import { retryVideoDownload, recoverInFlightVideos } from '../../src/services/videoRecovery'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'

afterEach(() => { vi.clearAllMocks() })

const MEDIA = 'ba1764fb-6f24-49d4-9b1e-6c13af2f1f7b'
const URL = `https://flow-content.google/video/${MEDIA}?Expires=1&KeyName=k&Signature=s`
const complete = { success: true, statuses: [{ generationId: MEDIA, status: 'complete', mediaId: MEDIA, videoUrl: URL }] }
const fallback = { success: true, base64: 'data:video/mp4;base64,AQID', resolution: '720p', upscaleFallback: { requested: '1080p', errorKind: 'flow-upscale-unavailable' } }
const NOTICE = { kind: 'upscale-fallback', requested: '1080p', saved: '720p', reason: 'flow-upscale-unavailable' }

describe('retryVideoDownload', () => {
  it('returns the lower-resolution notice and records it in the history metadata', async () => {
    const genAPI = { checkVideoStatus: vi.fn().mockResolvedValue(complete), downloadVideo: vi.fn().mockResolvedValue(fallback) }
    const res = await retryVideoDownload({ item: { id: 'vscene_1', generationId: MEDIA, mediaId: MEDIA }, genAPI, onUpdate: vi.fn(), projectName: 'p', videoResolution: '1080p' })
    expect(res).toEqual({ success: true, downloadNotice: NOTICE })
    expect(fileSystemAPI.saveVideo.mock.calls[0][4]).toMatchObject({ resolution: '720p', downloadNotice: NOTICE })
  })
  it('no notice when the requested resolution was saved', async () => {
    const genAPI = { checkVideoStatus: vi.fn().mockResolvedValue(complete), downloadVideo: vi.fn().mockResolvedValue({ success: true, base64: 'data:video/mp4;base64,AQID', resolution: '1080p' }) }
    const res = await retryVideoDownload({ item: { id: 'vscene_1', generationId: MEDIA, mediaId: MEDIA }, genAPI, onUpdate: vi.fn(), projectName: 'p', videoResolution: '1080p' })
    expect(res).toEqual({ success: true })
  })
})

describe('recoverInFlightVideos', () => {
  it('returns the notices of the recovered items', async () => {
    const r = await recoverInFlightVideos({
      framePairs: [{ id: 'vscene_1', generationId: MEDIA, status: 'generating' }],
      projectName: 'p', videoResolution: '1080p', mode: 'flow',
      checkVideoStatus: vi.fn().mockResolvedValue(complete), downloadVideo: vi.fn().mockResolvedValue(fallback),
      onFramePairUpdate: vi.fn(),
    })
    expect(r).toMatchObject({ recovered: 1, notices: [NOTICE] })
  })
})
