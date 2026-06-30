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

  it('refetch(): 마운트 시 실패해도 재호출하면 동적 목록으로 갱신 (설정 열 때 재시도)', async () => {
    // Flow 모드 스크랩은 앱 시작 시 Flow 페이지 로딩 중이라 1회차에 빈손이 될 수 있다.
    //   재시도가 없으면 정적 폴백에 고정 → 설정 열 때 refetch 로 settle 된 페이지를 다시 긁는다.
    const listModels = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'not ready' })   // 마운트: 실패 → 정적
      .mockResolvedValueOnce({ success: true, models: [
        { id: 'gemini-2.5-flash-image', methods: ['generateContent'] },
      ] })                                                              // refetch: 성공
    const { result } = renderHook(() => useAvailableModels({ listModels }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.imageModels).toEqual(IMAGE_MODELS)           // 정적 폴백

    act(() => { result.current.refetch() })
    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.imageModels.map(m => m.id)).toContain('gemini-2.5-flash-image'))
  })

  it('source: 동적 목록 성공이면 dynamic (refetch 게이팅용)', async () => {
    const listModels = vi.fn().mockResolvedValue({ success: true, models: [
      { id: 'gemini-2.5-flash-image', methods: ['generateContent'] },
    ] })
    const { result } = renderHook(() => useAvailableModels({ listModels }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.source).toBe('dynamic')
  })

  it('source: 실패/폴백이면 static', async () => {
    const listModels = vi.fn().mockResolvedValue({ success: false, error: 'no key' })
    const { result } = renderHook(() => useAvailableModels({ listModels }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.source).toBe('static')
  })

  it('Flow 모드: 정적 목록은 Flow 모델(FLOW_STATIC_MODELS)이지 API gemini 모델이 아님', async () => {
    // Flow 모드 드롭다운에 API gemini-* 모델이 새지 않아야 한다(정적 Flow 목록만).
    const { FLOW_STATIC_MODELS } = await import('../../src/engine/flowModels')

    const prevElectron = window.electronAPI
    window.electronAPI = {
      listFlowAgentModels: vi.fn().mockResolvedValue({ success: true, image: { options: [] }, video: { options: [{ value: 'veo_x', label: 'Veo X' }] } }),
    }
    try {
      const listModels = vi.fn().mockResolvedValue({ success: true, models: [] })
      const { result } = renderHook(() => useAvailableModels({ listModels }, 'flow'))
      await waitFor(() => expect(result.current.loading).toBe(false))
      const ids = result.current.imageModels.map(m => m.id)
      expect(ids).toEqual(FLOW_STATIC_MODELS.imageModels.map(m => m.id))
      expect(ids.some(id => /gemini/.test(id))).toBe(false)
    } finally {
      window.electronAPI = prevElectron
    }
  })

  it('Flow 모드: 동적 스크랩 제거 — listFlowAgentModels 호출 없이 항상 FLOW_STATIC (UI drift 안정화)', async () => {
    const { FLOW_STATIC_MODELS: flowStatic } = await import('../../src/engine/flowModels')
    const prevElectron = window.electronAPI
    // 스크랩 IPC 가 (성공처럼) 있어도 호출하지 않아야 한다 — Flow UI drift 로 깨지는 동적 경로를 제거.
    const listFlowAgentModels = vi.fn().mockResolvedValue({
      success: true, image: { options: [{ value: 'x', label: 'X' }] }, video: { options: [{ value: 'y', label: 'Y' }] },
    })
    window.electronAPI = { listFlowAgentModels }
    try {
      const listModels = vi.fn()
      const { result } = renderHook(() => useAvailableModels({ listModels }, 'flow'))
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.imageModels).toEqual(flowStatic.imageModels)
      expect(result.current.videoModels).toEqual(flowStatic.videoModels)
      expect(result.current.source).toBe('flow-static')
      expect(listFlowAgentModels).not.toHaveBeenCalled()
      expect(listModels).not.toHaveBeenCalled()
    } finally {
      window.electronAPI = prevElectron
    }
  })

  it('Flow 모드: listModels 없어도(빈 genAPI) FLOW_STATIC + source:flow-static (heal 경로 보존, 리뷰 r4)', async () => {
    // Flow 정적 선택은 listModels 게이트보다 우선해야 한다 — genAPI 가 비어 listModels 가 없을 때도
    //   API 정적 카탈로그('static')가 아니라 권위 있는 FLOW_STATIC('flow-static')을 반환해야
    //   computeModelHeal 이 stale API 모델을 Flow 모델로 치유한다.
    const { FLOW_STATIC_MODELS: flowStatic } = await import('../../src/engine/flowModels')
    const { result } = renderHook(() => useAvailableModels({}, 'flow'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.imageModels).toEqual(flowStatic.imageModels)
    expect(result.current.videoModels).toEqual(flowStatic.videoModels)
    expect(result.current.source).toBe('flow-static')
  })

  it('I1: mode 변경 시 재실행 (mode dep) — api 는 /models, flow 는 정적 FLOW_MODELS', async () => {
    // mode가 바뀌면 effect를 다시 실행해야 한다 (우연이 아닌 명시적 의존). api→flow 전환 시
    //   flow 는 동적 스크랩 없이 정적 FLOW_MODELS 로 전환된다(listModels 추가 호출 없음).
    const { FLOW_STATIC_MODELS: flowStatic } = await import('../../src/engine/flowModels')
    const listModels = vi.fn().mockResolvedValue({ success: true, models: [
      { id: 'gemini-2.5-flash-image', displayName: 'NB', methods: ['generateContent'] },
    ] })
    let mode = 'api'
    const { result, rerender } = renderHook(() => useAvailableModels({ listModels }, mode))
    await waitFor(() => expect(result.current.imageModels.map(m => m.id)).toContain('gemini-2.5-flash-image'))
    expect(listModels).toHaveBeenCalledTimes(1)

    // mode 변경 → flow: 정적 FLOW_MODELS 로 전환, listModels 추가 호출 없음
    mode = 'flow'
    rerender()
    await waitFor(() => expect(result.current.imageModels).toEqual(flowStatic.imageModels))
    expect(listModels).toHaveBeenCalledTimes(1)
  })
})
