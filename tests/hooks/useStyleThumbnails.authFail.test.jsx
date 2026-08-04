import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const toastInfo = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('../../src/components/Toast', () => ({
  toast: { info: (...a) => toastInfo(...a), success: (...a) => toastSuccess(...a), error: (...a) => toastError(...a), warning: vi.fn() },
}))

vi.mock('../../src/config/defaults', () => ({
  STYLE_PRESETS: {
    styles: [
      { id: 'cinematic', name: 'Cinematic', prompt_en: 'cinematic lighting' },
    ],
  },
}))

vi.mock('../../src/utils/quotaStop', () => ({
  isQuotaExhaustedError: () => false,
  emitQuotaStop: vi.fn(),
}))

import { useStyleThumbnails } from '../../src/hooks/useStyleThumbnails'

const t = (k) => ({
  'status.flowAuthErrorStopped': 'Flow에 로그인 후 다시 시도해주세요.',
  'toast.authErrorStop': 'API 키를 확인해주세요.',
  'reference.thumbnailStopped': '썸네일 생성 중단',
}[k] || k)

beforeEach(() => {
  toastInfo.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
})

describe('useStyleThumbnails — Flow auth failure guidance', () => {
  it('preset authFailed shows Flow auth guidance, not API-key guidance', async () => {
    const genAPI = {
      mode: 'flow',
      cancelGeneration: vi.fn().mockResolvedValue({ success: true, aborted: 0 }),
      generateImage: vi.fn().mockResolvedValue({ success: false, authFailed: true, error: 'Auth expired' }),
    }
    const { result } = renderHook(() => useStyleThumbnails(genAPI, { flowProjectReady: true }))

    await act(async () => {
      await result.current.generateThumbnails(['cinematic'], [], t)
    })

    expect(toastError).toHaveBeenCalledWith('Flow에 로그인 후 다시 시도해주세요.')
    expect(toastError).not.toHaveBeenCalledWith('API 키를 확인해주세요.')
    expect(genAPI.cancelGeneration).toHaveBeenCalledTimes(1)
  })

  it('custom authFailed shows Flow auth guidance, not API-key guidance', async () => {
    const genAPI = {
      mode: 'flow',
      cancelGeneration: vi.fn().mockResolvedValue({ success: true, aborted: 0 }),
      generateImage: vi.fn().mockResolvedValue({ success: false, authFailed: true, error: 'Auth expired' }),
    }
    const { result } = renderHook(() => useStyleThumbnails(genAPI, { flowProjectReady: true }))

    await act(async () => {
      await result.current.generateThumbnails(
        [],
        [{ id: 'style-1', name: 'custom', prompt: 'ink wash', type: 'style' }],
        t,
      )
    })

    expect(toastError).toHaveBeenCalledWith('Flow에 로그인 후 다시 시도해주세요.')
    expect(toastError).not.toHaveBeenCalledWith('API 키를 확인해주세요.')
    expect(genAPI.cancelGeneration).toHaveBeenCalledTimes(1)
  })
})
