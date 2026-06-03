/**
 * useAvailableModels — 라이브 /models 로 모델 선택 옵션을 채우고, 실패/빈 결과면 정적
 * 카탈로그로 graceful 폴백.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
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

  it('byok-key-changed 시 /models 재조회 — 키 저장 후 동적 목록 반영 (리뷰)', async () => {
    const listModels = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'No API key' }) // 최초: 무키
      .mockResolvedValueOnce({ success: true, models: [
        { id: 'gemini-2.5-flash-image', methods: ['generateContent'] },
      ] }) // 키 저장 후
    const { result } = renderHook(() => useAvailableModels({ listModels }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.imageModels).toEqual(IMAGE_MODELS) // 무키 → 정적

    act(() => { window.dispatchEvent(new CustomEvent('byok-key-changed')) })
    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.imageModels.map(m => m.id)).toContain('gemini-2.5-flash-image'))
  })

  it('superseded(지난) /models 응답이 최신 상태를 덮지 않음 (race, 리뷰)', async () => {
    let resolveA
    const pA = new Promise((r) => { resolveA = r })
    const listModels = vi.fn()
      .mockReturnValueOnce(pA)                                         // 1st(키 A) — 늦게 resolve
      .mockResolvedValueOnce({ success: false, error: 'No API key' })  // 2nd(키 삭제) — 먼저 resolve
    const { result } = renderHook(() => useAvailableModels({ listModels }))

    // 1st in-flight 중 키 삭제 이벤트 → 2nd 발화
    act(() => { window.dispatchEvent(new CustomEvent('byok-key-changed')) })
    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.videoModels).toEqual(VIDEO_MODELS)) // 2nd → 정적

    // 이제 1st(키 A)가 늦게 동적으로 성공 — superseded 라 무시돼야 함
    await act(async () => {
      resolveA({ success: true, models: [{ id: 'veo-2.0-generate-001', methods: ['predictLongRunning'] }] })
    })
    expect(result.current.videoModels).toEqual(VIDEO_MODELS) // 여전히 정적 (지난 응답 무시)
  })

  it('byok-key-changed 후 키 없으면 정적 폴백으로 복귀 — 이전 키 동적 목록 비움 (리뷰)', async () => {
    const listModels = vi.fn()
      .mockResolvedValueOnce({ success: true, models: [
        { id: 'veo-2.0-generate-001', methods: ['predictLongRunning'] },
      ] })
      .mockResolvedValueOnce({ success: false, error: 'No API key' }) // 키 삭제 후
    const { result } = renderHook(() => useAvailableModels({ listModels }))
    await waitFor(() => expect(result.current.videoModels.map(m => m.id)).toContain('veo-2.0-generate-001'))

    act(() => { window.dispatchEvent(new CustomEvent('byok-key-changed')) })
    await waitFor(() => expect(result.current.videoModels).toEqual(VIDEO_MODELS))
  })
})
