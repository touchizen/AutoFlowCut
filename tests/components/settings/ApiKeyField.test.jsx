import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ApiKeyField from '../../../src/components/settings/ApiKeyField'

const t = (k, vars) => (vars ? `${k}:${JSON.stringify(vars)}` : k)

describe('ApiKeyField (presentational)', () => {
  const base = {
    label: 'Typecast', statusLabel: 'settings.ttsKeyStatusLabel', hasKey: false,
    loading: false, encryptionAvailable: true, busy: false, keyInput: '',
    onKeyInput: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(), getKeyUrl: 'https://x', t,
  }

  it('shows the provider label and a password input', () => {
    render(<ApiKeyField {...base} />)
    expect(screen.getByText('Typecast')).toBeTruthy()
    expect(screen.getByPlaceholderText('settings.ttsKeyPlaceholder')).toBeTruthy()
  })

  it('save button calls onSave; remove shown only when hasKey', () => {
    const onSave = vi.fn()
    const { rerender } = render(<ApiKeyField {...base} onSave={onSave} />)
    fireEvent.click(screen.getByText('settings.ttsKeySave'))
    expect(onSave).toHaveBeenCalled()
    expect(screen.queryByText('settings.ttsKeyRemove')).toBeNull()
    rerender(<ApiKeyField {...base} hasKey={true} />)
    expect(screen.getByText('settings.ttsKeyRemove')).toBeTruthy()
  })

  it('disables input+save when encryption unavailable', () => {
    render(<ApiKeyField {...base} encryptionAvailable={false} />)
    expect(screen.getByPlaceholderText('settings.ttsKeyPlaceholder').disabled).toBe(true)
  })
})
