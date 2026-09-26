/**
 * useVideoAutomation — 배치 다운로드 권한 마커 downloadGated (M2-R3 H6, B2)
 *
 * G1(b) 는 Flow 의 stopped·타임아웃·폴 auth 항목을 download-only 로 만들었지만 그 항목들은 consumeGate.ensure()(첫 다운로드 직전에만 돈다)를 지난 적이 없다 —
 * Phase 0 은 download-entitlement 아닌 download-only 전부를 "이미 과금됨" 으로 보고 게이트 없이 재다운로드했다(10개 Start → 첫 완료 전 Stop → Start: 10개 무료).
 * 이제 그 배치의 게이트가 ok 를 돌려준 뒤 종결되는 pending 항목의 패치에 downloadGated:true 를 싣고, Phase 0 은 마커 없는 download-only 를 게이트(consumeGate.ensure 1회)로
 * 보낸다(거부 → download-entitlement 로 표시, id 유지; ok → 마커). 마커 있는 항목·항목별 Retry(App 의 handleVideoRetry → retryVideoDownload 직행)는 게이트 없음.
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
vi.mock('../../src/firebase/functions', () => ({ consumeBatchDownload: vi.fn(async () => ({ charged: true })) }))

import { retryVideoDownload } from '../../src/services/videoRecovery'
import { consumeBatchDownload } from '../../src/firebase/functions'

const SIGNED = 'https://flow-content.google/video/x?Signature=SIG#'
const PENDING = (gid) => ({ generationId: gid, status: 'pending', videoUrl: null, mediaId: null, error: null })
const COMPLETE = (gid) => ({ generationId: gid, status: 'complete', mediaId: gid, videoUrl: SIGNED + gid, error: null })
const SUB = { batchRemaining: 10, batchUnlimited: false }
const OPTS = { mode: 't2v', projectName: 'proj', saveMode: 'folder', videoModel: 'Omni Flash', aspectRatio: '16:9', duration: 6, videoResolution: '720p', videoBatchCount: 1, seed: null, concurrency: 5, flowPacingMinMs: 1000, flowPacingMaxMs: 1000 }
const SCENES = (n) => Array.from({ length: n }, (_, i) => ({ id: `vscene_${i + 1}`, prompt: `p${i + 1}` }))

beforeEach(() => { __resetQuotaStopForTests(); vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0); vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); consumeBatchDownload.mockReset(); consumeBatchDownload.mockResolvedValue({ charged: true }) })

function setup({ polls = (ids, i) => ({ success: true, statuses: ids.map((gid) => (i === 0 ? PENDING(gid) : COMPLETE(gid))) }), downloadFails = () => false } = {}) {
  let n = 0
  let pollIdx = 0
  const generateVideoT2V = vi.fn(async () => ({ success: true, generationId: `gen-${++n}`, creditsLeft: 1040 }))
  const checkVideoStatus = vi.fn(async (ids) => polls(ids, pollIdx++))
  const downloadVideo = vi.fn(async (url) => (downloadFails(url) ? { success: false, error: 'network' } : { success: true, base64: 'data:video/mp4;base64,AQID' }))
  const genAPI = { generateVideoT2V, generateVideoI2V: vi.fn(), checkVideoStatus, downloadVideo, upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('flow-session'), flowSessionReason: vi.fn(() => null) }
  const onItemUpdate = vi.fn()
  // 실제 배치 게이트: subscriptionBatch 있음 · 인증됨 · active
  const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow', true, SUB, vi.fn(), true, vi.fn(), 'active', vi.fn(async () => {})))
  return { hook, genAPI, onItemUpdate, generateVideoT2V, checkVideoStatus, downloadVideo }
}
async function begin(h, scenes) {
  const started = {}
  await act(async () => { started.promise = h.hook.result.current.start({ ...OPTS, scenes, onItemUpdate: h.onItemUpdate }) })
  return started
}
async function run(h, scenes, ms = 40000, step = 500) {
  const { promise } = await begin(h, scenes)
  for (let t = 0; t < ms; t += step) await act(async () => { await vi.advanceTimersByTimeAsync(step) })
  await act(async () => { await promise })
}
const patches = (h, id) => h.onItemUpdate.mock.calls.filter((c) => c[0] === id).map((c) => [c[1], c[2] || {}])
const last = (h, id) => patches(h, id).at(-1)
/** App.jsx 영상 onItemUpdate 화이트리스트의 손 사본(App.flowSessionReason T6 핀 참조) — downloadGated 도 'in' 규칙으로 통과. */
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
      ...(r && 'downloadGated' in r ? { downloadGated: r.downloadGated } : {}),
    }
  }
  return s
}
const clearCounters = (h) => { h.onItemUpdate.mockClear(); h.generateVideoT2V.mockClear(); h.checkVideoStatus.mockClear(); retryVideoDownload.mockClear() }

