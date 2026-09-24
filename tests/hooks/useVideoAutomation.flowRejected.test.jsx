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
 *   - 두 번째 start() 는 App 머지 상태로 — 거부 항목(generationId 없음)은 다시 제출, fetch-failed 항목은 download-only.
 *     M2-R3 H3: Flow 모드 Phase 0 은 출처로 분류한다(generationId 있음 + videoPath 없음 = 이미 과금된 제출 → mediaId 유무로 download-only/in-flight, status 무관).
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
const OPTS = { mode: 't2v', projectName: 'proj', saveMode: 'folder', videoModel: 'Omni Flash', aspectRatio: '16:9', duration: 6, videoResolution: '720p', videoBatchCount: 1, seed: null, concurrency: 5, flowPacingMinMs: 1000, flowPacingMaxMs: 1000 }
/** start() 를 부르고 그 promise 를 객체에 담아 돌려준다(stop 등 중간 개입이 필요한 테스트용 — async 함수가 promise 를 직접 return 하면 그걸 기다려 버린다). */
async function begin(h, scenes, extra = {}) {
  const started = {}
  await act(async () => { started.promise = h.hook.result.current.start({ ...OPTS, scenes, onItemUpdate: h.onItemUpdate, ...extra }) })
  return started
}
async function run(h, scenes, ms = 40000, step = 500) {
  const { promise } = await begin(h, scenes)
  for (let t = 0; t < ms; t += step) await act(async () => { await vi.advanceTimersByTimeAsync(step) })
  await act(async () => { await promise })
}
const patches = (h, id) => h.onItemUpdate.mock.calls.filter((c) => c[0] === id).map((c) => [c[1], c[2] || {}])
const last = (h, id) => patches(h, id).at(-1)
/**
 * App.jsx t2v onItemUpdate 화이트리스트(:1719-1739)와 같은 규칙으로 훅 패치를 씬 상태로 접는다(두 번째 start 의 입력).
 * M2-R2 G6(B3): 손 사본이다 — App 의 실제 화이트리스트는 tests/components/App.flowSessionReason.test.jsx 의 T6 블록(M2-5 + G6: 'error' 상태의 mediaId·generationId
 *   통과)이 핀한다. App 의 목록을 바꾸면 그 핀과 이 함수를 같이 고쳐라.
 */
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
      ...(r && 'downloadGated' in r ? { downloadGated: r.downloadGated } : {}),   // M2-R3 H6
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

  // M2-R3 H3: 거부 결과는 generationId 를 쓰지 않으므로 거부 항목은 generationId 없이 남는다 → fresh. (옛 generationId 가 **남아 있는** 항목은 이전에 과금된 제출이라
  //   H3 의 출처 분류가 폴링한다 — useVideoAutomation.provenance.test.jsx (c). 이 핀의 옛 픽스처 `generationId:'gen-old'` 는 그 규칙과 충돌해 null 로 바꿨다.)
  it('두 번째 start(App 머지 상태): 거부 항목(generationId 없음 — 거부 id 는 rejectedMediaId 로만·mediaId null) 은 다시 제출 — download-only 가 아니다', async () => {
    const h = setup()
    const merged = [
      { id: 'vscene_2', prompt: 'p2', status: 'error', generationId: null, mediaId: null, videoPath: null, error: 'flow-video-settings-mismatch', errorKind: 'flow-video-settings-mismatch', errorParams: MISMATCH.errorParams, rejectedMediaId: UUID11 },
    ]
    await run(h, merged)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(1)
    expect(h.generateVideoT2V.mock.calls[0][0]).toBe('p2')
    expect(retryVideoDownload).not.toHaveBeenCalled()
    // M2-R1 F2: 재제출의 generating 패치가 옛 kind·params·거부 id 를 null 로 지운다(stale kind 가 새 런에 새지 않게)
    const submitted = patches(h, 'vscene_2').find(([st, p]) => st === 'generating' && p.generationId)
    expect(submitted).toBeTruthy()
    expect(submitted[1]).toMatchObject({ error: null, errorKind: null, errorParams: null, rejectedMediaId: null, rejectedMediaIds: null })
    // 거부됐던 id 로는 상태 폴을 부르지 않는다 — 폴은 새 제출의 id 만
    for (const c of h.checkVideoStatus.mock.calls) expect(c[0]).not.toContain(UUID11)
    expect(h.checkVideoStatus.mock.calls[0][0]).toEqual(['gen-1'])
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

  it('폴 authFailed(kind 동반): pending 항목이 errorKind:auth + 인증 문구 + mediaId/generationId(M2-R2 G1(b)), raw 토큰 없음', async () => {
    const h = setup({ polls: () => AUTH })
    await run(h, [SCENES3[0]], 5000)
    expect(last(h, 'vscene_1')).toEqual(['error', { error: AUTH_TEXT, errorKind: 'auth', generationId: 'gen-1', mediaId: 'gen-1' }])
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

// M2-R2 G1 (A1/B1): Flow 의 generationId 는 곧 mediaId — YhhmEf 가 200 을 돌려준 순간 과금됐고 그 id 로 영상을 받는다. 그래서
//   (a) 제출 시점의 authFailed(세션 게이트 not-on-flow/wiz-missing — 뷰 재로드 중 일시적일 수 있다 — 또는 클릭 전 nzlxg 의 401/16)는 **새 제출만**
//       멈추고(submitHalt) 이미 제출된 pending 은 끝까지 폴링·다운로드한다(authStopped 없음). 최종 status 는 error + 인증 문구.
//   (b) pending 항목의 **모든** 종결 패치(사용자 stop·폴 타임아웃·폴 authFailed·꼬리)가 mediaId:generationId 를 실어 App 머지 뒤
//       download-only(error+generationId+mediaId)로 분류된다 — 다음 Start/Retry 는 retryVideoDownload, 재제출(10크레딧)은 없다.
describe('useVideoAutomation — Flow 의 과금된 pending 은 어떤 종결에서도 download-only 로 남는다 (M2-R2 G1)', () => {
  const AUTH_TEXT = 'Auth error. Please login to Flow and try again.'
  const GATE = { success: false, authFailed: true, errorKind: 'flow-session-missing', error: 'wiz-missing' }
  const AUTH401 = { success: false, errorKind: 'flow-rpc-error', error: 'flow-rpc-error', authFailed: true, rpcStatus: 401 }
  const GATE_POLL = (ids) => ({ success: true, statuses: ids.map((gid) => ({ generationId: gid, status: 'pending', pollError: 'flow-session-missing' })) })
  const DOWNLOAD_ONLY_1 = { status: 'error', generationId: 'gen-1', mediaId: 'gen-1', videoPath: null }
  /** 두 번째 start — App 머지 상태를 입력으로, 카운터를 비우고 돌린다. */
  const secondStart = async (h, merged) => {
    h.onItemUpdate.mockClear(); h.generateVideoT2V.mockClear(); h.checkVideoStatus.mockClear(); retryVideoDownload.mockClear()
    await run(h, merged)
  }
  const expectDownloadOnly = (h) => {
    expect(h.generateVideoT2V).not.toHaveBeenCalled()
    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
    expect(retryVideoDownload.mock.calls[0][0].item).toMatchObject({ id: 'vscene_1', generationId: 'gen-1', mediaId: 'gen-1' })
  }

  it('(a) 2항목: #2 제출이 세션 게이트 authFailed → #1 은 계속 폴링돼 complete+다운로드, #2 는 auth(mediaId/generationId 없음), status error + 인증 문구; 두 번째 start(실패 항목만)는 #1 을 재제출하지 않는다', async () => {
    const h = setup({ submit: { p2: GATE } })
    await run(h, SCENES3.slice(0, 2))
    expect(h.generateVideoT2V.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2'])
    expect(h.checkVideoStatus).toHaveBeenCalledTimes(2)
    expect(h.checkVideoStatus.mock.calls[0][0]).toEqual(['gen-1'])
    expect(h.downloadVideo).toHaveBeenCalledTimes(1)
    expect(last(h, 'vscene_1')[0]).toBe('complete')
    expect(last(h, 'vscene_1')[1]).toMatchObject({ mediaId: UUID11, generationId: 'gen-1', videoPath: '/proj/videos/t2v_1.mp4' })
    expect(patches(h, 'vscene_1').some(([, p]) => p.errorKind === 'auth')).toBe(false)
    expect(last(h, 'vscene_2')).toEqual(['error', { error: AUTH_TEXT, errorKind: 'auth' }])
    expect(h.hook.result.current.status).toBe('error')
    expect(h.hook.result.current.statusMessage).toContain(AUTH_TEXT)
    expect(h.hook.result.current.statusMessage).not.toMatch(/wiz-missing|Downloading|Polling/)
    // 두 번째 start: App 머지 상태의 실패 항목만(전체 Start 는 complete 도 재생성하는 설계라 회수된 #1 은 제외) — 과금된 #1 이 error 로 남았다면 여기서 재제출된다
    const merged = ['vscene_1', 'vscene_2'].map((id, i) => mergeLikeApp(h, id, { id, prompt: `p${i + 1}` }))
    expect(merged[0]).toMatchObject({ status: 'complete', generationId: 'gen-1', mediaId: UUID11, videoPath: '/proj/videos/t2v_1.mp4' })
    expect(merged[1]).toMatchObject({ status: 'error', errorKind: 'auth' })
    expect(merged[1].generationId).toBeUndefined()
    await secondStart(h, merged.filter((sc) => sc.status === 'error'))
    expect(h.generateVideoT2V.mock.calls.map((c) => c[0])).toEqual(['p2'])
    expect(retryVideoDownload).not.toHaveBeenCalled()
  })

  it('(b) Stop 중간: stopped 패치가 mediaId:generationId 를 실어 → App 머지 뒤 두 번째 start 는 retryVideoDownload(재제출 없음)', async () => {
    const h = setup({ polls: (ids) => ({ success: true, statuses: ids.map(PENDING) }) })
    const { promise } = await begin(h, [SCENES3[0]])
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    act(() => { h.hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    await act(async () => { await promise })
    expect(last(h, 'vscene_1')).toEqual(['error', expect.objectContaining({ errorKind: 'stopped', generationId: 'gen-1', mediaId: 'gen-1' })])
    expect(h.hook.result.current.status).toBe('stopped')
    const merged = mergeLikeApp(h, 'vscene_1', { id: 'vscene_1', prompt: 'p1' })
    expect(merged).toMatchObject(DOWNLOAD_ONLY_1)
    await secondStart(h, [merged])
    expectDownloadOnly(h)
  })

  it.each([
    ['{pending, pollError:flow-session-missing} ×120', GATE_POLL],
    ['최상위 {success:false} ×120 (F9 경로)', () => ({ success: false, error: 'temporary server error' })],
  ])('(b) 폴 예산 소진(%s) → 항목은 flow-video-fetch-failed + mediaId:generationId → 두 번째 start 는 download-only', async (_l, polls) => {
    const h = setup({ polls })
    await run(h, [SCENES3[0]], 125 * 10000, 10000)
    expect(h.checkVideoStatus).toHaveBeenCalledTimes(120)
    expect(last(h, 'vscene_1')).toEqual(['error', expect.objectContaining({ errorKind: 'flow-video-fetch-failed', generationId: 'gen-1', mediaId: 'gen-1' })])
    expect(h.hook.result.current.status).toBe('done')
    const merged = mergeLikeApp(h, 'vscene_1', { id: 'vscene_1', prompt: 'p1' })
    expect(merged).toMatchObject({ ...DOWNLOAD_ONLY_1, errorKind: 'flow-video-fetch-failed' })
    await secondStart(h, [merged])
    expectDownloadOnly(h)
  })

  it('(b) 폴 authFailed(실제 401): pending 항목 패치가 mediaId:generationId 를 유지 → 두 번째 start 는 download-only', async () => {
    const h = setup({ polls: () => AUTH401 })
    await run(h, [SCENES3[0]], 5000)
    expect(last(h, 'vscene_1')).toEqual(['error', { error: AUTH_TEXT, errorKind: 'auth', generationId: 'gen-1', mediaId: 'gen-1' }])
    expect(h.hook.result.current.status).toBe('error')
    const merged = mergeLikeApp(h, 'vscene_1', { id: 'vscene_1', prompt: 'p1' })
    expect(merged).toMatchObject({ ...DOWNLOAD_ONLY_1, errorKind: 'auth' })
    await secondStart(h, [merged])
    expectDownloadOnly(h)
  })

  it('(b) 꼬리 auth: Phase 0 download-only 가 authFailed 로 멈추면 in-flight 항목의 auth 패치도 mediaId:generationId', async () => {
    retryVideoDownload.mockResolvedValueOnce({ success: false, authFailed: true, error: 'flow-rpc-error' })
    const h = setup()
    await run(h, [
      { id: 'vscene_1', prompt: 'p1', status: 'error', generationId: 'gen-0', mediaId: 'gen-0', videoPath: null },
      { id: 'vscene_2', prompt: 'p2', status: 'generating', generationId: 'gen-9', mediaId: null, videoPath: null },
    ], 5000)
    expect(h.generateVideoT2V).not.toHaveBeenCalled()
    // downloadGated: M2-R3 H6 — Phase 0 의 게이트(여기선 무게이트 → ok)를 지난 배치라 꼬리 패치가 마커를 든다
    expect(last(h, 'vscene_2')).toEqual(['error', { error: AUTH_TEXT, errorKind: 'auth', generationId: 'gen-9', mediaId: 'gen-9', downloadGated: true }])
    expect(h.hook.result.current.isRunning).toBe(false)
  })
})

// M2-R3 H5(A5/B3): Phase 0 의 download-only 재시도가 authFailed 로 멈추면(#R25-3) 옛 코드는 download-only **만** 있을 때만 조기 종료 분기에서 status 를 세웠다 — in-flight 가 섞인
//   배치는 꼬리에서 auth 패치만 쓰고 status 가 'running'(문구 "⚡ Re-downloading…") 으로 남았다(isRunning 은 false). 멈추는 자리에서 status error + authFailureText 를 세운다.
//   retryVideoDownload 에는 authErrorText(인증 문구 함수)를 넘겨 kind 동반 authFailed 의 항목 문구가 raw 토큰이 되지 않게 한다.
describe('useVideoAutomation — Phase 0 authFailed 의 status·문구 (M2-R3 H5)', () => {
  const AUTH_TEXT = 'Auth error. Please login to Flow and try again.'
  const MIXED = [
    { id: 'vscene_1', prompt: 'p1', status: 'error', generationId: 'gen-0', mediaId: 'gen-0', videoPath: null },
    { id: 'vscene_2', prompt: 'p2', status: 'generating', generationId: 'gen-9', mediaId: null, videoPath: null },
  ]

  it('download-only + in-flight 혼합: 재시도 authFailed(kind 동반 → errorKind:auth) → status error + 인증 문구, isRunning false, raw 토큰·Re-downloading 없음; in-flight 는 auth+mediaId', async () => {
    retryVideoDownload.mockResolvedValueOnce({ success: false, authFailed: true, error: AUTH_TEXT, errorKind: 'auth' })
    const h = setup()
    await run(h, MIXED, 5000)
    expect(h.generateVideoT2V).not.toHaveBeenCalled()
    expect(h.checkVideoStatus).not.toHaveBeenCalled()
    expect(last(h, 'vscene_2')).toEqual(['error', { error: AUTH_TEXT, errorKind: 'auth', generationId: 'gen-9', mediaId: 'gen-9', downloadGated: true }])   // downloadGated: M2-R3 H6
    expect(h.hook.result.current.isRunning).toBe(false)
    expect(h.hook.result.current.status).toBe('error')
    expect(h.hook.result.current.statusMessage).toContain(AUTH_TEXT)
    expect(h.hook.result.current.statusMessage).not.toMatch(/Re-downloading|flow-session-missing|flow-rpc-error|wiz-missing/)
    // 훅은 서비스에 인증 문구 함수를 넘긴다(kind 동반 authFailed 의 항목 문구가 raw 토큰이 되지 않게)
    expect(retryVideoDownload.mock.calls[0][0].authErrorText).toBeTypeOf('function')
    expect(retryVideoDownload.mock.calls[0][0].authErrorText()).toBe(AUTH_TEXT)
  })

  it('kind 없는 옛 authFailed 결과는 그 error 문구가 상태 문구(authFailureText 규칙), status error', async () => {
    retryVideoDownload.mockResolvedValueOnce({ success: false, authFailed: true, error: 'Auth expired — please re-login to Flow' })
    const h = setup()
    await run(h, MIXED, 5000)
    expect(h.hook.result.current.status).toBe('error')
    expect(h.hook.result.current.statusMessage).toContain('Auth expired — please re-login to Flow')
    expect(h.hook.result.current.isRunning).toBe(false)
  })
})

// M2-R2 G3(B6): 4회째 "레코드 없음" 은 flow-video-not-found — 훅 패치가 kind+mediaId 를 남기고(F1 분기), 표엔 그 kind 문구(재생성 안내)가 보이며 raw kind 토큰은
//   없다. mediaId 가 남아 있으므로 다음 Start 는 download-only(재제출 없음) — Regenerate 만이 새 생성이다.
describe('useVideoAutomation — flow-video-not-found 는 kind 문구로 보이고 download-only 로 남는다 (M2-R2 G3)', () => {
  it('폴 {failed, flow-video-not-found, mediaId} → 항목 kind+mediaId+generationId; ResultsTable 텍스트에 재생성 안내(raw kind 없음); 두 번째 start 는 retryVideoDownload', async () => {
    const h = setup({ polls: (ids) => ({ success: true, statuses: ids.map((gid) => ({ generationId: gid, status: 'failed', errorKind: 'flow-video-not-found', error: 'flow-video-not-found', mediaId: gid })) }) })
    await run(h, [SCENES3[0]])
    const [s1, p1] = last(h, 'vscene_1')
    expect(s1).toBe('error')
    expect(p1).toMatchObject({ errorKind: 'flow-video-not-found', mediaId: 'gen-1', generationId: 'gen-1' })
    const { container } = render(<I18nProvider><ResultsTable items={[{ id: 'vscene_1', prompt: 'p1', status: 'error', ...p1 }]} mediaType="video" onVideoRetry={vi.fn()} /></I18nProvider>)
    const text = container.querySelector('.prompt-error')?.textContent || ''
    expect(text).toMatch(/Regenerate|재생성/)
    expect(text).not.toContain('flow-video-not-found')
    expect(text).not.toMatch(/\{\w+\}/)
    const merged = mergeLikeApp(h, 'vscene_1', { id: 'vscene_1', prompt: 'p1' })
    expect(merged).toMatchObject({ status: 'error', generationId: 'gen-1', mediaId: 'gen-1', videoPath: null, errorKind: 'flow-video-not-found' })
    h.onItemUpdate.mockClear(); h.generateVideoT2V.mockClear(); retryVideoDownload.mockClear()
    await run(h, [merged])
    expect(h.generateVideoT2V).not.toHaveBeenCalled()
    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
  })
})

// M2-R2 G4(B2): flow-settings-not-applied 는 params 가 {} 라 F8 서명이 항상 같았다 — 10초 씬 둘이 duration-not-offered 로 거부되면 6초·8초 씬까지 그 kind 로
//   닫혔다(재실행해도 순서가 같아 영영 못 간다). main 이 드라이버 reason 을 필드로 실어 주고, 훅은 **배치 전체 이유**(model-not-offered·ratio-not-offered:*·
//   input-mode-not-material·model-submenu-unknown·model-menu-not-open·resolution-missing)만 종결 후보로 센다. 항목별 이유(duration-not-offered:*·not-checked:*·
//   needs-trusted:*·settings-trigger-*·panel-not-closed)는 절대 종결하지 않는다(연속 셈도 리셋). 서명엔 reason 도 든다.
describe('useVideoAutomation — flow-settings-not-applied 는 배치 전체 reason 만 종결한다 (M2-R2 G4)', () => {
  const NOT_APPLIED = (reason) => ({ success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason })
  const DUR = [{ id: 'vscene_1', prompt: 'p1', targetDuration: 10 }, { id: 'vscene_2', prompt: 'p2', targetDuration: 10 }, { id: 'vscene_3', prompt: 'p3', targetDuration: 6 }, { id: 'vscene_4', prompt: 'p4', targetDuration: 8 }]

  it('duration-not-offered:10 ×2(항목별) → 6초·8초 항목은 그대로 제출돼 complete', async () => {
    const h = setup({ submit: { p1: NOT_APPLIED('duration-not-offered:10'), p2: NOT_APPLIED('duration-not-offered:10') } })
    await run(h, DUR)
    expect(h.generateVideoT2V.mock.calls.map((c) => [c[0], c[3]])).toEqual([['p1', 10], ['p2', 10], ['p3', 6], ['p4', 8]])
    expect(last(h, 'vscene_1')).toEqual(['error', { error: 'flow-settings-not-applied', errorKind: 'flow-settings-not-applied' }])
    expect(last(h, 'vscene_3')[0]).toBe('complete')
    expect(last(h, 'vscene_4')[0]).toBe('complete')
    expect(h.hook.result.current.status).toBe('done')
  })

  it('model-not-offered ×2(배치 전체) → 종결: 제출 2회, 4항목 전부 그 kind, status error + kind 문구', async () => {
    const h = setup({ submit: { p1: NOT_APPLIED('model-not-offered'), p2: NOT_APPLIED('model-not-offered') } })
    await run(h, DUR)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(2)
    for (const id of ['vscene_1', 'vscene_2', 'vscene_3', 'vscene_4']) expect(last(h, id)).toEqual(['error', { error: 'flow-settings-not-applied', errorKind: 'flow-settings-not-applied' }])
    expect(h.hook.result.current.status).toBe('error')
    expect(h.hook.result.current.statusMessage).toContain('errorSection.kind.flow-settings-not-applied')
  })

  it('배치 전체 이유라도 reason 이 다르면(ratio-not-offered:4:3 → model-not-offered) 연속이 아니다 — 계속 제출', async () => {
    const h = setup({ submit: { p1: NOT_APPLIED('ratio-not-offered:4:3'), p2: NOT_APPLIED('model-not-offered') } })
    await run(h, SCENES3)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(3)
    expect(last(h, 'vscene_3')[0]).toBe('complete')
  })

  it('항목별 이유가 사이에 끼면 리셋: [model-not-offered, not-checked:duration, model-not-offered, 성공] → 4회 제출', async () => {
    const h = setup({ submit: { p1: NOT_APPLIED('model-not-offered'), p2: NOT_APPLIED('not-checked:duration'), p3: NOT_APPLIED('model-not-offered') } })
    await run(h, DUR)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(4)
    expect(last(h, 'vscene_4')[0]).toBe('complete')
  })

  // M2-R3 H9(B5): G4 는 배치 전체 이유 둘·항목별 이유 둘만 핀했다 — resolution-missing 을 빼거나(F11 의 렌더러 배관 결함이 항목마다 7~15s 로 배치 전체를 끌고 간다),
  //   input-mode/submenu/menu-not-open 을 빼거나, 항목별 패밀리를 넣는(needs-trusted 두 번에 남은 항목이 전부 닫힌다) 변이가 전부 살아남았다. 여섯·다섯 전부를 돈다.
  it.each(['model-not-offered', 'ratio-not-offered:4:3', 'input-mode-not-material', 'model-submenu-unknown', 'model-menu-not-open', 'resolution-missing'])(
    '배치 전체 이유 %s ×2 → 종결: 제출 2회, 4항목 전부 그 kind, status error + kind 문구', async (reason) => {
      const h = setup({ submit: { p1: NOT_APPLIED(reason), p2: NOT_APPLIED(reason) } })
      await run(h, DUR)
      expect(h.generateVideoT2V).toHaveBeenCalledTimes(2)
      for (const id of ['vscene_1', 'vscene_2', 'vscene_3', 'vscene_4']) expect(last(h, id)).toEqual(['error', { error: 'flow-settings-not-applied', errorKind: 'flow-settings-not-applied' }])
      expect(patches(h, 'vscene_3').some(([st]) => st === 'generating')).toBe(false)
      expect(h.hook.result.current.status).toBe('error')
      expect(h.hook.result.current.statusMessage).toContain('errorSection.kind.flow-settings-not-applied')
    })

  it.each(['duration-not-offered:10', 'not-checked:duration', 'needs-trusted:ratio', 'settings-trigger-click-failed', 'panel-not-closed'])(
    '항목별 이유 %s: ×2 여도 종결하지 않고(4회 제출, #3·#4 complete, status done) 배치 전체 이유 사이에 끼면 연속을 리셋한다', async (reason) => {
      const a = setup({ submit: { p1: NOT_APPLIED(reason), p2: NOT_APPLIED(reason) } })
      await run(a, DUR)
      expect(a.generateVideoT2V).toHaveBeenCalledTimes(4)
      expect(last(a, 'vscene_1')).toEqual(['error', { error: 'flow-settings-not-applied', errorKind: 'flow-settings-not-applied' }])
      expect(last(a, 'vscene_3')[0]).toBe('complete')
      expect(last(a, 'vscene_4')[0]).toBe('complete')
      expect(a.hook.result.current.status).toBe('done')
      // 리셋: [model-not-offered, R, model-not-offered, ok] → 4회 제출(같은 배치 전체 이유가 연속이 아니게 된다)
      const b = setup({ submit: { p1: NOT_APPLIED('model-not-offered'), p2: NOT_APPLIED(reason), p3: NOT_APPLIED('model-not-offered') } })
      await run(b, DUR)
      expect(b.generateVideoT2V).toHaveBeenCalledTimes(4)
      expect(last(b, 'vscene_4')[0]).toBe('complete')
    })
})

// M2-R2 G7(B4): §12.3 #68/#69 가 주장한 F8/F9 동작 중 핀이 없던 넷 — (a) 해상도 아닌 kind 의 연속 거부도 종결 (b) 다른 kind 가 끼면 리셋 (c) pending 드레인 뒤에도
//   최종 문구는 kind 문구 (d) Flow 의 failed 상태 문구로 quota 를 발화하지 않는다. 각각의 변이(집합 축소·리셋 삭제·문구 복원 삭제·가드 삭제)가 물어야 한다.
describe('useVideoAutomation — F8/F9 핀 보강 (M2-R2 G7)', () => {
  const NOT_OFFERED = { success: false, errorKind: 'flow-resolution-not-offered', error: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } }
  const SCENES4 = [...SCENES3, { id: 'vscene_4', prompt: 'p4' }]

  it('(a) flow-agent-off-failed ×2(해상도 아닌 kind)도 종결 — 제출 2회, #3 그 kind, status error + kind 문구', async () => {
    const OFF = { success: false, errorKind: 'flow-agent-off-failed', error: 'flow-agent-off-failed' }
    const h = setup({ submit: { p1: OFF, p2: OFF } })
    await run(h, SCENES3)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(2)
    expect(last(h, 'vscene_3')).toEqual(['error', { error: 'flow-agent-off-failed', errorKind: 'flow-agent-off-failed' }])
    expect(h.hook.result.current.status).toBe('error')
    expect(h.hook.result.current.statusMessage).toContain('errorSection.kind.flow-agent-off-failed')
  })

  it('(b) 거부 → 다른 kind → 같은 거부는 연속이 아니다(리셋) — 4항목 전부 제출, #4 complete', async () => {
    const h = setup({ submit: { p1: NOT_OFFERED, p2: { success: false, errorKind: 'text-injection-failed', error: 'text-injection-failed' }, p3: NOT_OFFERED } })
    await run(h, SCENES4)
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(4)
    expect(last(h, 'vscene_4')[0]).toBe('complete')
  })

  it('(c) [ok, 거부, 거부]: pending #1 이 드레인(다운로드)된 뒤 최종 statusMessage 는 kind 문구 — 다운로드 문구가 아니다', async () => {
    const h = setup({ submit: { p2: NOT_OFFERED, p3: NOT_OFFERED } })
    await run(h, SCENES3)
    expect(last(h, 'vscene_1')[0]).toBe('complete')
    expect(h.downloadVideo).toHaveBeenCalledTimes(1)
    expect(h.hook.result.current.status).toBe('error')
    expect(h.hook.result.current.statusMessage).toContain('errorSection.kind.flow-resolution-not-offered')
    expect(h.hook.result.current.statusMessage).not.toMatch(/Downloading|Polling|flow-content/)
  })

  it('(d) Flow 의 failed 상태가 error:RESOURCE_EXHAUSTED 여도 quota 리스너는 발화하지 않는다(읽기 결과) — 항목 error, status done', async () => {
    const listener = vi.fn()
    subscribeQuotaStop(listener)
    const h = setup({ polls: (ids) => ({ success: true, statuses: ids.map((gid) => ({ generationId: gid, status: 'failed', error: 'RESOURCE_EXHAUSTED' })) }) })
    await run(h, [SCENES3[0]])
    expect(listener).not.toHaveBeenCalled()
    expect(last(h, 'vscene_1')).toEqual(['error', expect.objectContaining({ error: 'RESOURCE_EXHAUSTED' })])
    expect(h.hook.result.current.status).toBe('done')
  })
})
