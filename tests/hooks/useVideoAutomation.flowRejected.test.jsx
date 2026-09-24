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
/** App.jsx t2v onItemUpdate 화이트리스트(:1719-1739)와 같은 규칙으로 훅 패치를 씬 상태로 접는다(두 번째 start 의 입력). */
function mergeLikeApp(h, id, base) {
  let s = { ...base }
  for (const [status, r] of patches(h, id)) {
    s = {
      ...s, status,
      ...(r && 'mediaId' in r ? { mediaId: r.mediaId } : {}),
      ...(r?.generationId ? { generationId: r.generationId } : {}),
      ...(r && 'videoPath' in r ? { videoPath: r.videoPath } : {}),
      ...(r && 'error' in r ? { error: r.error } : {}),
      ...(r && 'errorKind' in r ? { errorKind: r.errorKind } : {}),
      ...(r && 'errorParams' in r ? { errorParams: r.errorParams } : {}),
      ...(r && 'rejectedMediaId' in r ? { rejectedMediaId: r.rejectedMediaId } : {}),
      ...(r && 'rejectedMediaIds' in r ? { rejectedMediaIds: r.rejectedMediaIds } : {}),
    }
  }
  return s
}

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

  it('두 번째 start(App 머지 상태): 거부 항목(옛 generationId 잔존·mediaId null) 은 다시 제출 — download-only 가 아니다', async () => {
    const h = setup()
    const merged = [
      { id: 'vscene_2', prompt: 'p2', status: 'error', generationId: 'gen-old', mediaId: null, videoPath: null, error: 'flow-video-settings-mismatch', errorKind: 'flow-video-settings-mismatch', errorParams: MISMATCH.errorParams, rejectedMediaId: UUID11 },
    ]
    await run(h, merged)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(1)
    expect(h.generateVideoT2V.mock.calls[0][0]).toBe('p2')
    expect(retryVideoDownload).not.toHaveBeenCalled()
    // M2-R1 F2: 재제출의 generating 패치가 옛 kind·params·거부 id 를 null 로 지운다(stale kind 가 새 런에 새지 않게)
    const submitted = patches(h, 'vscene_2').find(([st, p]) => st === 'generating' && p.generationId)
    expect(submitted).toBeTruthy()
    expect(submitted[1]).toMatchObject({ error: null, errorKind: null, errorParams: null, rejectedMediaId: null, rejectedMediaIds: null })
    // 거부됐던 id 로는 상태 폴·다운로드를 부르지 않는다
    for (const c of h.checkVideoStatus.mock.calls) expect(c[0]).not.toContain(UUID11)
    for (const c of h.downloadVideo.mock.calls) expect(String(c[0])).not.toContain('gen-old')
    expect(last(h, 'vscene_2')[0]).toBe('complete')
  })

  // M2-R1 F1(A1/B1): fetch-failed 는 손으로 만든 픽스처가 아니라 **훅의 폴 루프가 실제로 만든 패치**로 검증한다 — 폴이
  //   {failed, flow-video-fetch-failed, mediaId} 를 돌려주면 failed 분기가 errorKind·mediaId·generationId 를 남겨야 App 머지 뒤
  //   download-only 분류(status error + generationId + mediaId + !videoPath)에 걸려 재제출(10크레딧) 대신 재다운로드로 간다.
  it('폴이 {failed, flow-video-fetch-failed, mediaId} → 훅 패치에 errorKind·mediaId·generationId 보존 → App 머지 뒤 두 번째 start 는 download-only(retryVideoDownload), 재제출 없음', async () => {
    const h = setup({ polls: (ids) => ({ success: true, statuses: ids.map((gid) => ({ generationId: gid, status: 'failed', errorKind: 'flow-video-fetch-failed', error: 'flow-video-fetch-failed', mediaId: mediaOf(gid) })) }) })
    await run(h, [SCENES3[0]])
    expect(h.checkVideoStatus).toHaveBeenCalledTimes(1)
    const [s1, p1] = last(h, 'vscene_1')
    expect(s1).toBe('error')
    expect(p1).toMatchObject({ error: 'flow-video-fetch-failed', errorKind: 'flow-video-fetch-failed', mediaId: UUID11, generationId: 'gen-1' })
    const merged = mergeLikeApp(h, 'vscene_1', { id: 'vscene_1', prompt: 'p1' })
    expect(merged).toMatchObject({ status: 'error', generationId: 'gen-1', mediaId: UUID11, videoPath: null, errorKind: 'flow-video-fetch-failed' })
    h.onItemUpdate.mockClear(); h.generateVideoT2V.mockClear(); h.checkVideoStatus.mockClear()
    await run(h, [merged])
    expect(h.generateVideoT2V).not.toHaveBeenCalled()
    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
    expect(retryVideoDownload.mock.calls[0][0].item).toMatchObject({ id: 'vscene_1', mediaId: UUID11, generationId: 'gen-1' })
  })
})

