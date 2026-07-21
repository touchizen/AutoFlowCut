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

  it('validates and saves with the configured provider id', async () => {
    renderField()
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"OpenAI"}')

    fireEvent.change(input, { target: { value: '  sk-openai  ' } })
    fireEvent.click(screen.getByText('settings.ttsKeySave'))

    await vi.waitFor(() => expect(validateKey).toHaveBeenCalledWith('sk-openai', 'openai'))
    await vi.waitFor(() => expect(saveKey).toHaveBeenCalledWith('sk-openai', 'openai'))
    await vi.waitFor(() => expect(input.value).toBe(''))
    expect(toast.success).toHaveBeenCalledWith('settings.apiKeySaved')
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

  it('can skip no-op validation and use an explicitly unverified save message', async () => {
    renderField({
      provider: 'fal',
      label: 'fal.ai',
      validateOnSave: false,
      savedToastKey: 'settings.falKeySavedUnverified',
    })
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"fal.ai"}')

    fireEvent.change(input, { target: { value: 'fal-key' } })
    fireEvent.click(screen.getByText('settings.ttsKeySave'))

    await vi.waitFor(() => expect(saveKey).toHaveBeenCalledWith('fal-key', 'fal'))
    expect(validateKey).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('settings.falKeySavedUnverified')
    expect(toast.success).not.toHaveBeenCalledWith('settings.apiKeySaved')
  })

  it('removes only the configured provider key', async () => {
    renderField()

    fireEvent.click(screen.getByText('settings.ttsKeyRemove'))

    await vi.waitFor(() => expect(clearKey).toHaveBeenCalledWith('openai'))
    expect(toast.success).toHaveBeenCalledWith('settings.apiKeyRemoved')
  })
})
