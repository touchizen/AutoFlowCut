import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// hooks가 IPC(window.electronAPI)를 부르므로 mock — 존재 여부만 렌더 확인.
vi.mock('../../../src/hooks/useApiKey', () => ({ useApiKey: () => ({ hasKey: true, encryptionAvailable: true, loading: false, validateKey: vi.fn(), saveKey: vi.fn(), clearKey: vi.fn() }) }))
vi.mock('../../../src/hooks/useTtsKeys', () => ({ useTtsKeys: (p) => ({ hasKey: false, encryptionAvailable: true, loading: false, saveKey: vi.fn(), clearKey: vi.fn(), provider: p }) }))

import ApiKeyTab from '../../../src/components/settings/ApiKeyTab'
const t = (k) => k

describe('ApiKeyTab (consolidated list)', () => {
  it('lists Gemini + all three TTS providers', () => {
    render(<ApiKeyTab t={t} />)
    expect(screen.getByText('Google Gemini')).toBeTruthy()
    expect(screen.getByText('Typecast')).toBeTruthy()
    expect(screen.getByText('ElevenLabs')).toBeTruthy()
    expect(screen.getByText('Google Cloud TTS')).toBeTruthy()
  })

  it('flags Google Cloud TTS as unavailable for Story audio', () => {
    render(<ApiKeyTab t={t} />)
    expect(screen.getByText('settings.googlettsStoryUnavailable')).toBeTruthy()
  })
})
