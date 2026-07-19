/**
 * useGenAPI.test.js — useFlowAPI drop-in 대체 훅 통합 테스트.
 *
 * genai IPC mock 을 관통: 인증(BYOK), 이미지 동기 생성 + async 에뮬레이션,
 * 레퍼런스 base64 해석, 비디오 매핑, Flow 전용 기능의 graceful degrade.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGenAPI } from '../../src/hooks/useGenAPI'
import { DEFAULT_IMAGE_MODEL_ID, VIDEO_REFERENCE_IMAGE_LIMIT } from '../../src/config/genModels'

const IMG_RESULT = {
  success: true,
  images: [{ base64: 'ABC', mimeType: 'image/png', dataUrl: 'data:image/png;base64,ABC' }],
}

beforeEach(() => {
  window.electronAPI.genaiGetKeyStatus.mockResolvedValue({ hasKey: true, encryptionAvailable: true })
  window.electronAPI.genaiGenerateImage.mockResolvedValue(IMG_RESULT)
  window.electronAPI.genaiGenerateVideo.mockResolvedValue({ success: true, generationId: 'op1' })
  window.electronAPI.genaiCheckVideoStatus.mockResolvedValue({ success: true, statuses: [] })
  window.electronAPI.genaiDownloadVideo.mockResolvedValue({ success: true, base64: 'VID' })
})

describe('useGenAPI — 인증(BYOK)', () => {
  it('키 있으면 byok sentinel, 없으면 null', async () => {
    const { result } = renderHook(() => useGenAPI())
    let tok
    await act(async () => { tok = await result.current.getAccessToken() })
    expect(tok).toBe('byok')

    window.electronAPI.genaiGetKeyStatus.mockResolvedValue({ hasKey: false })
    await act(async () => { tok = await result.current.getAccessToken() })
    expect(tok).toBeNull()
  })

  it('providerId 지정 시 byProvider[id] 로 게이트 (§5.7 openai-only)', async () => {
    // google 키 없음 + openai 키 있음
    window.electronAPI.genaiGetKeyStatus.mockResolvedValue({
      hasKey: false, byProvider: { google: false, openai: true },
    })
    const { result } = renderHook(() => useGenAPI())
    let googleTok, openaiTok
    await act(async () => {
      googleTok = await result.current.getAccessToken(false, false, 'google')
      openaiTok = await result.current.getAccessToken(false, false, 'openai')
    })
    expect(googleTok).toBeNull()   // google 키 없음 → 차단
    expect(openaiTok).toBe('byok') // openai 키 있음 → 통과 (핵심)
  })
})

describe('useGenAPI — 이미지', () => {
  it('generateImage: 레퍼런스 base64 해석 후 전달 + 결과 매핑', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateImage(
        'a cat',
        [{ name: 'hero', data: 'data:image/png;base64,REF' }],
        { aspectRatio: '16:9' }
      )
    })
    expect(window.electronAPI.genaiGenerateImage).toHaveBeenCalledWith({
      prompt: 'a cat',
      referenceImages: [{ mimeType: 'image/png', data: 'REF' }],
      aspectRatio: '16:9',
      model: DEFAULT_IMAGE_MODEL_ID,
    })
    // base64 필드는 data URL, mediaId 는 null (업스케일 자동 skip), actualAspectRatio 표면화(§2.4)
    expect(r.images[0]).toEqual({ base64: 'data:image/png;base64,ABC', mimeType: 'image/png', mediaId: null, actualAspectRatio: null })
  })

  it('generateImage: provider 를 IPC 로 관통 + 비-google 은 gemini 기본 강제 안 함', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    await act(async () => {
      await result.current.generateImage('a cat', [], { aspectRatio: '16:9', provider: 'openai' })
    })
    const call = window.electronAPI.genaiGenerateImage.mock.calls.at(-1)[0]
    expect(call.provider).toBe('openai')
    // model 미지정 + 비-google → undefined(어댑터가 gpt-image-1 기본), gemini 강제 아님
    expect(call.model).toBeUndefined()
  })

  it('generateImage: openai + 명시 모델은 그대로 전달', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    await act(async () => {
      await result.current.generateImage('a cat', [], { provider: 'openai', model: 'gpt-image-1' })
    })
    const call = window.electronAPI.genaiGenerateImage.mock.calls.at(-1)[0]
    expect(call).toMatchObject({ provider: 'openai', model: 'gpt-image-1' })
  })

  it('generateImage: actualAspectRatio 를 결과에 표면화(근사 provider)', async () => {
    window.electronAPI.genaiGenerateImage.mockResolvedValueOnce({
      success: true,
      images: [{ base64: 'B64', mimeType: 'image/png', dataUrl: 'data:image/png;base64,B64' }],
      actualAspectRatio: '3:2',
    })
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => { r = await result.current.generateImage('a cat', [], { provider: 'openai', aspectRatio: '16:9' }) })
    expect(r.actualAspectRatio).toBe('3:2')
    expect(r.images[0].actualAspectRatio).toBe('3:2')
    expect(r.provider).toBe('openai')
  })

  it('generateImage: 선택 모델을 IPC 로 전달 + 결과에 model 기록', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateImage('a cat', [], { aspectRatio: '9:16', model: 'gemini-3.1-flash-image' })
    })
    expect(window.electronAPI.genaiGenerateImage.mock.calls.at(-1)[0].model).toBe('gemini-3.1-flash-image')
    // finalize 가 result.model 을 주워 item.model 로 기록하므로, 결과에 effective model 이 실려야 한다.
    expect(r.model).toBe('gemini-3.1-flash-image')
  })

  it('generateImage: model 미지정 시 기본 이미지 모델로 폴백(결과에도 기록)', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => { r = await result.current.generateImage('a cat', []) })
    expect(window.electronAPI.genaiGenerateImage.mock.calls.at(-1)[0].model).toBe(DEFAULT_IMAGE_MODEL_ID)
    expect(r.model).toBe(DEFAULT_IMAGE_MODEL_ID)
  })

  it('submitGeneration: options.imageModel 을 generateImage model 로 매핑', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    await act(async () => {
      await result.current.submitGeneration('p', [], { aspectRatio: '16:9', imageModel: 'gemini-3-pro-image' })
    })
    await waitFor(() => {
      expect(window.electronAPI.genaiGenerateImage.mock.calls.at(-1)[0].model).toBe('gemini-3-pro-image')
    })
  })

  it('submit → check → collect 비동기 에뮬레이션', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let sub
    await act(async () => { sub = await result.current.submitGeneration('p', []) })
    expect(sub.success).toBe(true)
    expect(sub.generationId).toMatch(/^gen_/)

    await waitFor(async () => {
      const c = await result.current.checkGeneration(sub.generationId)
      expect(c.completed).toBe(true)
    })
    const col = await result.current.collectGeneration(sub.generationId)
    expect(col.success).toBe(true)
    expect(col.images[0].base64).toBe('data:image/png;base64,ABC')
  })

  it('collectGeneration: 미완료/없음 처리', async () => {
    const { result } = renderHook(() => useGenAPI())
    const r = await result.current.collectGeneration('nope')
    expect(r.success).toBe(false)
  })

  it('clearGenerations 후 collect 실패', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let sub
    await act(async () => { sub = await result.current.submitGeneration('p', []) })
    await act(async () => { await result.current.clearGenerations() })
    const r = await result.current.collectGeneration(sub.generationId)
    expect(r.success).toBe(false)
  })
})

describe('useGenAPI — 비디오', () => {
  it('generateVideoT2V → genaiGenerateVideo (veo 모델 통과)', async () => {
    const { result } = renderHook(() => useGenAPI())
    let r
    await act(async () => { r = await result.current.generateVideoT2V('go', 'veo-3.1-fast', '16:9', 8) })
    expect(window.electronAPI.genaiGenerateVideo).toHaveBeenCalledWith({
      prompt: 'go', aspectRatio: '16:9', durationSeconds: 8, model: 'veo-3.1-fast-generate-preview',
    })
    expect(r).toEqual({ success: true, generationId: 'op1' })
  })

  it('generateVideoT2V: non-google provider의 grok model/aspect/resolution을 IPC까지 byte-for-byte 보존', async () => {
    const { result } = renderHook(() => useGenAPI())

    await act(async () => {
      await result.current.generateVideoT2V(
        'launch',
        'grok-imagine-video-1.5',
        'VIDEO_ASPECT_RATIO_CINEMATIC_RAW',
        5,
        17,
        'native-ultra',
        [],
        { provider: 'grok' },
      )
    })

    expect(window.electronAPI.genaiGenerateVideo).toHaveBeenCalledWith({
      prompt: 'launch',
      aspectRatio: 'VIDEO_ASPECT_RATIO_CINEMATIC_RAW',
      durationSeconds: 5,
      model: 'grok-imagine-video-1.5',
      resolution: 'native-ultra',
      seed: 17,
      provider: 'grok',
    })
  })

  it('generateVideoI2V: non-google provider의 model/aspect/resolution을 IPC까지 원형 보존', async () => {
    const { result } = renderHook(() => useGenAPI())

    await act(async () => {
      await result.current.generateVideoI2V(
        'animate',
        'data:image/png;base64,START',
        null,
        'grok-imagine-video-1.5',
        '1:1',
        7,
        null,
        'provider-native',
        { provider: 'grok' },
      )
    })

    expect(window.electronAPI.genaiGenerateVideo).toHaveBeenCalledWith({
      prompt: 'animate',
      image: { mimeType: 'image/png', data: 'START' },
      endImage: null,
      aspectRatio: '1:1',
      durationSeconds: 7,
      model: 'grok-imagine-video-1.5',
      seed: undefined,
      resolution: 'provider-native',
      provider: 'grok',
    })
  })

  it('generateVideoT2V: referenceImages 를 base64 해석 후 IPC 로 전달', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    await act(async () => {
      await result.current.generateVideoT2V(
        'hero walks',
        'veo-3.1-fast-generate-preview',
        '16:9',
        8,
        null,
        '720p',
        [{ name: 'hero', data: 'data:image/png;base64,REF' }]
      )
    })

    expect(window.electronAPI.genaiGenerateVideo).toHaveBeenCalledWith({
      prompt: 'hero walks',
      referenceImages: [{ mimeType: 'image/png', data: 'REF' }],
      aspectRatio: '16:9',
      durationSeconds: 8,
      model: 'veo-3.1-fast-generate-preview',
      resolution: '720p',
    })
  })

  it('generateVideoT2V: referenceImages 는 최대 3개만 IPC 로 전달', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    await act(async () => {
      await result.current.generateVideoT2V(
        'team walks',
        'veo-3.1-fast-generate-preview',
        '16:9',
        8,
        null,
        '720p',
        ['a', 'b', 'c', 'd'].map(name => ({ name, data: `data:image/png;base64,${name.toUpperCase()}` }))
      )
    })

    const refs = window.electronAPI.genaiGenerateVideo.mock.calls.at(-1)[0].referenceImages
    expect(refs).toHaveLength(VIDEO_REFERENCE_IMAGE_LIMIT)
    expect(refs.map(r => r.data)).toEqual(['A', 'B', 'C'])
  })

  it('generateVideoT2V: 4번째 이후 reference 가 unresolved 여도 전송 대상이 아니므로 실패하지 않음', async () => {
    localStorage.setItem('workFolderPath', '/work')
    window.electronAPI.readResource.mockResolvedValue({ success: false, error: 'missing' })
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateVideoT2V(
        'team walks',
        'veo-3.1-fast-generate-preview',
        '16:9',
        8,
        null,
        '720p',
        [
          { name: 'a', data: 'data:image/png;base64,A' },
          { name: 'b', data: 'data:image/png;base64,B' },
          { name: 'c', data: 'data:image/png;base64,C' },
          { name: 'missing' },
        ]
      )
    })

    expect(r.success).toBe(true)
    expect(window.electronAPI.readResource).not.toHaveBeenCalled()
    const refs = window.electronAPI.genaiGenerateVideo.mock.calls.at(-1)[0].referenceImages
    expect(refs.map(ref => ref.data)).toEqual(['A', 'B', 'C'])
  })

  it('generateVideoT2V: 디스크 기반 reference + seed/resolution 을 함께 IPC 로 전달', async () => {
    localStorage.setItem('workFolderPath', '/work')
    window.electronAPI.readResource.mockResolvedValue({
      success: true,
      data: '/9j/DISKREF',
    })
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    await act(async () => {
      await result.current.generateVideoT2V(
        'hero walks',
        'veo-3.1-fast-generate-preview',
        '9:16',
        8,
        123,
        '1080p',
        [{ name: 'hero' }]
      )
    })

    expect(window.electronAPI.readResource).toHaveBeenCalledWith({
      workFolder: '/work',
      project: 'proj',
      resourceType: 'references',
      name: 'hero',
    })
    expect(window.electronAPI.genaiGenerateVideo).toHaveBeenCalledWith({
      prompt: 'hero walks',
      referenceImages: [{ mimeType: 'image/jpeg', data: '/9j/DISKREF' }],
      aspectRatio: '9:16',
      durationSeconds: 8,
      model: 'veo-3.1-fast-generate-preview',
      seed: 123,
      resolution: '1080p',
    })
  })

  it('generateVideoT2V: Veo Lite + referenceImages 는 IPC 호출 전에 실패', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateVideoT2V(
        'hero walks',
        'veo-3.1-lite-generate-preview',
        '16:9',
        8,
        null,
        '720p',
        [{ name: 'hero', data: 'data:image/png;base64,REF' }]
      )
    })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/Fast\/Quality/)
    expect(window.electronAPI.genaiGenerateVideo).not.toHaveBeenCalled()
  })

  it('generateVideoT2V: Vertex 전용 -001 모델명은 preview 로 치유 후 referenceImages 허용', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateVideoT2V(
        'hero walks',
        'veo-3.1-fast-generate-001',
        '16:9',
        8,
        null,
        '720p',
        [{ name: 'hero', data: 'data:image/png;base64,REF' }]
      )
    })

    expect(r.success).toBe(true)
    expect(window.electronAPI.genaiGenerateVideo).toHaveBeenCalledWith({
      prompt: 'hero walks',
      referenceImages: [{ mimeType: 'image/png', data: 'REF' }],
      aspectRatio: '16:9',
      durationSeconds: 8,
      model: 'veo-3.1-fast-generate-preview',
      resolution: '720p',
    })
  })

  it('generateVideoT2V: @ reference 가 resolve 되지 않으면 prompt 만 보내지 않고 실패', async () => {
    localStorage.setItem('workFolderPath', '/work')
    window.electronAPI.readResource.mockResolvedValue({ success: false, error: 'missing' })
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateVideoT2V(
        'hero walks',
        'veo-3.1-fast-generate-preview',
        '16:9',
        8,
        null,
        '720p',
        [{ name: 'hero' }]
      )
    })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/could not be resolved: hero/)
    expect(window.electronAPI.genaiGenerateVideo).not.toHaveBeenCalled()
  })

  it('generateVideoT2V: 미지원 GIF reference MIME 은 IPC 호출 전에 실패', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateVideoT2V(
        'hero walks',
        'veo-3.1-fast-generate-preview',
        '16:9',
        8,
        null,
        '720p',
        [{ name: 'hero', data: 'data:image/gif;base64,R0lGODlh' }]
      )
    })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/PNG, JPEG, or WebP/)
    expect(window.electronAPI.genaiGenerateVideo).not.toHaveBeenCalled()
  })

  it('generateVideoT2V: 명시 GIF MIME 은 PNG 데이터여도 IPC 호출 전에 실패', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateVideoT2V(
        'hero walks',
        'veo-3.1-fast-generate-preview',
        '16:9',
        8,
        null,
        '720p',
        [{ name: 'hero', mimeType: 'image/gif', data: 'data:image/png;base64,iVBORpng' }]
      )
    })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/PNG, JPEG, or WebP/)
    expect(window.electronAPI.genaiGenerateVideo).not.toHaveBeenCalled()
  })

  it('generateVideoT2V: MIME 을 확정할 수 없는 raw reference 는 IPC 호출 전에 실패', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateVideoT2V(
        'hero walks',
        'veo-3.1-fast-generate-preview',
        '16:9',
        8,
        null,
        '720p',
        [{ name: 'hero', data: 'UNKNOWNRAWBASE64' }]
      )
    })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/PNG, JPEG, or WebP/)
    expect(window.electronAPI.genaiGenerateVideo).not.toHaveBeenCalled()
  })

  it('generateVideoT2V: style reference 는 IPC 호출 전에 실패', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateVideoT2V(
        'hero walks',
        'veo-3.1-fast-generate-preview',
        '16:9',
        8,
        null,
        '720p',
        [{ name: 'noir', category: 'MEDIA_CATEGORY_STYLE', data: 'data:image/png;base64,REF' }]
      )
    })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/asset references/)
    expect(window.electronAPI.genaiGenerateVideo).not.toHaveBeenCalled()
  })

  it('generateVideoT2V: referenceType=style 은 IPC 호출 전에 실패', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateVideoT2V(
        'hero walks',
        'veo-3.1-fast-generate-preview',
        '16:9',
        8,
        null,
        '720p',
        [{ name: 'noir', referenceType: 'style', data: 'data:image/png;base64,REF' }]
      )
    })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/asset references/)
    expect(window.electronAPI.genaiGenerateVideo).not.toHaveBeenCalled()
  })

  it('비-veo 모델은 기본값으로 (model undefined)', async () => {
    const { result } = renderHook(() => useGenAPI())
    await act(async () => { await result.current.generateVideoT2V('go', 'flow-legacy', '16:9', 8) })
    expect(window.electronAPI.genaiGenerateVideo.mock.calls[0][0].model).toBeUndefined()
  })

  it('generateVideoT2V/I2V: seed 숫자면 IPC 에 전달 (Veo 재현성)', async () => {
    const { result } = renderHook(() => useGenAPI())
    await act(async () => { await result.current.generateVideoT2V('go', 'veo-3.1-fast', '16:9', 8, 777) })
    expect(window.electronAPI.genaiGenerateVideo.mock.calls.at(-1)[0].seed).toBe(777)
    await act(async () => {
      await result.current.generateVideoI2V('go', 'data:image/png;base64,ONLY', null, 'veo-3.1-fast', '16:9', 8, 42)
    })
    expect(window.electronAPI.genaiGenerateVideo.mock.calls.at(-1)[0].seed).toBe(42)
  })

  it('generateVideoT2V/I2V: resolution 을 IPC 에 전달', async () => {
    const { result } = renderHook(() => useGenAPI())
    await act(async () => { await result.current.generateVideoT2V('go', 'veo-3.1-fast', '16:9', 4, null, '720p') })
    expect(window.electronAPI.genaiGenerateVideo.mock.calls.at(-1)[0].resolution).toBe('720p')
    await act(async () => {
      await result.current.generateVideoI2V('go', 'data:image/png;base64,ONLY', null, 'veo-3.1-fast', '16:9', 8, null, '1080p')
    })
    expect(window.electronAPI.genaiGenerateVideo.mock.calls.at(-1)[0].resolution).toBe('1080p')
  })

  it('generateVideoT2V/I2V: Veo Lite + 4K 는 1080p 로 강등(미지원 해상도 가드)', async () => {
    const { result } = renderHook(() => useGenAPI())
    await act(async () => {
      await result.current.generateVideoT2V('go', 'veo-3.1-lite-generate-preview', '16:9', 8, null, '4k')
    })
    expect(window.electronAPI.genaiGenerateVideo.mock.calls.at(-1)[0].resolution).toBe('1080p')
    await act(async () => {
      await result.current.generateVideoI2V('go', 'data:image/png;base64,ONLY', null, 'veo-3.1-lite-generate-preview', '16:9', 8, null, '4k')
    })
    expect(window.electronAPI.genaiGenerateVideo.mock.calls.at(-1)[0].resolution).toBe('1080p')
  })

  it('generateVideoI2V: 레거시 Lite 모델명도 정규화 후 4K 를 1080p 로 강등', async () => {
    const { result } = renderHook(() => useGenAPI())
    await act(async () => {
      await result.current.generateVideoI2V('go', 'data:image/png;base64,ONLY', null, 'veo-3.1-lite', '16:9', 8, null, '4k')
    })
    const payload = window.electronAPI.genaiGenerateVideo.mock.calls.at(-1)[0]
    expect(payload.model).toBe('veo-3.1-lite-generate-preview')
    expect(payload.resolution).toBe('1080p')
  })

  it('generateVideoT2V: Veo Quality + 4K 는 그대로 4k', async () => {
    const { result } = renderHook(() => useGenAPI())
    await act(async () => {
      await result.current.generateVideoT2V('go', 'veo-3.1-generate-preview', '16:9', 8, null, '4k')
    })
    expect(window.electronAPI.genaiGenerateVideo.mock.calls.at(-1)[0].resolution).toBe('4k')
  })

  it('구 Flow underscore 키는 공식 모델명으로 매핑 (잘못된 endpoint 방지)', async () => {
    const { result } = renderHook(() => useGenAPI())
    await act(async () => { await result.current.generateVideoT2V('go', 'veo_3_1_t2v_fast_ultra_relaxed', '16:9', 8) })
    expect(window.electronAPI.genaiGenerateVideo.mock.calls[0][0].model).toBe('veo-3.1-fast-generate-preview')
  })

  it('checkVideoStatus → statuses 매핑 (videoUri ↔ mediaId)', async () => {
    window.electronAPI.genaiCheckVideoStatus.mockResolvedValue({
      success: true,
      statuses: [
        { generationId: 'a', status: 'completed', videoUri: 'https://v/a' },
        { generationId: 'b', status: 'pending' },
      ],
    })
    const { result } = renderHook(() => useGenAPI())
    let r
    await act(async () => { r = await result.current.checkVideoStatus(['a', 'b']) })
    // 'completed' → 'complete' 정규화, videoUri/videoUrl/mediaId 모두 uri 노출
    expect(r.statuses[0]).toMatchObject({
      generationId: 'a', status: 'complete',
      videoUri: 'https://v/a', videoUrl: 'https://v/a', mediaId: 'https://v/a',
    })
    expect(r.statuses[1]).toMatchObject({ generationId: 'b', status: 'pending' })
  })

  it('generateVideoI2V/F2V: start/end 프레임 base64 → image/endImage', async () => {
    const { result } = renderHook(() => useGenAPI())
    await act(async () => {
      await result.current.generateVideoI2V(
        'morph',
        'data:image/jpeg;base64,START',
        'data:image/png;base64,END',
        'veo-3.1-fast', '16:9', 8
      )
    })
    expect(window.electronAPI.genaiGenerateVideo).toHaveBeenCalledWith({
      prompt: 'morph',
      image: { mimeType: 'image/jpeg', data: 'START' },
      endImage: { mimeType: 'image/png', data: 'END' },
      aspectRatio: '16:9',
      durationSeconds: 8,
      model: 'veo-3.1-fast-generate-preview',
    })
  })

  it('generateVideoI2V: 끝 프레임 없으면 endImage null (단일 시작 프레임 I2V)', async () => {
    const { result } = renderHook(() => useGenAPI())
    await act(async () => {
      await result.current.generateVideoI2V('go', 'data:image/png;base64,ONLY', null, 'veo-3.1-fast', '16:9', 8)
    })
    const call = window.electronAPI.genaiGenerateVideo.mock.calls.at(-1)[0]
    expect(call.image).toEqual({ mimeType: 'image/png', data: 'ONLY' })
    expect(call.endImage).toBeNull()
  })

  it('generateVideoI2V: 줄바꿈 포함 data URL 프레임도 정상 파싱 (I2V→T2V 강등 방지)', async () => {
    const { result } = renderHook(() => useGenAPI())
    const wrapped = 'data:image/png;base64,AAAA\nBBBB\nCCCC'
    await act(async () => {
      await result.current.generateVideoI2V('go', wrapped, null, 'veo-3.1-fast', '16:9', 8)
    })
    const call = window.electronAPI.genaiGenerateVideo.mock.calls.at(-1)[0]
    expect(call.image).toEqual({ mimeType: 'image/png', data: 'AAAABBBBCCCC' })
  })

  it('downloadVideo → base64', async () => {
    const { result } = renderHook(() => useGenAPI())
    let r
    await act(async () => { r = await result.current.downloadVideo('https://v/a') })
    expect(window.electronAPI.genaiDownloadVideo).toHaveBeenCalledWith({ videoUri: 'https://v/a' })
    expect(r).toEqual({ success: true, base64: 'VID' })
  })
})

describe('useGenAPI — auth 실패 센티넬 (BYOK 키 거부)', () => {
  it('generateImage: 키 거부 → authFailed + onAuthError', async () => {
    const onAuthError = vi.fn()
    window.electronAPI.genaiGenerateImage.mockResolvedValue({
      success: false, error: 'HTTP 400 :: API key not valid :: INVALID_ARGUMENT',
    })
    const { result } = renderHook(() => useGenAPI({ onAuthError }))
    let r
    await act(async () => { r = await result.current.generateImage('p', []) })
    expect(r.authFailed).toBe(true)
    expect(onAuthError).toHaveBeenCalled()
  })

  it('generateVideoT2V: 키 거부 → authFailed', async () => {
    const onAuthError = vi.fn()
    window.electronAPI.genaiGenerateVideo.mockResolvedValue({ success: false, error: 'PERMISSION_DENIED' })
    const { result } = renderHook(() => useGenAPI({ onAuthError }))
    let r
    await act(async () => { r = await result.current.generateVideoT2V('p', 'veo-3.1-fast', '16:9', 8) })
    expect(r.authFailed).toBe(true)
    expect(onAuthError).toHaveBeenCalled()
  })

  it('checkVideoStatus: 폴링 중 키 거부 → authFailed 전파', async () => {
    const onAuthError = vi.fn()
    window.electronAPI.genaiCheckVideoStatus.mockResolvedValue({
      success: true,
      statuses: [{ generationId: 'a', status: 'failed', error: 'HTTP 403 :: PERMISSION_DENIED' }],
    })
    const { result } = renderHook(() => useGenAPI({ onAuthError }))
    let r
    await act(async () => { r = await result.current.checkVideoStatus(['a']) })
    expect(r.authFailed).toBe(true)
    expect(onAuthError).toHaveBeenCalled()
  })

  it('일반(quota) 에러는 authFailed 아님', async () => {
    const onAuthError = vi.fn()
    window.electronAPI.genaiGenerateImage.mockResolvedValue({ success: false, error: 'RESOURCE_EXHAUSTED' })
    const { result } = renderHook(() => useGenAPI({ onAuthError }))
    let r
    await act(async () => { r = await result.current.generateImage('p', []) })
    expect(r.authFailed).toBeUndefined()
    expect(onAuthError).not.toHaveBeenCalled()
  })
})

describe('useGenAPI — Flow 전용 graceful degrade', () => {
  it('uploadReference no-op (mediaId null)', async () => {
    const { result } = renderHook(() => useGenAPI())
    expect(await result.current.uploadReference('b64', 'style')).toEqual({ success: true, mediaId: null, caption: null })
  })

  it('fetchGallery / listFlowProjects → 빈 결과', async () => {
    const { result } = renderHook(() => useGenAPI())
    expect(await result.current.fetchGallery()).toEqual({ success: true, items: [] })
    expect(await result.current.listFlowProjects()).toEqual({ success: true, items: [] })
  })

  it('upscaleImage / upscaleVideo → 미지원(skip 유도)', async () => {
    const { result } = renderHook(() => useGenAPI())
    expect((await result.current.upscaleImage('m', '2k')).success).toBe(false)
    expect((await result.current.upscaleVideo('m', '1080p')).success).toBe(false)
  })
})
