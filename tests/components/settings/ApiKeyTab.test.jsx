import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

const {
  toast,
  validateKey,
  saveKeyGenai,
  clearKeyGenai,
  saveKeyTts,
  clearKeyTts,
  apiKeyState,
} = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  validateKey: vi.fn(),
  saveKeyGenai: vi.fn(),
  clearKeyGenai: vi.fn(),
  saveKeyTts: vi.fn(),
  clearKeyTts: vi.fn(),
  apiKeyState: {
    hasKey: false,
    byProvider: {
      google: false,
      openai: false,
      grok: false,
      fal: false,
      wavespeed: false,
      higgsfield: false,
    },
  },
}))

vi.mock('../../../src/components/Toast', () => ({ toast }))
vi.mock('../../../src/hooks/useApiKey', () => ({
  useApiKey: () => ({
    hasKey: apiKeyState.hasKey,
    byProvider: apiKeyState.byProvider,
    encryptionAvailable: true,
    loading: false,
    validateKey,
    saveKey: saveKeyGenai,
    clearKey: clearKeyGenai,
  }),
}))
vi.mock('../../../src/hooks/useTtsKeys', () => ({
  useTtsKeys: (provider) => ({
    hasKey: false,
    encryptionAvailable: true,
    loading: false,
    saveKey: (key) => saveKeyTts(provider, key),
    clearKey: () => clearKeyTts(provider),
  }),
}))

import ApiKeyTab, { GENERATION_API_KEY_PROVIDERS } from '../../../src/components/settings/ApiKeyTab'
import en from '../../../src/locales/en'
import ko from '../../../src/locales/ko'

const t = (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key)

const SINGLE_KEY_PROVIDER_CASES = [
  { id: 'openai', label: 'OpenAI', key: 'sk-openai', validates: true },
  { id: 'grok', label: 'Grok (xAI)', key: 'xai-grok', validates: true },
  { id: 'fal', label: 'fal.ai', key: 'fal-key', validates: false },
  { id: 'wavespeed', label: 'WaveSpeed', key: 'wavespeed-key', validates: true },
]

const EMPTY_GENERATION_STATUS = {
  google: false,
  openai: false,
  grok: false,
  fal: false,
  wavespeed: false,
  higgsfield: false,
}

const TTS_SAVE_CASES = [
  { id: 'typecast', label: 'Typecast', key: 'tc-sk-abc' },
  { id: 'elevenlabs', label: 'ElevenLabs', key: 'el-sk-abc' },
  { id: 'googletts', label: 'Google Cloud TTS', key: 'gcp-key-json' },
]

function saveButtonFor(input) {
  return input.closest('.setting-row').querySelector('button.btn-primary')
}

