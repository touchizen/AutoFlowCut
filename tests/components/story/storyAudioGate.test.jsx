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

  // 4차 머지 리뷰(Codex High): 키 저장 후 이어지는 retry가 start 거절(fixed-scenes-stale 등)을
  // 삼키면 안 된다. 직접 경로는 결과를 보고 토스트하지만, 게이트→저장→retry의 지연 경로가 bare
  // start를 다시 돌리며 결과를 버려 "토스트 0"이던 회귀를 잡는다(직접·지연 경로 단일 오너).
  it('키 저장 후 retry한 실행이 start 거절을 반환하면 조용히 넘어가지 않는다', async () => {
    const start = vi.fn().mockResolvedValue({ error: 'fixed-scenes-stale' })
    const onReloadVoices = vi.fn(async () => {})
    const audioPreflight = vi.fn()
      .mockResolvedValueOnce({ providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing' }], encryptionAvailable: true })
      .mockResolvedValueOnce({ providers: [{ provider: 'typecast', keyId: 'typecast', status: 'resolved-store' }], encryptionAvailable: true })
    mockSaveKey.mockResolvedValue({ success: true })

    renderStory(pipeline({ start, audioPreflight }), { onReloadVoices })
    goToAudioAndRun()
    await screen.findByText('Typecast')
    expect(start).not.toHaveBeenCalled()

    const input = document.querySelector('.audio-key-gate input[type="password"]')
    fireEvent.change(input, { target: { value: 'sk-abc' } })
    fireEvent.click(screen.getByRole('button', { name: /저장|Save/i }))

    await waitFor(() => expect(start).toHaveBeenCalledWith('audio', expect.anything()))
    expect(await screen.findByText(/fixed-scenes-stale/)).toBeTruthy()
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

  // Finding1(2R 리뷰): 세그먼트 "테스트" 게이트에서 키 저장→재시도는 testSegment의 원래
  // try/finally 밖(AudioKeyGateCard.onKeySaved)에서 돈다 — 그 retry가 가드/catch 없는 raw
  // ttsPreview 호출이면, 존재하지만 무효한 키에서 ttsPreview가 reject할 때 unhandled rejection +
  // 번역 안 된 토스트로 샌다. retry가 testSegment와 같은 가드된 경로(에러 토스트 포함)를 타야 한다.
  // §4.8 R3: story:tts-preview IPC 핸들러(electron/ipc/story-api.js)가 auth 실패를 이제 throw
  // 대신 { error: errorKind, provider } 로 돌려준다(story:load-audio-package의 asKind 관습과
  // 동일) — ttsPreview 목도 reject가 아니라 그 모양으로 resolve해야 실제 계약과 맞는다. 토스트도
  // raw 'invalid api key' 가 아니라 번역된 errorKind 문구여야 한다(§4.8 라운드3 finding).
  it('세그먼트 "테스트" 게이트에서 키 저장 후 retry가 가드된 경로를 타 — auth 실패는 번역된 에러 토스트를 보여준다', async () => {
    const ttsPreview = vi.fn()
      .mockResolvedValueOnce({ error: 'story-audio-tts-auth', provider: 'typecast' })
    const audioPreflight = vi.fn()
      .mockResolvedValueOnce({ providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing' }], encryptionAvailable: true })
      .mockResolvedValueOnce({ providers: [{ provider: 'typecast', keyId: 'typecast', status: 'resolved-store' }], encryptionAvailable: true })
    const onReloadVoices = vi.fn(async () => {})
    mockSaveKey.mockResolvedValue({ success: true })

    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      renderStory(pipeline({
        ttsPreview,
        audioPreflight,
        scenes: [{ storyId: 's1', segments: [{ id: 's1-1', speaker: 'narrator', text: '어느 날', status: 'pending' }] }],
      }), { onReloadVoices })
      fireEvent.click(screen.getByRole('button', { name: '오디오' })) // 스텝퍼 → viewedStep=audio
      fireEvent.click(screen.getByRole('button', { name: 's1-1 테스트' }))

      await screen.findByText('Typecast')
      expect(ttsPreview).not.toHaveBeenCalled()

      const input = document.querySelector('.audio-key-gate input[type="password"]')
      fireEvent.change(input, { target: { value: 'sk-invalid' } })
      fireEvent.click(screen.getByRole('button', { name: /저장|Save/i }))

      await waitFor(() => expect(ttsPreview).toHaveBeenCalledWith(
        expect.objectContaining({ segmentIds: ['s1-1'] }),
      ))
      // 게이트는 재검사 통과로 닫힌다 — 실패는 ttsPreview 쪽(무효 키)에서 난다.
      await waitFor(() => expect(screen.queryByText('Typecast')).toBeNull())
      // 가드된 경로(runSegmentTestGuarded)가 resolve된 { error: errorKind } 를 번역해 토스트한다
      // (raw 'invalid api key' 가 아니라 story-audio-tts-auth 의 로케일 문구).
      await screen.findByText('테스트 실패: 음성 API 키가 유효하지 않습니다(인증 실패). 설정 › API 키에서 키를 다시 확인하세요.')
      // 매크로태스크 한 틱을 더 흘려보내 어떤 unhandled rejection도 없었는지 확인.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
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
  // 실측 회귀(2026-07-25): 오디오가 에러/부분(partial) 상태일 때 ▶ 진행 버튼은 handlePrimaryAction 을
  // 타는데, 이 경로만 runAudioWithPreflight 의 결과를 버려서 main 이 거절해도 토스트·상태변화가
  // 전혀 없었다 — 화자별로 오디오를 다 채운 뒤 진행을 눌러도 "아무 반응 없음"으로 보였다.
  describe('진행 버튼(부분 실행 뒤)이 거절을 삼키지 않는다', () => {
    const partialAudioPipeline = (over = {}) => pipeline({
      state: {
        // 화자별 개별 실행을 마친 상태 — 스텝은 pending(partial) 로 남는다.
        steps: { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'pending', partial: true }, prompts: { status: 'pending' } },
        speakers: [{ id: 'narrator', name: '나레이션' }],
      },
      scenes: [{ storyId: 's1', segments: [{ id: 's1-1', speaker: 'narrator', text: '어느 날', status: 'done', audioPath: '/x/s1-1.wav' }] }],
      ...over,
    })

    it('start 가 busy 로 거절하면 이유를 토스트로 알린다(무반응 금지)', async () => {
      const start = vi.fn(async () => ({ error: 'busy' }))
      const audioPreflight = vi.fn().mockResolvedValue({ providers: [], encryptionAvailable: true })
      renderStory(partialAudioPipeline({ start, audioPreflight }))
      goToAudioAndRun()

      await waitFor(() => expect(start).toHaveBeenCalledWith('audio', expect.anything()))
      expect(await screen.findByText(/실행 중|Another task/i)).toBeTruthy()
    })

    it('start 가 다른 이유로 거절해도 조용히 넘어가지 않는다', async () => {
      const start = vi.fn(async () => ({ error: 'no-segments' }))
      const audioPreflight = vi.fn().mockResolvedValue({ providers: [], encryptionAvailable: true })
      renderStory(partialAudioPipeline({ start, audioPreflight }))
      goToAudioAndRun()

      await waitFor(() => expect(start).toHaveBeenCalled())
      // 번역 키가 없는 코드는 원문 그대로라도 보여준다 — 삼키지 않는 것이 핵심.
      expect(await screen.findByText(/no-segments/)).toBeTruthy()
    })

    it('preflight 가 막으면 오디오 패널에 남아 게이트 카드를 보여준다', async () => {
      const start = vi.fn()
      // 전체 실행은 화자별 실행과 달리 SFX provider 키까지 요구한다 — 여기서 갈린다.
      const audioPreflight = vi.fn().mockResolvedValue({
        providers: [{ provider: 'elevenlabs', keyId: 'elevenlabs', status: 'missing' }],
        encryptionAvailable: true,
      })
      renderStory(partialAudioPipeline({ start, audioPreflight }))
      goToAudioAndRun()

      await waitFor(() => expect(audioPreflight).toHaveBeenCalled())
      expect(await screen.findByText('ElevenLabs')).toBeTruthy()
      expect(start).not.toHaveBeenCalled()
    })
  })
})
