import { it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFlowAdoptPrompt, ADOPT_POLL_MS } from '../../src/hooks/useFlowAdoptPrompt.js'

afterEach(() => vi.useRealTimers())

it('flow+chatgpt never polls Flow project adoption', async () => {
  vi.useFakeTimers()
  const tryAdopt = vi.fn()
  renderHook(() => useFlowAdoptPrompt({
    mode: 'flow', sessionTarget: 'chatgpt', flowProjectReady: false,
    projectLoading: false, projectName: 'p', tryAdopt,
  }))
  await act(() => vi.advanceTimersByTimeAsync(ADOPT_POLL_MS * 3))
  expect(tryAdopt).not.toHaveBeenCalled()
})
