import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toastMocks = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { ...toastMocks, warning: vi.fn() },
}))

vi.mock('../../src/config/defaults', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    STYLE_PRESETS: { styles: [{ id: 'cancel-style', prompt_en: 'cinematic' }] },
  }
})

import { useGenAPI } from '../../src/hooks/useGenAPI'
import { createEngineApi } from '../../src/engine/engineApi'
import { useStyleThumbnails } from '../../src/hooks/useStyleThumbnails'

function deferred() {
  let resolve
  const promise = new Promise(res => { resolve = res })
  return { promise, resolve }
}

function useHarness() {
  const rawGenAPI = useGenAPI()
  const engine = { mode: 'api', ...createEngineApi(rawGenAPI) }
  return useStyleThumbnails(engine, { imageProvider: 'google', imageModel: 'gemini-test' })
}

beforeEach(() => {
  window.electronAPI.genaiCancel.mockResolvedValue({ success: true, aborted: 1 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Style thumbnail cancel — real useGenAPI → engineApi facade', () => {
  it('provider in-flight Stop은 captured scope를 정확히 한 번 취소하고 D4를 저장/실패 처리하지 않는다', async () => {
    const image = deferred()
    window.electronAPI.genaiGenerateImage.mockReturnValueOnce(image.promise)
    const hook = renderHook(() => useHarness())
    let generation
    act(() => {
      generation = hook.result.current.generateThumbnails(['cancel-style'], [], key => key)
    })
    await waitFor(() => expect(window.electronAPI.genaiGenerateImage).toHaveBeenCalledTimes(1))
    const scope = window.electronAPI.genaiGenerateImage.mock.calls[0][0].cancelScope

    act(() => {
      hook.result.current.stopGenerating()
      hook.result.current.stopGenerating()
    })
    image.resolve({ success: false, error: 'Operation aborted', errorKind: 'aborted', aborted: true })
    await act(async () => { await generation })

    expect(scope).toMatch(/^styleThumbs:/)
    expect(window.electronAPI.genaiCancel).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.genaiCancel).toHaveBeenCalledWith({ scope })
    expect(hook.result.current.thumbnails['cancel-style']).toBeUndefined()
    expect(toastMocks.error).not.toHaveBeenCalled()
    expect(toastMocks.success).not.toHaveBeenCalled()
    expect(toastMocks.info).toHaveBeenCalledWith('reference.thumbnailStopped')
    expect(hook.result.current.generating).toBe(false)
    expect(hook.result.current.stopping).toBe(false)
  })

  it('양성 대조군: 같은 direct sink의 비-abort failure는 기존 warn/진행 카운트로 처리된다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.electronAPI.genaiGenerateImage.mockResolvedValueOnce({
      success: false,
      error: 'provider failed',
      errorKind: 'transient',
    })
    const hook = renderHook(() => useHarness())

    await act(async () => {
      await hook.result.current.generateThumbnails(['cancel-style'], [], key => key)
    })

    expect(warn).toHaveBeenCalledWith(
      '[StyleThumbnails] Failed to generate cancel-style:',
      'provider failed',
    )
    expect(hook.result.current.progress).toMatchObject({ current: 1, total: 1 })
    expect(toastMocks.info).not.toHaveBeenCalledWith('reference.thumbnailStopped')
  })

  it('N4: success가 Stop 뒤 도착해도 이미 과금된 thumbnail 결과를 저장한다', async () => {
    vi.useFakeTimers()
    const image = deferred()
    window.electronAPI.genaiGenerateImage.mockReturnValueOnce(image.promise)
    const hook = renderHook(() => useHarness())
    let generation
    act(() => {
      generation = hook.result.current.generateThumbnails(['cancel-style'], [], key => key)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    act(() => hook.result.current.stopGenerating())
    image.resolve({
      success: true,
      images: [{ base64: 'data:image/png;base64,PAID', mimeType: 'image/png' }],
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    await act(async () => { await generation })

    expect(hook.result.current.thumbnails['cancel-style']).toBe('data:image/png;base64,PAID')
    expect(toastMocks.success).toHaveBeenCalled()
  })
})
