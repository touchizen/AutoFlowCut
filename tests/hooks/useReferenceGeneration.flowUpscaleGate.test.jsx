/**
 * useReferenceGeneration — flow.google.com 업스케일 게이트 (M1-10, D8-2)
 *
 * 레퍼런스 경로는 callOpts 에 imageUpscale 을 넘겨 엔진 게이트가 제출 **전에** flow-upscale-unsupported 를 돌려주게 한다
 * (스타일 ref 는 업스케일하지 않으므로 넘기지 않는다). 엔진이 그 kind 로 거절하면 ref 는 errorKind/errorParams 를 보존한다.
 * 배치 수집 뒤 후처리(tryUpscaleImage) 가 flow-upscale-unsupported 로 throw 하면(백스톱) ref 는 그 kind 로 실패하고
 * busy 가 풀리며 pendingQueue 에서 빠진다 — 180s 타임아웃까지 돌지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const coordinatorMocks = vi.hoisted(() => ({ runFlowCharacterOperation: vi.fn(), runFlowComposerRefresh: vi.fn() }))

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }) },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('../../src/utils/imageProcessing', () => ({ tryUpscaleImage: vi.fn(), extractThumbnailBase64: vi.fn().mockResolvedValue('thumb') }))
vi.mock('../../src/utils/urls', () => ({ cleanBase64: vi.fn((v) => v), toDataURL: vi.fn((v) => v) }))
vi.mock('../../src/utils/flowCharacterCoordinator', () => ({
  runFlowCharacterOperation: coordinatorMocks.runFlowCharacterOperation,
  runFlowComposerRefresh: coordinatorMocks.runFlowComposerRefresh,
}))

import { tryUpscaleImage } from '../../src/utils/imageProcessing'
import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

function setupHook({ references, settingsOverrides = {}, genOverrides = {} }) {
  window.electronAPI = { ...(window.electronAPI || {}), refreshFlowComposer: vi.fn().mockResolvedValue({ success: true }) }
  let liveRefs = references.map((r) => ({ ...r }))
  let n = 0
  const setReferences = vi.fn((updater) => { liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater })
  const genAPI = {
    mode: 'flow',
    getAccessToken: vi.fn().mockResolvedValue('flow-session'),
    flowSessionReason: vi.fn(() => null),
    clearTokenCache: vi.fn(),
    generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'direct-image', mediaId: 'direct-media' }] }),
    submitGeneration: vi.fn(async () => ({ success: true, generationId: `g-${++n}` })),
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'collected-image', mediaId: 'collected-media' }] }),
    uploadReference: vi.fn().mockResolvedValue({ success: false, errorKind: 'flow-references-unsupported', error: 'flow-references-unsupported' }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    ...genOverrides,
  }
  const { result } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'project', imageBatchCount: 1, concurrency: 5, imageUpscale: '2k', ...settingsOverrides },
    references: liveRefs, setReferences, genAPI, addPendingSave: vi.fn(), openSettings: vi.fn(), t: (k) => k,
    selectedStyleRefId: null, generationQueue: null, flowProjectReady: true, flowProjectId: 'flow-project',
  }))
  return { result, genAPI, getLiveRefs: () => liveRefs }
}

beforeEach(() => {
  vi.clearAllMocks()
  coordinatorMocks.runFlowCharacterOperation.mockImplementation(({ task }) => task())
  coordinatorMocks.runFlowComposerRefresh.mockImplementation(() => window.electronAPI?.refreshFlowComposer?.())
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); tryUpscaleImage.mockReset() })   // mockRejectedValue 는 clearAllMocks 로 안 지워진다 — 다음 테스트로 새면 kind 없는 거부가 180s 를 돌린다

describe('단일 ref (handleGenerateRef)', () => {
  it('캐릭터 ref: callOpts.imageUpscale 이 설정값(2k)으로 간다', async () => {
    const { result, genAPI } = setupHook({ references: [{ id: 'hero', type: 'character', prompt: 'hero portrait', status: 'pending' }] })
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(genAPI.generateImage).toHaveBeenCalledTimes(1)
    expect(genAPI.generateImage.mock.calls[0][2]).toMatchObject({ imageUpscale: '2k', purpose: 'reference' })
  })

  it('스타일 ref: 업스케일하지 않으므로 imageUpscale 을 넘기지 않는다', async () => {
    const { result, genAPI } = setupHook({ references: [{ id: 'sty', type: 'style', category: 'style', prompt: 'oil painting', status: 'pending' }] })
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(genAPI.generateImage).toHaveBeenCalledTimes(1)
    expect(genAPI.generateImage.mock.calls[0][2].imageUpscale).toBeUndefined()
  })

  it('엔진이 flow-upscale-unsupported 로 거절 → ref error 에 errorKind/errorParams 보존, 생성 호출 1회', async () => {
    const { result, genAPI, getLiveRefs } = setupHook({
      references: [{ id: 'hero', type: 'character', prompt: 'hero portrait', status: 'pending' }],
      genOverrides: { generateImage: vi.fn().mockResolvedValue({ success: false, errorKind: 'flow-upscale-unsupported', error: 'flow-upscale-unsupported', errorParams: {} }) },
    })
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(genAPI.generateImage).toHaveBeenCalledTimes(1)
    expect(getLiveRefs()[0]).toMatchObject({ status: 'error', errorKind: 'flow-upscale-unsupported', errorParams: {} })
  })
})

// Flow 모드의 캐릭터 ref 배치는 단건 경로(generateImage)를 재사용한다 — submitGeneration 경로는 비-캐릭터(scene) ref 로 검증.
describe('배치 백스톱의 범위 (R1#14)', () => {
  it('kind 없는 후처리 예외(디스크 오류 등)는 종결이 아니다 — 큐에 남고, 사용자 중지는 pending 으로 되돌린다', async () => {
    tryUpscaleImage.mockRejectedValue(new Error('EIO: disk error'))
    const { result, getLiveRefs } = setupHook({ references: [{ id: 'bg', type: 'scene', category: 'scene', prompt: 'castle courtyard', status: 'pending' }] })
    vi.useFakeTimers()
    let p
    await act(async () => { p = result.current.handleGenerateAllRefs(null, { targetRefKeys: ['id:bg'] }) })
    for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    // 아직 배치 진행 중 — ref 는 error 로 확정되지 않았고 busy 다
    expect(getLiveRefs()[0].status).not.toBe('error')
    expect(result.current.refBatchActive).toBe(true)
    await act(async () => { result.current.stopGenerateAllRefs() })
    for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    await act(async () => { await p })
    expect(getLiveRefs()[0].status).toBe('pending')
    expect(getLiveRefs()[0].errorKind).toBeFalsy()
  })
})

describe('배치 (handleGenerateAllRefs)', () => {
  const SCENE_REF = { id: 'bg', type: 'scene', category: 'scene', prompt: 'castle courtyard', status: 'pending' }

  it('submitGeneration callOpts 에 imageUpscale 이 간다(비-스타일 ref)', async () => {
    const { result, genAPI } = setupHook({ references: [SCENE_REF] })
    vi.useFakeTimers()
    let p
    await act(async () => { p = result.current.handleGenerateAllRefs(null, { targetRefKeys: ['id:bg'] }) })
    for (let i = 0; i < 6; i++) await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    await act(async () => { await p })
    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
    expect(genAPI.submitGeneration.mock.calls[0][2]).toMatchObject({ imageUpscale: '2k' })
  })

  it('백스톱: 후처리 tryUpscaleImage 가 flow-upscale-unsupported 로 throw → ref 는 그 kind 로 error, busy 해제, 큐에서 제거(타임아웃 없이 끝난다)', async () => {
    tryUpscaleImage.mockRejectedValue(Object.assign(new Error('flow-upscale-unsupported'), { errorKind: 'flow-upscale-unsupported', errorParams: {} }))
    const { result, getLiveRefs } = setupHook({ references: [SCENE_REF] })
    vi.useFakeTimers()
    let p
    await act(async () => { p = result.current.handleGenerateAllRefs(null, { targetRefKeys: ['id:bg'] }) })
    // 3초 폴 두 번이면 수집·백스톱이 끝나야 한다 — 180s 까지 돌면 실패
    for (let i = 0; i < 4; i++) await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    let batchResult
    await act(async () => { batchResult = await p })
    expect(getLiveRefs()[0]).toMatchObject({ status: 'error', errorKind: 'flow-upscale-unsupported', errorParams: {} })
    expect(result.current.generatingRefs).toEqual([])
    expect(result.current.refBatchActive).toBe(false)
    expect(batchResult.failed).toEqual([expect.objectContaining({ key: 'id:bg', stage: 'collect', error: 'flow-upscale-unsupported' })])
  })
})
