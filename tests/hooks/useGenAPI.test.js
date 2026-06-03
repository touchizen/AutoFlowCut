/**
 * useGenAPI.test.js — useFlowAPI drop-in 대체 훅 통합 테스트.
 *
 * genai IPC mock 을 관통: 인증(BYOK), 이미지 동기 생성 + async 에뮬레이션,
 * 레퍼런스 base64 해석, 비디오 매핑, Flow 전용 기능의 graceful degrade.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGenAPI } from '../../src/hooks/useGenAPI'
import { DEFAULT_IMAGE_MODEL_ID } from '../../src/config/genModels'

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
})

describe('useGenAPI — 이미지', () => {
  it('generateImageDOM: 레퍼런스 base64 해석 후 전달 + 결과 매핑', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateImageDOM(
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
    // base64 필드는 data URL, mediaId 는 null (업스케일 자동 skip)
    expect(r.images[0]).toEqual({ base64: 'data:image/png;base64,ABC', mimeType: 'image/png', mediaId: null })
  })

  it('generateImageDOM: 선택 모델을 IPC 로 전달 + 결과에 model 기록', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => {
      r = await result.current.generateImageDOM('a cat', [], { aspectRatio: '9:16', model: 'gemini-3.1-flash-image' })
    })
    expect(window.electronAPI.genaiGenerateImage.mock.calls.at(-1)[0].model).toBe('gemini-3.1-flash-image')
    // finalize 가 result.model 을 주워 item.model 로 기록하므로, 결과에 effective model 이 실려야 한다.
    expect(r.model).toBe('gemini-3.1-flash-image')
  })

  it('generateImageDOM: model 미지정 시 기본 이미지 모델로 폴백(결과에도 기록)', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let r
    await act(async () => { r = await result.current.generateImageDOM('a cat', []) })
    expect(window.electronAPI.genaiGenerateImage.mock.calls.at(-1)[0].model).toBe(DEFAULT_IMAGE_MODEL_ID)
    expect(r.model).toBe(DEFAULT_IMAGE_MODEL_ID)
  })

  it('submitGenerationDOM: options.imageModel 을 generateImageDOM model 로 매핑', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    await act(async () => {
      await result.current.submitGenerationDOM('p', [], { aspectRatio: '16:9', imageModel: 'gemini-3-pro-image' })
    })
    await waitFor(() => {
      expect(window.electronAPI.genaiGenerateImage.mock.calls.at(-1)[0].model).toBe('gemini-3-pro-image')
    })
  })

  it('submit → check → collect 비동기 에뮬레이션', async () => {
    const { result } = renderHook(() => useGenAPI({ getProjectName: () => 'proj' }))
    let sub
    await act(async () => { sub = await result.current.submitGenerationDOM('p', []) })
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
    await act(async () => { sub = await result.current.submitGenerationDOM('p', []) })
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
      prompt: 'go', aspectRatio: '16:9', durationSeconds: 8, model: 'veo-3.1-fast',
    })
    expect(r).toEqual({ success: true, generationId: 'op1' })
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
      model: 'veo-3.1-fast',
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
  it('generateImageDOM: 키 거부 → authFailed + onAuthError', async () => {
    const onAuthError = vi.fn()
    window.electronAPI.genaiGenerateImage.mockResolvedValue({
      success: false, error: 'HTTP 400 :: API key not valid :: INVALID_ARGUMENT',
    })
    const { result } = renderHook(() => useGenAPI({ onAuthError }))
    let r
    await act(async () => { r = await result.current.generateImageDOM('p', []) })
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
    await act(async () => { r = await result.current.generateImageDOM('p', []) })
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
