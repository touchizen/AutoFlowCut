/**
 * useVideoAutomation — Flow fresh 항목이 든 **옛 Flow 모양 generationId** 는 한 번의 실패 뒤에도 남지 않는다 (M2-R6 K1, A1 = B1)
 *
 * J3 는 옛 서버측 생성 실패 행(error PUBLIC_ERROR_* · errorKind null · UUID G · mediaId/videoPath null)을 fresh 로 분류했지만, 제출 전 'generating' 패치가 status 만 바꿔
 * 옛 G 가 그대로 남았다. 그 뒤 어떤 비성공 패치(클릭 전 거부·클릭 뒤 거부·flow-batch-halted·제출 auth·flow-feature-unsupported)도 {error, errorKind} 만 쓰고,
 * App 화이트리스트는 truthy generationId 만 머지하므로 훅이 지울 길도 없었다 → 행이 {error, errorKind:X, G, mediaId:null} 이 되면 J3 술어에서 벗어나
 * 다음 Start/Retry 가 과금된 in-flight 로 잡아 G 를 폴한다(jwpduf 레코드 없음 ×3 → flow-video-not-found + mediaId=G → 영원히 download-only).
 * "과금 안 된 실패는 다시 생성할 수 있다" 가 첫 실패 한 번까지만 성립했다.
 *
 * 이제: Flow 모드에서 fresh 로 분류된 항목이 Flow 모양 generationId 를 들고 videoPath 가 없으면 제출 전 'generating' 패치가 {generationId:null, mediaId:null} 을 싣고,
 * 미제출 항목의 종결 패치(markHalted · 제출 unsupported · 제출 auth · 같은 거부 2연속)도 같은 clear 를 싣는다. App 의 두 화이트리스트(t2v·i2v)는 명시적 null 을
 * 통과시킨다('generationId' in result — mediaId 와 같은 규칙; App.flowSessionReason 의 K1 핀). 여기의 mergeLikeApp 은 그 화이트리스트의 손 사본.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }), saveVideo: vi.fn(async (_p, videoId) => ({ success: true, path: `/proj/videos/${videoId}.mp4` })) },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn(async () => ({ success: true })) }))
vi.mock('../../src/utils/videoMetadata', () => ({ pickVideoMetadata: vi.fn(() => ({})), buildVideoMetaPatch: vi.fn(() => ({})) }))
vi.mock('../../src/utils/framePairImages', () => ({ resolveFrameImageBase64: vi.fn().mockResolvedValue(null) }))

import { retryVideoDownload } from '../../src/services/videoRecovery'

const G = '0f3b9c1e-5d2a-4b7c-8e9f-0a1b2c3d4e5f'   // 옛 Flow 제출 id(UUID 모양) — 사용자 실데이터의 legacy 행이 든 것
const UUID11 = '00000011-0000-4000-8000-000000000000'
const SIGNED = 'https://flow-content.google/video/<uuid#11>?Expires=1&KeyName=k&Signature=SIG'
const COMPLETE = (gid) => ({ generationId: gid, status: 'complete', mediaId: gid, videoUrl: SIGNED, error: null })
/** 사용자 실데이터 모양의 옛 서버측 생성 실패 행(J3 술어가 true) */
const LEGACY = { status: 'error', error: 'PUBLIC_ERROR_DANGER_FILTER', errorKind: null, generationId: G, mediaId: null, videoPath: null }
const PRECLICK = { success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason: 'resolution-missing', errorParams: {} }
const MISMATCH = { success: false, errorKind: 'flow-video-settings-mismatch', error: 'flow-video-settings-mismatch', errorParams: { expected: 'a', actual: 'b' }, rejectedMediaId: UUID11, postClick: true }
const UNSUPPORTED = { success: false, errorKind: 'flow-feature-unsupported', error: 'flow-feature-unsupported' }
const AUTH = { success: false, authFailed: true, errorKind: 'flow-session-missing', error: 'wiz-missing' }
const OPTS = { projectName: 'proj', saveMode: 'folder', videoModel: 'Omni Flash', aspectRatio: '16:9', duration: 6, videoResolution: '720p', videoBatchCount: 1, seed: null, concurrency: 5, flowPacingMinMs: 1000, flowPacingMaxMs: 1000 }

