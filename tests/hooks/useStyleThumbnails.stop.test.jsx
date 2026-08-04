/**
 * Thumbnail Stop — stopGenerating must halt the preset loop before the next
 * submission, and it stays on the renderer-local stop path (stopRequestedRef):
 * no engine-side cancellation call is issued.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/config/defaults', () => ({
  STYLE_PRESETS: {
    styles: [
      { id: 'stop-chain-a', prompt_en: 'copperpunk skyline' },
      { id: 'stop-chain-b', prompt_en: 'gaslight noir alley' },
    ],
  },
}))
import { useStyleThumbnails } from '../../src/hooks/useStyleThumbnails'

afterEach(() => {
  vi.useRealTimers()
  delete window.electronAPI
})

function gatedGenAPI() {
  const events = []
  let release
  const generateImage = vi.fn(() => {
    events.push('generate:start')
    return new Promise((resolve) => { release = resolve })
  })
  const genAPI = {
    generateImage,
    mode: 'flow',
    setStopRequested: vi.fn(async (value) => {
      events.push(`cancel:${value}`)
      return { success: true }
    }),
  }
  return { genAPI, events, releaseActive: (value) => release(value) }
}

describe('useStyleThumbnails Stop', () => {
  it('stops the preset loop before the next submission without engine-side cancellation', async () => {
    vi.useFakeTimers()
    const h = gatedGenAPI()
    const { result } = renderHook(() => useStyleThumbnails(h.genAPI, { flowProjectReady: true }))

    let run
    act(() => { run = result.current.generateThumbnails(['stop-chain-a', 'stop-chain-b'], [], (key) => key) })
    await act(async () => { await Promise.resolve() })
    expect(h.events).toEqual(['generate:start'])

    act(() => { result.current.stopGenerating() })
    expect(result.current.stopping).toBe(true)

    await act(async () => {
      h.releaseActive({ success: false, error: 'cancelled' })
      await vi.advanceTimersByTimeAsync(5000)
    })
    await act(async () => { await run })

    // Stop actually stopped the loop: the second preset was never submitted,
    // and the renderer-local stop never issued an engine cancellation call.
    expect(h.genAPI.generateImage).toHaveBeenCalledTimes(1)
    expect(h.events).toEqual(['generate:start'])
    expect(h.genAPI.setStopRequested).not.toHaveBeenCalled()
  })
})
