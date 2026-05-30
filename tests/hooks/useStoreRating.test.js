/**
 * useStoreRating — export(3) / generation(5) 트리거 + 영속/스누즈 동작
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStoreRating } from '../../src/hooks/useStoreRating'
import {
  STORE_RATING_KEY,
  STORE_PRODUCT_ID,
  PROMPT_THRESHOLDS
} from '../../src/utils/storeRating'

beforeEach(() => {
  localStorage.clear()
})

function repeat(fn, n) {
  for (let i = 0; i < n; i++) act(() => fn())
}

describe('useStoreRating — export trigger (3)', () => {
  it('does not show before threshold', () => {
    const { result } = renderHook(() => useStoreRating({ isStoreBuild: true }))
    repeat(result.current.recordExport, PROMPT_THRESHOLDS.export - 1)
    expect(result.current.showModal).toBe(false)
  })

  it('shows exactly at the export threshold on a store build', () => {
    const { result } = renderHook(() => useStoreRating({ isStoreBuild: true }))
    repeat(result.current.recordExport, PROMPT_THRESHOLDS.export)
    expect(result.current.showModal).toBe(true)
  })
})

describe('useStoreRating — generation trigger (5)', () => {
  it('does not show after 4 completed generations', () => {
    const { result } = renderHook(() => useStoreRating({ isStoreBuild: true }))
    repeat(result.current.recordGeneration, PROMPT_THRESHOLDS.generation - 1)
    expect(result.current.showModal).toBe(false)
  })

  it('shows exactly at the 5th completed generation', () => {
    const { result } = renderHook(() => useStoreRating({ isStoreBuild: true }))
    repeat(result.current.recordGeneration, PROMPT_THRESHOLDS.generation)
    expect(result.current.showModal).toBe(true)
  })

  it('never shows on a non-store build', () => {
    const { result } = renderHook(() => useStoreRating({ isStoreBuild: false }))
    repeat(result.current.recordGeneration, PROMPT_THRESHOLDS.generation + 3)
    repeat(result.current.recordExport, PROMPT_THRESHOLDS.export + 3)
    expect(result.current.showModal).toBe(false)
  })
})

describe('useStoreRating — actions', () => {
  it('rateNow opens the store deep link and never prompts again', () => {
    const openExternal = vi.fn()
    const { result } = renderHook(() => useStoreRating({ isStoreBuild: true, openExternal }))
    repeat(result.current.recordExport, PROMPT_THRESHOLDS.export)
    act(() => result.current.rateNow())

    expect(openExternal).toHaveBeenCalledWith(
      `ms-windows-store://review/?ProductId=${STORE_PRODUCT_ID}`
    )
    expect(result.current.showModal).toBe(false)

    // 이후 어느 채널로도 다시 안 뜸
    repeat(result.current.recordGeneration, 20)
    expect(result.current.showModal).toBe(false)
  })

  it('dismissForever locks out both channels', () => {
    const { result } = renderHook(() => useStoreRating({ isStoreBuild: true }))
    repeat(result.current.recordGeneration, PROMPT_THRESHOLDS.generation)
    act(() => result.current.dismissForever())
    expect(result.current.showModal).toBe(false)

    repeat(result.current.recordExport, 20)
    expect(result.current.showModal).toBe(false)
  })

  it('remindLater snoozes, then re-prompts after more successes', () => {
    const { result } = renderHook(() => useStoreRating({ isStoreBuild: true }))
    repeat(result.current.recordExport, PROMPT_THRESHOLDS.export)
    act(() => result.current.remindLater())
    expect(result.current.showModal).toBe(false)

    repeat(result.current.recordExport, 1)
    expect(result.current.showModal).toBe(false)

    repeat(result.current.recordExport, 10)
    expect(result.current.showModal).toBe(true)
  })
})

describe('useStoreRating — persistence', () => {
  it('persists across remounts without a startup popup, then triggers on next success', () => {
    const first = renderHook(() => useStoreRating({ isStoreBuild: true }))
    repeat(first.result.current.recordExport, PROMPT_THRESHOLDS.export - 1)
    first.unmount()

    const second = renderHook(() => useStoreRating({ isStoreBuild: true }))
    expect(second.result.current.showModal).toBe(false)

    repeat(second.result.current.recordExport, 1)
    expect(second.result.current.showModal).toBe(true)
  })

  it('does not pop up on mount even if a prior session crossed the threshold unanswered', () => {
    localStorage.setItem(
      STORE_RATING_KEY,
      JSON.stringify({ status: 'pending', counts: { export: 99, generation: 99 }, nextPromptAt: { export: 3, generation: 5 } })
    )
    const { result } = renderHook(() => useStoreRating({ isStoreBuild: true }))
    expect(result.current.showModal).toBe(false)
  })
})
