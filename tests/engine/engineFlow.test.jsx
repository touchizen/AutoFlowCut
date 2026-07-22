/**
 * engineFlow.test.jsx — useFlowEngine 어댑터 단위 테스트.
 * window.electronAPI.flow* 를 모킹해 IPC 없이 완전 검증.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { assertEngineContract } from './engineContract'
import { FLOW_MODELS } from '../../src/engine/flowModels'

// --- flow* IPC mocks ---
const mockFlowExtractToken = vi.fn()
const mockFlowValidateToken = vi.fn()
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
    flowExtractToken: mockFlowExtractToken,
    flowValidateToken: mockFlowValidateToken,
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

describe('useFlowEngine — getAccessToken', () => {
  it('calls flowExtractToken then flowValidateToken and returns the raw token', async () => {
    mockFlowExtractToken.mockResolvedValue({ success: true, token: 'bearer-abc' })
    mockFlowValidateToken.mockResolvedValue({ valid: true, expiry: Date.now() + 3600_000 })

    const { result } = renderHook(() => useFlowEngine())
    let token
    await act(async () => {
      token = await result.current.getAccessToken()
    })

    expect(mockFlowExtractToken).toHaveBeenCalledTimes(1)
    expect(mockFlowValidateToken).toHaveBeenCalledWith({ token: 'bearer-abc' })
    expect(token).toBe('bearer-abc')
  })

  it('sets accessToken state after successful extraction', async () => {
    mockFlowExtractToken.mockResolvedValue({ success: true, token: 'tok-123' })
    mockFlowValidateToken.mockResolvedValue({ valid: true, expiry: Date.now() + 3600_000 })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => { await result.current.getAccessToken() })

    expect(result.current.accessToken).toBe('tok-123')
  })

  it('returns null and does not set token when extract fails', async () => {
    mockFlowExtractToken.mockResolvedValue({ success: false })

    const { result } = renderHook(() => useFlowEngine())
    let token
    await act(async () => { token = await result.current.getAccessToken() })

    expect(token).toBeNull()
    expect(result.current.accessToken).toBeNull()
  })

  it('populates projectId from flowExtractProjectId after successful token (I3)', async () => {
    mockFlowExtractToken.mockResolvedValue({ success: true, token: 'tok-i3' })
    mockFlowValidateToken.mockResolvedValue({ valid: true, expiry: Date.now() + 3600_000 })
    mockFlowExtractProjectId.mockResolvedValue({ projectId: 'proj-abc' })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => { await result.current.getAccessToken() })

    expect(mockFlowExtractProjectId).toHaveBeenCalledWith({ liveOnly: false })
    expect(result.current.projectId).toBe('proj-abc')
  })

  it('returns null when token is invalid', async () => {
    mockFlowExtractToken.mockResolvedValue({ success: true, token: 'expired-tok' })
    mockFlowValidateToken.mockResolvedValue({ valid: false })

    const { result } = renderHook(() => useFlowEngine())
    let token
    await act(async () => { token = await result.current.getAccessToken() })

    expect(token).toBeNull()
    expect(result.current.accessToken).toBeNull()
  })
})

describe('useFlowEngine — clearTokenCache', () => {
  it('clears the accessToken state', async () => {
    mockFlowExtractToken.mockResolvedValue({ success: true, token: 'tok-abc' })
    mockFlowValidateToken.mockResolvedValue({ valid: true, expiry: Date.now() + 3600_000 })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => { await result.current.getAccessToken() })
    expect(result.current.accessToken).toBe('tok-abc')

    act(() => { result.current.clearTokenCache() })
    expect(result.current.accessToken).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// #R3-1: bound projectId (getFlowProjectId) takes precedence over extracted (live URL)
// ---------------------------------------------------------------------------
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
    mockFlowExtractToken.mockResolvedValue({ success: true, token: 'tok' })
    mockFlowValidateToken.mockResolvedValue({ valid: true })
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

    mockFlowExtractToken.mockResolvedValue({ success: true, token: 'tok2' })
    mockFlowValidateToken.mockResolvedValue({ valid: true })
    mockFlowExtractProjectId.mockResolvedValue({ projectId: extractedId })
    await act(async () => { await result.current.getAccessToken() })

    await act(async () => {
      await result.current.generateImage('fallback prompt', [])
    })
    expect(mockFlowGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: extractedId })
    )
  })

  it('uses bound projectId for uploadReference (character entity path)', async () => {
    const boundId = 'bound-char-proj'
    mockFlowUploadCharacterEntity.mockResolvedValue({ success: true })
    const { result } = renderHook(() => useFlowEngine({ getFlowProjectId: () => boundId }))
    await act(async () => {
      await result.current.uploadReference('base64data', { type: 'character', name: 'hero' })
    })
    expect(mockFlowUploadCharacterEntity).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: boundId })
    )
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
    expect(mockFlowExtractToken).not.toHaveBeenCalled()
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

describe('useFlowEngine — uploadReference routing', () => {
  it('routes to flowUploadReference for plain (non-character) refs', async () => {
    mockFlowUploadReference.mockResolvedValue({ success: true, mediaId: 'ref-plain', caption: null })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.uploadReference('data:img/png;base64,abc', { category: 'style' })
    })

    expect(mockFlowUploadReference).toHaveBeenCalledTimes(1)
    expect(mockFlowUploadCharacterEntity).not.toHaveBeenCalled()
    expect(res.mediaId).toBe('ref-plain')
  })

  it('routes to flowUploadCharacterEntity for character type refs', async () => {
    mockFlowUploadCharacterEntity.mockResolvedValue({
      success: true, entityId: 'ent-1', workflowId: 'wf-1', mediaId: 'media-1', registered: true,
    })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.uploadReference(
        'data:img/png;base64,abc',
        { category: 'character', type: 'character', name: 'Hero' }
      )
    })

    expect(mockFlowUploadCharacterEntity).toHaveBeenCalledTimes(1)
    expect(mockFlowUploadReference).not.toHaveBeenCalled()
    expect(res.entityId).toBe('ent-1')
    expect(res.mediaId).toBe('media-1')
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
    expect(mockFlowExtractToken).not.toHaveBeenCalled()
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

describe('useFlowEngine — submitGeneration: mention routing (C1)', () => {
  const syncedRef = {
    id: 1,
    name: 'hero',
    type: 'character',
    category: 'character',
    entityId: 'ent-1',
    flowNameSyncStatus: 'synced',
    mediaId: 'm1',
  }

  it('routes to flowGenerateScene when prompt has a resolvable @mention', async () => {
    mockFlowGenerateScene.mockResolvedValue({
      success: true,
      images: [{ base64: 'data:img', mediaId: 'scene-m1' }],
      workflowId: 'wf-scene-1',
      mediaId: 'scene-m1',
      fifeUrl: null,
    })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.submitGeneration('@hero walks', [], { references: [syncedRef] })
    })

    expect(mockFlowGenerateScene).toHaveBeenCalledTimes(1)
    expect(mockFlowGenerateImage).not.toHaveBeenCalled()
    // submitGeneration contract: { success, generationId }
    // #R6-1: generationId is now a local-map id (e.g. 'scene-N'), NOT the raw workflowId
    expect(res.success).toBe(true)
    expect(typeof res.generationId).toBe('string')
    expect(res.generationId.length).toBeGreaterThan(0)
    // flowGenerateScene is called with prompt + segments
    const call = mockFlowGenerateScene.mock.calls[0][0]
    expect(call.prompt).toBe('@hero walks')
    expect(Array.isArray(call.segments)).toBe(true)
    expect(call.segments.some(s => s.type === 'mention' && s.name === 'hero')).toBe(true)
  })

  it('passes only tag-matched scene gap refs alongside resolved mention chips', async () => {
    const syncedMention = { ...syncedRef, name: '사내', entityId: 'ent-office', mediaId: 'media-office' }
    const tagOnly = {
      id: 2,
      name: '도둑 우두머리',
      type: 'character',
      category: 'character',
      entityId: 'ent-bandit',
      flowNameSyncStatus: 'synced',
      mediaId: 'media-bandit',
    }
    mockFlowGenerateScene.mockResolvedValue({ success: true, generationId: 'scene-gap-async' })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.submitGeneration('@사내가 도둑 우두머리를 바라본다', [syncedMention, tagOnly], {
        references: [syncedMention, tagOnly],
      })
    })

    const call = mockFlowGenerateScene.mock.calls[0][0]
    expect(call.segments.some(s => s.type === 'mention' && s.name === '사내')).toBe(true)
    expect(call.gapReferences.map(r => r.mediaId)).toEqual(['media-bandit'])
  })

  it('#R35: passes asyncMode:true to flowGenerateScene', async () => {
    mockFlowGenerateScene.mockResolvedValue({ success: true, generationId: 'scene-async-1' })
    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.submitGeneration('@hero walks', [], { references: [syncedRef] })
    })
    expect(mockFlowGenerateScene.mock.calls[0][0].asyncMode).toBe(true)
  })

  it('#R35: async scene → returns the SERVER generationId (background collect), not a local scene-N id', async () => {
    // flowGenerateScene 이 generationId 를 주면(Agent OFF 비동기 제출) 그걸 그대로 반환 →
    //   checkGeneration 은 localResultsRef 미스라 flow:check-generation 폴링 경로를 탄다.
    mockFlowGenerateScene.mockResolvedValue({ success: true, generationId: 'scene-async-xyz' })
    mockFlowCheckGeneration.mockResolvedValue({ success: true, completed: false })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.submitGeneration('@hero walks', [], { references: [syncedRef] })
    })
    expect(res.generationId).toBe('scene-async-xyz')

    // checkGeneration 이 서버 폴링(flow:check-generation)으로 위임되는지 — 로컬 결과가 아님
    await act(async () => {
      await result.current.checkGeneration('scene-async-xyz')
    })
    expect(mockFlowCheckGeneration).toHaveBeenCalledWith({ generationId: 'scene-async-xyz' })
  })

  it('#R35: sync scene fallback (images, no generationId) still stored locally (Agent ON)', async () => {
    // flowGenerateScene 이 images 만 주면(Agent ON DOM 수집) 기존대로 로컬 저장 + 즉시 완료.
    mockFlowGenerateScene.mockResolvedValue({
      success: true, images: [{ base64: 'data:img', mediaId: 'm-on' }], workflowId: 'wf-on',
    })
    mockFlowCheckGeneration.mockClear()
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.submitGeneration('@hero walks', [], { references: [syncedRef] })
    })
    expect(res.generationId).toMatch(/^scene-/)
    // 로컬 결과 → checkGeneration 은 서버 폴링 안 함(즉시 완료)
    let st
    await act(async () => { st = await result.current.checkGeneration(res.generationId) })
    expect(st.completed).toBe(true)
    expect(mockFlowCheckGeneration).not.toHaveBeenCalled()
  })

  it('falls back to flowGenerateImage when prompt has no mentions', async () => {
    mockFlowGenerateImage.mockResolvedValue({ success: true, generationId: 'gen-plain' })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.submitGeneration('a plain prompt', [], { references: [] })
    })

    expect(mockFlowGenerateImage).toHaveBeenCalledTimes(1)
    expect(mockFlowGenerateScene).not.toHaveBeenCalled()
    expect(res.success).toBe(true)
    expect(res.generationId).toBe('gen-plain')
  })

  it('falls back to flowGenerateImage when references list is empty even if @ appears in prompt', async () => {
    mockFlowGenerateImage.mockResolvedValue({ success: true, generationId: 'gen-noref' })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.submitGeneration('@hero walks', [], { references: [] })
    })

    // No eligible mention (no character refs with entityId+synced) → flowGenerateImage
    expect(mockFlowGenerateImage).toHaveBeenCalledTimes(1)
    expect(mockFlowGenerateScene).not.toHaveBeenCalled()
  })
})

describe('useFlowEngine — generateImage: mention routing (C1)', () => {
  const syncedRef = {
    id: 1,
    name: 'hero',
    type: 'character',
    category: 'character',
    entityId: 'ent-1',
    flowNameSyncStatus: 'synced',
    mediaId: 'm1',
  }

  it('routes to flowGenerateScene when prompt has a resolvable @mention', async () => {
    mockFlowGenerateScene.mockResolvedValue({
      success: true,
      images: [{ base64: 'data:img', mediaId: 'scene-m2' }],
      workflowId: 'wf-scene-2',
      mediaId: 'scene-m2',
      fifeUrl: null,
    })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.generateImage('@hero sits', [], { references: [syncedRef] })
    })

    expect(mockFlowGenerateScene).toHaveBeenCalledTimes(1)
    expect(mockFlowGenerateImage).not.toHaveBeenCalled()
    // generateImage contract: { success, images }
    expect(res.success).toBe(true)
    expect(res.images).toHaveLength(1)
    expect(res.images[0].mediaId).toBe('scene-m2')
  })

  it('passes only tag-matched scene gap refs on the synchronous scene route', async () => {
    const syncedMention = { ...syncedRef, name: '사내', entityId: 'ent-office', mediaId: 'media-office' }
    const tagOnly = {
      id: 2,
      name: '도둑 우두머리',
      type: 'character',
      category: 'character',
      entityId: 'ent-bandit',
      flowNameSyncStatus: 'synced',
      mediaId: 'media-bandit',
    }
    mockFlowGenerateScene.mockResolvedValue({ success: true, images: [{ base64: 'data:img', mediaId: 'scene-gap-sync' }] })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.generateImage('@사내가 도둑 우두머리를 바라본다', [syncedMention, tagOnly], {
        references: [syncedMention, tagOnly],
      })
    })

    expect(mockFlowGenerateScene.mock.calls[0][0].gapReferences.map(r => r.mediaId)).toEqual(['media-bandit'])
  })

  it('falls back to flowGenerateImage (asyncMode:false) when no mention', async () => {
    mockFlowGenerateImage.mockResolvedValue({ success: true, images: [{ base64: 'img', mediaId: 'plain' }] })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.generateImage('no mention prompt', [], {})
    })

    expect(mockFlowGenerateImage).toHaveBeenCalledTimes(1)
    const call = mockFlowGenerateImage.mock.calls[0][0]
    expect(call.asyncMode).toBe(false)
    expect(mockFlowGenerateScene).not.toHaveBeenCalled()
    expect(res.success).toBe(true)
  })

  it('#R7-7: fails (no plain fallback) when an @mention is unresolved', async () => {
    // ineligible character ref (not synced) → @hero is an unresolved mention, not eligible
    const ineligible = { id: 2, name: 'hero', type: 'character', entityId: null, flowNameSyncStatus: 'failed' }
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.generateImage('@hero sits', [], { references: [ineligible] })
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Unresolved @mention/)
    expect(mockFlowGenerateImage).not.toHaveBeenCalled()
    expect(mockFlowGenerateScene).not.toHaveBeenCalled()
  })

  it('#R8-11: marks authFailed when flowGenerateImage returns an auth error (plain path)', async () => {
    mockFlowGenerateImage.mockResolvedValue({ success: false, error: '401 Unauthorized' })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.generateImage('plain prompt', [], {})
    })
    expect(res.success).toBe(false)
    expect(res.authFailed).toBe(true)
  })

  it('#R7-7: passes opts (aspectRatio/seed/model/batchCount/references) to flowGenerateScene', async () => {
    mockFlowGenerateScene.mockResolvedValue({ success: true, images: [{ base64: 'data:img', mediaId: 'sm' }] })
    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.generateImage('@hero sits', [], {
        references: [syncedRef], aspectRatio: '9:16', seed: 42, model: 'veo-x', batchCount: 3,
      })
    })
    const call = mockFlowGenerateScene.mock.calls[0][0]
    expect(call.aspectRatio).toBe('9:16')
    expect(call.seed).toBe(42)
    expect(call.model).toBe('veo-x')
    expect(call.batchCount).toBe(3)
    expect(Array.isArray(call.references)).toBe(true)
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

describe('useFlowEngine — uploadReference: displayName field (Fix #4)', () => {
  it('passes displayName (not name) to flowUploadCharacterEntity', async () => {
    mockFlowUploadCharacterEntity.mockResolvedValue({
      success: true, entityId: 'ent-2', workflowId: 'wf-2', mediaId: 'media-2', registered: true,
    })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.uploadReference(
        'data:img/png;base64,abc',
        { category: 'character', type: 'character', name: 'Villain' }
      )
    })

    expect(mockFlowUploadCharacterEntity).toHaveBeenCalledTimes(1)
    const call = mockFlowUploadCharacterEntity.mock.calls[0][0]
    // Must pass displayName, not name
    expect(call.displayName).toBe('Villain')
    expect(call.name).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// #R4-3: token ref prevents stale closure — effectiveToken() vs accessToken state
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// #R6-1: mention-path submitGeneration → collectable via local completed map
// ---------------------------------------------------------------------------
describe('useFlowEngine (#R6-1) — mention submit is collectable via local map', () => {
  const syncedRef = {
    id: 1, name: 'hero', type: 'character', category: 'character',
    entityId: 'ent-1', flowNameSyncStatus: 'synced', mediaId: 'm1',
  }

  it('submitGeneration mention path returns { success:true, generationId } (not workflowId raw)', async () => {
    mockFlowGenerateScene.mockResolvedValue({
      success: true,
      images: [{ base64: 'data:img', mediaId: 'scene-m1' }],
      workflowId: 'wf-scene-99',
      mediaId: 'scene-m1',
    })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.submitGeneration('@hero walks', [], { references: [syncedRef] })
    })

    expect(res.success).toBe(true)
    expect(typeof res.generationId).toBe('string')
    expect(res.generationId.length).toBeGreaterThan(0)
  })

  it('checkGeneration returns { success:true, completed:true } for a local-map id', async () => {
    mockFlowGenerateScene.mockResolvedValue({
      success: true,
      images: [{ base64: 'data:img', mediaId: 'scene-m1' }],
      workflowId: 'wf-scene-99',
    })

    const { result } = renderHook(() => useFlowEngine())
    let genId
    await act(async () => {
      const res = await result.current.submitGeneration('@hero walks', [], { references: [syncedRef] })
      genId = res.generationId
    })

    let checkRes
    await act(async () => {
      checkRes = await result.current.checkGeneration(genId)
    })

    expect(checkRes.success).toBe(true)
    expect(checkRes.completed).toBe(true)
    // should NOT have delegated to IPC for this local id
    expect(mockFlowCheckGeneration).not.toHaveBeenCalled()
  })

  it('collectGeneration returns { success:true, images } for a local-map id', async () => {
    const expectedImages = [{ base64: 'data:img', mediaId: 'scene-m1' }]
    mockFlowGenerateScene.mockResolvedValue({
      success: true,
      images: expectedImages,
      workflowId: 'wf-scene-99',
    })

    const { result } = renderHook(() => useFlowEngine())
    let genId
    await act(async () => {
      const res = await result.current.submitGeneration('@hero walks', [], { references: [syncedRef] })
      genId = res.generationId
    })

    let collectRes
    await act(async () => {
      collectRes = await result.current.collectGeneration(genId)
    })

    expect(collectRes.success).toBe(true)
    expect(collectRes.images).toEqual(expectedImages)
    // should NOT have delegated to IPC for this local id
    expect(mockFlowCollectGeneration).not.toHaveBeenCalled()
  })

  it('clearGenerations clears the local map so collectGeneration falls through to IPC', async () => {
    mockFlowGenerateScene.mockResolvedValue({
      success: true,
      images: [{ base64: 'data:img', mediaId: 'scene-m1' }],
      workflowId: 'wf-clear-1',
    })
    // IPC fallback after clear — simulate not-found response
    mockFlowCollectGeneration.mockResolvedValue({ success: false, error: 'not found' })

    const { result } = renderHook(() => useFlowEngine())
    let genId
    await act(async () => {
      const res = await result.current.submitGeneration('@hero walks', [], { references: [syncedRef] })
      genId = res.generationId
    })

    // clear the local map
    mockFlowClearGenerations.mockResolvedValue({ success: true })
    await act(async () => {
      await result.current.clearGenerations()
    })

    // after clear, collectGeneration must fall through to IPC (not local map)
    await act(async () => {
      await result.current.collectGeneration(genId)
    })

    expect(mockFlowCollectGeneration).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// #R6-2: mention path passes opts (aspectRatio, seed, model, batchCount, refs)
// ---------------------------------------------------------------------------
describe('useFlowEngine (#R6-2) — mention submit passes opts to flowGenerateScene', () => {
  const syncedRef = {
    id: 1, name: 'hero', type: 'character', category: 'character',
    entityId: 'ent-1', flowNameSyncStatus: 'synced', mediaId: 'm1',
  }

  it('passes aspectRatio, seed, model, batchCount from callOpts into flowGenerateScene', async () => {
    mockFlowGenerateScene.mockResolvedValue({
      success: true, images: [], workflowId: 'wf-opts-1',
    })

    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.submitGeneration('@hero walks', [], {
        references: [syncedRef],
        aspectRatio: '16:9',
        seed: 42,
        model: 'flow-ultra',
        batchCount: 3,
      })
    })

    expect(mockFlowGenerateScene).toHaveBeenCalledTimes(1)
    const call = mockFlowGenerateScene.mock.calls[0][0]
    expect(call.aspectRatio).toBe('16:9')
    expect(call.seed).toBe(42)
    expect(call.model).toBe('flow-ultra')
    expect(call.batchCount).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// #R6-3: checkVideoStatus sets videoUrl = s.videoUrl || s.mediaId || null
// ---------------------------------------------------------------------------
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

  it('does NOT fail when the mention is fully resolved (no unresolved)', async () => {
    // #R20-4: the mention path collects images synchronously, so a resolved mention returns an image
    //   (empty images with no mediaId/fifeUrl is now a fail-closed result, not a silent success).
    mockFlowGenerateScene.mockResolvedValue({
      success: true, images: [{ base64: 'data:img', mediaId: 'm-ok' }], workflowId: 'wf-ok',
    })

    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.submitGeneration('@hero walks', [], { references: [syncedRef] })
    })

    expect(res.success).toBe(true)
    expect(mockFlowGenerateScene).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// #R33: 미해결 @멘션 이미지 폴백 — 미동기화 캐릭터라도 mediaId 가 있으면 @ 를 떼고
//   ref 이미지를 주입해 일반 이미지로 생성(하드 실패 대신). mediaId 없으면 기존대로 실패.
// ---------------------------------------------------------------------------
describe('useFlowEngine (#R33) — unresolved @mention image fallback', () => {
  // 미동기화지만 업로드는 됨(mediaId 보유) — king 케이스.
  const unsyncedWithMedia = {
    id: 9, name: 'king', type: 'character', category: 'character',
    entityId: null, flowNameSyncStatus: 'failed', mediaId: 'king-m',
  }

  it('submitGeneration: unresolved mention with mediaId → flowGenerateImage (stripped prompt + injected ref)', async () => {
    mockFlowGenerateImage.mockResolvedValue({ success: true, generationId: 'gen-fb' })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.submitGeneration('@king walks in', [], { references: [unsyncedWithMedia] })
    })
    expect(mockFlowGenerateScene).not.toHaveBeenCalled()
    expect(mockFlowGenerateImage).toHaveBeenCalledTimes(1)
    const call = mockFlowGenerateImage.mock.calls[0][0]
    // @ 가 제거되어 일반 텍스트로
    expect(call.prompt).toBe('king walks in')
    // king 의 이미지가 mediaId 로 주입됨
    expect(call.referenceImages.some(r => r.mediaId === 'king-m')).toBe(true)
    expect(call.asyncMode).toBe(true)
    expect(res.success).toBe(true)
  })

  it('generateImage: unresolved mention with mediaId → flowGenerateImage fallback (asyncMode:false)', async () => {
    mockFlowGenerateImage.mockResolvedValue({ success: true, images: [{ base64: 'img', mediaId: 'x' }] })
    const { result } = renderHook(() => useFlowEngine())
    await act(async () => {
      await result.current.generateImage('@king sits', [], { references: [unsyncedWithMedia] })
    })
    const call = mockFlowGenerateImage.mock.calls[0][0]
    expect(call.prompt).toBe('king sits')
    expect(call.referenceImages.some(r => r.mediaId === 'king-m')).toBe(true)
    expect(call.asyncMode).toBe(false)
  })

  it('does NOT fall back (hard fails) when the unresolved ref has no mediaId', async () => {
    const noMedia = { id: 10, name: 'ghost', type: 'character', entityId: null, flowNameSyncStatus: 'failed', mediaId: null }
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.submitGeneration('@ghost appears', [], { references: [noMedia] })
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Unresolved @mention/)
    expect(mockFlowGenerateImage).not.toHaveBeenCalled()
    expect(mockFlowGenerateScene).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// #R33: staleMention 전파 — Flow UI 에서 캐릭터 삭제 시 멘션 피커 누락 신호를 호출측에 전달
//   (useAutomation 이 ref 를 'failed' 로 마킹해 self-heal 하도록).
// ---------------------------------------------------------------------------
describe('useFlowEngine (#R33) — staleMention propagation', () => {
  const synced = { id: 1, name: 'king', type: 'character', entityId: 'e1', flowNameSyncStatus: 'synced', mediaId: 'm1' }

  it('submitGeneration: flowGenerateScene staleMention → propagated on the failed result', async () => {
    mockFlowGenerateScene.mockResolvedValue({ success: false, errorKind: 'option-not-found', error: 'Mention selection failed', retry: true, staleMention: 'king' })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.submitGeneration('@king walks', [], { references: [synced] })
    })
    expect(res.success).toBe(false)
    expect(res.errorKind).toBe('option-not-found')
    expect(res.staleMention).toBe('king')
  })

  it('generateImage: flowGenerateScene staleMention → propagated', async () => {
    mockFlowGenerateScene.mockResolvedValue({ success: false, errorKind: 'option-not-found', error: 'Mention selection failed', retry: true, staleMention: 'king' })
    const { result } = renderHook(() => useFlowEngine())
    let res
    await act(async () => {
      res = await result.current.generateImage('@king walks', [], { references: [synced] })
    })
    expect(res.success).toBe(false)
    expect(res.errorKind).toBe('option-not-found')
    expect(res.staleMention).toBe('king')
  })
})

// ---------------------------------------------------------------------------
// #R33: planMentionRouting / planUnresolvedMentionFallback — pure unit tests
// ---------------------------------------------------------------------------
// 개별 씬 생성이 이 결과를 보고 "동기화 후 재시도"를 제안한다 — 문자열이 아니라 필드로 판정한다.
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
describe('useFlowEngine (#R4-3) — token ref prevents stale closure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowExtractToken.mockResolvedValue({ success: true, token: 'tok-fresh' })
    mockFlowValidateToken.mockResolvedValue({ valid: true })
    mockFlowExtractProjectId.mockResolvedValue({ projectId: null })
  })

  it('getAccessToken then uploadReference uses the fresh token (not null)', async () => {
    mockFlowUploadReference.mockResolvedValue({ success: true, mediaId: 'm1' })

    const { result } = renderHook(() => useFlowEngine())

    // Call getAccessToken — sets ref synchronously in same microtask
    await act(async () => {
      await result.current.getAccessToken()
    })

    // Now call uploadReference — must pass the fresh token via ref, not stale null
    await act(async () => {
      await result.current.uploadReference('base64data', {})
    })

    expect(mockFlowUploadReference).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok-fresh' })
    )
  })

  it('getAccessToken then checkVideoStatus uses the fresh token', async () => {
    mockFlowCheckVideoStatus.mockResolvedValue({ success: true, statuses: [] })

    const { result } = renderHook(() => useFlowEngine())

    await act(async () => {
      await result.current.getAccessToken()
    })

    await act(async () => {
      await result.current.checkVideoStatus(['gen-id-1'])
    })

    expect(mockFlowCheckVideoStatus).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok-fresh' })
    )
  })

  it('clearTokenCache clears the ref so subsequent calls pass null token', async () => {
    mockFlowUploadReference.mockResolvedValue({ success: true, mediaId: 'm1' })

    const { result } = renderHook(() => useFlowEngine())

    // Get a fresh token first
    await act(async () => {
      await result.current.getAccessToken()
    })
    expect(result.current.accessToken).toBe('tok-fresh')

    // Clear token — clears both state and ref
    act(() => {
      result.current.clearTokenCache()
    })

    // After clear, uploadReference should pass null token
    await act(async () => {
      await result.current.uploadReference('base64data', {})
    })

    expect(mockFlowUploadReference).toHaveBeenCalledWith(
      expect.objectContaining({ token: null })
    )
  })
})

// ---------------------------------------------------------------------------
// #R36: Flow T2V @멘션 — segments(칩) 경로 vs ref 이미지 가드
// ---------------------------------------------------------------------------
describe('useFlowEngine — #R36 T2V @멘션 segments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowGenerateVideoT2V.mockResolvedValue({ success: true, generationId: 'gv1' })
  })

  it('segments 가 있으면 ref 가드 없이 flowGenerateVideoT2V 에 segments 를 넘긴다', async () => {
    const { result } = renderHook(() => useFlowEngine())
    const segs = [{ type: 'mention', name: 'king', entityId: 'e1' }, { type: 'text', text: ' walks' }]
    let res
    await act(async () => {
      res = await result.current.generateVideoT2V('@king walks', 'veo', '16:9', 6, null, '720p', [], { segments: segs })
    })
    expect(res.success).toBe(true)
    expect(mockFlowGenerateVideoT2V).toHaveBeenCalledWith(expect.objectContaining({ segments: segs }))
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

describe('useFlowEngine M1 final image reference guard', () => {
  const dirtyReferences = [
    { mediaId: null },
    { mediaId: undefined },
    { mediaId: '' },
    { mediaId: 'media-ok' },
  ]

  it('filters invalid mediaIds before synchronous flowGenerateImage IPC', async () => {
    mockFlowGenerateImage.mockClear()
    mockFlowGenerateImage.mockResolvedValue({
      success: true,
      images: [{ base64: 'image' }],
    })
    const { result } = renderHook(() => useFlowEngine())

    await act(async () => {
      await result.current.generateImage('plain prompt', dirtyReferences)
    })

    expect(mockFlowGenerateImage.mock.calls[0][0].referenceImages).toEqual([
      { mediaId: 'media-ok' },
    ])
  })

  it('filters invalid mediaIds before async flowGenerateImage IPC', async () => {
    mockFlowGenerateImage.mockClear()
    mockFlowGenerateImage.mockResolvedValue({
      success: true,
      generationId: 'generation-1',
    })
    const { result } = renderHook(() => useFlowEngine())

    await act(async () => {
      await result.current.submitGeneration('plain prompt', dirtyReferences)
    })

    expect(mockFlowGenerateImage.mock.calls[0][0].referenceImages).toEqual([
      { mediaId: 'media-ok' },
    ])
  })

  it('keeps an entity-only synced mention on the scene route', async () => {
    mockFlowGenerateImage.mockClear()
    mockFlowGenerateScene.mockClear()
    mockFlowGenerateScene.mockResolvedValue({
      success: true,
      images: [{ base64: 'scene-image' }],
    })
    const entityOnlyReference = {
      id: 'entity-only',
      name: 'EntityOnly',
      type: 'character',
      entityId: 'entity-1',
      flowNameSyncStatus: 'synced',
      mediaId: null,
    }
    const { result } = renderHook(() => useFlowEngine())

    await act(async () => {
      await result.current.generateImage('@EntityOnly appears', [], {
        references: [entityOnlyReference],
      })
    })

    expect(mockFlowGenerateScene).toHaveBeenCalledTimes(1)
    expect(mockFlowGenerateImage).not.toHaveBeenCalled()
  })
})
