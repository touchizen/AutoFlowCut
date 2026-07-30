import { it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAvailableModels } from '../../src/hooks/useAvailableModels.js'

it('flow+chatgpt does not select or scrape the Flow catalog', async () => {
  const listModels = vi.fn().mockResolvedValue({ success: true, models: [] })
  const previous = window.electronAPI
  window.electronAPI = { listFlowAgentModels: vi.fn() }
  try {
    const { result } = renderHook(() => useAvailableModels({ listModels }, 'flow', 'chatgpt'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.source).toBe('session-target-unavailable')
    expect(result.current.imageModels).toEqual([])
    expect(result.current.videoModels).toEqual([])
    expect(window.electronAPI.listFlowAgentModels).not.toHaveBeenCalled()
    expect(listModels).not.toHaveBeenCalled()
  } finally { window.electronAPI = previous }
})
