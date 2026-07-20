/**
 * M3b-2b Task 2 — 오디오 생성 진입점을 pre-flight로 게이트한다. 키가 없는 provider가 있으면
 * start()를 부르지 않고 AudioKeyGateCard를 인라인으로 보여준다(§4.4). 키를 저장하면
 * (best-effort) 목소리 재조회 + 재검사하고, 통과하면 원래 하려던 실행을 이어서 돈다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))

const mockSaveKey = vi.fn()
vi.mock('../../../src/hooks/useApiKey', () => ({
  useApiKey: () => ({ hasKey: false, encryptionAvailable: true, loading: false, validateKey: vi.fn(), saveKey: vi.fn(), clearKey: vi.fn() }),
}))
vi.mock('../../../src/hooks/useTtsKeys', () => ({
  useTtsKeys: () => ({ hasKey: false, encryptionAvailable: true, loading: false, saveKey: (...args) => mockSaveKey(...args), clearKey: vi.fn() }),
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

const goToAudioAndRun = () => {
  fireEvent.click(screen.getByRole('button', { name: '오디오' })) // 스텝퍼 → viewedStep=audio
  fireEvent.click(screen.getByRole('button', { name: '오디오 실행' })) // primary action
}

describe('StoryView — 오디오 pre-flight 키 게이트', () => {
  beforeEach(() => {
    mockSaveKey.mockReset()
    localStorage.setItem('autoflowcut_lang', 'ko')
  })

  it('missing 키가 있으면 AudioKeyGateCard를 보여주고 start를 부르지 않는다', async () => {
    const start = vi.fn()
    const audioPreflight = vi.fn().mockResolvedValue({
      providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing' }],
      encryptionAvailable: true,
    })
    renderStory(pipeline({ start, audioPreflight }))
    goToAudioAndRun()

    await waitFor(() => expect(audioPreflight).toHaveBeenCalled())
    expect(await screen.findByText('Typecast')).toBeTruthy()
    expect(start).not.toHaveBeenCalled()
  })

  it('모든 provider가 ok면 게이트 없이 바로 start를 부른다', async () => {
    const start = vi.fn(async () => ({}))
    const audioPreflight = vi.fn().mockResolvedValue({
      providers: [{ provider: 'typecast', keyId: 'typecast', status: 'resolved-store' }],
      encryptionAvailable: true,
    })
    renderStory(pipeline({ start, audioPreflight }))
    goToAudioAndRun()

    await waitFor(() => expect(audioPreflight).toHaveBeenCalled()) // 우회하지 않고 반드시 preflight를 거친다
    await waitFor(() => expect(start).toHaveBeenCalledWith('audio', expect.anything()))
    expect(screen.queryByText('Typecast')).toBeNull()
  })

  it('키 저장 후 provider 재조회 + 재검사하고, 통과하면 원래 실행을 이어서 돈다', async () => {
    const start = vi.fn(async () => ({}))
    const onVoiceSearch = vi.fn(async () => {})
    const audioPreflight = vi.fn()
      .mockResolvedValueOnce({ providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing' }], encryptionAvailable: true })
      .mockResolvedValueOnce({ providers: [{ provider: 'typecast', keyId: 'typecast', status: 'resolved-store' }], encryptionAvailable: true })
    mockSaveKey.mockResolvedValue({ success: true })

    renderStory(pipeline({ start, audioPreflight }), { onVoiceSearch })
    goToAudioAndRun()
    await screen.findByText('Typecast')
    expect(start).not.toHaveBeenCalled()

    const input = document.querySelector('.audio-key-gate input[type="password"]')
    fireEvent.change(input, { target: { value: 'sk-abc' } })
    fireEvent.click(screen.getByRole('button', { name: /저장|Save/i }))

    await waitFor(() => expect(onVoiceSearch).toHaveBeenCalledWith('typecast'))
    await waitFor(() => expect(audioPreflight).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(start).toHaveBeenCalledWith('audio', expect.anything()))
    expect(screen.queryByText('Typecast')).toBeNull() // 게이트 해제
  })

  it('재검사에서도 여전히 missing이면 게이트가 남고 start는 안 부른다', async () => {
    const start = vi.fn()
    const onVoiceSearch = vi.fn(async () => {})
    const audioPreflight = vi.fn().mockResolvedValue({
      providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing' }],
      encryptionAvailable: true,
    })
    mockSaveKey.mockResolvedValue({ success: true })

    renderStory(pipeline({ start, audioPreflight }), { onVoiceSearch })
    goToAudioAndRun()
    await screen.findByText('Typecast')

    const input = document.querySelector('.audio-key-gate input[type="password"]')
    fireEvent.change(input, { target: { value: 'sk-abc' } })
    fireEvent.click(screen.getByRole('button', { name: /저장|Save/i }))

    await waitFor(() => expect(audioPreflight).toHaveBeenCalledTimes(2))
    expect(start).not.toHaveBeenCalled()
    expect(screen.getByText('Typecast')).toBeTruthy()
  })
})