// M2-R1 F3(A3): authFailed 결과의 error 가 기계 토큰(errorKind 동반 — 'wiz-missing'·'not-on-flow'·'flow-rpc-error')이면 항목·상태 문구는
//   인증 안내(authErrorMessage) — useAutomation/useReferenceGeneration 의 authFailureText 와 같은 규칙. kind 없는 옛 결과는 error 그대로.
describe('useVideoAutomation — authFailed 결과의 문구(authFailureText)', () => {
  const AUTH = { success: false, authFailed: true, errorKind: 'flow-session-missing', error: 'wiz-missing' }
  const AUTH_TEXT = 'Auth error. Please login to Flow and try again.'   // getAuthErrorMessage('flow', t) 의 폴백(t 가 키를 돌려주므로)
  const noRawToken = (h) => {
    for (const c of h.onItemUpdate.mock.calls) expect(JSON.stringify(c[2] || {})).not.toMatch(/wiz-missing|not-on-flow/)
    expect(h.hook.result.current.statusMessage).not.toMatch(/wiz-missing|not-on-flow/)
  }

  it('제출 authFailed(kind 동반): 이 항목 + 남은 항목이 errorKind:auth + 인증 문구, 패치·상태 문구에 raw 토큰 없음', async () => {
    const h = setup({ submit: { p1: AUTH } })
    await run(h, SCENES3.slice(0, 2), 5000)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(1)
    for (const id of ['vscene_1', 'vscene_2']) expect(last(h, id)).toEqual(['error', { error: AUTH_TEXT, errorKind: 'auth' }])
    expect(h.hook.result.current.status).toBe('error')
    noRawToken(h)
  })

  it('폴 authFailed(kind 동반): pending 항목이 errorKind:auth + 인증 문구, raw 토큰 없음', async () => {
    const h = setup({ polls: () => AUTH })
    await run(h, [SCENES3[0]], 5000)
    expect(last(h, 'vscene_1')).toEqual(['error', { error: AUTH_TEXT, errorKind: 'auth' }])
    expect(h.hook.result.current.status).toBe('error')
    noRawToken(h)
  })

  it('kind 없는 옛 authFailed 결과는 error 문구 그대로(회귀 없음)', async () => {
    const h = setup({ submit: { p1: { success: false, authFailed: true, error: 'Auth expired — please re-login to Flow' } } })
    await run(h, [SCENES3[0]], 5000)
    expect(last(h, 'vscene_1')).toEqual(['error', { error: 'Auth expired — please re-login to Flow', errorKind: 'auth' }])
  })
})

