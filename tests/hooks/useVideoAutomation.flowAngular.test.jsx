/**
 * useVideoAutomation × useFlowEngine — flow.google.com 렌더러 통합 (c) (M2-6)
 *
 * 실제 useFlowEngine + useVideoAutomation 을 window.electronAPI.flow* 모킹(main 의 새 결과 계약) 위에서 돌린다:
 *   세션 판정 → flowGenerateVideoT2V(resolution·token:null) → flowCheckVideoStatus(pending → complete+videoUrl)
 *   → flowDownloadVideoUrl({url, token:null}) → saveVideo → complete. 클릭 전 거부(flow-resolution-not-offered {requested})
 *   는 항목 error + 렌더 텍스트에 값, 다운로드 없음. postClick/거부 id 결과(불일치·quota·submit-lost)는 새 제출만 멈추고
 *   pending 은 끝까지 — 미제출 항목은 flow-batch-halted {cause}.
 */
import { renderHook, act, render } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { useFlowEngine } from '../../src/engine/engineFlow'
import { __resetQuotaStopForTests, subscribeQuotaStop } from '../../src/utils/quotaStop'
import ResultsTable from '../../src/components/ResultsTable'
import { I18nProvider } from '../../src/hooks/useI18n'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    saveVideo: vi.fn(async (_p, videoId) => ({ success: true, path: `/proj/videos/${videoId}.mp4` })),
  },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn(async () => ({ success: true })) }))
vi.mock('../../src/firebase/functions', () => ({ consumeBatchDownload: vi.fn(async () => ({ charged: false })) }))

import { fileSystemAPI } from '../../src/hooks/useFileSystem'
import { toast } from '../../src/components/Toast'
import { retryVideoDownload } from '../../src/services/videoRecovery'

const UUID11 = '<uuid#11>'
const SIGNED = 'https://flow-content.google/video/<uuid#11>?Expires=1790261742&KeyName=labs-flow-prod-cdn-key&Signature=SIG'
const MISMATCH = { success: false, errorKind: 'flow-video-settings-mismatch', error: 'flow-video-settings-mismatch', errorParams: { expected: 'Omni Flash 6s 16:9 720p', actual: 'veo_3_1_t2v_fast_6s' }, rejectedMediaId: UUID11, postClick: true }
const QUOTA = { success: false, errorKind: 'flow-rpc-error', error: 'RESOURCE_EXHAUSTED', rpcCode: 8, postClick: true }
const LOST = { success: false, errorKind: 'flow-submit-lost', error: 'flow-submit-lost', postClick: true }
const NOT_OFFERED = { success: false, errorKind: 'flow-resolution-not-offered', error: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } }

const api = {}
beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers({ now: 1790240102500 })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.clearAllMocks()
  // main(flow-angular) 의 새 계약: 제출은 mediaId 를 generationId 로, 상태 폴은 id 당 pending → complete(+서명 URL)
  const polls = new Map()
  Object.assign(api, {
    flowSessionStatus: vi.fn(async () => ({ ready: true, credits: 1050 })),
    flowExtractProjectId: vi.fn(async () => ({ projectId: 'proj-1' })),
    flowGenerateVideoT2V: vi.fn(async ({ prompt }) => ({ success: true, generationId: `${UUID11}:${prompt}`, creditsLeft: 1040 })),
    flowCheckVideoStatus: vi.fn(async ({ generationIds }) => ({
      success: true,
      statuses: generationIds.map((id) => {
        const n = (polls.get(id) || 0) + 1; polls.set(id, n)
        return n === 1 ? { status: 'pending' } : { status: 'complete', mediaId: id, videoUrl: SIGNED }
      }),
    })),
    flowDownloadVideoUrl: vi.fn(async () => ({ success: true, base64: 'data:video/mp4;base64,AQID' })),
    flowDomDownloadVideo: vi.fn(async () => ({ success: false, error: 'not used' })),
  })
  Object.assign(window.electronAPI, api)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function setup() {
  const onItemUpdate = vi.fn()
  const hook = renderHook(() => {
    const engine = useFlowEngine({})
    const video = useVideoAutomation(engine, (k) => k, null, null, 'flow')
    return { engine, video }
  })
  return { hook, onItemUpdate }
}
const SCENES = (n) => Array.from({ length: n }, (_, i) => ({ id: `vscene_${i + 1}`, prompt: `p${i + 1}` }))
async function run(h, scenes, opts = {}, ms = 40000) {
  let p
  await act(async () => {
    p = h.hook.result.current.video.start({
      mode: 't2v', scenes, projectName: 'proj', saveMode: 'folder', videoModel: 'Omni Flash', aspectRatio: '16:9', duration: 6, videoResolution: '720p',
      videoBatchCount: 1, seed: null, concurrency: 5, flowPacingMinMs: 1000, flowPacingMaxMs: 1000, onItemUpdate: h.onItemUpdate, ...opts,
    })
  })
  for (let t = 0; t < ms; t += 500) await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  await act(async () => { await p })
}
const patches = (h, id) => h.onItemUpdate.mock.calls.filter((c) => c[0] === id).map((c) => [c[1], c[2] || {}])
const last = (h, id) => patches(h, id).at(-1)
const renderErrors = (items) => {
  const { container } = render(<I18nProvider><ResultsTable items={items} mediaType="video" onVideoRetry={vi.fn()} /></I18nProvider>)
  return Array.from(container.querySelectorAll('.prompt-error')).map((el) => el.textContent)
}

