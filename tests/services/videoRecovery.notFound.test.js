/**
 * videoRecovery.retryVideoDownload — 상태 핸들러가 kind 를 실은 failed 를 답하면 그 kind 를 항목에 올린다 (M2-R2 G3, B6)
 *
 * download-only 경로(Phase 0 · handleVideoRetry)는 checkVideoStatus 한 번으로 판정한다. "레코드 없음" 4회째의 {failed, flow-video-not-found, mediaId}
 * 를 옛 분기가 error 문구만 남기고 errorKind 를 버려 표엔 raw 'flow-video-not-found' 토큰이 떴다. kind·params·mediaId(과금 안전)·generationId 를
 * 그대로 올린다 — 재생성 안내 문구가 보이고, Start 는 여전히 download-only(재제출 없음).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../src/hooks/useFileSystem', () => ({ fileSystemAPI: { saveVideo: vi.fn() } }))

import { retryVideoDownload } from '../../src/services/videoRecovery'

afterEach(() => { vi.clearAllMocks() })

/** engineFlow.checkVideoStatus 가 index-zip 으로 돌려주는 모양(generationId·videoUrl 폴백 포함). */
const failedStatus = (extra) => ({ success: true, statuses: [{ generationId: 'g1', status: 'failed', videoUrl: 'g1', mediaId: 'g1', error: 'flow-video-not-found', errorKind: 'flow-video-not-found', progress: null, ...extra }] })

describe('retryVideoDownload — failed 상태의 kind 를 항목에 올린다 (M2-R2 G3)', () => {
  it('{failed, flow-video-not-found, mediaId} → onUpdate error 패치에 errorKind·error·mediaId·generationId; 다운로드 없음; 결과 error 는 kind', async () => {
    const onUpdate = vi.fn()
    const genAPI = { checkVideoStatus: vi.fn().mockResolvedValue(failedStatus()), downloadVideo: vi.fn() }
    const res = await retryVideoDownload({ item: { id: 'vscene_1', generationId: 'g1', mediaId: 'g1' }, genAPI, onUpdate, projectName: 'p' })
    expect(res).toEqual({ success: false, error: 'flow-video-not-found' })
    expect(genAPI.downloadVideo).not.toHaveBeenCalled()
    const [id, status, patch] = onUpdate.mock.calls.at(-1)
    expect(id).toBe('vscene_1')
    expect(status).toBe('error')
    expect(patch).toMatchObject({ error: 'flow-video-not-found', errorKind: 'flow-video-not-found', mediaId: 'g1', generationId: 'g1' })
    expect(patch).not.toHaveProperty('errorParams')
  })

  it('kind 없는 failed(옛 Veo 경로) 는 errorKind:null 로 stale kind 를 지운다(F1 의 failed 분기와 같은 모양)', async () => {
    const onUpdate = vi.fn()
    const genAPI = { checkVideoStatus: vi.fn().mockResolvedValue({ success: true, statuses: [{ generationId: 'g1', status: 'failed', error: 'Video generation failed', mediaId: null }] }), downloadVideo: vi.fn() }
    await retryVideoDownload({ item: { id: 'vscene_1', generationId: 'g1', mediaId: 'g1' }, genAPI, onUpdate, projectName: 'p' })
    const [, , patch] = onUpdate.mock.calls.at(-1)
    expect(patch).toMatchObject({ error: 'Video generation failed', errorKind: null, generationId: 'g1' })
    expect(patch).not.toHaveProperty('mediaId')
  })
})
