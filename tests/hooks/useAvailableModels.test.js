/**
 * useAvailableModels — 라이브 /models 로 모델 선택 옵션을 채우고, 실패/빈 결과면 정적
 * 카탈로그로 graceful 폴백.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAvailableModels } from '../../src/hooks/useAvailableModels'
import { IMAGE_MODELS, VIDEO_MODELS } from '../../src/config/genModels'

describe('useAvailableModels', () => {
  it('성공: /models 를 카테고리로 분류해 노출 (이미지/비디오)', async () => {
    const listModels = vi.fn().mockResolvedValue({ success: true, models: [
      { id: 'gemini-2.5-flash-image', displayName: 'NB', methods: ['generateContent'] },
      { id: 'veo-2.0-generate-001', displayName: 'Veo 2', methods: ['predictLongRunning'] },
    ] })
    const { result } = renderHook(() => useAvailableModels({ listModels }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.imageModels.map(m => m.id)).toContain('gemini-2.5-flash-image')
    expect(result.current.videoModels.map(m => m.id)).toContain('veo-2.0-generate-001')
  })

  it('실패: 정적 카탈로그로 폴백 + error 노출', async () => {
    const listModels = vi.fn().mockResolvedValue({ success: false, error: 'no key' })
    const { result } = renderHook(() => useAvailableModels({ listModels }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.imageModels).toEqual(IMAGE_MODELS)
    expect(result.current.videoModels).toEqual(VIDEO_MODELS)
    expect(result.current.error).toBe('no key')
  })

  it('분류 결과가 비면(텍스트 모델만) 정적 카탈로그로 폴백', async () => {
    const listModels = vi.fn().mockResolvedValue({ success: true, models: [
      { id: 'gemini-2.5-flash', methods: ['generateContent'] },
    ] })
    const { result } = renderHook(() => useAvailableModels({ listModels }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.imageModels).toEqual(IMAGE_MODELS)
    expect(result.current.videoModels).toEqual(VIDEO_MODELS)
  })

  it('listModels 없으면 정적 카탈로그(로딩 종료)', async () => {
    const { result } = renderHook(() => useAvailableModels({}))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.imageModels).toEqual(IMAGE_MODELS)
    expect(result.current.videoModels).toEqual(VIDEO_MODELS)
  })
})
