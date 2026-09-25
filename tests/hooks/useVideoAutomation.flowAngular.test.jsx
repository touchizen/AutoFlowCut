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

  it('resolution 1080p → main 이 클릭 전에 flow-resolution-not-offered {requested} → 항목 error(렌더 텍스트에 1080p, 플레이스홀더 없음), 폴·다운로드 없음', async () => {
    api.flowGenerateVideoT2V.mockResolvedValue(NOT_OFFERED)
    const h = setup()
    await run(h, SCENES(1), { videoResolution: '1080p' }, 5000)
    expect(api.flowGenerateVideoT2V.mock.calls[0][0]).toMatchObject({ resolution: '1080p' })
    const [st, patch] = last(h, 'vscene_1')
    expect(st).toBe('error')
    expect(patch).toMatchObject({ errorKind: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } })
    expect(api.flowCheckVideoStatus).not.toHaveBeenCalled()
    expect(api.flowDownloadVideoUrl).not.toHaveBeenCalled()
    const [text] = renderErrors([{ id: 'vscene_1', prompt: 'p1', status: 'error', ...patch }])
    expect(text).toContain('1080p')
    expect(text).not.toMatch(/\{\w+\}/)
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
