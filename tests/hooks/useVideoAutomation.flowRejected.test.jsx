/**
 * useVideoAutomation — Flow 영상의 거부·중단 계약 (M2-5, 플랜 D8-6 / §3 공통 규칙)
 *
 * 제출 결과가 rejectedMediaId(s) 를 싣거나 postClick:true 이면(kind 목록이 아니다 — flow-rpc-multi-batch·flow-submit-lost 포함):
 *   - 그 항목에 error·errorKind·errorParams·rejectedMediaId(s) 를 기록한다 — **mediaId/generationId 는 기록하지 않는다**
 *     (download-only 분류 `status==='error' && generationId && mediaId` 가 물지 않게).
 *   - submitHalt 로 **새 제출만** 멈춘다: 이미 제출된 pending 은 폴링→완료→다운로드→저장까지 끝까지, stopRequestedRef 는 건드리지
 *     않는다(그건 꼬리가 pending 을 'stopped' 로 덮는다). 다 빠진 뒤 미제출 항목은 flow-batch-halted {cause:<halt kind>}.
 *   - quota(code 8) 도 같은 길: quotaStoppedRef + submitHalt + emitQuotaStop 1회(모달·큐 리스너 발화), stopRequestedRef 없이.
 *   - 폴 한 번이 {pending, pollError} 여도 폴링은 계속(항목 예산 −1).
 *   - 두 번째 start() 는 App 머지 상태(옛 generationId 잔존, mediaId null)로 — 거부 항목은 다시 제출, fetch-failed 항목은 download-only.
 */
import { renderHook, act, render } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
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
vi.mock('../../src/utils/videoMetadata', () => ({ pickVideoMetadata: vi.fn(() => ({})), buildVideoMetaPatch: vi.fn(() => ({})) }))

import { fileSystemAPI } from '../../src/hooks/useFileSystem'
import { retryVideoDownload } from '../../src/services/videoRecovery'

const UUID11 = '<uuid#11>'
const SIGNED = 'https://flow-content.google/video/<uuid#11>?Expires=1&KeyName=k&Signature=SIG'
const MISMATCH = { success: false, errorKind: 'flow-video-settings-mismatch', error: 'flow-video-settings-mismatch', errorParams: { expected: 'Omni Flash 6s 16:9 720p', actual: 'veo_3_1_t2v_fast_6s' }, rejectedMediaId: UUID11, postClick: true }
const QUOTA = { success: false, errorKind: 'flow-rpc-error', error: 'RESOURCE_EXHAUSTED', rpcCode: 8, postClick: true }
const mediaOf = (gid) => (gid === 'gen-1' ? UUID11 : `media-${gid}`)
const PENDING = (gid) => ({ generationId: gid, status: 'pending', videoUrl: null, mediaId: null, error: null })
const COMPLETE = (gid) => ({ generationId: gid, status: 'complete', mediaId: mediaOf(gid), videoUrl: SIGNED, error: null })
/** 폴 응답 — 요청 id 마다: 첫 폴은 pending, 그 뒤는 complete(테스트가 polls 로 덮어쓸 수 있다). */
const defaultPolls = (ids, i) => ({ success: true, statuses: ids.map((gid) => (i === 0 ? PENDING(gid) : COMPLETE(gid))) })

