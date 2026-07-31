import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DevFlagsProvider,
  useDevFlags,
} from '../../src/contexts/DevFlagsContext.jsx'

const wrapperFor = (electronAPI) => function Wrapper({ children }) {
  return <DevFlagsProvider electronAPI={electronAPI}>{children}</DevFlagsProvider>
}

describe('DevFlagsProvider', () => {
  it('fails closed when main does not expose the flag and enables only from a main positive control', async () => {
    const negative = renderHook(() => useDevFlags(), {
      wrapper: wrapperFor({ getDevFlags: vi.fn(async () => ({})) }),
    })
    expect(negative.result.current.chatgptTargetCombo).toBe(false)
    await waitFor(() => expect(negative.result.current.resolved).toBe(true))
    expect(negative.result.current.chatgptTargetCombo).toBe(false)
    negative.unmount()

    const positive = renderHook(() => useDevFlags(), {
      wrapper: wrapperFor({
        getDevFlags: vi.fn(async () => ({ chatgptTargetCombo: true })),
      }),
    })
    await waitFor(() => expect(positive.result.current.chatgptTargetCombo).toBe(true))
    expect(positive.result.current.resolved).toBe(true)
  })
})
