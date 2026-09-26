import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sharedFieldProps, toast, apiKeyState, validateKey, saveKey, clearKey } = vi.hoisted(() => ({
  sharedFieldProps: { current: null },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  apiKeyState: { byProvider: { higgsfield: false } },
  validateKey: vi.fn(),
  saveKey: vi.fn(),
  clearKey: vi.fn(),
}))

vi.mock('../../../src/components/Toast', () => ({ toast }))
vi.mock('../../../src/hooks/useApiKey', () => ({
  useApiKey: () => ({
    byProvider: apiKeyState.byProvider,
    encryptionAvailable: true,
    loading: false,
    validateKey,
    saveKey,
    clearKey,
  }),
}))
vi.mock('../../../src/components/settings/ApiKeyField', () => ({
  default: (props) => {
    sharedFieldProps.current = props
    return <button data-testid="shared-api-key-field" onClick={props.onSave}>Save shared field</button>
  },
}))

import HiggsfieldApiKeyField from '../../../src/components/settings/HiggsfieldApiKeyField'

const t = (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key)

describe('HiggsfieldApiKeyField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sharedFieldProps.current = null
    apiKeyState.byProvider = { higgsfield: false }
    validateKey.mockResolvedValue({ valid: true })
    saveKey.mockResolvedValue({ success: true })
    clearKey.mockResolvedValue({ success: true })
  })

  it('composes its key and secret through ApiKeyField.secondaryInput', async () => {
    render(
      <HiggsfieldApiKeyField
        provider="higgsfield"
        label="Higgsfield"
        getKeyUrl="https://platform.higgsfield.ai/"
        extraNote="note"
        t={t}
      />,
    )

    expect(screen.getByTestId('shared-api-key-field')).toBeTruthy()
    expect(sharedFieldProps.current.secondaryInput).toMatchObject({
      label: 'settings.higgsfieldSecretInputLabel',
      placeholder: 'settings.higgsfieldSecretPlaceholder',
      ariaLabel: 'settings.higgsfieldSecretInputLabel',
    })

    act(() => sharedFieldProps.current.onKeyInput('  hf-key  '))
    act(() => sharedFieldProps.current.secondaryInput.onChange('  hf-secret  '))
    fireEvent.click(screen.getByTestId('shared-api-key-field'))

    await vi.waitFor(() => expect(validateKey).toHaveBeenCalledWith('hf-key:hf-secret', 'higgsfield'))
    await vi.waitFor(() => expect(saveKey).toHaveBeenCalledWith('hf-key:hf-secret', 'higgsfield'))
    await vi.waitFor(() => expect(sharedFieldProps.current.keyInput).toBe(''))
    expect(sharedFieldProps.current.secondaryInput.value).toBe('')
  })

  it('validateOnSave=false uses the unverified save toast', async () => {
    render(
      <HiggsfieldApiKeyField
        provider="higgsfield"
        label="Higgsfield"
        getKeyUrl="https://platform.higgsfield.ai/"
        validateOnSave={false}
        t={t}
      />,
    )

    act(() => sharedFieldProps.current.onKeyInput('hf-key'))
    act(() => sharedFieldProps.current.secondaryInput.onChange('hf-secret'))
    fireEvent.click(screen.getByTestId('shared-api-key-field'))

    await vi.waitFor(() => expect(saveKey).toHaveBeenCalledWith('hf-key:hf-secret', 'higgsfield'))
    expect(validateKey).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('settings.apiKeySavedUnverified')
    expect(toast.success).not.toHaveBeenCalledWith('settings.apiKeySaved')
  })
})