beforeEach(() => { __resetQuotaStopForTests(); vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0); vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

/** genAPI — 제출은 프롬프트별 **첫 호출** 결과표(그 뒤는 성공: 두 번째 Start 가 재제출하는지 본다), 폴은 항상 complete. */
function setup({ t2v = {}, i2v = {} } = {}) {
  let n = 0
  const once = (table) => {
    const used = new Set()
    return async (prompt) => {
      if (table[prompt] && !used.has(prompt)) { used.add(prompt); return table[prompt] }
      return { success: true, generationId: `gen-new-${++n}`, creditsLeft: 1040 }
    }
  }
  const generateVideoT2V = vi.fn(once(t2v))
  const generateVideoI2V = vi.fn(once(i2v))
  const checkVideoStatus = vi.fn(async (ids) => ({ success: true, statuses: ids.map(COMPLETE) }))
  const downloadVideo = vi.fn(async () => ({ success: true, base64: 'data:video/mp4;base64,AQID' }))
  const genAPI = { generateVideoT2V, generateVideoI2V, checkVideoStatus, downloadVideo, upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('flow-session'), flowSessionReason: vi.fn(() => null) }
  const onItemUpdate = vi.fn()
  const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow'))
  return { hook, genAPI, onItemUpdate, generateVideoT2V, generateVideoI2V, checkVideoStatus, downloadVideo }
}
async function run(h, input, ms = 30000) {
  let p
  await act(async () => { p = h.hook.result.current.start({ ...OPTS, mode: 't2v', ...input, onItemUpdate: h.onItemUpdate }) })
  for (let t = 0; t < ms; t += 500) await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  await act(async () => { await p })
}
const patches = (h, id) => h.onItemUpdate.mock.calls.filter((c) => c[0] === id).map((c) => [c[1], c[2] || {}])
const last = (h, id) => patches(h, id).at(-1)
const clearCalls = (h) => { h.onItemUpdate.mockClear(); h.generateVideoT2V.mockClear(); h.generateVideoI2V.mockClear(); h.checkVideoStatus.mockClear(); h.downloadVideo.mockClear(); retryVideoDownload.mockClear() }
/**
 * App.jsx t2v/i2v onItemUpdate 화이트리스트의 손 사본 — generationId 는 M2-R6 K1 부터 'generationId' in result(명시적 null 통과; mediaId 와 같은 규칙).
 * App 의 실제 화이트리스트는 tests/components/App.flowSessionReason.test.jsx 의 K1 핀이 지킨다. App 의 목록을 바꾸면 그 핀과 이 함수를 같이 고쳐라.
 */
function mergeLikeApp(h, id, base) {
  let s = { ...base }
  for (const [status, r] of patches(h, id)) {
    s = {
      ...s, status,
      ...(r && 'mediaId' in r ? { mediaId: r.mediaId } : {}),
      ...(r && 'generationId' in r ? { generationId: r.generationId } : {}),
      ...(r && 'videoPath' in r ? { videoPath: r.videoPath } : {}),
      ...(r && 'error' in r ? { error: r.error } : {}),
      ...(r && 'errorKind' in r ? { errorKind: r.errorKind } : {}),
      ...(r && 'errorParams' in r ? { errorParams: r.errorParams } : {}),
      ...(r && 'rejectedMediaId' in r ? { rejectedMediaId: r.rejectedMediaId } : {}),
      ...(r && 'rejectedMediaIds' in r ? { rejectedMediaIds: r.rejectedMediaIds } : {}),
      ...(r && 'downloadGated' in r ? { downloadGated: r.downloadGated } : {}),
    }
  }
  return s
}
/** 두 번째 Start 의 공통 단언: 옛 G 는 어느 폴에도 없고, 재제출된 새 id 만 폴·완료된다. */
const expectResubmittedNotPolled = (h, id, gid) => {
  expect(h.checkVideoStatus.mock.calls.flat(2)).not.toContain(G)
  expect(retryVideoDownload).not.toHaveBeenCalled()
  expect(last(h, id)).toEqual(['complete', expect.objectContaining({ generationId: gid, mediaId: gid })])
}

describe('useVideoAutomation — Flow fresh 항목의 옛 Flow 모양 generationId 는 한 번의 실패 뒤에도 남지 않는다 (M2-R6 K1)', () => {
  it('(a) T2V 옛 실패 행 → 클릭 전 거부(flow-settings-not-applied) → App 머지 → 다시 Start: 재제출 1, G 는 폴하지 않는다 — 제출 전 generating 패치가 id 를 지운다', async () => {
    const h = setup({ t2v: { p1: PRECLICK } })
    const row = { id: 'vscene_1', prompt: 'p1', ...LEGACY }
    await run(h, { scenes: [row] })
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(1)
    expect(h.checkVideoStatus).not.toHaveBeenCalled()
    const merged = mergeLikeApp(h, 'vscene_1', row)
    expect(merged).toMatchObject({ status: 'error', errorKind: 'flow-settings-not-applied', videoPath: null })
    clearCalls(h)
    await run(h, { scenes: [merged] })
    expect(h.generateVideoT2V).toHaveBeenCalledTimes(1)
    expectResubmittedNotPolled(h, 'vscene_1', 'gen-new-1')
    expect(merged).toMatchObject({ generationId: null, mediaId: null })
  })

  it('(b) T2V 옛 실패 행이 다른 항목의 클릭 뒤 실패로 flow-batch-halted 가 됐다(미제출) → App 머지 → 다시 Start: 둘 다 재제출, G 는 폴하지 않는다 — markHalted 패치가 id 를 지운다', async () => {
    const h = setup({ t2v: { p1: MISMATCH } })
    const rows = [{ id: 'vscene_1', prompt: 'p1', status: 'pending', generationId: null, mediaId: null, videoPath: null }, { id: 'vscene_2', prompt: 'p2', ...LEGACY }]
    await run(h, { scenes: rows })
    expect(h.generateVideoT2V.mock.calls.map((c) => c[0])).toEqual(['p1'])   // #2 는 halt 로 미제출
    expect(last(h, 'vscene_2')).toEqual(['error', expect.objectContaining({ errorKind: 'flow-batch-halted', errorParams: { cause: 'flow-video-settings-mismatch' } })])
    const merged = rows.map((r) => mergeLikeApp(h, r.id, r))
    clearCalls(h)
    await run(h, { scenes: merged })
    expect(h.generateVideoT2V.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2'])
    expectResubmittedNotPolled(h, 'vscene_2', 'gen-new-2')
    expect(merged[1]).toMatchObject({ generationId: null, mediaId: null })
  })

  it('(c) I2V 옛 실패 행이 다른 쌍의 flow-feature-unsupported 로 함께 닫혔다(미제출) → App 머지 → 다시 Start: 둘 다 재제출, G 는 폴하지 않는다 — unsupported 종결 패치가 id 를 지운다', async () => {
    const h = setup({ i2v: { p1: UNSUPPORTED } })
    const fp = (id, prompt, extra) => ({ id, prompt, startSceneId: 'scene_1', _startMediaId: 'm-START', ...extra })
    const rows = [fp('fp_1', 'p1', { status: 'pending', generationId: null, mediaId: null, videoPath: null }), fp('fp_2', 'p2', LEGACY)]
    await run(h, { mode: 'i2v', framePairs: rows })
    expect(h.generateVideoI2V.mock.calls.map((c) => c[0])).toEqual(['p1'])
    for (const id of ['fp_1', 'fp_2']) expect(last(h, id)).toEqual(['error', expect.objectContaining({ errorKind: 'flow-feature-unsupported' })])
    const merged = rows.map((r) => mergeLikeApp(h, r.id, r))
    clearCalls(h)
    await run(h, { mode: 'i2v', framePairs: merged })
    expect(h.generateVideoI2V.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2'])
    expectResubmittedNotPolled(h, 'fp_2', 'gen-new-2')
    expect(merged[1]).toMatchObject({ generationId: null, mediaId: null })
  })

  it('(d) T2V 옛 실패 행이 다른 항목의 제출 authFailed 로 함께 닫혔다(미제출) → App 머지 → 다시 Start: 둘 다 재제출, G 는 폴하지 않는다 — 제출 auth 패치가 id 를 지운다', async () => {
    const h = setup({ t2v: { p1: AUTH } })
    const rows = [{ id: 'vscene_1', prompt: 'p1', status: 'pending', generationId: null, mediaId: null, videoPath: null }, { id: 'vscene_2', prompt: 'p2', ...LEGACY }]
    await run(h, { scenes: rows })
    expect(h.generateVideoT2V.mock.calls.map((c) => c[0])).toEqual(['p1'])
    expect(last(h, 'vscene_2')).toEqual(['error', expect.objectContaining({ errorKind: 'auth' })])
    const merged = rows.map((r) => mergeLikeApp(h, r.id, r))
    clearCalls(h)
    await run(h, { scenes: merged })
    expect(h.generateVideoT2V.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2'])
    expectResubmittedNotPolled(h, 'vscene_2', 'gen-new-2')
    expect(merged[1]).toMatchObject({ generationId: null, mediaId: null })
  })

  it('(e) T2V 옛 실패 행이 같은 클릭 전 거부 2연속(F8 종결)으로 함께 닫혔다(미제출) → App 머지 → 다시 Start: 셋 다 재제출, G 는 폴하지 않는다 — F8 종결 패치가 id 를 지운다', async () => {
    const h = setup({ t2v: { p1: PRECLICK, p2: PRECLICK } })
    const rows = [
      { id: 'vscene_1', prompt: 'p1', status: 'pending', generationId: null, mediaId: null, videoPath: null },
      { id: 'vscene_2', prompt: 'p2', status: 'pending', generationId: null, mediaId: null, videoPath: null },
      { id: 'vscene_3', prompt: 'p3', ...LEGACY },
    ]
    await run(h, { scenes: rows })
    expect(h.generateVideoT2V.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2'])   // #3 은 F8 종결로 미제출
    expect(last(h, 'vscene_3')).toEqual(['error', expect.objectContaining({ errorKind: 'flow-settings-not-applied' })])
    const merged = rows.map((r) => mergeLikeApp(h, r.id, r))
    clearCalls(h)
    await run(h, { scenes: merged }, 60000)
    expect(h.generateVideoT2V.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2', 'p3'])
    expectResubmittedNotPolled(h, 'vscene_3', 'gen-new-3')
    expect(merged[2]).toMatchObject({ generationId: null, mediaId: null })
  })
})
