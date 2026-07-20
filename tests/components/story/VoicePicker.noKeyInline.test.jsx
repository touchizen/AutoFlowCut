import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
const mockTtsSaveKey = vi.fn()
vi.mock('../../../src/hooks/useApiKey', () => ({ useApiKey: () => ({ hasKey: false, encryptionAvailable: true, loading: false, validateKey: vi.fn(), saveKey: vi.fn(), clearKey: vi.fn() }) }))
vi.mock('../../../src/hooks/useTtsKeys', () => ({ useTtsKeys: (p) => ({ hasKey: false, encryptionAvailable: true, loading: false, saveKey: (...args) => mockTtsSaveKey(...args), clearKey: vi.fn(), provider: p }) }))
import VoicePicker from '../../../src/components/story/VoicePicker.jsx'

const t = (k, d) => (typeof d === 'string' ? d : k)
const voices = [
  { provider: 'gemini', id: 'Kore', name: 'Kore', gender: 'female', genderSource: 'adapter', language: 'multi', traits: ['firm'] },
  { provider: 'typecast', id: 'v1', name: 'Sanghyun', gender: null, genderSource: null, language: 'ko', traits: [] },
]

describe('VoicePicker attempt-first no-key inline card', () => {
  it('shows an inline key field under the voice whose preview failed with error=no-key', () => {
    const previewState = { status: 'error', error: 'no-key', provider: 'gemini', voiceId: 'Kore' }
    render(
      <VoicePicker
        voices={voices}
        selected={{}}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onOverrideGender={vi.fn()}
        previewState={previewState}
        t={t}
        isKo
      />,
    )
    expect(screen.getByText('Google Gemini')).toBeInTheDocument()
  })

  it('does not show the inline key field for a voice from a different provider', () => {
    const previewState = { status: 'error', error: 'no-key', provider: 'gemini', voiceId: 'Kore' }
    const { container } = render(
      <VoicePicker
        voices={voices}
        selected={{}}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onOverrideGender={vi.fn()}
        previewState={previewState}
        t={t}
        isKo
      />,
    )
    // Only one inline key-gate field label should render (Gemini's), scoped by ApiKeyField's
    // own "setting-label" element — the "Typecast" chip text also matches getByText, so this
    // checks the ApiKeyField-specific label instead of any "Typecast" substring in the DOM.
    const gateLabels = [...container.querySelectorAll('.setting-label')].map((el) => el.textContent)
    expect(gateLabels).toEqual(['Google Gemini'])
  })

  it('does not show the inline key field when status is not error or error is not no-key', () => {
    const previewState = { status: 'error', error: 'unauthorized', provider: 'gemini', voiceId: 'Kore' }
    render(
      <VoicePicker
        voices={voices}
        selected={{}}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onOverrideGender={vi.fn()}
        previewState={previewState}
        t={t}
        isKo
      />,
    )
    expect(screen.queryByText('Google Gemini')).not.toBeInTheDocument()
  })

  it('the voice list itself still renders without a key (keyless list stays)', () => {
    render(
      <VoicePicker
        voices={voices}
        selected={{}}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onOverrideGender={vi.fn()}
        previewState={{ status: 'idle' }}
        t={t}
        isKo
      />,
    )
    expect(screen.getByText('Kore')).toBeInTheDocument()
    expect(screen.getByText('Sanghyun')).toBeInTheDocument()
  })

  it('finding4: saving the key inline re-attempts the preview for that same voice (dismisses the card on success)', async () => {
    mockTtsSaveKey.mockResolvedValue({ success: true })
    const onPreview = vi.fn()
    // typecast voice (v1) uses TtsApiKeyField — no validate step, matches useTtsKeys mock above.
    const previewState = { status: 'error', error: 'no-key', provider: 'typecast', voiceId: 'v1' }
    render(
      <VoicePicker
        voices={voices}
        selected={{}}
        onSelect={vi.fn()}
        onPreview={onPreview}
        onOverrideGender={vi.fn()}
        previewState={previewState}
        t={t}
        isKo
      />,
    )
    const input = document.querySelector('.audio-key-gate input[type="password"]')
    fireEvent.change(input, { target: { value: 'sk-abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.ttsKeySave' }))

    await new Promise((r) => setTimeout(r, 0)) // flush onSave's await saveKey()
    expect(onPreview).toHaveBeenCalledWith({ provider: 'typecast', voiceId: 'v1', language: 'ko', genderSource: null, name: 'Sanghyun' })
  })
})
