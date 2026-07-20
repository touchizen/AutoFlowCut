import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAudioPreflight } from '../../src/hooks/useAudioPreflight'

const pipe = (providers, enc = true) => ({ audioPreflight: vi.fn().mockResolvedValue({ providers, encryptionAvailable: enc }) })

describe('useAudioPreflight', () => {
  it('ok=true when no provider is missing', async () => {
    const { result } = renderHook(() => useAudioPreflight(pipe([
      { provider: 'typecast', keyId: 'typecast', status: 'resolved-store', encryptionAvailable: true },
    ])))
    const r = await result.current.check({})
    expect(r.ok).toBe(true)
    expect(r.missing).toEqual([])
  })
  it('ok=false and lists missing providers', async () => {
    const { result } = renderHook(() => useAudioPreflight(pipe([
      { provider: 'typecast', keyId: 'typecast', status: 'resolved-fallback', encryptionAvailable: true },
      { provider: 'gemini', keyId: 'genai', status: 'missing', encryptionAvailable: true },
    ])))
    const r = await result.current.check({})
    expect(r.ok).toBe(false)
    expect(r.missing.map(m => m.provider)).toEqual(['gemini'])
  })
  it('ok=true on empty required set', async () => {
    const { result } = renderHook(() => useAudioPreflight(pipe([])))
    const r = await result.current.check({})
    expect(r.ok).toBe(true)
  })
})
