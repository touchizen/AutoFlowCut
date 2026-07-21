import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVoicePreview } from '../../src/hooks/useVoicePreview.js'

describe('useVoicePreview surfaces error kind + provider', () => {
  beforeEach(() => {
    global.window = global.window || {}
    window.electronAPI = { ttsPreviewVoice: vi.fn().mockResolvedValue({ error: 'no-key', provider: 'gemini' }) }
  })

  it('sets status error with error=no-key and provider', async () => {
    const { result } = renderHook(() => useVoicePreview())
    await act(async () => { await result.current.play({ provider: 'gemini', voiceId: 'Kore', language: 'ko' }) })
    expect(result.current.state.status).toBe('error')
    expect(result.current.state.error).toBe('no-key')
    expect(result.current.state.provider).toBe('gemini')
  })
})