// M2-R1 F8(A8): 배치 전체에 걸린 클릭 전 거부(1080p 요청 등)를 항목마다 7~15s 페이싱으로 반복하면 30씬이 같은 이유로 5~9분을 허비한다.
//   같은 kind + 같은 params(JSON 동일)의 설정계 거부가 **연속 2번**이면 나머지 freshGen 을 그 kind/params 로 닫고 종결(terminalStopped, 페이싱 없음).
//   첫 번째는 다음 항목이 한 번 더 시도한다(다른 항목·다른 params 면 다른 결과일 수 있다). 성공이 끼면 리셋.
describe('useVideoAutomation — 같은 클릭 전 거부가 연속 2번이면 종결(M2-R1 F8)', () => {
  const NOT_OFFERED = { success: false, errorKind: 'flow-resolution-not-offered', error: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } }
  const SCENES4 = [...SCENES3, { id: 'vscene_4', prompt: 'p4' }]

  it('4항목 1080p → 제출 2회, 4항목 전부 {requested:1080p} error, 첫 페이싱 뒤엔 대기 없음, status error + 그 kind 문구', async () => {
    const h = setup({ submit: { p1: NOT_OFFERED, p2: NOT_OFFERED, p3: NOT_OFFERED, p4: NOT_OFFERED } })
    let p
    await act(async () => {
      p = h.hook.result.current.start({
        mode: 't2v', scenes: SCENES4, projectName: 'proj', saveMode: 'folder', videoModel: 'Omni Flash', aspectRatio: '16:9', duration: 6, videoResolution: '1080p',
        videoBatchCount: 1, seed: null, concurrency: 5, flowPacingMinMs: 1000, flowPacingMaxMs: 1000, onItemUpdate: h.onItemUpdate,
      })
    })
    // 첫 실패 뒤 페이싱 1s → 두 번째 실패(종결). 1.6s 안에 끝나야 한다(세 번째 페이싱이 있으면 아직 running).
    for (let t = 0; t < 1600; t += 100) await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(2)
    expect(h.hook.result.current.isRunning).toBe(false)
    expect(h.hook.result.current.status).toBe('error')
    expect(h.hook.result.current.statusMessage).toContain('errorSection.kind.flow-resolution-not-offered')
    for (const id of ['vscene_1', 'vscene_2', 'vscene_3', 'vscene_4']) {
      expect(last(h, id)).toEqual(['error', { error: 'flow-resolution-not-offered', errorKind: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } }])
    }
    expect(patches(h, 'vscene_3').some(([st]) => st === 'generating')).toBe(false)
    await act(async () => { await p })
  })

  it('첫 거부 뒤 성공이 끼면 리셋: [거부, 성공, 거부, 거부, …] → 제출 4회, #5 는 미제출 그 kind', async () => {
    const h = setup({ submit: { p1: NOT_OFFERED, p3: NOT_OFFERED, p4: NOT_OFFERED, p5: NOT_OFFERED } })
    await run(h, [...SCENES4, { id: 'vscene_5', prompt: 'p5' }])
    expect(h.generateVideoT2V.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(last(h, 'vscene_2')[0]).toBe('complete')
    expect(last(h, 'vscene_5')).toEqual(['error', { error: 'flow-resolution-not-offered', errorKind: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } }])
    expect(h.hook.result.current.status).toBe('error')
  })

  it('params 가 다르면 연속이 아니다: 1080p 거부 → 4k 거부 → 계속 제출', async () => {
    const h = setup({ submit: { p1: NOT_OFFERED, p2: { ...NOT_OFFERED, errorParams: { requested: '4k' } } } })
    await run(h, SCENES3)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(3)
    expect(last(h, 'vscene_3')[0]).toBe('complete')
  })
})

// M2-R1 F9(A9/B9): Flow 모드에서 최상위 {success:false}(auth·feature-unsupported 아님) 폴은 **읽기** 결과다 — quota 중단을 발화하지도, break 로
//   폴 루프를 끝내(pending 이 "Polling timeout" 으로 묻힌다)지도 않는다. 전 항목 pollError 1회(예산 −1)로 보고 계속 폴링해 끝까지 드레인한다.
describe('useVideoAutomation — Flow 최상위 폴 실패는 pollError 1회(M2-R1 F9)', () => {
  it('폴 1회 {success:false, error:RESOURCE_EXHAUSTED} → emitQuotaStop 없음, 폴링 계속, complete → 다운로드, status done', async () => {
    const listener = vi.fn()
    subscribeQuotaStop(listener)
    const h = setup({ polls: (ids, i) => (i === 0 ? { success: false, error: 'RESOURCE_EXHAUSTED' } : { success: true, statuses: ids.map(COMPLETE) }) })
    await run(h, [SCENES3[0]])
    expect(listener).not.toHaveBeenCalled()
    expect(h.checkVideoStatus).toHaveBeenCalledTimes(2)
    expect(h.downloadVideo).toHaveBeenCalledTimes(1)
    expect(last(h, 'vscene_1')[0]).toBe('complete')
    expect(patches(h, 'vscene_1').some(([, p]) => /Polling timeout/.test(String(p.error || '')))).toBe(false)
    expect(h.hook.result.current.status).toBe('done')
  })
})
