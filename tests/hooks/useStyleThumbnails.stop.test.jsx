/**
 * C3 — the thumbnail Stop must cancel an active ChatGPT job through the same
 * cancellation chain useAutomation.stop() uses (cancelsActiveOnStop → setStopRequested(true)
 * → chatgpt:cancel-generations → adapter cancelAll). Engines that do not advertise
 * cancellation (Flow/API) must stay untouched.
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

function gatedGenAPI({ cancelsActiveOnStop }) {
  const events = []
  let release
  const generateImage = vi.fn(() => {
    events.push('generate:start')
    return new Promise((resolve) => { release = resolve })
  })
  const genAPI = {
    generateImage,
    mode: 'flow',
    ...(cancelsActiveOnStop ? { cancelsActiveOnStop: true } : {}),
    setStopRequested: vi.fn(async (value) => {
      events.push(`cancel:${value}`)
      return { success: true }
    }),
  }
  return { genAPI, events, releaseActive: (value) => release(value) }
}

async function runStopScenario({ cancelsActiveOnStop }) {
  vi.useFakeTimers()
  const h = gatedGenAPI({ cancelsActiveOnStop })
  const { result } = renderHook(() => useStyleThumbnails(h.genAPI, { flowProjectReady: true }))

  let run
  act(() => { run = result.current.generateThumbnails(['stop-chain-a', 'stop-chain-b'], [], (key) => key) })
  await act(async () => { await Promise.resolve() })
  expect(h.events).toEqual(['generate:start'])

  act(() => { result.current.stopGenerating() })

  await act(async () => {
    h.releaseActive({ success: false, errorKind: 'chatgpt-generation-cancelled', error: 'cancelled' })
    await vi.advanceTimersByTimeAsync(5000)
  })
  await act(async () => { await run })

  // Stop actually stopped the loop: the second preset was never submitted.
  expect(h.genAPI.generateImage).toHaveBeenCalledTimes(1)
  return h
}

describe('useStyleThumbnails Stop — active ChatGPT job cancellation', () => {
  it('wires Stop through setStopRequested(true) when the engine advertises active cancellation', async () => {
    const h = await runStopScenario({ cancelsActiveOnStop: true })

    expect(h.events).toEqual(['generate:start', 'cancel:true'])
    expect(h.genAPI.setStopRequested).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('leaves engines without cancelsActiveOnStop on their existing stop path', async () => {
    const h = await runStopScenario({ cancelsActiveOnStop: false })

    expect(h.events).toEqual(['generate:start'])
    expect(h.genAPI.setStopRequested).not.toHaveBeenCalled()
  })
})
