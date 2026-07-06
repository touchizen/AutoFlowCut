import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useVoicePreview } from '../../src/hooks/useVoicePreview.js'

beforeEach(() => {
  globalThis.window = globalThis.window || {}
  window.electronAPI = { ttsPreviewVoice: vi.fn(async () => ({ audioBase64: btoa('x'), mimeType: 'audio/wav' })), ttsTagVoiceGender: vi.fn() }
  globalThis.Audio = class { play() { return Promise.resolve() } pause() {} set onended(fn) { this._e = fn } get onended() { return this._e } }
  globalThis.AudioContext = class { decodeAudioData() { const ch = new Float32Array(16000); return Promise.resolve({ numberOfChannels: 1, sampleRate: 16000, getChannelData: () => ch }) } close() {} }
})

it('play sets loading then playing', async () => {
  const { result } = renderHook(() => useVoicePreview())
  await act(async () => { result.current.play({ provider: 'typecast', voiceId: 'v1', language: 'ko', genderSource: null }) })
  await waitFor(() => expect(['playing', 'idle']).toContain(result.current.state.status))
  expect(window.electronAPI.ttsPreviewVoice).toHaveBeenCalled()
})
