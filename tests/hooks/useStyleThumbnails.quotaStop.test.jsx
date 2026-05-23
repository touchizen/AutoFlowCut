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
  STYLE_PRESETS: { styles: [] },
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
  it('custom 루프 첫 ref 가 quota 면 stopped toast 노출, success toast 미노출', async () => {
    // generateImageDOM 이 항상 quota 에러 반환.
    const flowAPI = {
      generateImageDOM: vi.fn().mockResolvedValue({
        success: false,
        error: 'Resource has been exhausted (e.g. check quota).',
      }),
    }

    const { result } = renderHook(() => useStyleThumbnails(flowAPI))

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
  })
})
