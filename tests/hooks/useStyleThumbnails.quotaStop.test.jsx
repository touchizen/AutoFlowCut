/**
 * useStyleThumbnails — quota stop 시 custom 루프도 stopped=true 로 정리되는지 검증.
 *
 * 회귀: custom 루프의 break 들이 stopped 플래그를 set 안 해서 quota 모달이 떴음에도
 * "Thumbnail generation stopped" toast 가 안 뜨고, 이미 생성된 썸네일이 있으면 success
 * toast 까지 함께 표시되는 일관성 문제.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const toastInfo = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('../../src/components/Toast', () => ({
  toast: { info: (...a) => toastInfo(...a), success: (...a) => toastSuccess(...a), error: (...a) => toastError(...a) },
}))

vi.mock('../../src/config/defaults', () => ({
  STYLE_PRESETS: { styles: [{ id: 'p1', prompt_en: 'preset one' }] },
}))

import { useStyleThumbnails } from '../../src/hooks/useStyleThumbnails'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

beforeEach(() => {
  __resetQuotaStopForTests()
  toastInfo.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useStyleThumbnails — custom-loop quota stop', () => {
  it('K3: custom result errorKind quota stops on non-matching error text', async () => {
    // generateImage 이 항상 quota 에러 반환.
    const genAPI = {
      cancelGeneration: vi.fn().mockResolvedValue({ success: true, aborted: 0 }),
      generateImage: vi.fn().mockResolvedValue({
        success: false,
        error: 'Too Many Requests',
        errorKind: 'quota',
      }),
    }

    const { result } = renderHook(() => useStyleThumbnails(genAPI))

    // custom 만 — preset 은 STYLE_PRESETS 빈 배열로 mock.
    await act(async () => {
      await result.current.generateThumbnails(
        [],  // presetIds — preset 루프 skip
        [{ id: 'c1', name: 'custom1', prompt: 'a', type: 'style' }],  // customRefs
        (k) => k
      )
    })

    // quota → stopped toast 노출
    const stoppedCall = toastInfo.mock.calls.find(([msg]) =>
      typeof msg === 'string' && (msg.includes('stopped') || msg.includes('reference.thumbnailStopped'))
    )
    expect(stoppedCall).toBeTruthy()

    // generated=0 이라 success toast 는 안 떠야 함.
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(genAPI.cancelGeneration).toHaveBeenCalledTimes(1)
  })

  it('K3: preset result errorKind quota stops on non-matching error text', async () => {
    const generateImage = vi.fn().mockResolvedValue({
      success: false,
      error: 'Too Many Requests',
      errorKind: 'quota',
    })
    const cancelGeneration = vi.fn().mockResolvedValue({ success: true, aborted: 0 })
    const { result } = renderHook(() => useStyleThumbnails({ generateImage, cancelGeneration }))

    await act(async () => {
      await result.current.generateThumbnails(['p1'], [], (k) => k)
    })

    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(toastInfo).toHaveBeenCalledWith('reference.thumbnailStopped')
    expect(cancelGeneration).toHaveBeenCalledTimes(1)
  })

  it('K3: result errorKind other overrides quota-looking text', async () => {
    const generateImage = vi.fn().mockResolvedValue({
      success: false,
      error: 'Resource has been exhausted (e.g. check quota).',
      errorKind: 'other',
    })
    const cancelGeneration = vi.fn().mockResolvedValue({ success: true, aborted: 0 })
    const { result } = renderHook(() => useStyleThumbnails({ generateImage, cancelGeneration }))

    await act(async () => {
      await result.current.generateThumbnails([], [
        { id: 'c1', name: 'custom1', prompt: 'a', type: 'style' },
        { id: 'c2', name: 'custom2', prompt: 'b', type: 'style' },
      ], (k) => k)
    })

    expect(generateImage).toHaveBeenCalledTimes(2)
    expect(toastInfo).not.toHaveBeenCalledWith('reference.thumbnailStopped')
  })
})
