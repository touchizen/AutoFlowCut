/**
 * engineFlow.test.jsx — useFlowEngine 어댑터 단위 테스트.
 * window.electronAPI.flow* 를 모킹해 IPC 없이 완전 검증.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { assertEngineContract } from './engineContract'
import { FLOW_MODELS } from '../../src/engine/flowModels'

// --- flow* IPC mocks ---
const mockFlowSessionStatus = vi.fn()
const mockFlowExtractProjectId = vi.fn()
const mockFlowGenerateImage = vi.fn()
const mockFlowCheckGeneration = vi.fn()
const mockFlowCollectGeneration = vi.fn()
const mockFlowClearGenerations = vi.fn()
const mockFlowUploadReference = vi.fn()
const mockFlowGenerateCharacter = vi.fn()
const mockFlowRerollCharacter = vi.fn()
const mockFlowUploadCharacterEntity = vi.fn()
const mockFlowFetchMedia = vi.fn()
const mockFlowGenerateVideoT2V = vi.fn()
const mockFlowGenerateVideoI2V = vi.fn()
const mockFlowCheckVideoStatus = vi.fn()
const mockFlowDownloadVideoUrl = vi.fn()
const mockFlowDomDownloadVideo = vi.fn()
const mockFlowUpscaleVideo = vi.fn()
const mockFlowUpscaleImage = vi.fn()
const mockFlowFetchGallery = vi.fn()
const mockFlowListProjects = vi.fn()
const mockFlowGenerateScene = vi.fn()

beforeEach(() => {
  // Install flow* methods on the existing window.electronAPI mock (setup.js installs base mock)
  Object.assign(window.electronAPI, {
    flowSessionStatus: mockFlowSessionStatus,
    flowExtractProjectId: mockFlowExtractProjectId,
    flowGenerateImage: mockFlowGenerateImage,
    flowCheckGeneration: mockFlowCheckGeneration,
    flowCollectGeneration: mockFlowCollectGeneration,
    flowClearGenerations: mockFlowClearGenerations,
    flowUploadReference: mockFlowUploadReference,
    flowGenerateCharacter: mockFlowGenerateCharacter,
    flowRerollCharacter: mockFlowRerollCharacter,
    flowUploadCharacterEntity: mockFlowUploadCharacterEntity,
    flowFetchMedia: mockFlowFetchMedia,
    flowGenerateVideoT2V: mockFlowGenerateVideoT2V,
    flowGenerateVideoI2V: mockFlowGenerateVideoI2V,
    flowCheckVideoStatus: mockFlowCheckVideoStatus,
    flowDownloadVideoUrl: mockFlowDownloadVideoUrl,
    flowDomDownloadVideo: mockFlowDomDownloadVideo,
    flowUpscaleVideo: mockFlowUpscaleVideo,
    flowUpscaleImage: mockFlowUpscaleImage,
    flowFetchGallery: mockFlowFetchGallery,
    flowListProjects: mockFlowListProjects,
    flowGenerateScene: mockFlowGenerateScene,
  })
})

// Import after mocks are set up in beforeEach
import { useFlowEngine, resolveEffectiveProjectId, isFlowAuthError, markFlowAuthFailure, planMentionRouting, planUnresolvedMentionFallback, planCharacterGeneration, computeSceneGapReferences } from '../../src/engine/engineFlow'

// #R8-11: Flow auth-error sentinel — pure unit tests
describe('isFlowAuthError / markFlowAuthFailure (#R8-11)', () => {
  it('detects auth errors only on failed results with auth-like error text', () => {
    expect(isFlowAuthError({ success: false, error: '401 Unauthorized' })).toBe(true)
    expect(isFlowAuthError({ success: false, error: 'invalid token' })).toBe(true)
    expect(isFlowAuthError({ success: false, error: '로그인이 필요합니다' })).toBe(true)
    expect(isFlowAuthError({ success: false, error: 'quota exhausted' })).toBe(false)
    expect(isFlowAuthError({ success: true })).toBe(false)
    expect(isFlowAuthError(null)).toBe(false)
  })
  it('marks authFailed on auth errors, preserves otherwise', () => {
    expect(markFlowAuthFailure({ success: false, error: '403 forbidden' }).authFailed).toBe(true)
    expect(markFlowAuthFailure({ success: false, error: 'network' }).authFailed).toBeUndefined()
    const ok = { success: true, images: [] }
    expect(markFlowAuthFailure(ok)).toBe(ok) // unchanged reference
    expect(markFlowAuthFailure({ success: false, error: 'x', authFailed: true }).authFailed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// #R3-1: resolveEffectiveProjectId — pure unit tests
// ---------------------------------------------------------------------------
describe('resolveEffectiveProjectId (#R3-1)', () => {
  it('prefers bound id over extracted id', () => {
    expect(resolveEffectiveProjectId('bound-123', 'extracted-456')).toBe('bound-123')
  })

  it('falls back to extracted id when bound is null', () => {
    expect(resolveEffectiveProjectId(null, 'extracted-456')).toBe('extracted-456')
  })

  it('falls back to extracted id when bound is undefined', () => {
    expect(resolveEffectiveProjectId(undefined, 'extracted-456')).toBe('extracted-456')
  })

  it('returns null when both are null', () => {
    expect(resolveEffectiveProjectId(null, null)).toBeNull()
  })

  it('returns null when both are undefined', () => {
    expect(resolveEffectiveProjectId(undefined, undefined)).toBeNull()
  })

  it('returns bound id even when extracted is also non-null', () => {
    expect(resolveEffectiveProjectId('new-bound', 'old-extracted')).toBe('new-bound')
  })
})

describe('useFlowEngine — engine contract', () => {
  it('satisfies the 21-key engine contract', () => {
    const { result } = renderHook(() => useFlowEngine())
    assertEngineContract(result.current)
  })

  it('accessToken is initially null', () => {
    const { result } = renderHook(() => useFlowEngine())
    expect(result.current.accessToken).toBeNull()
  })

  it('projectId is initially null', () => {
    const { result } = renderHook(() => useFlowEngine())
    expect(result.current.projectId).toBeNull()
  })
})

describe('useFlowEngine — getAccessToken (flow:session-status, M1-10)', () => {
  // flow.google.com 에는 세션 API 도 Bearer 도 없다. 준비 판정은 flowSessionStatus 이고, 준비되면 토큰 대신
  //   센티널 'flow-session'(useGenerationEngine.ready 용) — IPC 페이로드의 token 은 항상 null.
  it('ready → 센티널 "flow-session", state 도 센티널, reason null, projectId 추출', async () => {
    mockFlowSessionStatus.mockResolvedValue({ ready: true, credits: 1050 })
    mockFlowExtractProjectId.mockResolvedValue({ projectId: 'proj-abc' })
    const { result } = renderHook(() => useFlowEngine())
    let token
    await act(async () => { token = await result.current.getAccessToken() })
    expect(mockFlowSessionStatus).toHaveBeenCalledTimes(1)
    expect(token).toBe('flow-session')
    expect(result.current.accessToken).toBe('flow-session')
    expect(result.current.flowSessionReason()).toBeNull()
    expect(mockFlowExtractProjectId).toHaveBeenCalledWith({ liveOnly: false })
    expect(result.current.projectId).toBe('proj-abc')
  })

  it.each(['wiz-missing', 'not-on-flow', 'rpc:http:500', 'rpc:er:3', 'timeout'])('not ready(%s) → null + reason, state null', async (reason) => {
    mockFlowSessionStatus.mockResolvedValue({ ready: false, reason })
    const { result } = renderHook(() => useFlowEngine())
    let token
    await act(async () => { token = await result.current.getAccessToken() })
    expect(token).toBeNull()
    expect(result.current.accessToken).toBeNull()
    expect(result.current.flowSessionReason()).toBe(reason)
    expect(mockFlowExtractProjectId).not.toHaveBeenCalled()
  })

  it('IPC reject → null, reason "timeout"', async () => {
    mockFlowSessionStatus.mockRejectedValue(new Error('ipc down'))
    const { result } = renderHook(() => useFlowEngine())
    let token
    await act(async () => { token = await result.current.getAccessToken() })
    expect(token).toBeNull()
    expect(result.current.flowSessionReason()).toBe('timeout')
  })

  it('ready 뒤 not-ready 가 오면 센티널을 거둔다', async () => {
    mockFlowSessionStatus.mockResolvedValueOnce({ ready: true, credits: 1 }).mockResolvedValueOnce({ ready: false, reason: 'not-on-flow' })
    mockFlowExtractProjectId.mockResolvedValue({ projectId: null })
    const { result } = renderHook(() => useFlowEngine())
    await act(async () => { await result.current.getAccessToken() })
    expect(result.current.accessToken).toBe('flow-session')
    await act(async () => { await result.current.getAccessToken() })
    expect(result.current.accessToken).toBeNull()
    expect(result.current.flowSessionReason()).toBe('not-on-flow')
  })
})

describe('useFlowEngine — clearTokenCache', () => {
  it('clears the accessToken sentinel', async () => {
    mockFlowSessionStatus.mockResolvedValue({ ready: true, credits: 1050 })
    mockFlowExtractProjectId.mockResolvedValue({ projectId: null })
    const { result } = renderHook(() => useFlowEngine())
    await act(async () => { await result.current.getAccessToken() })
    expect(result.current.accessToken).toBe('flow-session')

    act(() => { result.current.clearTokenCache() })
    expect(result.current.accessToken).toBeNull()
  })
})

describe('useFlowEngine — bound projectId precedence (#R3-1)', () => {
  beforeEach(() => {
    mockFlowGenerateImage.mockResolvedValue({ success: true, images: [] })
    mockFlowUploadReference.mockResolvedValue({ success: true, mediaId: 'm1' })
    mockFlowGenerateVideoT2V.mockResolvedValue({ success: true, generationId: 'g1' })
    mockFlowCheckVideoStatus.mockResolvedValue({ success: true, statuses: [] })
  })

  it('uses bound projectId (from getFlowProjectId) for generateImage, ignoring extracted id', async () => {
    const boundId = 'bound-proj-99'
    const extractedId = 'extracted-proj-01'
    // Provide a getFlowProjectId getter that returns the bound id
    const { result } = renderHook(() => useFlowEngine({ getFlowProjectId: () => boundId }))

    // Simulate extracted projectId being set (via getAccessToken → flowExtractProjectId)
    mockFlowSessionStatus.mockResolvedValue({ ready: true, credits: 1050 })
    mockFlowExtractProjectId.mockResolvedValue({ projectId: extractedId })
    await act(async () => { await result.current.getAccessToken() })
    // Confirm extracted id was set internally
    expect(result.current.projectId).toBe(extractedId)

    // Now call generateImage — it must use boundId, NOT extractedId
    await act(async () => {
      await result.current.generateImage('test prompt', [])
    })
    expect(mockFlowGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: boundId })
    )
  })

  it('falls back to extracted projectId when getFlowProjectId returns null', async () => {
    const extractedId = 'extracted-proj-fallback'
    const { result } = renderHook(() => useFlowEngine({ getFlowProjectId: () => null }))

    mockFlowSessionStatus.mockResolvedValue({ ready: true, credits: 1050 })
    mockFlowExtractProjectId.mockResolvedValue({ projectId: extractedId })
    await act(async () => { await result.current.getAccessToken() })

    await act(async () => {
      await result.current.generateImage('fallback prompt', [])
    })
    expect(mockFlowGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: extractedId })
    )
  })

  it('uploadReference 는 flow.google.com 에서 미지원 — IPC 없이 flow-references-unsupported (M1-10)', async () => {
    const { result } = renderHook(() => useFlowEngine({ getFlowProjectId: () => 'bound-char-proj' }))
    let res
    await act(async () => {
      res = await result.current.uploadReference('base64data', { type: 'character', name: 'hero' })
    })
    expect(res).toMatchObject({ success: false, errorKind: 'flow-references-unsupported', error: 'flow-references-unsupported' })
    expect(mockFlowUploadCharacterEntity).not.toHaveBeenCalled()
    expect(mockFlowUploadReference).not.toHaveBeenCalled()
  })

  it('uses bound projectId for checkVideoStatus', async () => {
    const boundId = 'bound-video-proj'
    mockFlowCheckVideoStatus.mockResolvedValue({ success: true, statuses: [] })
    const { result } = renderHook(() => useFlowEngine({ getFlowProjectId: () => boundId }))
    await act(async () => {
      await result.current.checkVideoStatus(['gen-1'])
    })
    expect(mockFlowCheckVideoStatus).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: boundId })
    )
  })
})

describe('useFlowEngine — listModels', () => {
  it('returns FLOW_MODELS without any IPC call (m1: no flow IPC at all)', async () => {
    const { result } = renderHook(() => useFlowEngine())
    let models
    await act(async () => { models = await result.current.listModels() })

    // No flow IPC should be called — not token, not projects, not image generation
    expect(mockFlowSessionStatus).not.toHaveBeenCalled()
    expect(mockFlowListProjects).not.toHaveBeenCalled()
    expect(mockFlowGenerateImage).not.toHaveBeenCalled()
    expect(models).toEqual({ success: true, models: FLOW_MODELS })
  })

  it('result.models is a flat array (C1: flat array for categorizeApiModels)', async () => {
    const { result } = renderHook(() => useFlowEngine())
    let models
    await act(async () => { models = await result.current.listModels() })

    expect(Array.isArray(models.models)).toBe(true)
    expect(models.models.length).toBeGreaterThan(0)
  })
})

describe('useFlowEngine — generateImage vs submitGeneration (asyncMode)', () => {
  it('generateImage calls flowGenerateImage with asyncMode:false', async () => {
    mockFlowGenerateImage.mockResolvedValue({ success: true, images: [{ base64: 'data:img', mediaId: 'm1' }] })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.generateImage('a prompt', [], { aspectRatio: '16:9' })
    })

    expect(mockFlowGenerateImage).toHaveBeenCalledTimes(1)
    const call = mockFlowGenerateImage.mock.calls[0][0]
    expect(call.asyncMode).toBe(false)
    expect(call.prompt).toBe('a prompt')
  })

  it('submitGeneration calls flowGenerateImage with asyncMode:true', async () => {
    mockFlowGenerateImage.mockResolvedValue({ success: true, generationId: 'gen-42' })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.submitGeneration('another prompt', [], {})
    })

    expect(mockFlowGenerateImage).toHaveBeenCalledTimes(1)
    const call = mockFlowGenerateImage.mock.calls[0][0]
    expect(call.asyncMode).toBe(true)
    expect(res.success).toBe(true)
    expect(res.generationId).toBe('gen-42')
  })
})

describe('useFlowEngine — checkVideoStatus index zip', () => {
  it('zips generationIds with statuses by index', async () => {
    mockFlowCheckVideoStatus.mockResolvedValue({
      success: true,
      statuses: [
        { status: 'complete', mediaId: 'ma', videoUrl: 'http://a', error: null },
        { status: 'pending', mediaId: null, videoUrl: null, error: null },
      ],
    })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.checkVideoStatus(['id-a', 'id-b'])
    })

    expect(res.success).toBe(true)
    expect(res.statuses[0].generationId).toBe('id-a')
    expect(res.statuses[1].generationId).toBe('id-b')
    expect(res.statuses[0].status).toBe('complete')
    expect(res.statuses[0].videoUrl).toBe('http://a')
  })

  it('passes the ids array to flowCheckVideoStatus', async () => {
    mockFlowCheckVideoStatus.mockResolvedValue({ success: true, statuses: [] })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.checkVideoStatus(['x', 'y'])
    })

    expect(mockFlowCheckVideoStatus).toHaveBeenCalledWith(
      expect.objectContaining({ generationIds: ['x', 'y'] })
    )
  })
})

describe('useFlowEngine — uploadReference (flow.google.com 미지원, M1-10)', () => {
  it.each([
    ['plain', { category: 'style' }],
    ['character', { category: 'character', type: 'character', name: 'Hero' }],
  ])('%s ref → flow-references-unsupported, 어떤 IPC 도 호출하지 않는다', async (_n, meta) => {
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.uploadReference('data:img/png;base64,abc', meta) })
    expect(res).toEqual({ success: false, errorKind: 'flow-references-unsupported', error: 'flow-references-unsupported' })
    expect(mockFlowUploadReference).not.toHaveBeenCalled()
    expect(mockFlowUploadCharacterEntity).not.toHaveBeenCalled()
  })
})

describe('useFlowEngine — downloadVideo routing', () => {
  it('routes to flowDownloadVideoUrl when uri looks like a URL', async () => {
    mockFlowDownloadVideoUrl.mockResolvedValue({ success: true, base64: 'vid-data' })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.downloadVideo('https://example.com/video.mp4')
    })

    expect(mockFlowDownloadVideoUrl).toHaveBeenCalledTimes(1)
    expect(mockFlowDomDownloadVideo).not.toHaveBeenCalled()
  })

  it('routes to flowDomDownloadVideo when uri is a mediaId (no protocol)', async () => {
    mockFlowDomDownloadVideo.mockResolvedValue({ success: true, base64: 'vid-dom' })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.downloadVideo('media-id-123')
    })

    expect(mockFlowDomDownloadVideo).toHaveBeenCalledTimes(1)
    expect(mockFlowDownloadVideoUrl).not.toHaveBeenCalled()
  })
})

describe('useFlowEngine — setStopRequested (renderer-local)', () => {
  it('does not call any IPC when setStopRequested is called', () => {
    const { result } = renderHook(() => useFlowEngine())
    act(() => { result.current.setStopRequested(true) })

    // No flow IPC should have been called
    expect(mockFlowSessionStatus).not.toHaveBeenCalled()
    expect(mockFlowGenerateImage).not.toHaveBeenCalled()
  })

  it('setStopRequested is a function (contract satisfied)', () => {
    const { result } = renderHook(() => useFlowEngine())
    expect(typeof result.current.setStopRequested).toBe('function')
  })
})

describe('useFlowEngine — checkGeneration', () => {
  it('delegates to flowCheckGeneration', async () => {
    mockFlowCheckGeneration.mockResolvedValue({ success: true, completed: true })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.checkGeneration('gen-1') })

    expect(mockFlowCheckGeneration).toHaveBeenCalledWith({ generationId: 'gen-1' })
    expect(res.completed).toBe(true)
  })
})

describe('useFlowEngine — collectGeneration', () => {
  it('delegates to flowCollectGeneration', async () => {
    mockFlowCollectGeneration.mockResolvedValue({ success: true, images: [{ base64: 'img', mediaId: 'm2' }] })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.collectGeneration('gen-1') })

    expect(mockFlowCollectGeneration).toHaveBeenCalledWith({ generationId: 'gen-1', token: null })
    expect(res.images[0].mediaId).toBe('m2')
  })
})

describe('useFlowEngine — clearGenerations', () => {
  it('delegates to flowClearGenerations', async () => {
    mockFlowClearGenerations.mockResolvedValue({ success: true, cleared: 3 })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.clearGenerations() })

    expect(mockFlowClearGenerations).toHaveBeenCalledTimes(1)
    expect(res.success).toBe(true)
  })
})

describe('useFlowEngine — fetchMedia', () => {
  it('delegates to flowFetchMedia', async () => {
    mockFlowFetchMedia.mockResolvedValue({ success: true, base64: 'img-data' })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.fetchMedia('media-abc') })

    expect(mockFlowFetchMedia).toHaveBeenCalledWith({ token: null, mediaId: 'media-abc' })
    expect(res.base64).toBe('img-data')
  })
})

describe('useFlowEngine — fetchGallery', () => {
  it('delegates to flowFetchGallery', async () => {
    mockFlowFetchGallery.mockResolvedValue({ success: true, items: [{ mediaId: 'm', url: 'u' }] })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.fetchGallery('proj-1') })

    expect(mockFlowFetchGallery).toHaveBeenCalledWith({ token: null, projectId: 'proj-1' })
    expect(res.items.length).toBe(1)
  })
})

describe('useFlowEngine — listFlowProjects', () => {
  it('delegates to flowListProjects', async () => {
    mockFlowListProjects.mockResolvedValue({ success: true, items: [{ projectId: 'p1', title: 'Test' }] })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.listFlowProjects(10) })

    expect(mockFlowListProjects).toHaveBeenCalledWith({ token: null, pageSize: 10 })
    expect(res.items[0].projectId).toBe('p1')
  })
})

describe('useFlowEngine — Flow 입력 게이트 (M1-10, Flow 모드 무조건 — DOM 조작 전 거부)', () => {
  const synced = { id: 1, name: 'hero', type: 'character', category: 'character', entityId: 'ent-1', flowNameSyncStatus: 'synced', mediaId: 'm1' }
  const unsyncedWithMedia = { id: 9, name: 'king', type: 'character', category: 'character', entityId: null, flowNameSyncStatus: 'failed', mediaId: 'king-m' }
  const entityOnly = { id: 'entity-only', name: 'EntityOnly', type: 'character', entityId: 'entity-1', flowNameSyncStatus: 'synced', mediaId: null }
  const ENTRIES = [['generateImage'], ['submitGeneration']]
  const REFS_UNSUPPORTED = { success: false, errorKind: 'flow-references-unsupported', error: 'flow-references-unsupported' }
  const noGeneration = () => {
    expect(mockFlowGenerateImage).not.toHaveBeenCalled()
    expect(mockFlowGenerateScene).not.toHaveBeenCalled()
  }
  beforeEach(() => { vi.clearAllMocks() })

  it.each(ENTRIES)('%s: callOpts.matchedRefCount:1(필터 전 개수) → flow-references-unsupported', async (fn) => {
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current[fn]('plain prompt', [], { matchedRefCount: 1 }) })
    expect(res).toMatchObject(REFS_UNSUPPORTED)
    noGeneration()
  })

  it.each(ENTRIES)('%s: referenceImages:[{mediaId:"m"}] → 동일 (무효 mediaId 만 있어도 동일)', async (fn) => {
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current[fn]('plain prompt', [{ mediaId: 'm' }], {}) })
    expect(res).toMatchObject(REFS_UNSUPPORTED)
    await act(async () => { res = await result.current[fn]('plain prompt', [{ mediaId: null }, { mediaId: '' }], {}) })
    expect(res).toMatchObject(REFS_UNSUPPORTED)
    noGeneration()
  })

  it.each(ENTRIES)('%s: 해결된 @멘션(scene 라우팅) → 동일, flowGenerateScene 미호출', async (fn) => {
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current[fn]('@hero walks', [], { references: [synced] }) })
    expect(res).toMatchObject(REFS_UNSUPPORTED)
    await act(async () => { res = await result.current[fn]('@EntityOnly appears', [], { references: [entityOnly] }) })
    expect(res).toMatchObject(REFS_UNSUPPORTED)
    noGeneration()
  })

  it.each(ENTRIES)('%s: 미해결 멘션의 이미지 폴백(mediaId 주입)도 → 동일', async (fn) => {
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current[fn]('@king walks in', [], { references: [unsyncedWithMedia] }) })
    expect(res).toMatchObject(REFS_UNSUPPORTED)
    noGeneration()
  })

  it.each(ENTRIES)('%s: callOpts.imageUpscale:"2k" → flow-upscale-unsupported; "off"/미정의는 통과', async (fn) => {
    mockFlowGenerateImage.mockResolvedValue({ success: true, generationId: 'g', images: [{ base64: 'x' }] })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current[fn]('plain prompt', [], { imageUpscale: '2k' }) })
    expect(res).toMatchObject({ success: false, errorKind: 'flow-upscale-unsupported', error: 'flow-upscale-unsupported' })
    expect(mockFlowGenerateImage).not.toHaveBeenCalled()
    await act(async () => { await result.current[fn]('plain prompt', [], { imageUpscale: 'off' }) })
    await act(async () => { await result.current[fn]('plain prompt', [], {}) })
    expect(mockFlowGenerateImage).toHaveBeenCalledTimes(2)
  })

  it.each(ENTRIES)('%s: 게이트를 통과한 평문은 referenceImages:[]·token:null 로 제출', async (fn) => {
    mockFlowGenerateImage.mockResolvedValue({ success: true, generationId: 'g', images: [{ base64: 'x' }] })
    const { result } = renderHook(() => useFlowEngine())
    await act(async () => { await result.current[fn]('plain prompt', [], { matchedRefCount: 0, aspectRatio: '16:9' }) })
    expect(mockFlowGenerateImage).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'plain prompt', referenceImages: [], token: null, aspectRatio: '16:9' }))
  })

  it('submitGeneration 멘션 씬은 로컬 맵 id 를 만들지 않는다 — checkGeneration 은 IPC 로 간다', async () => {
    mockFlowCheckGeneration.mockResolvedValue({ success: false, error: 'Generation not found', notFound: true })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.submitGeneration('@hero walks', [], { references: [synced] }) })
    expect(res.generationId).toBeUndefined()
    let st
    await act(async () => { st = await result.current.checkGeneration('scene-1') })
    expect(mockFlowCheckGeneration).toHaveBeenCalledWith({ generationId: 'scene-1' })
    expect(st.notFound).toBe(true)
  })
})

describe('useFlowEngine — Flow auth side-effects (#R11-2/3)', () => {
  it('#R11-2: an auth-error result clears the token and calls opts.onAuthError', async () => {
    mockFlowGenerateImage.mockResolvedValue({ success: false, error: '401 Unauthorized' })
    const onAuthError = vi.fn()
    const { result } = renderHook(() => useFlowEngine({ onAuthError }))
    let res
    await act(async () => { res = await result.current.generateImage('p', [], {}) })
    expect(res.authFailed).toBe(true)
    expect(onAuthError).toHaveBeenCalledTimes(1)
  })

  it('#R12-1/#R13-1: checkVideoStatus returns one entry per id; mismatched length → all pending (no misattribution)', async () => {
    // Flow returned fewer statuses than requested ids — index-zip would misattribute, so all pending.
    mockFlowCheckVideoStatus.mockResolvedValue({ success: true, statuses: [{ status: 'complete', mediaId: 'm1' }] })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.checkVideoStatus(['g1', 'g2', 'g3']) })
    expect(res.statuses).toHaveLength(3) // one entry per requested id
    expect(res.statuses.map(s => s.generationId)).toEqual(['g1', 'g2', 'g3'])
    expect(res.statuses.every(s => s.status === 'pending')).toBe(true) // length mismatch → safe, no misattribution
  })

  it('#R13-1: checkVideoStatus zips by index when lengths match (Flow order contract)', async () => {
    mockFlowCheckVideoStatus.mockResolvedValue({ success: true, statuses: [{ status: 'complete', mediaId: 'm1' }, { status: 'pending' }] })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.checkVideoStatus(['g1', 'g2']) })
    expect(res.statuses[0]).toMatchObject({ generationId: 'g1', status: 'complete', mediaId: 'm1' })
    expect(res.statuses[1]).toMatchObject({ generationId: 'g2', status: 'pending' })
  })

  it('#R11-3: checkVideoStatus surfaces top-level authFailed when a status carries an auth error', async () => {
    mockFlowCheckVideoStatus.mockResolvedValue({
      success: true,
      statuses: [
        { status: 'pending' },
        { status: 'failed', error: '403 permission denied' },
      ],
    })
    const onAuthError = vi.fn()
    const { result } = renderHook(() => useFlowEngine({ onAuthError }))
    let res
    await act(async () => { res = await result.current.checkVideoStatus(['g1', 'g2']) })
    expect(res.authFailed).toBe(true)
    expect(Array.isArray(res.statuses)).toBe(true)
    expect(onAuthError).toHaveBeenCalled()
  })
})

describe('useFlowEngine — generateVideoI2V: base64 upload (Fix #1)', () => {
  it('uploads base64 data URL frames before calling flowGenerateVideoI2V', async () => {
    mockFlowUploadReference.mockResolvedValueOnce({ success: true, mediaId: 'media-start' })
    mockFlowUploadReference.mockResolvedValueOnce({ success: true, mediaId: 'media-end' })
    mockFlowGenerateVideoI2V.mockResolvedValue({ success: true, generationId: 'vid-1' })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.generateVideoI2V(
        'a video prompt',
        'data:image/png;base64,abc123',
        'data:image/png;base64,def456',
        'veo-model', '9:16', 5, 0, null, {}
      )
    })

    // flowUploadReference called twice (start + end frames)
    expect(mockFlowUploadReference).toHaveBeenCalledTimes(2)
    expect(mockFlowGenerateVideoI2V).toHaveBeenCalledTimes(1)
    const call = mockFlowGenerateVideoI2V.mock.calls[0][0]
    expect(call.startImageMediaId).toBe('media-start')
    expect(call.endImageMediaId).toBe('media-end')
    expect(res.success).toBe(true)
    expect(res.generationId).toBe('vid-1')
  })

  it('R1#8: frame upload failure keeps its errorKind (flow-feature-unsupported) on the result', async () => {
    mockFlowUploadReference.mockResolvedValueOnce({ success: false, errorKind: 'flow-feature-unsupported', error: 'flow-feature-unsupported:upload-reference' })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.generateVideoI2V('a video prompt', 'data:image/png;base64,abc123', null, 'veo-model', '9:16', 5, 0, null, {})
    })
    expect(res).toMatchObject({ success: false, errorKind: 'flow-feature-unsupported', error: 'flow-feature-unsupported:upload-reference' })
    expect(mockFlowGenerateVideoI2V).not.toHaveBeenCalled()
  })

  it('#R9-3: propagates authFailed when a frame upload returns an auth error', async () => {
    mockFlowUploadReference.mockResolvedValueOnce({ success: false, error: '401 Unauthorized' })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.generateVideoI2V(
        'a video prompt', 'data:image/png;base64,abc123', null,
        'veo-model', '9:16', 5, 0, null, {}
      )
    })
    expect(res.success).toBe(false)
    expect(res.authFailed).toBe(true)
    expect(mockFlowGenerateVideoI2V).not.toHaveBeenCalled()
  })

  it('passes media IDs through unchanged (no upload) when frames are already IDs', async () => {
    mockFlowGenerateVideoI2V.mockResolvedValue({ success: true, generationId: 'vid-2' })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.generateVideoI2V(
        'a video prompt',
        'media-id-start',   // short non-base64 string → media ID
        'media-id-end',
        'veo-model', '9:16', 5, 0, null, {}
      )
    })

    // flowUploadReference should NOT be called — IDs passed through
    expect(mockFlowUploadReference).not.toHaveBeenCalled()
    expect(mockFlowGenerateVideoI2V).toHaveBeenCalledTimes(1)
    const call = mockFlowGenerateVideoI2V.mock.calls[0][0]
    expect(call.startImageMediaId).toBe('media-id-start')
    expect(call.endImageMediaId).toBe('media-id-end')
    expect(res.success).toBe(true)
  })

  it('uploads only startImage when endImage is null (single-frame I2V)', async () => {
    mockFlowUploadReference.mockResolvedValueOnce({ success: true, mediaId: 'media-start-only' })
    mockFlowGenerateVideoI2V.mockResolvedValue({ success: true, generationId: 'vid-3' })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.generateVideoI2V(
        'single frame prompt',
        'data:image/jpeg;base64,xxxx',
        null,
        'veo-model', '16:9', 5, 0, null, {}
      )
    })

    // Only one upload (startImage); endImage=null is skipped
    expect(mockFlowUploadReference).toHaveBeenCalledTimes(1)
    expect(mockFlowGenerateVideoI2V).toHaveBeenCalledTimes(1)
    const call = mockFlowGenerateVideoI2V.mock.calls[0][0]
    expect(call.startImageMediaId).toBe('media-start-only')
    expect(call.endImageMediaId).toBeNull()
  })
})

describe('useFlowEngine (#R6-3) — checkVideoStatus videoUrl fallback to mediaId', () => {
  it('sets videoUrl = mediaId when status has mediaId but no videoUrl', async () => {
    mockFlowCheckVideoStatus.mockResolvedValue({
      success: true,
      statuses: [
        { status: 'complete', mediaId: 'media-fallback-id', videoUrl: null, error: null },
      ],
    })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.checkVideoStatus(['gen-vid-1'])
    })

    expect(res.success).toBe(true)
    expect(res.statuses[0].videoUrl).toBe('media-fallback-id')
    expect(res.statuses[0].mediaId).toBe('media-fallback-id')
  })

  it('prefers videoUrl over mediaId when both are present', async () => {
    mockFlowCheckVideoStatus.mockResolvedValue({
      success: true,
      statuses: [
        { status: 'complete', mediaId: 'media-id', videoUrl: 'https://cdn.example.com/video.mp4', error: null },
      ],
    })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.checkVideoStatus(['gen-vid-2'])
    })

    expect(res.statuses[0].videoUrl).toBe('https://cdn.example.com/video.mp4')
  })
})

// ---------------------------------------------------------------------------
// #R6-4: unresolved @mentions → fail immediately, no IPC call
// ---------------------------------------------------------------------------
describe('useFlowEngine (#R6-4) — unresolved @mention fails submitGeneration', () => {
  const syncedRef = {
    id: 1, name: 'hero', type: 'character', category: 'character',
    entityId: 'ent-1', flowNameSyncStatus: 'synced', mediaId: 'm1',
  }
  // An unsynced ref WITHOUT a usable mediaId → @villain is unresolved AND cannot image-fallback (#R33).
  const unsyncedRef = {
    id: 2, name: 'villain', type: 'character', category: 'character',
    entityId: null, flowNameSyncStatus: 'pending', mediaId: null,
  }

  it('returns { success:false, error } when prompt has an unresolved @mention', async () => {
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.submitGeneration('@villain appears', [], { references: [syncedRef, unsyncedRef] })
    })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Unresolved @mention/)
    expect(res.error).toContain('villain')
    // Neither IPC should be called
    expect(mockFlowGenerateScene).not.toHaveBeenCalled()
    expect(mockFlowGenerateImage).not.toHaveBeenCalled()
  })

  it('fully resolved mention is not "unresolved" — but the scene route is unsupported on flow.google.com (M1-10)', async () => {
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.submitGeneration('@hero walks', [], { references: [syncedRef] })
    })

    expect(res).toMatchObject({ success: false, errorKind: 'flow-references-unsupported' })
    expect(res.errorKind).not.toBe('unresolved-mentions')
    expect(mockFlowGenerateScene).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// #R33: 미해결 @멘션 이미지 폴백 — 미동기화 캐릭터라도 mediaId 가 있으면 @ 를 떼고
//   ref 이미지를 주입해 일반 이미지로 생성(하드 실패 대신). mediaId 없으면 기존대로 실패.
// ---------------------------------------------------------------------------
describe('generateImage: 미해결 멘션 결과 계약', () => {
  it('하드 실패면 errorKind 와 unresolvedNames 를 함께 돌려준다', async () => {
    const { result } = renderHook(() => useFlowEngine({ mode: 'flow', projectId: 'p' }))
    const refs = [
      { id: 1, name: 'hero', type: 'character', entityId: 'e1', flowNameSyncStatus: 'synced', mediaId: 'm1' },
      { id: 2, name: 'king', type: 'character', entityId: 'e2', flowNameSyncStatus: 'failed', mediaId: 'km' },
    ]
    const res = await result.current.generateImage('@hero and @king', [], { references: refs })
    expect(res.success).toBe(false)
    expect(res.errorKind).toBe('unresolved-mentions')
    expect(res.unresolvedNames).toEqual(['king'])
  })

  // 배치는 submitGeneration 을 쓴다 — 두 진입점이 같은 계약이어야 호출부가 하나로 복구할 수 있다.
  it('submitGeneration 도 같은 계약으로 돌려준다', async () => {
    const { result } = renderHook(() => useFlowEngine({ mode: 'flow', projectId: 'p' }))
    const refs = [
      { id: 1, name: 'hero', type: 'character', entityId: 'e1', flowNameSyncStatus: 'synced', mediaId: 'm1' },
      { id: 2, name: 'king', type: 'character', entityId: 'e2', flowNameSyncStatus: 'failed', mediaId: 'km' },
    ]
    const res = await result.current.submitGeneration('@hero and @king', [], { references: refs })
    expect(res.success).toBe(false)
    expect(res.errorKind).toBe('unresolved-mentions')
    expect(res.unresolvedNames).toEqual(['king'])
  })
})

describe('#R33: planMentionRouting (pure)', () => {
  const synced = { id: 1, name: 'hero', type: 'character', entityId: 'e1', flowNameSyncStatus: 'synced', mediaId: 'm1' }
  const unsyncedMedia = { id: 2, name: 'king', type: 'character', entityId: null, flowNameSyncStatus: 'failed', mediaId: 'km' }
  const unsyncedNoMedia = { id: 3, name: 'ghost', type: 'character', entityId: null, flowNameSyncStatus: 'failed', mediaId: null }

  it('no mention → kind:image, prompt/refs unchanged', () => {
    const r = planMentionRouting('a plain prompt', [{ mediaId: 'z' }], [])
    expect(r.kind).toBe('image')
    expect(r.prompt).toBe('a plain prompt')
    expect(r.referenceImages).toEqual([{ mediaId: 'z' }])
  })

  it('resolved mention → kind:scene with segments', () => {
    const r = planMentionRouting('@hero runs', [], [synced])
    expect(r.kind).toBe('scene')
    expect(r.segments.some(s => s.type === 'mention' && s.name === 'hero')).toBe(true)
  })

  it('unresolved-only with mediaId → kind:image fallback (stripped + injected)', () => {
    const r = planMentionRouting('@king runs', [], [unsyncedMedia])
    expect(r.kind).toBe('image')
    expect(r.prompt).toBe('king runs')
    expect(r.referenceImages.some(x => x.mediaId === 'km')).toBe(true)
  })

  it('unresolved-only without mediaId → kind:error', () => {
    const r = planMentionRouting('@ghost runs', [], [unsyncedNoMedia])
    expect(r.kind).toBe('error')
    expect(r.error).toMatch(/Unresolved @mention/)
  })

  it('mixed (resolved + unresolved) → kind:error (cannot merge paths)', () => {
    const r = planMentionRouting('@hero and @king', [], [synced, unsyncedMedia])
    expect(r.kind).toBe('error')
    expect(r.error).toContain('king')
  })

  // 호출부가 "무엇을 고쳐야 하나"를 알아야 그 자리에서 동기화를 제안할 수 있다. 사람이 읽는
  // 에러 문자열을 파싱해서 이름을 캐내면 파서가 둘이 되고 문구를 바꾸는 순간 조용히 깨진다.
  it('error carries the unresolved names as data, not only in the message', () => {
    const r = planMentionRouting('@hero and @king', [], [synced, unsyncedMedia])
    expect(r.unresolvedNames).toEqual(['king'])
  })

  it('braced unresolved name is carried whole', () => {
    const r = planMentionRouting('@{도둑 우두머리} 등장', [], [synced])
    expect(r.unresolvedNames).toEqual(['도둑 우두머리'])
  })

  it('braced unresolved error reports the full inner name', () => {
    const r = planMentionRouting('@{도둑 우두머리} 등장', [], [synced])
    expect(r).toEqual({
      kind: 'error',
      error: 'Unresolved @mention(s): 도둑 우두머리',
      unresolvedNames: ['도둑 우두머리'],
    })
  })

  it('braced unresolved character with mediaId falls back without prefix shortening', () => {
    const boss = {
      id: 4,
      name: '도둑 우두머리',
      type: 'character',
      flowNameSyncStatus: 'failed',
      mediaId: 'boss-media',
    }
    const r = planMentionRouting('@{도둑 우두머리}A young man', [], [boss])
    expect(r.kind).toBe('image')
    expect(r.prompt).toBe('도둑 우두머리A young man')
    expect(r.referenceImages.map(ref => ref.mediaId)).toEqual(['boss-media'])
  })

  it('braced unresolved fallback does not strip a particle to a shorter ref', () => {
    const chulsoo = {
      id: 5,
      name: '철수',
      type: 'character',
      flowNameSyncStatus: 'failed',
      mediaId: 'chulsoo-media',
    }
    const r = planMentionRouting('@{철수가} 달린다', [], [chulsoo])
    expect(r.kind).toBe('error')
    expect(r.error).toContain('철수가')
  })

  it('braced unresolved fallback matches the exact full name case-insensitively', () => {
    const bob = {
      id: 6,
      name: 'Bob',
      type: 'character',
      flowNameSyncStatus: 'failed',
      mediaId: 'bob-media',
    }

    const r = planMentionRouting('@{BOB} walks', [], [bob])

    expect(r.kind).toBe('image')
    expect(r.prompt).toBe('BOB walks')
    expect(r.referenceImages.map(ref => ref.mediaId)).toEqual(['bob-media'])
  })
})

describe('computeSceneGapReferences (pure)', () => {
  it('excludes chip mentions, drops refs without mediaId, and dedupes by mediaId', () => {
    const mentionRef = { name: 'Office Man', mediaId: 'media-office' }
    const gapRef = { name: '도둑 우두머리', mediaId: 'media-bandit' }
    const duplicateMedia = { name: '초저녁 도둑', mediaId: 'media-bandit' }
    const noMedia = { name: '배경 인물', mediaId: null }

    const result = computeSceneGapReferences(
      [mentionRef, gapRef, duplicateMedia, noMedia],
      [{ type: 'mention', name: 'office man' }, { type: 'text', text: ' 장면' }],
    )

    expect(result).toEqual([gapRef])
  })

  it('does not inject a same-mediaId alias of a chip-mentioned ref (no double-conditioning)', () => {
    // 사내(chip) 와 mediaId 가 같은 중복 카드(다른 이름)는 이미 chip 으로 컨디셔닝된 이미지라 imageInput 재주입 금지.
    const chipRef = { name: '사내', mediaId: 'media-office' }
    const sameMediaAlias = { name: '사내_복제', mediaId: 'media-office' }
    const realGap = { name: '도둑 우두머리', mediaId: 'media-bandit' }

    const result = computeSceneGapReferences(
      [chipRef, sameMediaAlias, realGap],
      [{ type: 'mention', name: '사내' }],
    )

    expect(result.map(r => r.mediaId)).toEqual(['media-bandit'])
  })

  it('blocks a same-mediaId alias even when it precedes the chip ref (order-independent)', () => {
    // referenceImages 순서는 caller/사용자 정의 → alias 가 chip ref 보다 앞서도 이중 컨디셔닝 금지.
    const sameMediaAlias = { name: '사내_복제', mediaId: 'media-office' }
    const chipRef = { name: '사내', mediaId: 'media-office' }
    const realGap = { name: '도둑 우두머리', mediaId: 'media-bandit' }

    const result = computeSceneGapReferences(
      [sameMediaAlias, chipRef, realGap],
      [{ type: 'mention', name: '사내' }],
    )

    expect(result.map(r => r.mediaId)).toEqual(['media-bandit'])
  })

  it('excludes a canonical space-name chip produced from a braced mention', () => {
    const chipRef = {
      id: 6,
      type: 'character',
      name: '도둑 우두머리',
      entityId: 'boss-entity',
      flowNameSyncStatus: 'synced',
      mediaId: 'boss-media',
    }
    const gapRef = { name: '골목 배경', mediaId: 'alley-media' }
    const routing = planMentionRouting('@{도둑 우두머리} 등장', [], [chipRef])

    expect(routing.kind).toBe('scene')
    expect(computeSceneGapReferences([chipRef, gapRef], routing.segments)).toEqual([gapRef])
  })
})

describe('#R33: planUnresolvedMentionFallback (pure)', () => {
  const unsyncedMedia = { id: 2, name: 'king', type: 'character', entityId: null, flowNameSyncStatus: 'failed', mediaId: 'km', category: 'character' }

  it('returns stripped prompt + merged refs when all unresolved have mediaId', () => {
    const fb = planUnresolvedMentionFallback('@king walks', [{ mediaId: 'pre' }], [{ name: 'king' }], [unsyncedMedia])
    expect(fb).not.toBeNull()
    expect(fb.prompt).toBe('king walks')
    expect(fb.referenceImages.map(r => r.mediaId)).toEqual(['pre', 'km'])
  })

  it('returns null when any unresolved name has no usable mediaId', () => {
    const noMedia = { name: 'ghost', mediaId: null }
    expect(planUnresolvedMentionFallback('@ghost', [], [{ name: 'ghost' }], [noMedia])).toBeNull()
  })

  it('dedupes by mediaId (no duplicate injection)', () => {
    const fb = planUnresolvedMentionFallback('@king', [{ mediaId: 'km' }], [{ name: 'king' }], [unsyncedMedia])
    expect(fb.referenceImages.filter(r => r.mediaId === 'km')).toHaveLength(1)
  })

  it('#R34-fix: 같은 이름의 비-character(scene/style) ref 가 character 멘션 폴백을 가로채지 않는다', () => {
    // @king 은 캐릭터 멘션 의도. 같은 이름의 scene ref(mediaId 보유)가 있어도
    // character 가 미동기화이고 주입 불가(mediaId 없음)면 폴백 포기(null) — scene 이미지를 주입하지 않는다.
    const charNoMedia = { id: 3, name: 'king', type: 'character', mediaId: null, category: 'character' }
    const sceneSameName = { id: 4, name: 'king', type: 'scene', mediaId: 'scene-media', category: 'scene' }
    const fb = planUnresolvedMentionFallback('@king walks', [], [{ name: 'king' }], [sceneSameName, charNoMedia])
    expect(fb).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Existing: token ref prevents stale closure (#R4-3)
// ---------------------------------------------------------------------------
describe('useFlowEngine — 세션 준비 후 IPC 페이로드의 token 은 항상 null (M1-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowSessionStatus.mockResolvedValue({ ready: true, credits: 1050 })
    mockFlowExtractProjectId.mockResolvedValue({ projectId: null })
  })

  it('getAccessToken 뒤 checkVideoStatus / fetchMedia / generateVideoT2V 가 token:null 로 나간다', async () => {
    mockFlowCheckVideoStatus.mockResolvedValue({ success: true, statuses: [] })
    mockFlowFetchMedia.mockResolvedValue({ success: true, base64: 'x' })
    mockFlowGenerateVideoT2V.mockResolvedValue({ success: true, generationId: 'gv' })
    const { result } = renderHook(() => useFlowEngine())
    await act(async () => { await result.current.getAccessToken() })
    expect(result.current.accessToken).toBe('flow-session')
    await act(async () => {
      await result.current.checkVideoStatus(['gen-id-1'])
      await result.current.fetchMedia('m1')
      await result.current.generateVideoT2V('a quiet street', 'veo', '16:9', 6, null, '720p', [], {})
    })
    expect(mockFlowCheckVideoStatus).toHaveBeenCalledWith(expect.objectContaining({ token: null }))
    expect(mockFlowFetchMedia).toHaveBeenCalledWith({ token: null, mediaId: 'm1' })
    expect(mockFlowGenerateVideoT2V).toHaveBeenCalledWith(expect.objectContaining({ token: null }))
  })

  it('clearTokenCache 뒤에도 token:null (센티널만 사라진다)', async () => {
    mockFlowFetchMedia.mockResolvedValue({ success: true, base64: 'x' })
    const { result } = renderHook(() => useFlowEngine())
    await act(async () => { await result.current.getAccessToken() })
    act(() => { result.current.clearTokenCache() })
    expect(result.current.accessToken).toBeNull()
    await act(async () => { await result.current.fetchMedia('m2') })
    expect(mockFlowFetchMedia).toHaveBeenCalledWith({ token: null, mediaId: 'm2' })
  })
})

// M2-3: 해상도를 엔진 → IPC 로 넘긴다(옛 경로는 _resolution 을 버렸다 — 플랜 1-3). 패널에 없는 값(1080p)은 main 이 클릭 전에
//   flow-resolution-not-offered {requested} 로 닫는다(M2-2) — 그 판정이 서려면 값이 IPC 에 실려야 한다.
describe('useFlowEngine — M2-3 generateVideoT2V 는 resolution 을 IPC 페이로드에 싣는다', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowGenerateVideoT2V.mockResolvedValue({ success: true, generationId: 'gv1', creditsLeft: 1040 })
  })

  it("generateVideoT2V('p','Omni Flash','16:9',6,null,'1080p',[],{}) → 페이로드 {resolution:'1080p', token:null, model, aspectRatio, duration}", async () => {
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.generateVideoT2V('p', 'Omni Flash', '16:9', 6, null, '1080p', [], {}) })
    expect(res).toEqual({ success: true, generationId: 'gv1', creditsLeft: 1040 })
    expect(mockFlowGenerateVideoT2V).toHaveBeenCalledTimes(1)
    expect(mockFlowGenerateVideoT2V.mock.calls[0][0]).toMatchObject({ resolution: '1080p', token: null, prompt: 'p', model: 'Omni Flash', aspectRatio: '16:9', duration: 6, segments: null })
  })

  it('main 의 flow-resolution-not-offered {requested} · postClick · rejectedMediaId 결과는 그대로 통과한다(markAuth 가 덮지 않는다)', async () => {
    mockFlowGenerateVideoT2V.mockResolvedValueOnce({ success: false, errorKind: 'flow-resolution-not-offered', error: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.generateVideoT2V('p', 'Omni Flash', '16:9', 6, null, '1080p', [], {}) })
    expect(res).toEqual({ success: false, errorKind: 'flow-resolution-not-offered', error: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } })
    mockFlowGenerateVideoT2V.mockResolvedValueOnce({ success: false, errorKind: 'flow-video-settings-mismatch', error: 'flow-video-settings-mismatch', errorParams: { expected: 'a', actual: 'b' }, rejectedMediaId: 'rm', postClick: true })
    await act(async () => { res = await result.current.generateVideoT2V('p', 'Omni Flash', '16:9', 6, null, '720p', [], {}) })
    expect(res).toMatchObject({ errorKind: 'flow-video-settings-mismatch', rejectedMediaId: 'rm', postClick: true })
    expect(res).not.toHaveProperty('authFailed')
    expect(res).not.toHaveProperty('mediaId')
    expect(res).not.toHaveProperty('generationId')
  })
})

describe('useFlowEngine — #R36 T2V @멘션 segments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowGenerateVideoT2V.mockResolvedValue({ success: true, generationId: 'gv1' })
  })

  it('segments(@멘션 칩) 가 있으면 flow-mention-chips-unsupported — flowGenerateVideoT2V 미호출 (M1-10)', async () => {
    const { result } = renderHook(() => useFlowEngine())
    const segs = [{ type: 'mention', name: 'king', entityId: 'e1' }, { type: 'text', text: ' walks' }]
    let res
    await act(async () => {
      res = await result.current.generateVideoT2V('@king walks', 'veo', '16:9', 6, null, '720p', [], { segments: segs })
    })
    expect(res).toMatchObject({ success: false, errorKind: 'flow-mention-chips-unsupported', error: 'flow-mention-chips-unsupported' })
    expect(mockFlowGenerateVideoT2V).not.toHaveBeenCalled()
  })

  it('segments 없이 referenceImages 가 있으면 기존대로 fail-fast(ref 미지원)', async () => {
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.generateVideoT2V('hero walks', 'veo', '16:9', 6, null, '720p', [{ mediaId: 'm1' }], {})
    })
    expect(res.success).toBe(false)
    expect(res).toMatchObject({
      errorKind: 'flow-t2v-reference-images-unsupported',
      error: 'Flow text-to-video does not support reference images',
    })
    expect(mockFlowGenerateVideoT2V).not.toHaveBeenCalled()
  })

  it('segments/ref 둘 다 없으면 일반 텍스트 T2V (정상 제출)', async () => {
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.generateVideoT2V('a quiet street', 'veo', '16:9', 6, null, '720p', [], {})
    })
    expect(res.success).toBe(true)
    expect(mockFlowGenerateVideoT2V).toHaveBeenCalledWith(expect.objectContaining({ segments: null }))
  })
})

// Ref 탭 캐릭터 카드는 Flow 의 /characters 컴포저에서 바로 생성한다. 메인 컴포저("모든 미디어")로
// 만들면 그냥 미디어일 뿐이라, entity 로 만들려면 그 이미지를 /characters 에 다시 업로드해야 한다
// (= '동기화' 버튼). flowGenerateCharacter 는 생성과 동시에 entityId 를 돌려줘 그 왕복을 없앤다.
describe('useFlowEngine — 캐릭터 ref 는 /characters 에서 생성한다', () => {
  const charOpts = { purpose: 'reference', ref: { id: 7, name: '준호', type: 'character' }, aspectRatio: '16:9', seed: 42, model: 'Nano Banana 2' }
  const charResult = {
    success: true,
    images: [{ base64: 'data:img', mediaId: 'm-char' }],
    entityId: 'e-1', workflowId: 'w-1', mediaId: 'm-char', registered: true,
  }

  it('generateImage: 캐릭터 ref 면 flowGenerateCharacter 를 부른다', async () => {
    mockFlowGenerateCharacter.mockResolvedValue(charResult)
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.generateImage('한국인, male, tall', [], charOpts) })

    expect(mockFlowGenerateImage).not.toHaveBeenCalled()
    expect(mockFlowGenerateCharacter).toHaveBeenCalledTimes(1)
    const call = mockFlowGenerateCharacter.mock.calls[0][0]
    expect(call.prompt).toBe('한국인, male, tall')
    expect(call.displayName).toBe('준호')
    expect(call.aspectRatio).toBe('16:9') // 미주입 시 Flow 기본값(9:16)으로 나간다
    expect(call.seed).toBe(42)
    expect(call.model).toBe('Nano Banana 2') // 선택된 이미지 모델은 캐릭터 경로도 따라야 한다
    expect(res).toMatchObject({ success: true, entityId: 'e-1', workflowId: 'w-1', registered: true })
  })

  // #R37: reroll 배선은 **의도적으로 꺼져 있다**. 리뷰에서 두 결함이 확인됐다:
  //   (1) reroll 재등록은 buildEntityImageBody(imageReferences 만)를 써서 displayName 을 등록하지
  //       않는데도 registered:true 를 돌려준다 → 이름 없는 entity 가 'synced' 로 마킹되고 멘션 피커가
  //       이름을 못 찾는다. 이 작업이 rename 경로를 금지한 것과 같은 버그 부류다.
  //   (2) reroll 핸들러는 aspectRatio/seed/model 을 버린다(create 의 arm 블록이 없다).
  // 이 테스트는 "무심코 다시 켜는 것"을 막는다. 켜려면 위 둘을 고치고 실앱에서 눈으로 검증할 것.
  it('캐릭터 재생성은 항상 create 로 간다 — reroll 은 결함이 남아 꺼져 있다', async () => {
    const existingOpts = { ...charOpts, ref: { ...charOpts.ref, entityId: 'e-existing', workflowId: 'w-old' } }
    const { result } = renderHook(() => useFlowEngine())
    await act(async () => { await result.current.generateImage('new look', [], existingOpts) })

    expect(mockFlowRerollCharacter).not.toHaveBeenCalled()
    expect(mockFlowGenerateCharacter).toHaveBeenCalled()
  })

  it('planCharacterGeneration 은 entityId 가 있어도 create 를 고른다', () => {
    expect(planCharacterGeneration({ entityId: 'e1', workflowId: 'w1' })).toBe('create')
    expect(planCharacterGeneration({})).toBe('create')
  })

  it('scene/style ref 는 그대로 메인 컴포저(flowGenerateImage)로 간다', async () => {
    mockFlowGenerateImage.mockResolvedValue({ success: true, images: [{ base64: 'i', mediaId: 'm' }] })
    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.generateImage('p', [], { purpose: 'reference', ref: { id: 1, name: 's', type: 'style' } })
    })
    expect(mockFlowGenerateCharacter).not.toHaveBeenCalled()
    expect(mockFlowGenerateImage).toHaveBeenCalledTimes(1)
  })

  it('씬 생성(purpose 미지정)은 캐릭터 경로로 새지 않는다', async () => {
    mockFlowGenerateImage.mockResolvedValue({ success: true, images: [{ base64: 'i', mediaId: 'm' }] })
    const { result } = renderHook(() => useFlowEngine())
    await act(async () => { await result.current.generateImage('p', [], {}) })
    expect(mockFlowGenerateCharacter).not.toHaveBeenCalled()
  })

  // flowGenerateCharacter 는 동기 반환(생성 완료된 images)이다. 배치는 submit→collect 계약이라
  // scene 동기 폴백과 같은 방식으로 로컬 맵에 담아 generationId 를 돌려준다.
  // nameApplied 를 안 실으면 배치 캐릭터는 렌더러의 refresh 폴백을 못 타 — 이름이 SPA 에 안 들어간
  // 채로 synced 로 마킹되고 멘션 피커엔 옛 이름이 남는다.
  it('submitGeneration→collect 가 nameApplied 를 그대로 전달한다', async () => {
    mockFlowGenerateCharacter.mockResolvedValue({ ...charResult, nameApplied: false })
    const { result } = renderHook(() => useFlowEngine())
    let sub, col
    await act(async () => { sub = await result.current.submitGeneration('p', [], charOpts) })
    await act(async () => { col = await result.current.collectGeneration(sub.generationId) })
    expect(col.nameApplied).toBe(false)
  })

  it('submitGeneration: 캐릭터 ref 는 동기 생성 후 generationId 를 돌려주고 collect 로 회수된다', async () => {
    mockFlowGenerateCharacter.mockResolvedValue(charResult)
    const { result } = renderHook(() => useFlowEngine())
    let sub
    await act(async () => { sub = await result.current.submitGeneration('p', [], charOpts) })
    expect(sub.success).toBe(true)
    expect(sub.generationId).toBeTruthy()
    expect(mockFlowGenerateImage).not.toHaveBeenCalled()

    let col
    await act(async () => { col = await result.current.collectGeneration(sub.generationId) })
    expect(col).toMatchObject({ success: true, entityId: 'e-1', workflowId: 'w-1', registered: true })
    expect(col.images[0].mediaId).toBe('m-char')
    expect(mockFlowCollectGeneration).not.toHaveBeenCalled() // 로컬 맵에서 회수
  })

  it('생성이 실패하면 그대로 실패를 전파한다 (entity 없는 카드를 done 으로 만들지 않는다)', async () => {
    mockFlowGenerateCharacter.mockResolvedValue({ success: false, error: 'generate HTTP 400' })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.generateImage('p', [], charOpts) })
    expect(res.success).toBe(false)
    expect(res.error).toContain('400')
  })
})

describe('useFlowEngine — checkVideoStatus: 새 경로 필드·중립 문구 (M1-10)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('항목 {error:"flow-rpc-error", rpcStatus:403} 는 authFailed 가 되지 않는다(정규식 스캔 통과)', async () => {
    mockFlowCheckVideoStatus.mockResolvedValue({ success: true, statuses: [{ status: 'failed', error: 'flow-rpc-error', errorKind: 'flow-rpc-error', rpcStatus: 403 }] })
    const onAuthError = vi.fn()
    const { result } = renderHook(() => useFlowEngine({ onAuthError }))
    let res
    await act(async () => { res = await result.current.checkVideoStatus(['g1']) })
    expect(res.authFailed).toBeUndefined()
    expect(onAuthError).not.toHaveBeenCalled()
    expect(res.statuses[0]).toMatchObject({ generationId: 'g1', status: 'failed', error: 'flow-rpc-error', errorKind: 'flow-rpc-error' })
  })

  it('main 이 authFailed:true 를 명시하면 markAuth (센티널 제거 + onAuthError 1회)', async () => {
    mockFlowCheckVideoStatus.mockResolvedValue({ success: false, error: 'flow-rpc-error', errorKind: 'flow-rpc-error', rpcStatus: 401, authFailed: true })
    const onAuthError = vi.fn()
    const { result } = renderHook(() => useFlowEngine({ onAuthError }))
    let res
    await act(async () => { res = await result.current.checkVideoStatus(['g1']) })
    expect(res.authFailed).toBe(true)
    expect(onAuthError).toHaveBeenCalledTimes(1)
  })

  it('errorKind · unknownState · errorParams · rejectedMediaId · pollError 를 항목에 그대로 싣는다', async () => {
    mockFlowCheckVideoStatus.mockResolvedValue({ success: true, statuses: [
      { status: 'pending', unknownState: 7 },
      { status: 'failed', error: 'flow-video-settings-mismatch', errorKind: 'flow-video-settings-mismatch', errorParams: { expected: 'a', actual: 'b' }, rejectedMediaId: 'rm' },
      { status: 'pending', pollError: 'flow-rpc-error', rpcCode: 8 },
    ] })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => { res = await result.current.checkVideoStatus(['g1', 'g2', 'g3']) })
    expect(res.statuses[0]).toMatchObject({ generationId: 'g1', status: 'pending', unknownState: 7 })
    expect(res.statuses[1]).toMatchObject({ generationId: 'g2', status: 'failed', errorKind: 'flow-video-settings-mismatch', errorParams: { expected: 'a', actual: 'b' }, rejectedMediaId: 'rm' })
    expect(res.statuses[1].mediaId).toBeNull()
    expect(res.statuses[2]).toMatchObject({ generationId: 'g3', status: 'pending', pollError: 'flow-rpc-error', rpcCode: 8 })
  })
})