describe('ApiKeyTab (consolidated list)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiKeyState.hasKey = false
    apiKeyState.byProvider = { ...EMPTY_GENERATION_STATUS }
    validateKey.mockResolvedValue({ valid: true })
    saveKeyGenai.mockResolvedValue({ success: true })
    clearKeyGenai.mockResolvedValue({ success: true })
    saveKeyTts.mockResolvedValue({ success: true })
    clearKeyTts.mockResolvedValue({ success: true })
  })

  it('organizes generation and voice keys under localized category headings', () => {
    render(<ApiKeyTab t={t} />)

    expect(screen.getByRole('heading', { name: 'settings.apiKeyGenerationSectionTitle' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'settings.apiKeyVoiceSectionTitle' })).toBeTruthy()
    expect(en.settings.apiKeyGenerationSectionTitle).toBe('Image & Video')
    expect(en.settings.apiKeyVoiceSectionTitle).toBe('Voice (TTS)')
    expect(ko.settings.apiKeyGenerationSectionTitle).toBe('이미지·비디오 생성')
    expect(ko.settings.apiKeyVoiceSectionTitle).toBe('음성')
  })

  it('uses a provider-neutral security disclosure for the shared generation section', () => {
    render(<ApiKeyTab t={t} />)

    const generationSection = screen
      .getByRole('heading', { name: 'settings.apiKeyGenerationSectionTitle' })
      .closest('.settings-section')
    expect(within(generationSection).getByText('settings.apiKeySecurityNote')).toBeTruthy()
    expect(en.settings.apiKeySecurityNote).toBe(
      'API keys are encrypted with your OS keychain and stored only on this device. Each key is sent only to its own provider, never to us.',
    )
    expect(ko.settings.apiKeySecurityNote).toBe(
      'API 키는 OS 키체인으로 암호화되어 이 기기에만 저장됩니다. 각 키는 해당 제공자에게만 전송되며 운영자에게는 전송되지 않습니다.',
    )
    expect(en.settings.apiKeySecurityNote).not.toContain('only to Google')
    expect(ko.settings.apiKeySecurityNote).not.toContain('Google 로만')
  })

  it('keeps the required generation-provider config complete', () => {
    expect(GENERATION_API_KEY_PROVIDERS.map(({ id }) => id)).toEqual([
      'openai',
      'grok',
      'fal',
      'wavespeed',
      'higgsfield',
    ])
    for (const provider of GENERATION_API_KEY_PROVIDERS) {
      expect(provider).not.toHaveProperty('provisional')
    }
  })

  it('renders Gemini and every configured generation provider (anti-drift)', () => {
    render(<ApiKeyTab t={t} />)

    expect(screen.getByText('Google Gemini')).toBeTruthy()
    for (const provider of GENERATION_API_KEY_PROVIDERS) {
      expect(screen.getByText(provider.label)).toBeTruthy()
    }
  })

  it.each(GENERATION_API_KEY_PROVIDERS)(
    '$id status reads only byProvider.$id',
    ({ id }) => {
      apiKeyState.byProvider = { ...EMPTY_GENERATION_STATUS, [id]: true }
      render(<ApiKeyTab t={t} />)

      for (const provider of GENERATION_API_KEY_PROVIDERS) {
        const row = screen.getByText(provider.label).closest('.setting-row')
        const expectedStatus = provider.id === id ? 'settings.apiKeySet' : 'settings.apiKeyNotSet'
        expect(within(row).getByText(expectedStatus)).toBeTruthy()
      }
    },
  )

  it('lists all registry-driven non-genai TTS providers', () => {
    render(<ApiKeyTab t={t} />)

    expect(screen.getByText('Typecast')).toBeTruthy()
    expect(screen.getByText('ElevenLabs')).toBeTruthy()
    expect(screen.getByText('Google Cloud TTS')).toBeTruthy()
  })

  it('preserves the ElevenLabs and Google Cloud TTS notes', () => {
    render(<ApiKeyTab t={t} />)

    expect(screen.getByText('settings.elevenlabsVoicesReadHint')).toBeTruthy()
    expect(screen.getByText('settings.googlettsStoryUnavailable')).toBeTruthy()
  })

  it.each(SINGLE_KEY_PROVIDER_CASES)(
    'saving $id routes through useApiKey with provider $id',
    async ({ id, label, key, validates }) => {
      const onKeySaved = vi.fn()
      render(<ApiKeyTab t={t} onKeySaved={onKeySaved} />)
      const input = screen.getByPlaceholderText(`settings.ttsKeyPlaceholder:{"label":"${label}"}`)

      fireEvent.change(input, { target: { value: key } })
      fireEvent.click(saveButtonFor(input))

      await vi.waitFor(() => expect(saveKeyGenai).toHaveBeenCalledWith(key, id))
      if (validates) {
        expect(validateKey).toHaveBeenCalledWith(key, id)
      } else {
        expect(validateKey).not.toHaveBeenCalled()
      }
      expect(onKeySaved).not.toHaveBeenCalled()
    },
  )

  it.each(GENERATION_API_KEY_PROVIDERS.filter(({ validateOnSave }) => validateOnSave === false))(
    'every validateOnSave:false provider structurally renders the unverified save toast without an override ($id)',
    async (provider) => {
      expect(provider).not.toHaveProperty('savedToastKey')

      render(<ApiKeyTab t={t} />)
      const input = screen.getByPlaceholderText(`settings.ttsKeyPlaceholder:{"label":"${provider.label}"}`)
      const key = `${provider.id}-key`
      let candidate = key

      fireEvent.change(input, { target: { value: key } })
      if (provider.credentialType === 'key-secret') {
        const secretInput = screen.getByPlaceholderText('settings.higgsfieldSecretPlaceholder')
        fireEvent.change(secretInput, { target: { value: `${provider.id}-secret` } })
        candidate = `${key}:${provider.id}-secret`
      }
      fireEvent.click(saveButtonFor(input))

      await vi.waitFor(() => expect(saveKeyGenai).toHaveBeenCalledWith(candidate, provider.id))
      expect(validateKey).not.toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('settings.apiKeySavedUnverified')
      expect(toast.success).not.toHaveBeenCalledWith('settings.apiKeySaved')
    },
  )

  it('fal saves without no-op validation', async () => {
    render(<ApiKeyTab t={t} />)
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"fal.ai"}')

    fireEvent.change(input, { target: { value: 'fal-secret' } })
    fireEvent.click(saveButtonFor(input))

    await vi.waitFor(() => expect(saveKeyGenai).toHaveBeenCalledWith('fal-secret', 'fal'))
    expect(validateKey).not.toHaveBeenCalled()
  })

  it('combines Higgsfield key and secret as key:secret for validation and storage', async () => {
    const onKeySaved = vi.fn()
    render(<ApiKeyTab t={t} onKeySaved={onKeySaved} />)
    const keyInput = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"Higgsfield"}')
    const secretInput = screen.getByPlaceholderText('settings.higgsfieldSecretPlaceholder')

    fireEvent.change(keyInput, { target: { value: '  hf-key  ' } })
    fireEvent.change(secretInput, { target: { value: '  hf-secret  ' } })
    fireEvent.click(saveButtonFor(keyInput))

    await vi.waitFor(() => expect(validateKey).toHaveBeenCalledWith('hf-key:hf-secret', 'higgsfield'))
    await vi.waitFor(() => expect(saveKeyGenai).toHaveBeenCalledWith('hf-key:hf-secret', 'higgsfield'))
    await vi.waitFor(() => expect(keyInput.value).toBe(''))
    expect(secretInput.value).toBe('')
    expect(onKeySaved).not.toHaveBeenCalled()
  })
})

