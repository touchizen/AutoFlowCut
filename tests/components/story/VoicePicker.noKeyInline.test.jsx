import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('../../../src/hooks/useApiKey', () => ({ useApiKey: () => ({ hasKey: false, encryptionAvailable: true, loading: false, validateKey: vi.fn(), saveKey: vi.fn(), clearKey: vi.fn() }) }))
vi.mock('../../../src/hooks/useTtsKeys', () => ({ useTtsKeys: (p) => ({ hasKey: false, encryptionAvailable: true, loading: false, saveKey: vi.fn(), clearKey: vi.fn(), provider: p }) }))
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
})