describe('useVideoAutomation × useFlowEngine — 성공 경로', () => {
  it('ready → flowGenerateVideoT2V(resolution 720p, token null, model/ratio/duration) → pending → complete → flowDownloadVideoUrl({url, token:null}) → saveVideo → complete', async () => {
    const h = setup()
    await run(h, SCENES(1))
    expect(api.flowSessionStatus).toHaveBeenCalled()
    expect(api.flowGenerateVideoT2V).toHaveBeenCalledTimes(1)
    expect(api.flowGenerateVideoT2V.mock.calls[0][0]).toMatchObject({ token: null, prompt: 'p1', model: 'Omni Flash', aspectRatio: '16:9', duration: 6, resolution: '720p', projectId: 'proj-1', refs: [], plan: null })
    expect(api.flowGenerateVideoT2V.mock.calls[0][0]).not.toHaveProperty('segments')   // M3: 옛 칩 필드는 싣지 않는다(main 은 계속 거부)
    expect(api.flowCheckVideoStatus).toHaveBeenCalledWith(expect.objectContaining({ token: null, generationIds: [`${UUID11}:p1`] }))
    expect(api.flowDownloadVideoUrl).toHaveBeenCalledWith({ url: SIGNED, token: null })
    expect(api.flowDomDownloadVideo).not.toHaveBeenCalled()
    expect(fileSystemAPI.saveVideo).toHaveBeenCalledWith('proj', 't2v_1', 'data:video/mp4;base64,AQID', expect.anything(), expect.objectContaining({ mediaId: `${UUID11}:p1` }))
    const [st, patch] = last(h, 'vscene_1')
    expect(st).toBe('complete')
    expect(patch).toMatchObject({ videoPath: '/proj/videos/t2v_1.mp4', mediaId: `${UUID11}:p1`, generationId: `${UUID11}:p1`, error: null, errorKind: null })
    expect(h.hook.result.current.video.status).toBe('done')
  })

  // 2026-10-19 업스케일 복구(사용자 결정): Flow 모드의 해상도 설정 = 다운로드 해상도. 생성은 늘 720p(새 Flow 패널은 {360p, 720p}),
  //   1080p/4K 는 완료 뒤 DOM 다운로드(⋮ → 다운로드 → 1080p)로 업스케일해 받는다. 서명 URL 은 mediaId 를 뽑는 데만 쓴다.
  const REAL = 'ba1764fb-6f24-49d4-9b1e-6c13af2f1f7b'
  const SIGNED_REAL = `https://flow-content.google/video/${REAL}?Expires=1&KeyName=k&Signature=s`
  const completeWith = (url) => async ({ generationIds }) => ({ success: true, statuses: generationIds.map((id) => ({ status: 'complete', mediaId: id, videoUrl: url })) })

  it('resolution 1080p → 생성은 720p, 완료 뒤 DOM 업스케일 다운로드(mediaId·1080p) → 저장', async () => {
    api.flowCheckVideoStatus.mockImplementation(completeWith(SIGNED_REAL))
    api.flowDomDownloadVideo.mockResolvedValue({ success: true, base64: 'data:video/mp4;base64,SEQ=', mimeType: 'video/mp4', resolution: '1080p' })
    const h = setup()
    await run(h, SCENES(1), { videoResolution: '1080p' })
    expect(api.flowGenerateVideoT2V.mock.calls[0][0]).toMatchObject({ resolution: '720p' })
    expect(api.flowDomDownloadVideo).toHaveBeenCalledWith({ mediaId: REAL, resolution: '1080p' })
    expect(api.flowDownloadVideoUrl).not.toHaveBeenCalled()
    expect(fileSystemAPI.saveVideo).toHaveBeenCalledWith('proj', 't2v_1', 'data:video/mp4;base64,SEQ=', expect.anything(), expect.objectContaining({ resolution: '1080p' }))
    expect(last(h, 'vscene_1')[0]).toBe('complete')
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('resolution 1080p 인데 DOM 업스케일 실패 → 720p 원본(서명 URL)으로 저장, 영상은 잃지 않는다', async () => {
    api.flowCheckVideoStatus.mockImplementation(completeWith(SIGNED_REAL))
    api.flowDomDownloadVideo.mockResolvedValue({ success: false, errorKind: 'flow-download-tile-not-found', error: 'flow-download-tile-not-found' })
    const h = setup()
    await run(h, SCENES(1), { videoResolution: '1080p' })
    expect(api.flowDownloadVideoUrl).toHaveBeenCalledWith({ url: SIGNED_REAL, token: null })
    expect(fileSystemAPI.saveVideo).toHaveBeenCalledWith('proj', 't2v_1', 'data:video/mp4;base64,AQID', expect.anything(),
      expect.objectContaining({ resolution: '720p', downloadNotice: { kind: 'upscale-fallback', requested: '1080p', saved: '720p', reason: 'flow-download-tile-not-found' } }))
    expect(last(h, 'vscene_1')[0]).toBe('complete')
    // Codex R1 #3: 낮은 해상도로 저장됐음을 알린다 — 배치 끝에 한 번(Fable #8)
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith('videoAutomation.savedAtLowerResolution')
  })

  it('resolution 4k 인데 4K 가 막혀 1080p 로 받음 → 메타에 실제 해상도 · 경고', async () => {
    api.flowCheckVideoStatus.mockImplementation(completeWith(SIGNED_REAL))
    api.flowDomDownloadVideo.mockResolvedValue({ success: true, base64: 'data:video/mp4;base64,SEQ=', mimeType: 'video/mp4', resolution: '1080p', downgradedFrom: '4k' })
    const h = setup()
    await run(h, SCENES(1), { videoResolution: '4k', videoModel: 'Veo 3.1 - Fast' })
    expect(api.flowDomDownloadVideo).toHaveBeenCalledWith({ mediaId: REAL, resolution: '4k' })
    expect(fileSystemAPI.saveVideo).toHaveBeenCalledWith('proj', 't2v_1', 'data:video/mp4;base64,SEQ=', expect.anything(),
      expect.objectContaining({ resolution: '1080p', downloadNotice: { kind: 'upscale-downgraded', requested: '4k', saved: '1080p' } }))
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith('videoAutomation.savedAtLowerResolution')
  })

  it('4K + Omni Flash → 생성 모델 한계로 깎지 않고 4K 를 요청한다(Codex R2 #2 · Fable #4)', async () => {
    api.flowCheckVideoStatus.mockImplementation(completeWith(SIGNED_REAL))
    api.flowDomDownloadVideo.mockResolvedValue({ success: true, base64: 'data:video/mp4;base64,SEQ=', mimeType: 'video/mp4', resolution: '4k' })
    const h = setup()
    await run(h, SCENES(1), { videoResolution: '4k' })   // videoModel 기본 'Omni Flash'
    expect(api.flowGenerateVideoT2V.mock.calls[0][0]).toMatchObject({ resolution: '720p' })
    expect(api.flowDomDownloadVideo).toHaveBeenCalledWith({ mediaId: REAL, resolution: '4k' })
  })

  it('저장이 실패하면 "낮은 해상도로 저장" 으로 세지 않는다(Codex R3 #3)', async () => {
    api.flowCheckVideoStatus.mockImplementation(completeWith(SIGNED_REAL))
    api.flowDomDownloadVideo.mockResolvedValue({ success: false, errorKind: 'flow-upscale-unavailable', error: 'flow-upscale-unavailable' })
    fileSystemAPI.saveVideo.mockResolvedValueOnce({ success: false, error: 'disk full' })
    const h = setup()
    await run(h, SCENES(1), { videoResolution: '1080p' })
    expect(last(h, 'vscene_1')[0]).toBe('error')
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('다운로드 전용 항목(Phase 0)의 알림도 모으고, 새 제출이 막혀 일찍 끝나도 한 번 알린다(Fable R2 #2)', async () => {
    retryVideoDownload.mockResolvedValueOnce({ success: true, downloadNotice: { kind: 'upscale-fallback', requested: '1080p', saved: '720p' } })
    api.flowGenerateVideoT2V.mockResolvedValue(LOST)
    const h = setup()
    const scenes = [
      { id: 'vscene_1', prompt: 'p1', status: 'error', generationId: REAL, mediaId: REAL, downloadGated: true },
      { id: 'vscene_2', prompt: 'p2' },
    ]
    await run(h, scenes, { videoResolution: '1080p' }, 5000)
    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith('videoAutomation.savedAtLowerResolution')
  })

  it('세 항목이 모두 낮은 해상도로 저장돼도 경고는 배치 끝에 한 번(Fable #8)', async () => {
    api.flowCheckVideoStatus.mockImplementation(completeWith(SIGNED_REAL))
    api.flowDomDownloadVideo.mockResolvedValue({ success: false, errorKind: 'flow-upscale-unavailable', error: 'flow-upscale-unavailable' })
    const h = setup()
    await run(h, SCENES(3), { videoResolution: '1080p' })
    expect(fileSystemAPI.saveVideo).toHaveBeenCalledTimes(3)
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith('videoAutomation.savedAtLowerResolution')
  })
})

describe('useVideoAutomation × useFlowEngine — 새 제출만 중단(통합판)', () => {
  it('3항목 #2 모델키 불일치 → #1 다운로드 완료, #2 rejectedMediaId 기록(mediaId/generationId 없음), #3 flow-batch-halted {cause}', async () => {
    api.flowGenerateVideoT2V.mockImplementation(async ({ prompt }) => (prompt === 'p2' ? MISMATCH : { success: true, generationId: `${UUID11}:${prompt}`, creditsLeft: 1040 }))
    const h = setup()
    await run(h, SCENES(3))
    expect(api.flowGenerateVideoT2V).toHaveBeenCalledTimes(2)
    expect(last(h, 'vscene_1')[0]).toBe('complete')
    expect(api.flowDownloadVideoUrl).toHaveBeenCalledTimes(1)
    const p2 = last(h, 'vscene_2')[1]
    expect(p2).toMatchObject({ errorKind: 'flow-video-settings-mismatch', errorParams: MISMATCH.errorParams, rejectedMediaId: UUID11 })
    expect(p2).not.toHaveProperty('mediaId')
    expect(p2).not.toHaveProperty('generationId')
    expect(last(h, 'vscene_3')[1]).toEqual({ error: 'flow-batch-halted', errorKind: 'flow-batch-halted', errorParams: { cause: 'flow-video-settings-mismatch' } })
    expect(h.hook.result.current.video.status).toBe('error')
    const texts = renderErrors([{ id: 'vscene_2', prompt: 'p2', status: 'error', ...p2 }, { id: 'vscene_3', prompt: 'p3', status: 'error', ...last(h, 'vscene_3')[1] }])
    expect(texts[0]).toContain('veo_3_1_t2v_fast_6s')
    expect(texts[1]).toContain('flow-video-settings-mismatch')
    for (const tx of texts) expect(tx).not.toMatch(/\{\w+\}/)
  })

  it('3항목 #2 quota(code 8) → 동일 + 모달 리스너 1회 + #1 완료 + 최종 status stopped(quota 문구)', async () => {
    const listener = vi.fn()
    subscribeQuotaStop(listener)
    api.flowGenerateVideoT2V.mockImplementation(async ({ prompt }) => (prompt === 'p2' ? QUOTA : { success: true, generationId: `${UUID11}:${prompt}`, creditsLeft: 1040 }))
    const h = setup()
    await run(h, SCENES(3))
    expect(api.flowGenerateVideoT2V).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(last(h, 'vscene_1')[0]).toBe('complete')
    expect(last(h, 'vscene_3')[1]).toEqual({ error: 'flow-batch-halted', errorKind: 'flow-batch-halted', errorParams: { cause: 'flow-rpc-error' } })
    expect(h.hook.result.current.video.status).toBe('stopped')
    expect(h.hook.result.current.video.statusMessage).toMatch(/quota|limit reached|한도/i)
  })

  it('flow-submit-lost(크레딧 감소, postClick) → 항목 error + 새 제출 중단; #1 은 끝까지', async () => {
    api.flowGenerateVideoT2V.mockImplementation(async ({ prompt }) => (prompt === 'p2' ? LOST : { success: true, generationId: `${UUID11}:${prompt}`, creditsLeft: 1040 }))
    const h = setup()
    await run(h, SCENES(3))
    expect(api.flowGenerateVideoT2V).toHaveBeenCalledTimes(2)
    expect(last(h, 'vscene_2')[1]).toMatchObject({ errorKind: 'flow-submit-lost', error: 'flow-submit-lost' })
    expect(last(h, 'vscene_3')[1]).toEqual({ error: 'flow-batch-halted', errorKind: 'flow-batch-halted', errorParams: { cause: 'flow-submit-lost' } })
    expect(last(h, 'vscene_1')[0]).toBe('complete')
  })
})

// M3-14(계획서 docs/plans/2026-09-25-flow-M3-references-plan.md §4 M3-14 · D10·D12·D14): 레퍼런스 영상(r2v) — 실제 useVideoAutomation(item.referenceImages) →
//   실제 useFlowEngine.generateVideoT2V 가 @멘션을 계획해 IPC refs(바이트)·plan(인라인 멘션)으로 보낸다. main 이 클릭 뒤 레퍼런스 불일치로 거부하면
//   (flow-references-mismatch + rejectedMediaId, postClick — 과금됨) 새 제출만 멈추고 제출된 항목은 끝까지 간다.
describe('useVideoAutomation × useFlowEngine — 레퍼런스 영상 (M3-14)', () => {
  const KING = { name: 'king', data: 'data:image/png;base64,iVBORw0KGgoKING' }
  const REF_SCENES = (n) => Array.from({ length: n }, (_, i) => ({ id: `vscene_${i + 1}`, prompt: `@king p${i + 1}`, referenceImages: [KING] }))
  const REFS_MISMATCH = { success: false, errorKind: 'flow-references-mismatch', error: 'flow-references-mismatch', errorParams: {}, rejectedMediaId: UUID11, postClick: true }

  it('3항목 #2 flow-references-mismatch(rejectedMediaId) → #1 다운로드 완료, #2 거부 id 만(mediaId/generationId 없음), #3 flow-batch-halted {cause:flow-references-mismatch}', async () => {
    api.flowGenerateVideoT2V.mockImplementation(async ({ prompt }) => (prompt === '@king p2' ? REFS_MISMATCH : { success: true, generationId: `${UUID11}:${prompt}`, creditsLeft: 1033 }))
    const h = setup()
    await run(h, REF_SCENES(3), { duration: 4, aspectRatio: '9:16' })
    expect(api.flowGenerateVideoT2V).toHaveBeenCalledTimes(2)
    // 제출된 두 항목 모두 엔진이 계획한 레퍼런스(바이트)·인라인 멘션을 싣는다 — 옛 칩 segments 는 없다
    for (const [call, n] of [[0, 1], [1, 2]]) {
      const payload = api.flowGenerateVideoT2V.mock.calls[call][0]
      expect(payload).toMatchObject({ token: null, prompt: `@king p${n}`, model: 'Omni Flash', aspectRatio: '9:16', duration: 4, projectId: 'proj-1' })
      expect(payload.refs).toEqual([{ base64: 'iVBORw0KGgoKING', mime: 'image/png' }])
      expect(payload.plan).toEqual({ segments: [{ t: 'mention', ref: 0 }, { t: 'text', text: ` p${n}` }], attach: [] })
      expect(payload).not.toHaveProperty('segments')
    }
    // #1 은 끝까지(폴 → 다운로드 → 저장)
    expect(last(h, 'vscene_1')[0]).toBe('complete')
    expect(api.flowDownloadVideoUrl).toHaveBeenCalledTimes(1)
    expect(fileSystemAPI.saveVideo).toHaveBeenCalledWith('proj', 't2v_1', 'data:video/mp4;base64,AQID', expect.anything(), expect.objectContaining({ mediaId: `${UUID11}:@king p1` }))
    // #2 는 거부한 미디어 id 만 — 다운로드 대상이 되지 않게 mediaId/generationId 키가 없다
    const [st2, p2] = last(h, 'vscene_2')
    expect(st2).toBe('error')
    expect(p2).toMatchObject({ errorKind: 'flow-references-mismatch', rejectedMediaId: UUID11 })
    expect(p2).not.toHaveProperty('mediaId')
    expect(p2).not.toHaveProperty('generationId')
    expect(api.flowCheckVideoStatus.mock.calls.flatMap((c) => c[0].generationIds)).not.toContain(UUID11)
    // #3 은 제출하지 않고 중단 사유를 남긴다
    expect(last(h, 'vscene_3')[1]).toEqual({ error: 'flow-batch-halted', errorKind: 'flow-batch-halted', errorParams: { cause: 'flow-references-mismatch' } })
    expect(h.hook.result.current.video.status).toBe('error')
    const texts = renderErrors([{ id: 'vscene_2', prompt: '@king p2', status: 'error', ...p2 }, { id: 'vscene_3', prompt: '@king p3', status: 'error', ...last(h, 'vscene_3')[1] }])
    expect(texts[0]).toContain('Flow generated with different references than requested, so the result was not used.')
    expect(texts[1]).toContain('flow-references-mismatch')
    for (const tx of texts) expect(tx).not.toMatch(/\{\w+\}/)
  })
})
