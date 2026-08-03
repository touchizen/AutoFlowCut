/**
 * C3 — reference Stop must cancel active ChatGPT work through the same chain the
 * batch (useAutomation.stop) and thumbnail (useStyleThumbnails.stopGenerating) Stops use:
 * cancelsActiveOnStop → engine setStopRequested(true) → chatgpt:cancel-generations →
 * adapter cancelAll. Before the fix, stopGenerateAllRefs only flipped renderer-local refs,
 * so a main-owned ChatGPT page/fetch job kept running after the user pressed Stop.
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

function renderRefHook(genAPI) {
  return renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'folder', imageBatchCount: 1 },
    references: [{ id: 1, prompt: 'a portrait', type: 'character', status: 'pending' }],
    setReferences: vi.fn(),
    genAPI,
    addPendingSave: vi.fn(),
    openSettings: vi.fn(),
    t: (key) => key,
    generationQueue: null,
  }))
}

describe('useReferenceGeneration — Stop cancels active ChatGPT work (C3)', () => {
  it('routes Stop into setStopRequested(true) when the engine advertises active cancellation', () => {
    const events = []
    const genAPI = {
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      cancelsActiveOnStop: true,
      setStopRequested: vi.fn((value) => {
        events.push(`cancel:${value}`)
        return Promise.resolve({ success: true })
      }),
    }
    const { result } = renderRefHook(genAPI)

    act(() => { result.current.stopGenerateAllRefs() })

    expect(events).toEqual(['cancel:true'])
  })

  it('leaves engines without the advertisement on their local stop path (Flow/API shape)', () => {
    const events = []
    // Flow engine shape: setStopRequested exists but cancelsActiveOnStop is NOT advertised —
    // its stop is renderer-local and must not be invoked from the reference Stop.
    const flowGenAPI = {
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      setStopRequested: vi.fn((value) => { events.push(`flow-cancel:${value}`) }),
    }
    const flow = renderRefHook(flowGenAPI)
    act(() => { flow.result.current.stopGenerateAllRefs() })
    expect(events).toEqual([])

    // Positive control in the same observation frame: the advertising engine DOES record
    // the cancellation through the identical harness, so the empty log above is meaningful.
    const chatgptGenAPI = {
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      cancelsActiveOnStop: true,
      setStopRequested: vi.fn((value) => {
        events.push(`chatgpt-cancel:${value}`)
        return Promise.resolve({ success: true })
      }),
    }
    const chatgpt = renderRefHook(chatgptGenAPI)
    act(() => { chatgpt.result.current.stopGenerateAllRefs() })
    expect(events).toEqual(['chatgpt-cancel:true'])
  })

  it('does not reject unhandled when the cancellation IPC fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const genAPI = {
        getAccessToken: vi.fn().mockResolvedValue('token'),
        clearTokenCache: vi.fn(),
        cancelsActiveOnStop: true,
        setStopRequested: vi.fn(() => Promise.reject(new Error('ipc-down'))),
      }
      const { result } = renderRefHook(genAPI)

      await act(async () => {
        result.current.stopGenerateAllRefs()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(genAPI.setStopRequested).toHaveBeenCalledWith(true)
      expect(warn.mock.calls.map((call) => call[0])).toContain(
        '[GenerateRef] active generation cancellation failed:',
      )
    } finally {
      warn.mockRestore()
    }
  })
})
