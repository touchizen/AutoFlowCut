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

  it('키 저장 후 provider 재로드(onReloadVoices) + 재검사하고, 통과하면 원래 실행을 이어서 돈다', async () => {
    // Finding1(리뷰): onVoiceSearch(App의 handleTtsVoiceSearch)는 query.length<2면 no-op하는
    // 원격 검색이라 여기 넘겨도 조용히 아무 일도 안 한다 — 실제 재조회 계약은 onReloadVoices다.
    const start = vi.fn(async () => ({}))
    const onVoiceSearch = vi.fn(async () => {})
    const onReloadVoices = vi.fn(async () => {})
    const audioPreflight = vi.fn()
      .mockResolvedValueOnce({ providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing' }], encryptionAvailable: true })
      .mockResolvedValueOnce({ providers: [{ provider: 'typecast', keyId: 'typecast', status: 'resolved-store' }], encryptionAvailable: true })
    mockSaveKey.mockResolvedValue({ success: true })

    renderStory(pipeline({ start, audioPreflight }), { onVoiceSearch, onReloadVoices })
    goToAudioAndRun()
    await screen.findByText('Typecast')
    expect(start).not.toHaveBeenCalled()

    const input = document.querySelector('.audio-key-gate input[type="password"]')
    fireEvent.change(input, { target: { value: 'sk-abc' } })
    fireEvent.click(screen.getByRole('button', { name: /저장|Save/i }))

    await waitFor(() => expect(onReloadVoices).toHaveBeenCalledWith('typecast'))
    expect(onVoiceSearch).not.toHaveBeenCalled() // 검색 경로는 안 쓴다 — 재로드 전용 채널
    await waitFor(() => expect(audioPreflight).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(start).toHaveBeenCalledWith('audio', expect.anything()))
    expect(screen.queryByText('Typecast')).toBeNull() // 게이트 해제
  })

  it('재검사에서도 여전히 missing이면 게이트가 남고 start는 안 부른다', async () => {
    const start = vi.fn()
    const onReloadVoices = vi.fn(async () => {})
    const audioPreflight = vi.fn().mockResolvedValue({
      providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing' }],
      encryptionAvailable: true,
    })
    mockSaveKey.mockResolvedValue({ success: true })

    renderStory(pipeline({ start, audioPreflight }), { onReloadVoices })
    goToAudioAndRun()
    await screen.findByText('Typecast')

    const input = document.querySelector('.audio-key-gate input[type="password"]')
    fireEvent.change(input, { target: { value: 'sk-abc' } })
    fireEvent.click(screen.getByRole('button', { name: /저장|Save/i }))

    await waitFor(() => expect(audioPreflight).toHaveBeenCalledTimes(2))
    expect(start).not.toHaveBeenCalled()
    expect(screen.getByText('Typecast')).toBeTruthy()
  })

  // Finding3(리뷰): 세그먼트 단건 "테스트"도 배치 실행과 같은 preflight 게이트를 거쳐야 한다 —
  // 안 거치면 missing key일 때 ttsPreview의 IPC 거절이 errorKind 없는 raw 토스트로 샌다.
  it('세그먼트 "테스트"도 preflight를 거친다 — missing 키면 ttsPreview를 안 부르고 게이트 카드를 보여준다', async () => {
    const ttsPreview = vi.fn()
    const audioPreflight = vi.fn().mockResolvedValue({
      providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing' }],
      encryptionAvailable: true,
    })
    renderStory(pipeline({
      ttsPreview,
      audioPreflight,
      scenes: [{ storyId: 's1', segments: [{ id: 's1-1', speaker: 'narrator', text: '어느 날', status: 'pending' }] }],
    }))
    fireEvent.click(screen.getByRole('button', { name: '오디오' })) // 스텝퍼 → viewedStep=audio
    fireEvent.click(screen.getByRole('button', { name: 's1-1 테스트' }))

    await waitFor(() => expect(audioPreflight).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'segmentTest', segmentIds: ['s1-1'] }),
    ))
    expect(await screen.findByText('Typecast')).toBeTruthy()
    expect(ttsPreview).not.toHaveBeenCalled()
  })

  // Finding2(리뷰): "오디오 다시 생성"(완료된 audio 스텝의 redo)이 preflight에 막히면(missing key)
  // start()가 안 불려 steps.audio는 done 그대로다. 예전엔 이때도 무조건 setViewedStep(null)을 해서
  // displayStep이 currentStep(=audio 이후의 다음 미완료 스텝, 보통 prompts)으로 떨어져 오디오
  // 패널 자체가 사라졌다 — 그 안에 있는 AudioKeyGateCard도 함께 사라져 키를 입력할 UI가 없었다.
  it('완료된 오디오 "다시 생성"이 missing 키로 막히면 오디오 패널(과 게이트 카드)이 그대로 보인다', async () => {
    const start = vi.fn()
    const audioPreflight = vi.fn().mockResolvedValue({
      providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing' }],
      encryptionAvailable: true,
    })
    renderStory(pipeline({
      start,
      audioPreflight,
      state: {
        steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'pending' } },
        speakers: [{ id: 'narrator', name: '나레이션' }],
      },
    }))
    fireEvent.click(screen.getByRole('button', { name: '오디오' })) // 스텝퍼 → viewedStep=audio(done)
    fireEvent.click(screen.getByRole('button', { name: /오디오 다시 생성/ })) // redo

    await waitFor(() => expect(audioPreflight).toHaveBeenCalled())
    expect(await screen.findByText('Typecast')).toBeTruthy() // 게이트 카드가 여전히 보인다
    expect(start).not.toHaveBeenCalled()
    // 오디오 패널을 벗어나 다른 스텝(프롬프트 등)으로 새지 않았다 — redo 버튼이 그대로 남아 있다.
    expect(screen.getByRole('button', { name: /오디오 다시 생성/ })).toBeTruthy()
  })

  // Finding2(리뷰) 미러 — 세그먼트 단건 "재생성"도 같은 이유로 같은 문제가 있었다.
  it('세그먼트 "재생성"이 missing 키로 막히면 오디오 패널이 그대로 보인다', async () => {
    const start = vi.fn()
    const audioPreflight = vi.fn().mockResolvedValue({
      providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing' }],
      encryptionAvailable: true,
    })
    renderStory(pipeline({
      start,
      audioPreflight,
      state: {
        steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'pending' } },
        speakers: [{ id: 'narrator', name: '나레이션' }],
      },
      scenes: [{ storyId: 's1', segments: [{ id: 's1-1', speaker: 'narrator', text: '어느 날', status: 'done', audioPath: '/x/s1-1.wav' }] }],
    }))
    fireEvent.click(screen.getByRole('button', { name: '오디오' })) // 스텝퍼 → viewedStep=audio(done)
    fireEvent.click(screen.getByRole('button', { name: 's1-1 재생성' }))

    await waitFor(() => expect(audioPreflight).toHaveBeenCalled())
    expect(await screen.findByText('Typecast')).toBeTruthy() // 게이트 카드가 여전히 보인다
    expect(start).not.toHaveBeenCalled()
    // 세그먼트 목록(오디오 패널)에 그대로 남아 있다 — 다른 스텝으로 안 샜다.
    expect(screen.getByRole('button', { name: 's1-1 재생성' })).toBeTruthy()
  })
})
