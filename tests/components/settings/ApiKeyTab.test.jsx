import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * §4.7 R3: settings-tab key save must trigger an App-level voice reload for the saved
 * provider ("all save wrappers share an App-level reload"). ApiKeyTab is the point where
 * every wrapper (GenaiApiKeyField + each TtsApiKeyField row) converges, so this is where the
 * wrapper→tab→modal contract (onSaved → onKeySaved(provider)) is verified end to end.
 */
const { validateKey, saveKeyGenai, saveKeyTts } = vi.hoisted(() => ({
  validateKey: vi.fn(async () => ({ valid: true })),
  saveKeyGenai: vi.fn(async () => ({ success: true })),
  saveKeyTts: vi.fn(async () => ({ success: true })),
}))
// hooks가 IPC(window.electronAPI)를 부르므로 mock — 존재 여부만 렌더 확인.
vi.mock('../../../src/hooks/useApiKey', () => ({
  useApiKey: () => ({ hasKey: true, encryptionAvailable: true, loading: false, validateKey, saveKey: saveKeyGenai, clearKey: vi.fn() }),
}))
// provider별 saveKey를 구분해야 하므로 훅을 부른 provider를 첫 인자로 실어 넘긴다.
vi.mock('../../../src/hooks/useTtsKeys', () => ({
  useTtsKeys: (p) => ({ hasKey: false, encryptionAvailable: true, loading: false, saveKey: (key) => saveKeyTts(p, key), clearKey: vi.fn() }),
}))

import ApiKeyTab from '../../../src/components/settings/ApiKeyTab'
const t = (k, vars) => (vars ? `${k}:${JSON.stringify(vars)}` : k)

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

describe('ApiKeyTab — onKeySaved reload wiring (§4.7)', () => {
  beforeEach(() => {
    validateKey.mockClear()
    saveKeyGenai.mockClear()
    saveKeyTts.mockClear()
  })

  it('saving the Gemini key calls onKeySaved("gemini")', async () => {
    const onKeySaved = vi.fn()
    render(<ApiKeyTab t={t} onKeySaved={onKeySaved} />)
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"Google Gemini"}')
    fireEvent.change(input, { target: { value: 'AIzaGOOD' } })
    fireEvent.click(screen.getAllByText('settings.ttsKeySave')[0])
    await vi.waitFor(() => expect(saveKeyGenai).toHaveBeenCalledWith('AIzaGOOD'))
    await vi.waitFor(() => expect(onKeySaved).toHaveBeenCalledWith('gemini'))
  })

  it('saving a TTS provider key (Typecast) calls onKeySaved("typecast")', async () => {
    const onKeySaved = vi.fn()
    render(<ApiKeyTab t={t} onKeySaved={onKeySaved} />)
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"Typecast"}')
    fireEvent.change(input, { target: { value: 'tc-sk-abc' } })
    fireEvent.click(screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"Typecast"}')
      .closest('.setting-row').querySelector('button.btn-primary'))
    await vi.waitFor(() => expect(saveKeyTts).toHaveBeenCalledWith('typecast', 'tc-sk-abc'))
    await vi.waitFor(() => expect(onKeySaved).toHaveBeenCalledWith('typecast'))
    expect(onKeySaved).not.toHaveBeenCalledWith('gemini')
  })

  it('without onKeySaved (not wired), saving still succeeds without throwing', async () => {
    render(<ApiKeyTab t={t} />)
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder:{"label":"ElevenLabs"}')
    fireEvent.change(input, { target: { value: 'el-sk-abc' } })
    fireEvent.click(input.closest('.setting-row').querySelector('button.btn-primary'))
    await vi.waitFor(() => expect(saveKeyTts).toHaveBeenCalledWith('elevenlabs', 'el-sk-abc'))
  })
})
