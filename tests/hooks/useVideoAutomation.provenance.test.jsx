/**
 * useVideoAutomation Phase 0 — Flow 모드는 status 가 아니라 **출처(provenance)** 로 분류한다 (M2-R3 H3, A3 + B1)
 *
 * 돈 규칙: Flow 의 제출된 항목은 YhhmEf 200 순간 과금됐고 generationId 가 곧 미디어 id 다. **generationId 가 있고 videoPath 가 없는 항목은 절대 새 제출이 아니다** —
 * mediaId 가 있으면 download-only, 없으면 in-flight(폴) — status 가 무엇이든(재시작 뒤 resetGeneratingItem 의 pending · generating · 옛 auth 패치의 error · stopped).
 * 옛 분류는 status 로 봤다(in-flight = 'generating' 만, download-only = 'error' 만): 앱을 껐다 켜면(복구는 Flow 프로젝트 open 이 확인돼야만 돌고 다시 돌지 않는다)
 * pending+generationId 가 fresh 로 잡혀 과금된 영상을 다시 제출했다. Regenerate/Clear 만 generationId·mediaId 를 null 로 지워 fresh 로 만든다.
 * API 모드는 기존 status 규칙 그대로(pending+generationId 는 fresh).
 * M2-R4 I4(A3): 출처 분류는 **엔진 모양**도 본다 — Flow 의 generationId 는 UUID(recoverInFlightVideos 의 #R34-1 필터와 같은 모양). API(Veo) 의 operation 이름
 *   (`models/veo/operations/…`)을 든 항목이 Flow 모드에서 Start 되면 전엔 in-flight 로 잡혀 jwpduf 가 4회 레코드 없음 → flow-video-not-found(+mediaId=operation 이름)로
 *   닫혔다(양 모드에서 영원히 download-only). 그 항목은 이 라운드 전처럼 fresh 다. 픽스처 id 는 그래서 UUID.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { resetGeneratingItem } from '../../src/hooks/useProjectData'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }), saveVideo: vi.fn(async (_p, videoId) => ({ success: true, path: `/proj/videos/${videoId}.mp4` })) },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn(async () => ({ success: true })) }))
vi.mock('../../src/utils/videoMetadata', () => ({ pickVideoMetadata: vi.fn(() => ({})), buildVideoMetaPatch: vi.fn(() => ({})) }))

import { retryVideoDownload } from '../../src/services/videoRecovery'

const SIGNED = 'https://flow-content.google/video/<uuid#11>?Expires=1&KeyName=k&Signature=SIG'
const G = '0f3b9c1e-5d2a-4b7c-8e9f-0a1b2c3d4e5f'   // M2-R4 I4: 과금된 Flow 제출 id 는 UUID 모양
const OP = 'models/veo-3.1-fast-generate-preview/operations/op-old-1'   // API(Veo) operation 이름 — Flow 가 만든 id 가 아니다
const COMPLETE = (gid) => ({ generationId: gid, status: 'complete', mediaId: gid, videoUrl: SIGNED, error: null })
const OPTS = { mode: 't2v', projectName: 'proj', saveMode: 'folder', videoModel: 'Omni Flash', aspectRatio: '16:9', duration: 6, videoResolution: '720p', videoBatchCount: 1, seed: null, concurrency: 5, flowPacingMinMs: 1000, flowPacingMaxMs: 1000 }

beforeEach(() => { __resetQuotaStopForTests(); vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0); vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function setup(appMode = 'flow') {
  let n = 0
  const generateVideoT2V = vi.fn(async () => ({ success: true, generationId: `gen-new-${++n}`, creditsLeft: 1040 }))
  const checkVideoStatus = vi.fn(async (ids) => ({ success: true, statuses: ids.map(COMPLETE) }))
  const downloadVideo = vi.fn(async () => ({ success: true, base64: 'data:video/mp4;base64,AQID' }))
  const genAPI = { generateVideoT2V, generateVideoI2V: vi.fn(), checkVideoStatus, downloadVideo, upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('token'), flowSessionReason: vi.fn(() => null) }
  const onItemUpdate = vi.fn()
  const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, appMode))
  return { hook, genAPI, onItemUpdate, generateVideoT2V, checkVideoStatus, downloadVideo }
}
async function run(h, scenes, ms = 20000) {
  let p
  await act(async () => { p = h.hook.result.current.start({ ...OPTS, scenes, onItemUpdate: h.onItemUpdate }) })
  for (let t = 0; t < ms; t += 500) await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  await act(async () => { await p })
}
const last = (h, id) => h.onItemUpdate.mock.calls.filter((c) => c[0] === id).map((c) => [c[1], c[2] || {}]).at(-1)
const expectPolledNotSubmitted = (h, gid) => {
  expect(h.generateVideoT2V).not.toHaveBeenCalled()
  expect(retryVideoDownload).not.toHaveBeenCalled()
  expect(h.checkVideoStatus).toHaveBeenCalled()
  expect(h.checkVideoStatus.mock.calls[0][0]).toEqual([gid])
  expect(h.downloadVideo).toHaveBeenCalledTimes(1)
  expect(last(h, 'vscene_1')[0]).toBe('complete')
  expect(last(h, 'vscene_1')[1]).toMatchObject({ generationId: gid, mediaId: gid })
}

describe('useVideoAutomation Phase 0 — Flow 모드 출처 분류 (M2-R3 H3)', () => {
  it('(a) 재시작 뒤 resetGeneratingItem 모양(pending + generationId, mediaId null, 복구 미실행) → 폴링(in-flight), 재제출 없음', async () => {
    // 제출 패치가 남긴 persisted 상태(generating + generationId, mediaId/videoPath null) → 로드 시 resetGeneratingItem 이 pending 으로 내린다
    const persisted = { id: 'vscene_1', prompt: 'p1', status: 'generating', generationId: G, mediaId: null, videoPath: null, generatingStartedAt: 123 }
    const restored = resetGeneratingItem(persisted)
    expect(restored).toMatchObject({ status: 'pending', generationId: G, mediaId: null })
    const h = setup('flow')
    await run(h, [restored])
    expectPolledNotSubmitted(h, G)
  })

  it('(b) generating + generationId + mediaId(중단된 download-only 재시도) → download-only(retryVideoDownload), 제출·폴 없음', async () => {
    const h = setup('flow')
    await run(h, [{ id: 'vscene_1', prompt: 'p1', status: 'generating', generationId: G, mediaId: G, videoPath: null }])
    expect(h.generateVideoT2V).not.toHaveBeenCalled()
    expect(h.checkVideoStatus).not.toHaveBeenCalled()
    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
    expect(retryVideoDownload.mock.calls[0][0].item).toMatchObject({ id: 'vscene_1', generationId: G, mediaId: G })
  })

  it('(c) error + generationId + mediaId:null(옛 auth 패치·거부 kind 잔존) → 폴링(in-flight), 재제출 없음', async () => {
    const h = setup('flow')
    await run(h, [{ id: 'vscene_1', prompt: 'p1', status: 'error', generationId: G, mediaId: null, videoPath: null, error: 'Auth error. Please login to Flow and try again.', errorKind: 'auth' }])
    expectPolledNotSubmitted(h, G)
  })

  it('(c2) stopped 도 같다: error/stopped + generationId, mediaId null(옛 G1(b) 이전 패치) → 폴링', async () => {
    const h = setup('flow')
    await run(h, [{ id: 'vscene_1', prompt: 'p1', status: 'error', generationId: G, mediaId: null, videoPath: null, errorKind: 'stopped' }])
    expectPolledNotSubmitted(h, G)
  })

  it('(d) Regenerate/Clear 로 generationId·mediaId 가 null 인 항목(옛 videoPath 폴백은 남아도) → fresh 제출', async () => {
    const h = setup('flow')
    await run(h, [{ id: 'vscene_1', prompt: 'p1', status: 'pending', generationId: null, mediaId: null, videoPath: '/proj/videos/t2v_1.mp4', error: null, errorKind: null }])
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(1)
    expect(retryVideoDownload).not.toHaveBeenCalled()
    expect(h.checkVideoStatus.mock.calls[0][0]).toEqual(['gen-new-1'])
  })

  it('(d2) complete + videoPath 는 전체 Start 에서 그대로 재생성(fresh) — 이슈1 유지', async () => {
    const h = setup('flow')
    await run(h, [{ id: 'vscene_1', prompt: 'p1', status: 'complete', generationId: 'gen-old', mediaId: 'gen-old', videoPath: '/proj/videos/t2v_1.mp4' }])
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(1)
    expect(retryVideoDownload).not.toHaveBeenCalled()
  })

  it('(f) Flow 모드에서 API operation 이름의 generationId(mediaId null, videoPath null) → Flow 가 만든 제출이 아니다 → fresh 제출(폴링·download-only 아님) (M2-R4 I4)', async () => {
    const h = setup('flow')
    await run(h, [{ id: 'vscene_1', prompt: 'p1', status: 'pending', generationId: OP, mediaId: null, videoPath: null }])
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(1)
    expect(retryVideoDownload).not.toHaveBeenCalled()
    expect(h.checkVideoStatus.mock.calls.flat(2)).not.toContain(OP)   // operation 이름을 jwpduf 로 폴하지 않는다
    expect(h.checkVideoStatus.mock.calls[0][0]).toEqual(['gen-new-1'])
    // error 상태 + operation 이름 + mediaId(API 의 download-only 모양)는 API 규칙(error+ids)대로 download-only — 엔진 필터는 in-flight 오분류만 막는다
    vi.clearAllMocks()
    const h2 = setup('flow')
    await run(h2, [{ id: 'vscene_1', prompt: 'p1', status: 'error', generationId: OP, mediaId: OP, videoPath: null }])
    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
    expect(h2.generateVideoT2V).not.toHaveBeenCalled()
  })

  it('(e) API 모드는 status 규칙 그대로: pending + generationId(mediaId null) → fresh 제출', async () => {
    const h = setup('api')
    await run(h, [{ id: 'vscene_1', prompt: 'p1', status: 'pending', generationId: 'op-old', mediaId: null, videoPath: null }])
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(1)
    expect(h.checkVideoStatus.mock.calls[0][0]).toEqual(['gen-new-1'])
    expect(retryVideoDownload).not.toHaveBeenCalled()
  })
})
