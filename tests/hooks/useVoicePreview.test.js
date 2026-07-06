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

it('play() rejection sets status to error', async () => {
  globalThis.Audio = class {
    play() { return Promise.reject(new Error('playback failed')) }
    pause() {}
    set onended(fn) { this._e = fn }
    get onended() { return this._e }
    set onerror(fn) { this._er = fn }
    get onerror() { return this._er }
  }
  const { result } = renderHook(() => useVoicePreview())
  // adapter genderSource skips the AudioContext decode path, isolating the play()-reject behavior
  await act(async () => { await result.current.play({ provider: 'typecast', voiceId: 'v1', language: 'ko', genderSource: 'adapter' }) })
  await waitFor(() => expect(result.current.state.status).toBe('error'))
})

it('unmount pauses audio, revokes the object URL, and closes the AudioContext', async () => {
  const pauseSpy = vi.fn()
  const closeSpy = vi.fn()
  globalThis.Audio = class {
    play() { return Promise.resolve() }
    pause() { pauseSpy() }
    set onended(fn) { this._e = fn }
    get onended() { return this._e }
    set onerror(fn) { this._er = fn }
    get onerror() { return this._er }
  }
  globalThis.AudioContext = class {
    decodeAudioData() { const ch = new Float32Array(16000); return Promise.resolve({ numberOfChannels: 1, sampleRate: 16000, getChannelData: () => ch }) }
    close() { closeSpy() }
  }
  const revokeSpy = vi.spyOn(URL, 'revokeObjectURL')

  const { result, unmount } = renderHook(() => useVoicePreview())
  await act(async () => { await result.current.play({ provider: 'typecast', voiceId: 'v1', language: 'ko', genderSource: null }) })

  unmount()

  expect(pauseSpy).toHaveBeenCalled()
  expect(closeSpy).toHaveBeenCalled()
  expect(revokeSpy).toHaveBeenCalled()
})

it('does not throw when ttsTagVoiceGender rejects', async () => {
  window.electronAPI.ttsTagVoiceGender = vi.fn(() => Promise.reject(new Error('ipc failed')))
  // Synthetic 100Hz sine (periodic, non-silent) so estimateGenderFromPcm resolves a real gender
  // instead of the all-zero default mock, which is silence and never triggers the tag call.
  const sampleRate = 16000
  const ch = new Float32Array(sampleRate)
  for (let i = 0; i < ch.length; i++) ch[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / sampleRate)
  globalThis.AudioContext = class {
    decodeAudioData() { return Promise.resolve({ numberOfChannels: 1, sampleRate, getChannelData: () => ch }) }
    close() {}
  }
  const { result } = renderHook(() => useVoicePreview())
  await act(async () => { await result.current.play({ provider: 'typecast', voiceId: 'v1', language: 'ko', genderSource: null }) })
  await waitFor(() => expect(result.current.lastGender).toBeTruthy())
  expect(window.electronAPI.ttsTagVoiceGender).toHaveBeenCalled()
})

it('in-flight play does not proceed after unmount (seq invalidation)', async () => {
  // Control when ttsPreviewVoice resolves
  let resolvePreview
  window.electronAPI.ttsPreviewVoice = vi.fn(() => new Promise(resolve => { resolvePreview = resolve }))

  const audioConstructorSpy = vi.fn()
  globalThis.Audio = class {
    constructor(src) { audioConstructorSpy(src) }
    play() { return Promise.resolve() }
    pause() {}
    set onended(fn) { this._e = fn }
    get onended() { return this._e }
    set onerror(fn) { this._er = fn }
    get onerror() { return this._er }
  }

  const { result, unmount } = renderHook(() => useVoicePreview())

  // Start play() but ttsPreviewVoice won't resolve until we call resolvePreview
  act(() => { result.current.play({ provider: 'typecast', voiceId: 'v1', language: 'ko', genderSource: 'adapter' }) })

  // Verify we're in loading state and Audio hasn't been constructed yet
  expect(result.current.state.status).toBe('loading')
  expect(audioConstructorSpy).not.toHaveBeenCalled()

  // Unmount while play() is still awaiting ttsPreviewVoice
  unmount()

  // Record spy call count before resolving post-unmount
  const callCountBeforeResolve = audioConstructorSpy.mock.calls.length

  // Now resolve the promise (after unmount)
  await act(async () => {
    resolvePreview({ audioBase64: btoa('x'), mimeType: 'audio/wav' })
    await Promise.resolve()
  })

  // Assert: Audio constructor should not be called after unmount (seq guard prevents it)
  expect(audioConstructorSpy.mock.calls.length).toBe(callCountBeforeResolve)
})
