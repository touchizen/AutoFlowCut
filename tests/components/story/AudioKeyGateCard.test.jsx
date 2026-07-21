import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('../../../src/hooks/useApiKey', () => ({ useApiKey: () => ({ hasKey: false, encryptionAvailable: true, loading: false, validateKey: vi.fn(), saveKey: vi.fn(), clearKey: vi.fn() }) }))
vi.mock('../../../src/hooks/useTtsKeys', () => ({ useTtsKeys: (p) => ({ hasKey: false, encryptionAvailable: true, loading: false, saveKey: vi.fn(), clearKey: vi.fn(), provider: p }) }))
import AudioKeyGateCard from '../../../src/components/story/AudioKeyGateCard'
const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k)

describe('AudioKeyGateCard', () => {
  it('renders a field per missing provider (gemini→Google Gemini label, typecast→Typecast)', () => {
    render(<AudioKeyGateCard missing={[{ provider: 'gemini', keyId: 'genai' }, { provider: 'typecast', keyId: 'typecast' }]} t={t} />)
    expect(screen.getByText('Google Gemini')).toBeTruthy()
    expect(screen.getByText('Typecast')).toBeTruthy()
  })
  it('renders nothing meaningful when missing is empty', () => {
    const { container } = render(<AudioKeyGateCard missing={[]} t={t} />)
    expect(container.querySelector('input')).toBeNull()
  })
})