describe('useVideoAutomation — downloadGated 마커와 Phase 0 게이트 (M2-R3 H6)', () => {
  it('Start 3 → 첫 완료 전 Stop(게이트 미통과, 마커 없음) → Start: Phase 0 이 consumeBatchDownload 를 재시도 전에 정확히 1회 부르고 3개 재다운로드 + 마커', async () => {
    const h = setup({ polls: (ids) => ({ success: true, statuses: ids.map(PENDING) }) })
    const { promise } = await begin(h, SCENES(3))
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    act(() => { h.hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    await act(async () => { await promise })
    expect(consumeBatchDownload).not.toHaveBeenCalled()   // 첫 다운로드가 없었으니 게이트도 없었다
    const merged = SCENES(3).map((sc) => mergeLikeApp(h, sc.id, sc))
    for (const m of merged) {
      expect(m).toMatchObject({ status: 'error', errorKind: 'stopped', mediaId: m.generationId, videoPath: null })
      expect(m.downloadGated).not.toBe(true)   // 제출 패치의 null 만 — 게이트를 지난 적이 없다
    }
    clearCounters(h)
    await run(h, merged, 5000)
    expect(h.generateVideoT2V).not.toHaveBeenCalled()
    expect(consumeBatchDownload).toHaveBeenCalledTimes(1)
    expect(consumeBatchDownload.mock.calls[0][0]).toMatchObject({ batchType: 'video-t2v' })
    expect(retryVideoDownload).toHaveBeenCalledTimes(3)
    expect(consumeBatchDownload.mock.invocationCallOrder[0]).toBeLessThan(Math.min(...retryVideoDownload.mock.invocationCallOrder))
    for (const sc of SCENES(3)) expect(patches(h, sc.id)).toContainEqual(['error', { downloadGated: true }])
    expect(h.hook.result.current.isRunning).toBe(false)
  })

  it('배치 안에서 게이트를 지난 뒤 종결된 항목은 마커를 든다(complete·다운로드 실패 둘 다) → 다시 Start 해도 게이트를 다시 지나지 않는다', async () => {
    const h = setup({ downloadFails: (url) => String(url).endsWith('#gen-2') })
    await run(h, SCENES(2))
    expect(consumeBatchDownload).toHaveBeenCalledTimes(1)
    expect(last(h, 'vscene_1')).toEqual(['complete', expect.objectContaining({ mediaId: 'gen-1', generationId: 'gen-1', videoPath: '/proj/videos/t2v_1.mp4', downloadGated: true })])
    expect(last(h, 'vscene_2')).toEqual(['error', expect.objectContaining({ mediaId: 'gen-2', generationId: 'gen-2', downloadGated: true })])
    const merged2 = mergeLikeApp(h, 'vscene_2', { id: 'vscene_2', prompt: 'p2' })
    expect(merged2).toMatchObject({ status: 'error', generationId: 'gen-2', mediaId: 'gen-2', downloadGated: true })
    clearCounters(h)
    await run(h, [merged2], 5000)
    expect(consumeBatchDownload).toHaveBeenCalledTimes(1)   // 마커 있는 항목 — 새 배치의 게이트를 다시 지나지 않는다
    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
    expect(h.generateVideoT2V).not.toHaveBeenCalled()
    expect(patches(h, 'vscene_2')).not.toContainEqual(['error', { downloadGated: true }])
  })

  it('Phase 0 게이트 거부 → 마커 없는 download-only 는 다운로드 없이 download-entitlement(id 유지)로 표시, 마커 있는 항목은 그대로 재다운로드', async () => {
    consumeBatchDownload.mockResolvedValueOnce({ denied: true })
    const h = setup()
    await run(h, [
      { id: 'vscene_1', prompt: 'p1', status: 'error', errorKind: 'stopped', generationId: 'gen-a', mediaId: 'gen-a', videoPath: null },
      { id: 'vscene_2', prompt: 'p2', status: 'error', errorKind: 'stopped', generationId: 'gen-b', mediaId: 'gen-b', videoPath: null, downloadGated: true },
    ], 5000)
    expect(consumeBatchDownload).toHaveBeenCalledTimes(1)
    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
    expect(retryVideoDownload.mock.calls[0][0].item.id).toBe('vscene_2')
    expect(last(h, 'vscene_1')).toEqual(['error', expect.objectContaining({ errorKind: 'download-entitlement', generationId: 'gen-a', mediaId: 'gen-a' })])
    expect(last(h, 'vscene_1')[1]).not.toHaveProperty('downloadGated')
    expect(h.generateVideoT2V).not.toHaveBeenCalled()
    expect(h.hook.result.current.isRunning).toBe(false)
  })

  it('새 제출의 generating 패치는 옛 마커를 null 로 지운다(전체 Start 의 재생성 — 새 배치의 권한은 새로 확인한다)', async () => {
    const h = setup()
    await run(h, [{ id: 'vscene_1', prompt: 'p1', status: 'complete', generationId: 'gen-old', mediaId: 'gen-old', videoPath: '/proj/videos/t2v_1.mp4', downloadGated: true }])
    const submitted = patches(h, 'vscene_1').find(([st, p]) => st === 'generating' && p.generationId)
    expect(submitted[1]).toMatchObject({ generationId: 'gen-1', downloadGated: null })
    expect(consumeBatchDownload).toHaveBeenCalledTimes(1)
    expect(last(h, 'vscene_1')).toEqual(['complete', expect.objectContaining({ downloadGated: true })])
  })
})
