import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * GenaiApiKeyField (wrapper) — restores the old ApiKeyTab behavior tests that were
 * dropped during M3a consolidation (validate-fails/passes gating, save→clear input,
 * clearKey failure surfacing). Mirrors ReferencePanel.syncPatchPreserved.test.jsx's
 * mock-the-hook + mock-Toast setup.
 */
const { toast, validateKey, saveKey, clearKey } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  validateKey: vi.fn(), saveKey: vi.fn(), clearKey: vi.fn(),
}))
vi.mock('../../../src/components/Toast', () => ({ toast }))
vi.mock('../../../src/hooks/useApiKey', () => ({
  useApiKey: () => ({
    hasKey: true, encryptionAvailable: true, loading: false, validateKey, saveKey, clearKey,
  }),
}))

import GenaiApiKeyField from '../../../src/components/settings/GenaiApiKeyField'

const t = (k, vars) => (vars ? `${k}:${JSON.stringify(vars)}` : k)

describe('GenaiApiKeyField (wrapper)', () => {
  beforeEach(() => {
    validateKey.mockReset()
    saveKey.mockReset()
    clearKey.mockReset()
    toast.success.mockReset()
    toast.error.mockReset()
  })

  it('empty input → validateKey NOT called', () => {
    render(<GenaiApiKeyField t={t} />)
    fireEvent.click(screen.getByText('settings.ttsKeySave'))
    expect(validateKey).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('settings.apiKeyEmpty')
  })

  it('invalid key → saveKey NOT called + error toast', async () => {
    validateKey.mockResolvedValue({ valid: false, error: 'bad key' })
    render(<GenaiApiKeyField t={t} />)
    fireEvent.change(screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"Google Gemini"}'), { target: { value: 'AIzaBAD' } })
    fireEvent.click(screen.getByText('settings.ttsKeySave'))
    await screen.findByText('settings.ttsKeySave')
    expect(validateKey).toHaveBeenCalledWith('AIzaBAD')
    expect(saveKey).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })

  it('valid key → saveKey called then input cleared', async () => {
    validateKey.mockResolvedValue({ valid: true })
    saveKey.mockResolvedValue({ success: true })
    render(<GenaiApiKeyField t={t} />)
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"Google Gemini"}')
    fireEvent.change(input, { target: { value: 'AIzaGOOD' } })
    fireEvent.click(screen.getByText('settings.ttsKeySave'))
    await vi.waitFor(() => expect(saveKey).toHaveBeenCalledWith('AIzaGOOD'))
    await vi.waitFor(() => expect(input.value).toBe(''))
    expect(toast.success).toHaveBeenCalled()
  })

  it('clearKey failure → error toast (not the unconditional success toast)', async () => {
    clearKey.mockResolvedValue({ success: false, error: 'locked' })
    render(<GenaiApiKeyField t={t} />)
    fireEvent.click(screen.getByText('settings.ttsKeyRemove'))
    await vi.waitFor(() => expect(clearKey).toHaveBeenCalled())
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
  })
})
