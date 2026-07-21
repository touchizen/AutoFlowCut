import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * TtsApiKeyField (wrapper) — restores the old TtsKeyTab behavior tests dropped during
 * M3a consolidation (save→clear input, clearKey failure surfacing).
 */
const { toast, saveKey, clearKey } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  saveKey: vi.fn(), clearKey: vi.fn(),
}))
vi.mock('../../../src/components/Toast', () => ({ toast }))
vi.mock('../../../src/hooks/useTtsKeys', () => ({
  useTtsKeys: () => ({
    hasKey: true, encryptionAvailable: true, loading: false, saveKey, clearKey,
  }),
}))

import TtsApiKeyField from '../../../src/components/settings/TtsApiKeyField'

const t = (k, vars) => (vars ? `${k}:${JSON.stringify(vars)}` : k)

describe('TtsApiKeyField (wrapper)', () => {
  beforeEach(() => {
    saveKey.mockReset()
    clearKey.mockReset()
    toast.success.mockReset()
    toast.error.mockReset()
  })

  it('save → saveKey called then input cleared', async () => {
    saveKey.mockResolvedValue({ success: true })
    render(<TtsApiKeyField provider="elevenlabs" label="ElevenLabs" getKeyUrl="https://x" t={t} />)
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"ElevenLabs"}')
    fireEvent.change(input, { target: { value: 'sk-abc' } })
    fireEvent.click(screen.getByText('settings.ttsKeySave'))
    await vi.waitFor(() => expect(saveKey).toHaveBeenCalledWith('sk-abc'))
    await vi.waitFor(() => expect(input.value).toBe(''))
    expect(toast.success).toHaveBeenCalled()
  })

  it('empty input → saveKey NOT called', () => {
    render(<TtsApiKeyField provider="elevenlabs" label="ElevenLabs" getKeyUrl="https://x" t={t} />)
    fireEvent.click(screen.getByText('settings.ttsKeySave'))
    expect(saveKey).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('settings.ttsKeyEmpty')
  })

  it('clearKey failure → error toast (not the unconditional success toast)', async () => {
    clearKey.mockResolvedValue({ success: false, error: 'locked' })
    render(<TtsApiKeyField provider="elevenlabs" label="ElevenLabs" getKeyUrl="https://x" t={t} />)
    fireEvent.click(screen.getByText('settings.ttsKeyRemove'))
    await vi.waitFor(() => expect(clearKey).toHaveBeenCalled())
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
  })
})
