/**
 * useStyleThumbnails — 전역 image provider/model 을 썸네일 generateImage 까지 전달 (M1 F3).
 * 안 하면 openai 선택 시에도 썸네일이 google 로 생성되거나(불일치) openai-only 사용자는 실패.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/config/defaults', () => ({
  STYLE_PRESETS: { styles: [{ id: 'p1', prompt_en: 'anime' }] },
}))
import { useStyleThumbnails } from '../../src/hooks/useStyleThumbnails'

beforeEach(() => {
  window.electronAPI = { saveStyleThumbnail: vi.fn().mockResolvedValue({ success: true, path: '/t/p1.png' }) }
})

describe('useStyleThumbnails — provider/model 전달', () => {
  it('preset + custom 썸네일 generateImage 에 imageProvider/imageModel 전달', async () => {
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'data:image/png;base64,X' }] })
    const genAPI = { generateImage, mode: 'api' }

    const { result } = renderHook(() =>
      useStyleThumbnails(genAPI, { flowProjectReady: true, imageProvider: 'openai', imageModel: 'gpt-image-1' })
    )

    await act(async () => {
      await result.current.generateThumbnails(['p1'], [{ id: 'c1', name: 'custom', prompt: 'noir' }], (k) => k)
    })

    expect(generateImage).toHaveBeenCalledTimes(2) // preset + custom
    for (const call of generateImage.mock.calls) {
      expect(call[2].provider).toBe('openai')
      expect(call[2].model).toBe('gpt-image-1')
    }
  })

  it('provider 미지정 → google 기본', async () => {
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'data:image/png;base64,X' }] })
    const { result } = renderHook(() => useStyleThumbnails({ generateImage, mode: 'api' }, { flowProjectReady: true }))
    await act(async () => {
      await result.current.generateThumbnails(['p1'], [], (k) => k)
    })
    expect(generateImage.mock.calls[0][2].provider).toBe('google')
  })
})
