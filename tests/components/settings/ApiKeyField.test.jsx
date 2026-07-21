import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ApiKeyField from '../../../src/components/settings/ApiKeyField'

const t = (k, vars) => (vars ? `${k}:${JSON.stringify(vars)}` : k)

describe('ApiKeyField (presentational)', () => {
  const base = {
    label: 'Typecast', hasKey: false,
    loading: false, encryptionAvailable: true, busy: false, keyInput: '',
    onKeyInput: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(), getKeyUrl: 'https://x', t,
  }

  it('shows the provider label and a password input', () => {
    render(<ApiKeyField {...base} />)
    expect(screen.getByText('Typecast')).toBeTruthy()
    expect(screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"Typecast"}')).toBeTruthy()
  })

  it('interpolates the provider label into the shared placeholder/getKey copy', () => {
    render(<ApiKeyField {...base} label="ElevenLabs" />)
    expect(screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"ElevenLabs"}')).toBeTruthy()
    expect(screen.getByText('settings.ttsKeyGetKey:{"label":"ElevenLabs"}')).toBeTruthy()
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
    expect(screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"Typecast"}').disabled).toBe(true)
  })

  it('renders an optional secondary password input through the shared field shell', () => {
    const onChange = vi.fn()
    render(
      <ApiKeyField
        {...base}
        label="Higgsfield"
        secondaryInput={{
          label: 'Secret',
          value: 'current-secret',
          onChange,
          placeholder: 'Paste secret',
          ariaLabel: 'Higgsfield secret',
        }}
      />,
    )

    const secondary = screen.getByLabelText('Higgsfield secret')
    expect(screen.getByText('Secret')).toBeTruthy()
    expect(secondary.getAttribute('type')).toBe('password')
    expect(secondary.value).toBe('current-secret')
    expect(secondary.getAttribute('placeholder')).toBe('Paste secret')

    fireEvent.change(secondary, { target: { value: 'next-secret' } })
    expect(onChange).toHaveBeenCalledWith('next-secret')
  })

  it('disables the optional secondary input with the primary input', () => {
    render(
      <ApiKeyField
        {...base}
        encryptionAvailable={false}
        secondaryInput={{
          value: '',
          onChange: vi.fn(),
          placeholder: 'Paste secret',
          ariaLabel: 'Higgsfield secret',
        }}
      />,
    )

    expect(screen.getByLabelText('Higgsfield secret')).toBeDisabled()
  })
})