beforeEach(() => { __resetQuotaStopForTests(); vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0); vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

/** genAPI — 제출은 프롬프트별 결과표, 폴은 순서 배열. */
function setup({ submit = {}, polls = defaultPolls } = {}) {
  let n = 0
  let pollIdx = 0
  const generateVideoT2V = vi.fn(async (prompt) => submit[prompt] ?? { success: true, generationId: `gen-${++n}`, creditsLeft: 1040 })
  const checkVideoStatus = vi.fn(async (ids) => polls(ids, pollIdx++))
  const downloadVideo = vi.fn(async () => ({ success: true, base64: 'data:video/mp4;base64,AQID' }))
  const genAPI = { generateVideoT2V, generateVideoI2V: vi.fn(), checkVideoStatus, downloadVideo, upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('flow-session'), flowSessionReason: vi.fn(() => null) }
  const onItemUpdate = vi.fn()
  const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow'))
  return { hook, genAPI, onItemUpdate, generateVideoT2V, checkVideoStatus, downloadVideo }
}
const SCENES3 = [{ id: 'vscene_1', prompt: 'p1' }, { id: 'vscene_2', prompt: 'p2' }, { id: 'vscene_3', prompt: 'p3' }]
async function run(h, scenes, ms = 40000) {
  let p
  await act(async () => {
    p = h.hook.result.current.start({
      mode: 't2v', scenes, projectName: 'proj', saveMode: 'folder', videoModel: 'Omni Flash', aspectRatio: '16:9', duration: 6, videoResolution: '720p',
      videoBatchCount: 1, seed: null, concurrency: 5, flowPacingMinMs: 1000, flowPacingMaxMs: 1000, onItemUpdate: h.onItemUpdate,
    })
  })
  for (let t = 0; t < ms; t += 500) await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  await act(async () => { await p })
}
const patches = (h, id) => h.onItemUpdate.mock.calls.filter((c) => c[0] === id).map((c) => [c[1], c[2] || {}])
const last = (h, id) => patches(h, id).at(-1)

describe('useVideoAutomation — Flow 거부 결과는 새 제출만 멈춘다 (M2-5)', () => {
  it('3항목: #1 제출(pending) · #2 모델키 불일치(postClick+rejectedMediaId) → #3 미제출; #1 은 폴링→complete→다운로드→저장; 드레인 뒤 #3 flow-batch-halted {cause}', async () => {
    const h = setup({ submit: { p2: MISMATCH } })
    await run(h, SCENES3)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(2)
    expect(h.generateVideoT2V.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2'])
    // #2: kind·params·거부 id 기록, mediaId/generationId 없음
    const [s2, p2] = last(h, 'vscene_2')
    expect(s2).toBe('error')
    expect(p2).toMatchObject({ error: 'flow-video-settings-mismatch', errorKind: 'flow-video-settings-mismatch', errorParams: MISMATCH.errorParams, rejectedMediaId: UUID11 })
    expect(p2).not.toHaveProperty('mediaId')
    expect(p2).not.toHaveProperty('generationId')
    // #1: 끝까지 — stopped 로 덮이지 않는다
    expect(h.downloadVideo).toHaveBeenCalledWith(SIGNED, '720p')
    expect(fileSystemAPI.saveVideo).toHaveBeenCalledTimes(1)
    const [s1, p1] = last(h, 'vscene_1')
    expect(s1).toBe('complete')
    expect(p1).toMatchObject({ mediaId: UUID11, generationId: 'gen-1', videoPath: '/proj/videos/t2v_1.mp4' })
    expect(patches(h, 'vscene_1').some(([, p]) => p.errorKind === 'stopped')).toBe(false)
    // #3: 제출된 적 없음 → halt kind + cause(실패 항목의 kind·params 를 물려받지 않는다)
    const [s3, p3] = last(h, 'vscene_3')
    expect(s3).toBe('error')
    expect(p3).toEqual({ error: 'flow-batch-halted', errorKind: 'flow-batch-halted', errorParams: { cause: 'flow-video-settings-mismatch' } })
    expect(patches(h, 'vscene_3').some(([st]) => st === 'generating')).toBe(false)
    expect(h.hook.result.current.status).toBe('error')
    expect(h.hook.result.current.status).not.toBe('stopped')
    expect(h.hook.result.current.statusMessage).toContain('errorSection.kind.flow-batch-halted')
    // 렌더: 훅 결과로 만든 item → ResultsTable 텍스트에 원인 kind·params 값, 플레이스홀더 없음
    const items = [{ id: 'vscene_2', prompt: 'p2', status: 'error', ...p2 }, { id: 'vscene_3', prompt: 'p3', status: 'error', ...p3 }]
    const { container } = render(<I18nProvider><ResultsTable items={items} mediaType="video" onVideoRetry={vi.fn()} /></I18nProvider>)
    const texts = Array.from(container.querySelectorAll('.prompt-error')).map((el) => el.textContent)
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('Omni Flash 6s 16:9 720p')
    expect(texts[0]).toContain('veo_3_1_t2v_fast_6s')
    expect(texts[1]).toContain('flow-video-settings-mismatch')
    for (const tx of texts) expect(tx).not.toMatch(/\{\w+\}/)
  })

  it('quota(code 8, postClick) 도 같은 드레인: emitQuotaStop 1회(리스너 발화), #1 완료, #3 halted(cause flow-rpc-error), 최종 문구는 quota(stopped)', async () => {
    const listener = vi.fn()
    subscribeQuotaStop(listener)
    const h = setup({ submit: { p2: QUOTA } })
    await run(h, SCENES3)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(last(h, 'vscene_1')[0]).toBe('complete')
    expect(patches(h, 'vscene_1').some(([, p]) => p.errorKind === 'stopped')).toBe(false)
    expect(last(h, 'vscene_2')[1]).toMatchObject({ error: 'RESOURCE_EXHAUSTED', errorKind: 'flow-rpc-error' })
    expect(last(h, 'vscene_3')[1]).toEqual({ error: 'flow-batch-halted', errorKind: 'flow-batch-halted', errorParams: { cause: 'flow-rpc-error' } })
    expect(h.hook.result.current.status).toBe('stopped')
    expect(h.hook.result.current.statusMessage).toMatch(/quota|limit reached|한도/i)
  })

  it.each(['flow-rpc-multi-batch', 'flow-submit-lost'])('%s(postClick, 거부 id 없음) 도 halt — kind 목록이 아니라 태그로 판정', async (kind) => {
    const h = setup({ submit: { p2: { success: false, errorKind: kind, error: kind, postClick: true } } })
    await run(h, SCENES3)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(2)
    expect(last(h, 'vscene_2')[1]).toMatchObject({ errorKind: kind })
    expect(last(h, 'vscene_3')[1]).toEqual({ error: 'flow-batch-halted', errorKind: 'flow-batch-halted', errorParams: { cause: kind } })
    expect(last(h, 'vscene_1')[0]).toBe('complete')
  })

  it('postClick 도 rejectedMediaId 도 없는 클릭 전 거부(flow-resolution-not-offered)는 halt 가 아니다 — 다음 항목을 계속 제출한다', async () => {
    const h = setup({ submit: { p2: { success: false, errorKind: 'flow-resolution-not-offered', error: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } } } })
    await run(h, SCENES3)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(3)
    expect(last(h, 'vscene_2')[1]).toMatchObject({ errorKind: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } })
    expect(last(h, 'vscene_3')[0]).toBe('complete')
  })

  it('폴 한 번이 {pending, pollError, rpcCode:8} 이어도 폴링 계속 → 다음 폴 complete → 다운로드; quota 리스너 미발화', async () => {
    const listener = vi.fn()
    subscribeQuotaStop(listener)
    const h = setup({ polls: (ids, i) => ({ success: true, statuses: ids.map((gid) => (i === 0 ? { generationId: gid, status: 'pending', pollError: 'flow-rpc-error', rpcCode: 8 } : COMPLETE(gid))) }) })
    await run(h, [SCENES3[0]])
    expect(h.checkVideoStatus).toHaveBeenCalledTimes(2)
    expect(h.downloadVideo).toHaveBeenCalledTimes(1)
    expect(last(h, 'vscene_1')[0]).toBe('complete')
    expect(listener).not.toHaveBeenCalled()
    expect(h.hook.result.current.status).toBe('done')
  })

  it('두 번째 start(App 머지 상태): 거부 항목(옛 generationId 잔존·mediaId null) 은 다시 제출, fetch-failed 항목(mediaId 보존) 은 download-only', async () => {
    const h = setup()
    const merged = [
      { id: 'vscene_2', prompt: 'p2', status: 'error', generationId: 'gen-old', mediaId: null, videoPath: null, error: 'flow-video-settings-mismatch', errorKind: 'flow-video-settings-mismatch', errorParams: MISMATCH.errorParams, rejectedMediaId: UUID11 },
      { id: 'vscene_4', prompt: 'p4', status: 'error', generationId: 'gen-4', mediaId: 'media-4', videoPath: null, error: 'flow-video-fetch-failed', errorKind: 'flow-video-fetch-failed' },
    ]
    await run(h, merged)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(1)
    expect(h.generateVideoT2V.mock.calls[0][0]).toBe('p2')
    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
    expect(retryVideoDownload.mock.calls[0][0].item).toMatchObject({ id: 'vscene_4', mediaId: 'media-4' })
    // 거부됐던 id 로는 상태 폴·다운로드를 부르지 않는다
    for (const c of h.checkVideoStatus.mock.calls) expect(c[0]).not.toContain(UUID11)
    for (const c of h.downloadVideo.mock.calls) expect(String(c[0])).not.toContain('gen-old')
    expect(last(h, 'vscene_2')[0]).toBe('complete')
  })
})
