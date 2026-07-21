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

  // Finding3(2R 리뷰): 이전엔 onKeySaved가 preview 재시도만 하고 그 provider의 계정 목소리를
  // 다시 안 긁었다 — 키를 막 저장한 계정 전용(키 게이트된) 목소리가 이번 렌더의 voices 목록에는
  // 없으므로, 재조회를 안 하면 그 목소리들이 화면에 영영 안 나타난다. onReloadVoices(provider)와
  // preview 재시도를 둘 다 해야 한다.
  it('finding3: saving the key inline also reloads that provider account voices (onReloadVoices), then re-attempts preview', async () => {
    mockTtsSaveKey.mockResolvedValue({ success: true })
    const onPreview = vi.fn()
    const onReloadVoices = vi.fn(async () => {})
    const previewState = { status: 'error', error: 'no-key', provider: 'typecast', voiceId: 'v1' }
    render(
      <VoicePicker
        voices={voices}
        selected={{}}
        onSelect={vi.fn()}
        onPreview={onPreview}
        onOverrideGender={vi.fn()}
        onReloadVoices={onReloadVoices}
        previewState={previewState}
        t={t}
        isKo
      />,
    )
    const input = document.querySelector('.audio-key-gate input[type="password"]')
    fireEvent.change(input, { target: { value: 'sk-abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.ttsKeySave' }))

    await new Promise((r) => setTimeout(r, 0)) // flush onSave's await saveKey()
    expect(onReloadVoices).toHaveBeenCalledWith('typecast')
    expect(onPreview).toHaveBeenCalledWith({ provider: 'typecast', voiceId: 'v1', language: 'ko', genderSource: null, name: 'Sanghyun' })
  })

  it('finding3: missing onReloadVoices prop does not break the preview re-attempt (best-effort)', async () => {
    mockTtsSaveKey.mockResolvedValue({ success: true })
    const onPreview = vi.fn()
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

    await new Promise((r) => setTimeout(r, 0))
    expect(onPreview).toHaveBeenCalledWith({ provider: 'typecast', voiceId: 'v1', language: 'ko', genderSource: null, name: 'Sanghyun' })
  })
})
