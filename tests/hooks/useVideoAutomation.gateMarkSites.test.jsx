/**
 * useVideoAutomation — downloadGated 마커의 종결 자리 핀 (M2-R4 I6, B4)
 *
 * H6 는 "이 배치의 consumeGate.ensure() 가 ok 를 돌려준 뒤 종결되는 pending 항목의 **모든** 패치" 에 마커를 싣는다고 했지만 stop 꼬리·failed 분기·항목별 타임아웃의 `...gateMark()` 는
 * 어떤 테스트도 지키지 않았다(셋을 지워도 tests/hooks·components·services 357 파일 초록 — 리뷰 B4). 그 자리가 빠지면: N개 Start → 첫 항목 완료(배치 소비됨) → Stop → 남은 항목은
 * 마커 없이 stopped 로 남아 다음 Start 의 Phase 0 이 같은 배치의 다운로드에 consumeBatchDownload 를 **한 번 더** 부른다(이중 과금).
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
const FAILED = (gid) => ({ generationId: gid, status: 'failed', error: 'flow-video-not-found', errorKind: 'flow-video-not-found', mediaId: gid })
const SUB = { batchRemaining: 10, batchUnlimited: false }
const OPTS = { mode: 't2v', projectName: 'proj', saveMode: 'folder', videoModel: 'Omni Flash', aspectRatio: '16:9', duration: 6, videoResolution: '720p', videoBatchCount: 1, seed: null, concurrency: 5, flowPacingMinMs: 1000, flowPacingMaxMs: 1000 }
const SCENES = (n) => Array.from({ length: n }, (_, i) => ({ id: `vscene_${i + 1}`, prompt: `p${i + 1}` }))
/** 첫 항목(gen-1)은 첫 폴에 complete(게이트 통과), 둘째(gen-2)는 폴마다 second(i) 가 준다. */
const polls = (second) => (ids, i) => ({ success: true, statuses: ids.map((gid) => (gid === 'gen-1' ? COMPLETE(gid) : second(gid, i))) })

beforeEach(() => { __resetQuotaStopForTests(); vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0); vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); consumeBatchDownload.mockReset(); consumeBatchDownload.mockResolvedValue({ charged: true }) })

function setup(pollFn) {
  let n = 0
  let pollIdx = 0
  const generateVideoT2V = vi.fn(async () => ({ success: true, generationId: `gen-${++n}`, creditsLeft: 1040 }))
  const checkVideoStatus = vi.fn(async (ids) => pollFn(ids, pollIdx++))
  const downloadVideo = vi.fn(async () => ({ success: true, base64: 'data:video/mp4;base64,AQID' }))
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
/** App.jsx 영상 onItemUpdate 화이트리스트의 손 사본(App.flowSessionReason T6 핀 참조). */
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

describe('useVideoAutomation — 게이트 통과 뒤 종결 자리마다 downloadGated 마커 (M2-R4 I6)', () => {
  it('(a) 게이트 통과(첫 항목 완료) → Stop → 남은 항목의 stopped 패치가 마커를 든다 → 다시 Start 해도 consumeBatchDownload 총 1회', async () => {
    const h = setup(polls((gid) => PENDING(gid)))
    const { promise } = await begin(h, SCENES(2))
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })   // 첫 폴: gen-1 complete → 게이트 소비 → 다운로드
    expect(consumeBatchDownload).toHaveBeenCalledTimes(1)
    expect(last(h, 'vscene_1')).toEqual(['complete', expect.objectContaining({ mediaId: 'gen-1', downloadGated: true })])
    act(() => { h.hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    await act(async () => { await promise })
    expect(last(h, 'vscene_2')).toEqual(['error', expect.objectContaining({ errorKind: 'stopped', generationId: 'gen-2', mediaId: 'gen-2', downloadGated: true })])
    const merged2 = mergeLikeApp(h, 'vscene_2', { id: 'vscene_2', prompt: 'p2' })
    clearCounters(h)
    await run(h, [merged2], 5000)
    expect(h.generateVideoT2V).not.toHaveBeenCalled()
    expect(retryVideoDownload).toHaveBeenCalledTimes(1)
    expect(consumeBatchDownload).toHaveBeenCalledTimes(1)   // 같은 배치의 다운로드 — 두 번째 소비 없음
  })

  it('(b1) 게이트 통과 뒤 항목별 폴 타임아웃 패치(flow-video-fetch-failed + mediaId)도 마커를 든다', async () => {
    const h = setup(polls((gid) => PENDING(gid)))
    await run(h, SCENES(2), 125 * 10000, 10000)
    expect(consumeBatchDownload).toHaveBeenCalledTimes(1)
    expect(h.checkVideoStatus).toHaveBeenCalledTimes(120)
    expect(last(h, 'vscene_2')).toEqual(['error', expect.objectContaining({ errorKind: 'flow-video-fetch-failed', generationId: 'gen-2', mediaId: 'gen-2', downloadGated: true })])
    expect(h.hook.result.current.status).toBe('done')
  })

  it('(b2) 게이트 통과 뒤 서버 failed 상태(flow-video-not-found + mediaId)의 패치도 마커를 든다', async () => {
    const h = setup(polls((gid, i) => (i === 0 ? PENDING(gid) : FAILED(gid))))
    await run(h, SCENES(2), 30000)
    expect(consumeBatchDownload).toHaveBeenCalledTimes(1)
    expect(last(h, 'vscene_2')).toEqual(['error', expect.objectContaining({ errorKind: 'flow-video-not-found', generationId: 'gen-2', mediaId: 'gen-2', downloadGated: true })])
  })
})