describe('ApiKeyTab — onKeySaved voice reload wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiKeyState.hasKey = false
    apiKeyState.byProvider = { ...EMPTY_GENERATION_STATUS }
    validateKey.mockResolvedValue({ valid: true })
    saveKeyGenai.mockResolvedValue({ success: true })
    saveKeyTts.mockResolvedValue({ success: true })
  })

  it('saving the Gemini key calls onKeySaved("gemini")', async () => {
    const onKeySaved = vi.fn()
    render(<ApiKeyTab t={t} onKeySaved={onKeySaved} />)
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"Google Gemini"}')

    fireEvent.change(input, { target: { value: 'AIzaGOOD' } })
    fireEvent.click(saveButtonFor(input))

    await vi.waitFor(() => expect(saveKeyGenai).toHaveBeenCalledWith('AIzaGOOD'))
    await vi.waitFor(() => expect(onKeySaved).toHaveBeenCalledWith('gemini'))
  })

  it.each(TTS_SAVE_CASES)('saving $id calls onKeySaved("$id")', async ({ id, label, key }) => {
    const onKeySaved = vi.fn()
    render(<ApiKeyTab t={t} onKeySaved={onKeySaved} />)
    const input = screen.getByPlaceholderText(`settings.ttsKeyPlaceholder:{"label":"${label}"}`)

    fireEvent.change(input, { target: { value: key } })
    fireEvent.click(saveButtonFor(input))

    await vi.waitFor(() => expect(saveKeyTts).toHaveBeenCalledWith(id, key))
    await vi.waitFor(() => expect(onKeySaved).toHaveBeenCalledWith(id))
    expect(onKeySaved).not.toHaveBeenCalledWith('gemini')
  })

  it('saving without onKeySaved remains safe', async () => {
    render(<ApiKeyTab t={t} />)
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"ElevenLabs"}')

    fireEvent.change(input, { target: { value: 'el-sk-abc' } })
    fireEvent.click(saveButtonFor(input))

    await vi.waitFor(() => expect(saveKeyTts).toHaveBeenCalledWith('elevenlabs', 'el-sk-abc'))
  })
})
