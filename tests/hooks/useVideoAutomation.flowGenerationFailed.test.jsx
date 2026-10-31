/**
 * 2026-10-31 — Flow 상태 4(생성 실패 · 크레딧 환불, 실기 xmas90 장면 1·3) → main 이 {failed, flow-video-generation-failed, errorParams:{reason}} (mediaId 없음).
 * Flow 행은 출처로 분류된다(Flow 모양 generationId + videoPath 없음 = 과금된 제출 → mediaId 있으면 download-only, 없으면 in-flight 폴). 실패 행이 generationId 를
 * 들고 있으면 다음 Start 가 in-flight 로 잡아 같은 실패 미디어를 영원히 폴한다 — 새로 만들 수 없다. 그래서 이 kind 만 generationId·mediaId 를 지워 fresh 로 만든다
 * (Flow 가 환불했으니 다시 제출하는 것이 맞다). 훅의 폴 분기와 로드 시 복구(recoverInFlightVideos) 둘 다.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }), saveVideo: vi.fn() },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../src/utils/videoMetadata', () => ({ pickVideoMetadata: vi.fn(() => ({})), buildVideoMetaPatch: vi.fn(() => ({})) }))

import { recoverInFlightVideos } from '../../src/services/videoRecovery'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

const G = '12345678-1234-1234-1234-123456789abc'
const KIND = 'flow-video-generation-failed'
const failedStatus = () => ({ success: true, statuses: [{ generationId: G, status: 'failed', errorKind: KIND, error: KIND, progress: null }] })
const startOpts = (scenes, onItemUpdate) => ({ mode: 't2v', scenes, projectName: 'proj', saveMode: 'folder', videoModel: 'Omni Flash', aspectRatio: '9:16', duration: 6, videoResolution: '720p', onItemUpdate })

beforeEach(() => { __resetQuotaStopForTests(); vi.spyOn(Math, 'random').mockReturnValue(0) })
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('Flow 생성 실패(상태 4) → 행을 fresh 로(generationId·mediaId 지움) → 다음 Start 가 새로 제출', () => {
  it('훅: 폴이 flow-video-generation-failed 를 주면 error 패치에 generationId:null·mediaId:null(+errorParams) — 머지 뒤 다시 Start 하면 재제출', async () => {
    const genAPI = {
      generateVideoT2V: vi.fn().mockResolvedValue({ success: true, generationId: G }),
      generateVideoI2V: vi.fn(), checkVideoStatus: vi.fn().mockResolvedValue(failedStatus()), downloadVideo: vi.fn(), upscaleVideo: vi.fn(), fetchMedia: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('flow-session'),
    }
    const patches = []
    const onItemUpdate = vi.fn((id, status, patch) => patches.push([id, status, patch]))
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow'))
    const item = { id: 'vscene_1', prompt: 'p1', status: 'pending', generationId: null, mediaId: null, videoPath: null }
    await act(async () => { await hook.result.current.start(startOpts([item], onItemUpdate)) })
    const err = patches.filter((p) => p[1] === 'error').pop()
    expect(err[2]).toMatchObject({ errorKind: KIND, generationId: null, mediaId: null })
    const merged = { ...item, status: 'error', ...err[2] }
    genAPI.generateVideoT2V.mockClear()
    await act(async () => { await hook.result.current.start(startOpts([merged], vi.fn())) })
    expect(genAPI.generateVideoT2V).toHaveBeenCalledTimes(1)   // in-flight 폴이 아니라 새 제출
  })

  it('복구: 로드 시 상태 확인이 flow-video-generation-failed 면 kind 만 남기고 id 는 그대로(늦게 끝난 복구가 새 생성의 id 를 지우지 않게, Codex) — 다음 Start 의 폴이 실패로 닫으며 지운다', async () => {
    const persisted = { id: 'fp_1', prompt: 'p', status: 'pending', generationId: G, mediaId: null, videoPath: null }
    const patches = []
    await recoverInFlightVideos({
      framePairs: [persisted], projectName: 'proj', mode: 'flow', checkVideoStatus: vi.fn().mockResolvedValue(failedStatus()), downloadVideo: vi.fn(),
      onFramePairUpdate: (id, patch) => patches.push([id, patch]),
    })
    expect(patches).toHaveLength(1)
    expect(patches[0][1]).toMatchObject({ status: 'error', errorKind: KIND, generationId: G })
    expect(patches[0][1]).not.toHaveProperty('mediaId')
    // 다음 Start: in-flight 로 G 를 한 번 폴 → 실패로 닫으며 id 를 지운다 → 그다음 Start 가 재제출
    const genAPI = {
      generateVideoT2V: vi.fn().mockResolvedValue({ success: true, generationId: G }), generateVideoI2V: vi.fn(),
      checkVideoStatus: vi.fn().mockResolvedValue(failedStatus()), downloadVideo: vi.fn(), upscaleVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn().mockResolvedValue('flow-session'),
    }
    const upd = []
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow'))
    const merged = { ...persisted, ...patches[0][1] }
    await act(async () => { await hook.result.current.start(startOpts([merged], vi.fn((id, st, patch) => upd.push(patch)))) })
    expect(genAPI.generateVideoT2V).not.toHaveBeenCalled()
    expect(upd.pop()).toMatchObject({ errorKind: KIND, generationId: null, mediaId: null })
  })
})
