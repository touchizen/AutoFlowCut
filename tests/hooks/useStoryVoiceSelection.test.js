import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStoryVoiceSelection } from '../../src/hooks/useStoryVoiceSelection.js'

const VOICES = [
  { provider: 'typecast', id: 'v1', name: 'Voice1' },
  { provider: 'gemini', id: 'g1', name: 'GVoice1' },
  { provider: 'elevenlabs', id: 'e1', name: 'EVoice1' },
]

describe('useStoryVoiceSelection', () => {
  it('openVoicePicker initializes pickerSelection from the speaker current voice', () => {
    const sp = { id: 's1', name: 'Alice', voice: { provider: 'gemini', voiceId: 'g1' } }
    const { result } = renderHook(() =>
      useStoryVoiceSelection({ speakers: [sp], voices: VOICES, onTagGender: vi.fn() })
    )

    act(() => result.current.openVoicePicker(sp))

    expect(result.current.voicePickerSpeaker).toBe('s1')
    expect(result.current.pickerSelection).toEqual({ provider: 'gemini', voiceId: 'g1' })
  })

  it('confirmVoice commits pickerSelection to the open speaker and closes the picker', () => {
    const sp = { id: 's1', name: 'Alice', voice: { provider: 'gemini', voiceId: 'g1' } }
    const { result } = renderHook(() =>
      useStoryVoiceSelection({ speakers: [sp], voices: VOICES, onTagGender: vi.fn() })
    )

    act(() => result.current.openVoicePicker(sp))
    act(() => result.current.setPickerSelection({ provider: 'elevenlabs', voiceId: 'e1' }))
    act(() => result.current.confirmVoice())

    expect(result.current.voicePickerSpeaker).toBeNull()
    expect(result.current.providerForSpeaker(sp)).toBe('elevenlabs')
    expect(result.current.voiceIdForSpeaker(sp)).toBe('e1')
  })

  it('closeVoicePicker cancels without committing the pending selection', () => {
    const sp = { id: 's1', name: 'Alice', voice: { provider: 'gemini', voiceId: 'g1' } }
    const { result } = renderHook(() =>
      useStoryVoiceSelection({ speakers: [sp], voices: VOICES, onTagGender: vi.fn() })
    )

    act(() => result.current.openVoicePicker(sp))
    act(() => result.current.setPickerSelection({ provider: 'elevenlabs', voiceId: 'e1' }))
    act(() => result.current.closeVoicePicker())

    expect(result.current.voicePickerSpeaker).toBeNull()
    // Unchanged — cancel must not touch the committed provider/voice mapping.
    expect(result.current.providerForSpeaker(sp)).toBe('gemini')
    expect(result.current.voiceIdForSpeaker(sp)).toBe('g1')
  })

  it('handleOverrideGender reports the override to onTagGender with source manual', () => {
    const onTagGender = vi.fn()
    const { result } = renderHook(() =>
      useStoryVoiceSelection({ speakers: [], voices: VOICES, onTagGender })
    )

    act(() => result.current.handleOverrideGender({ provider: 'typecast', voiceId: 'v1', gender: 'male' }))

    expect(onTagGender).toHaveBeenCalledWith({ provider: 'typecast', voiceId: 'v1', gender: 'male', source: 'manual' })
  })

  it('voiceIdForSpeaker falls back to sp.voice when there is no local override', () => {
    const sp = { id: 's2', name: 'Bob', voice: { provider: 'typecast', voiceId: 't1' } }
    const { result } = renderHook(() =>
      useStoryVoiceSelection({ speakers: [sp], voices: VOICES, onTagGender: vi.fn() })
    )

    expect(result.current.providerForSpeaker(sp)).toBe('typecast')
    expect(result.current.voiceIdForSpeaker(sp)).toBe('t1')
  })
})
