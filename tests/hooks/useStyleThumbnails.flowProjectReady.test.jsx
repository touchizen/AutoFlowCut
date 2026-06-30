/**
 * #R5-4 — useStyleThumbnails blocks generation when flow + !flowProjectReady.
 *
 * Scenarios:
 *  1. flow mode + flowProjectReady=false → generateThumbnails returns early, no genAPI call
 *  2. flow mode + flowProjectReady=true  → generateThumbnails proceeds normally
 *  3. api mode (flowProjectReady=true always) → generateThumbnails proceeds normally
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ── Mocks ────────────────────────────────────────────────────────────────────

const toastWarning = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()
const toastInfo = vi.fn()

vi.mock('../../src/components/Toast', () => ({
  toast: {
    warning: (...a) => toastWarning(...a),
    error: (...a) => toastError(...a),
    success: (...a) => toastSuccess(...a),
    info: (...a) => toastInfo(...a),
  },
}))

// STYLE_PRESETS empty — we don't test preset generation logic here
vi.mock('../../src/config/defaults', () => ({
  STYLE_PRESETS: { styles: [] },
}))

// quotaStop — not under test here
vi.mock('../../src/utils/quotaStop', () => ({
  isQuotaExhaustedError: () => false,
  emitQuotaStop: vi.fn(),
}))

// guards.js — import real implementation (it only uses toast which is mocked)
// No mock needed — we want the real checkFlowProjectReady behaviour

import { useStyleThumbnails } from '../../src/hooks/useStyleThumbnails'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGenAPI() {
  return {
    generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'aGVsbG8=' }] }),
  }
}

const tFn = (k, opts) => opts?.defaultValue || k

beforeEach(() => {
  toastWarning.mockClear()
  toastError.mockClear()
  toastSuccess.mockClear()
  toastInfo.mockClear()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useStyleThumbnails — flowProjectReady gate (#R5-4)', () => {
  it('flow + !flowProjectReady: returns early, genAPI.generateImage NOT called', async () => {
    const genAPI = makeGenAPI()
    const { result } = renderHook(() => useStyleThumbnails(genAPI, { flowProjectReady: false }))

    await act(async () => {
      await result.current.generateThumbnails(
        [],
        [{ id: 'c1', name: 'custom', prompt: 'abc', type: 'style' }],
        tFn
      )
    })

    expect(genAPI.generateImage).not.toHaveBeenCalled()
    // Should show a warning toast (from checkFlowProjectReady)
    expect(toastWarning).toHaveBeenCalled()
  })

  it('flow + !flowProjectReady: generating state stays false (no batch started)', async () => {
    const genAPI = makeGenAPI()
    const { result } = renderHook(() => useStyleThumbnails(genAPI, { flowProjectReady: false }))

    await act(async () => {
      await result.current.generateThumbnails([], [], tFn)
    })

    expect(result.current.generating).toBe(false)
  })

  it('flow + flowProjectReady=true: generateImage IS called (proceeds normally)', async () => {
    const genAPI = makeGenAPI()
    const { result } = renderHook(() => useStyleThumbnails(genAPI, { flowProjectReady: true }))

    await act(async () => {
      // customRefs has one item → should call generateImage once
      await result.current.generateThumbnails(
        [],
        [{ id: 'c1', name: 'custom', prompt: 'abc', type: 'style' }],
        tFn
      )
    })

    expect(genAPI.generateImage).toHaveBeenCalledTimes(1)
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('api mode (default flowProjectReady=true): generateImage IS called', async () => {
    const genAPI = makeGenAPI()
    // Default options — no flowProjectReady passed → defaults to true
    const { result } = renderHook(() => useStyleThumbnails(genAPI))

    await act(async () => {
      await result.current.generateThumbnails(
        [],
        [{ id: 'c1', name: 'custom', prompt: 'abc', type: 'style' }],
        tFn
      )
    })

    expect(genAPI.generateImage).toHaveBeenCalledTimes(1)
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('dep array: flowProjectReady in deps — generateThumbnails re-creates when flowProjectReady changes (#R6-18)', async () => {
    // This test verifies that flowProjectReady is in the useCallback dep array.
    // If it is NOT in deps, the callback captures the initial value (false) forever
    // and would block even after re-render with flowProjectReady=true.
    const genAPI = makeGenAPI()
    const { result, rerender } = renderHook(
      ({ r }) => useStyleThumbnails(genAPI, { flowProjectReady: r }),
      { initialProps: { r: false } }
    )

    // With flowProjectReady=false: should be blocked, genAPI not called
    await act(async () => {
      await result.current.generateThumbnails(
        [],
        [{ id: 'c1', name: 'custom', prompt: 'abc', type: 'style' }],
        tFn
      )
    })
    expect(genAPI.generateImage).not.toHaveBeenCalled()

    // Re-render with flowProjectReady=true: callback must re-create and allow generation
    rerender({ r: true })

    await act(async () => {
      await result.current.generateThumbnails(
        [],
        [{ id: 'c1', name: 'custom', prompt: 'abc', type: 'style' }],
        tFn
      )
    })
    expect(genAPI.generateImage).toHaveBeenCalledTimes(1)
  })
})
