/**
 * useGenAPI.test.js — useFlowAPI drop-in 대체 훅 통합 테스트.
 *
 * genai IPC mock 을 관통: 인증(BYOK), 이미지 동기 생성 + async 에뮬레이션,
 * 레퍼런스 base64 해석, 비디오 매핑, Flow 전용 기능의 graceful degrade.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGenAPI } from '../../src/hooks/useGenAPI'

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
    })
    // base64 필드는 data URL, mediaId 는 null (업스케일 자동 skip)
    expect(r.images[0]).toEqual({ base64: 'data:image/png;base64,ABC', mimeType: 'image/png', mediaId: null })
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
    expect(r.statuses[0]).toMatchObject({ generationId: 'a', status: 'completed', videoUri: 'https://v/a', mediaId: 'https://v/a' })
    expect(r.statuses[1]).toMatchObject({ generationId: 'b', status: 'pending' })
  })

  it('downloadVideo → base64', async () => {
    const { result } = renderHook(() => useGenAPI())
    let r
    await act(async () => { r = await result.current.downloadVideo('https://v/a') })
    expect(window.electronAPI.genaiDownloadVideo).toHaveBeenCalledWith({ videoUri: 'https://v/a' })
    expect(r).toEqual({ success: true, base64: 'VID' })
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
