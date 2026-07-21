import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const { toast, validateKey, saveKey, clearKey } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  validateKey: vi.fn(),
  saveKey: vi.fn(),
  clearKey: vi.fn(),
}))

vi.mock('../../../src/components/Toast', () => ({ toast }))
vi.mock('../../../src/hooks/useApiKey', () => ({
  useApiKey: () => ({
    byProvider: { openai: true, grok: false, fal: false, wavespeed: false },
    encryptionAvailable: true,
    loading: false,
    validateKey,
    saveKey,
    clearKey,
  }),
}))

import GenApiKeyField from '../../../src/components/settings/GenApiKeyField'
import en from '../../../src/locales/en'
import ko from '../../../src/locales/ko'

const t = (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key)

function renderField(props = {}) {
  return render(
    <GenApiKeyField
      provider="openai"
      label="OpenAI"
      getKeyUrl="https://platform.openai.com/api-keys"
      t={t}
      {...props}
    />,
  )
}

describe('GenApiKeyField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validateKey.mockResolvedValue({ valid: true })
    saveKey.mockResolvedValue({ success: true })
    clearKey.mockResolvedValue({ success: true })
  })

  it('validated OpenAI save uses the verified message', async () => {
    renderField()
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"OpenAI"}')

    fireEvent.change(input, { target: { value: '  sk-openai  ' } })
    fireEvent.click(screen.getByText('settings.ttsKeySave'))

    await vi.waitFor(() => expect(validateKey).toHaveBeenCalledWith('sk-openai', 'openai'))
    await vi.waitFor(() => expect(saveKey).toHaveBeenCalledWith('sk-openai', 'openai'))
    await vi.waitFor(() => expect(input.value).toBe(''))
    expect(toast.success).toHaveBeenCalledWith('settings.apiKeySaved')
    expect(toast.success).not.toHaveBeenCalledWith('settings.apiKeySavedUnverified')
    expect(en.settings.apiKeySaved).toBe('API key verified and saved')
    expect(ko.settings.apiKeySaved).toBe('API 키를 확인하고 저장했습니다')
  })

  it('does not save when provider validation fails', async () => {
    validateKey.mockResolvedValue({ valid: false, error: 'bad key' })
    renderField({ provider: 'grok', label: 'Grok (xAI)' })

    fireEvent.change(
      screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"Grok (xAI)"}'),
      { target: { value: 'xai-bad' } },
    )
    fireEvent.click(screen.getByText('settings.ttsKeySave'))

    await vi.waitFor(() => expect(validateKey).toHaveBeenCalledWith('xai-bad', 'grok'))
    expect(saveKey).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('settings.apiKeyInvalid:{"error":"bad key"}')
  })

  it('unvalidated fal save uses the shared unverified message', async () => {
    renderField({
      provider: 'fal',
      label: 'fal.ai',
      validateOnSave: false,
      savedToastKey: 'settings.apiKeySavedUnverified',
    })
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"fal.ai"}')

    fireEvent.change(input, { target: { value: 'fal-key' } })
    fireEvent.click(screen.getByText('settings.ttsKeySave'))

    await vi.waitFor(() => expect(saveKey).toHaveBeenCalledWith('fal-key', 'fal'))
    expect(validateKey).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('settings.apiKeySavedUnverified')
    expect(toast.success).not.toHaveBeenCalledWith('settings.apiKeySaved')
    expect(en.settings).not.toHaveProperty('falKeySavedUnverified')
    expect(ko.settings).not.toHaveProperty('falKeySavedUnverified')
  })

  it('removes only the configured provider key', async () => {
    renderField()

    fireEvent.click(screen.getByText('settings.ttsKeyRemove'))

    await vi.waitFor(() => expect(clearKey).toHaveBeenCalledWith('openai'))
    expect(toast.success).toHaveBeenCalledWith('settings.apiKeyRemoved')
  })
})
