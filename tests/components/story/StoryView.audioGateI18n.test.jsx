/**
 * concern-3: StoryView passes its useSafeT() result as `t` to AudioKeyGateCard, which forwards
 * it straight through to TtsApiKeyField/GenaiApiKeyField/ApiKeyField — those call the real i18n
 * convention t(key, params) (2 args), not useSafeT's own (key, fallbackKoString, params) — so a
 * params object landing in useSafeT's `fallback` slot was dropped and {label} showed up literally
 * in the placeholder instead of being interpolated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))
vi.mock('../../../src/hooks/useApiKey', () => ({
  useApiKey: () => ({ hasKey: false, encryptionAvailable: true, loading: false, validateKey: vi.fn(), saveKey: vi.fn(), clearKey: vi.fn() }),
}))
vi.mock('../../../src/hooks/useTtsKeys', () => ({
  useTtsKeys: () => ({ hasKey: false, encryptionAvailable: true, loading: false, saveKey: vi.fn(), clearKey: vi.fn() }),
}))

import StoryView from '../../../src/components/story/StoryView.jsx'
import { ToastProvider } from '../../../src/components/Toast.jsx'
import { I18nProvider } from '../../../src/hooks/useI18n.jsx'

const pipeline = (over = {}) => ({
  state: {
    steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'pending' }, prompts: { status: 'pending' } },
    speakers: [{ id: 'narrator', name: '나레이션' }],
  },
  scenes: [],
  streamingText: '', scriptText: '', start: vi.fn(async () => ({})), abort: vi.fn(), openError: null, ttsPreview: vi.fn(),
  audioPreflight: vi.fn(),
  ...over,
})

const renderStory = (p, props = {}) => render(
  <I18nProvider><ToastProvider><StoryView pipeline={p} voices={[]} {...props} /></ToastProvider></I18nProvider>,
)

describe('StoryView audio key gate — i18n interpolation', () => {
  beforeEach(() => {
    localStorage.setItem('autoflowcut_lang', 'ko')
  })

  it('interpolates {label} in the gate card placeholder instead of showing it literally', async () => {
    const audioPreflight = vi.fn().mockResolvedValue({
      providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing' }],
      encryptionAvailable: true,
    })
    renderStory(pipeline({ audioPreflight }))
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    fireEvent.click(screen.getByRole('button', { name: '오디오 실행' }))

    const input = await screen.findByPlaceholderText('Typecast API 키를 붙여넣으세요')
    expect(input).toBeTruthy()
    expect(screen.queryByPlaceholderText('{label} API 키를 붙여넣으세요')).toBeNull()
  })
})
