import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))

import StoryView from '../../../src/components/story/StoryView.jsx'
import { ToastProvider } from '../../../src/components/Toast.jsx'
import { I18nProvider } from '../../../src/hooks/useI18n.jsx'
import ko from '../../../src/locales/ko.js'
import en from '../../../src/locales/en.js'

const pipeline = () => ({
  state: {
    steps: {
      script: { status: 'done' },
      scenes: { status: 'done' },
      audio: { status: 'done' },
      prompts: { status: 'pending' },
    },
    speakers: [
      { id: 'narrator', name: '나레이션', voice: { provider: 'import', mp3Path: '/src/narrator.mp3', srtPath: '/src/narrator.srt' } },
      { id: 'widow', name: '과부', voice: { provider: 'typecast', voiceId: 'tc_w' } },
    ],
  },
  scenes: [{ storyId: 's1', segments: [
    { id: 'n1', type: 'narration', speaker: 'narrator', text: '해설', status: 'done' },
    { id: 'd1', type: 'narration', speaker: 'widow', text: '대사', status: 'pending' },
  ] }],
  streamingText: '',
  scriptText: '',
  start: vi.fn(async () => ({ operationId: 'op-speaker', partialAudioRun: true })),
  abort: vi.fn(),
  ttsPreview: vi.fn(),
  pickAudioImportFile: vi.fn(),
  segmentProgress: {},
})

describe('StoryView — 이 화자만 생성', () => {
  it('모든 화자 행에서 단수 onlySpeaker로 실행하고 완료 토스트를 띄운다', async () => {
    const p = pipeline()
    localStorage.setItem('autoflowcut_lang', 'ko')
    render(<I18nProvider><ToastProvider><StoryView pipeline={p} voices={[]} /></ToastProvider></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))

    // 접근성 이름에 **화자를 넣는다** — 다 같으면 스크린리더/음성제어 버튼 목록에서 어느 화자인지
    // 구분이 안 된다(버튼이 화자 수만큼 있다).
    expect(screen.getByRole('button', { name: '나레이션만 생성' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '과부만 생성' })).toBeTruthy()
    const widowRow = screen.getByLabelText('과부 목소리').closest('.story-voice-row')
    fireEvent.click(within(widowRow).getByRole('button', { name: '과부만 생성' }))

    await waitFor(() => expect(p.start).toHaveBeenCalledWith('audio', {
      onlySpeaker: 'widow',
      speakers: [
        { id: 'narrator', name: '나레이션', voice: { provider: 'import', mp3Path: '/src/narrator.mp3', srtPath: '/src/narrator.srt' } },
        { id: 'widow', name: '과부', voice: { provider: 'typecast', voiceId: 'tc_w' } },
      ],
    }))
    expect(await screen.findByText('과부만 생성됨 — 전체 진행으로 타임라인을 완성하세요')).toBeInTheDocument()
  })

  // (b-2) 성우 버튼 우클릭 → 강제 재생성 confirm 모달 → 확인 시 regenerateSpeaker로 실행.
  it('성우 버튼 우클릭 → confirm 모달 → 재생성 확인 시 regenerateSpeaker=true로 실행한다', async () => {
    const p = pipeline()
    localStorage.setItem('autoflowcut_lang', 'ko')
    render(<I18nProvider><ToastProvider><StoryView pipeline={p} voices={[]} /></ToastProvider></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    const widowRow = screen.getByLabelText('과부 목소리').closest('.story-voice-row')
    const btn = within(widowRow).getByRole('button', { name: '과부만 생성' })
    fireEvent.contextMenu(btn) // 우클릭 → 모달
    const confirm = await screen.findByRole('button', { name: '재생성' })
    fireEvent.click(confirm)
    await waitFor(() => expect(p.start).toHaveBeenCalledWith('audio', expect.objectContaining({
      onlySpeaker: 'widow',
      regenerateSpeaker: true,
    })))
  })

  it('우클릭 모달에서 취소하면 실행하지 않는다', async () => {
    const p = pipeline()
    localStorage.setItem('autoflowcut_lang', 'ko')
    render(<I18nProvider><ToastProvider><StoryView pipeline={p} voices={[]} /></ToastProvider></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    const widowRow = screen.getByLabelText('과부 목소리').closest('.story-voice-row')
    fireEvent.contextMenu(within(widowRow).getByRole('button', { name: '과부만 생성' }))
    fireEvent.click(await screen.findByRole('button', { name: '취소' }))
    expect(p.start).not.toHaveBeenCalled()
  })

  it('버튼과 완료 토스트 문구를 ko/en 카탈로그에 제공한다', () => {
    expect(ko.story.audio.runThisSpeaker).toBe('이 화자만 생성')
    expect(en.story.audio.runThisSpeaker).toBe('Generate this speaker')
    expect(ko.story.audio.runThisSpeakerDone).toBe('{speaker}만 생성됨 — 전체 진행으로 타임라인을 완성하세요')
    expect(en.story.audio.runThisSpeakerDone).toBe('{speaker} generated — run the full step to complete the timeline')
    // 아이콘(✨)만 두면 뭘 하는지 모른다 — 설명은 툴팁으로 간다. 키가 없으면 t()가 키를 그대로
    // 뱉어 툴팁에 'story.audio.runThisSpeakerHint' 가 뜬다.
    expect(ko.story.audio.runThisSpeakerHint).toBeTruthy()
    expect(en.story.audio.runThisSpeakerHint).toBeTruthy()
    expect(/[가-힣]/.test(en.story.audio.runThisSpeakerHint), 'en 에 한글이 섞이면 안 된다').toBe(false)
  })
})

// 실행 중 클릭하면 start() 가 invoke 전에 **동기로** segmentProgress/progressLog 를 비워 돌던 실행의
// 배지·경고가 증발한다. 그런데 disabled 는 필요 없다 — **화자 맵 자체가 실행 중엔 안 렌더된다**
// (StoryView.jsx: `steps.audio?.status !== 'running' &&`). 그 게이트가 이 버튼의 유일한 방어선이므로
// 여기서 못 박는다 — 게이트가 사라지면 ✨ 가 노출되고 위 사고가 실제로 난다.
describe('StoryView — 이 화자만 생성: 실행 중엔 노출되지 않는다', () => {
  it('오디오 실행 중이면 화자 맵과 함께 ✨ 도 사라진다', () => {
    const p = pipeline()
    p.state.steps.audio = { status: 'running', updatedAt: new Date(0).toISOString() }
    render(<StoryView pipeline={p} voices={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    expect(screen.queryAllByRole('button', { name: /만 생성$/ })).toHaveLength(0)
  })

  it('실행 중이 아니면 화자마다 노출된다 — 위 테스트가 항진이 아님을 고정', () => {
    render(<StoryView pipeline={pipeline()} voices={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    expect(screen.queryAllByRole('button', { name: /만 생성$/ }).length).toBeGreaterThan(0)
  })
})

// main 은 대사 없는 화자를 `{error:'story-audio-speaker-empty'}` 로 거절한다(사전검사라 스텝 상태를
// 일부러 안 건드린다 — 완료 프로젝트의 done 을 지키려고). 그래서 **오류 배너도 안 뜬다.**
// 여기서 안 띄우면 버튼이 아무 반응 없는 것처럼 보이고, 로케일 문구는 도달 불가능한 죽은 문자열이다.
describe('StoryView — 이 화자만 생성: 거절 피드백', () => {
  it('main 이 거절하면 사유를 토스트로 보여준다 — 무반응이면 고장으로 보인다', async () => {
    const p = pipeline()
    p.start = vi.fn(async () => ({ error: 'story-audio-speaker-empty' }))
    localStorage.setItem('autoflowcut_lang', 'ko')
    render(<I18nProvider><ToastProvider><StoryView pipeline={p} voices={[]} /></ToastProvider></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    fireEvent.click(screen.getByRole('button', { name: '나레이션만 생성' }))
    // 실제 ToastProvider 를 쓴다 — 목이 아니라 화면에 문구가 뜨는지 본다.
    await waitFor(() => expect(screen.getByText(ko.errorSection.kind['story-audio-speaker-empty'])).toBeTruthy())
  })
})

// ✨ 가 노출되는데 **다른 작업이 도는** 상태가 둘 있다:
//   - 미리듣기 중(steps.audio 는 running 이 아니다)
//   - audio:done + prompts:running (완료된 오디오 탭을 다시 열 수 있고 화자 맵도 보인다)
// 누르면 start() 가 invoke **전에** segmentProgress/progressLog 를 비워 **돌던 작업의 진행·경고가
// 증발**하고, main 은 {error:'busy'} 를 돌려주는데 그건 조용히 무시된다 — 아무 일도 안 일어난
// 것처럼 보이면서 화면만 지워진다.
describe('StoryView — 이 화자만 생성: 다른 작업 중엔 비활성', () => {
  it('미리듣기 중엔 비활성', async () => {
    const p = pipeline()
    let resolvePreview
    p.ttsPreview = vi.fn(() => new Promise((r) => { resolvePreview = r }))
    localStorage.setItem('autoflowcut_lang', 'ko')
    render(<I18nProvider><ToastProvider><StoryView pipeline={p} voices={[]} /></ToastProvider></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    const testBtns = screen.queryAllByRole('button', { name: /테스트|미리듣기/ })
    if (!testBtns.length) return
    fireEvent.click(testBtns[0])
    await waitFor(() => expect(p.ttsPreview).toHaveBeenCalled())
    const btns = screen.queryAllByRole('button', { name: /만 생성$/ })
    expect(btns.length).toBeGreaterThan(0)
    for (const b of btns) expect(b).toBeDisabled()
    resolvePreview?.({})
  })

  it('다른 스텝(prompts)이 도는 중엔 비활성 — audio 가 done 이라 맵이 보인다', () => {
    const p = pipeline()
    p.state.steps.audio = { status: 'done', updatedAt: new Date(0).toISOString() }
    p.state.steps.prompts = { status: 'running', updatedAt: new Date(0).toISOString() }
    localStorage.setItem('autoflowcut_lang', 'ko')
    render(<I18nProvider><ToastProvider><StoryView pipeline={p} voices={[]} /></ToastProvider></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: '오디오' }))
    const btns = screen.queryAllByRole('button', { name: /만 생성$/ })
    expect(btns.length, '맵이 안 보이면 이 테스트가 항진이다').toBeGreaterThan(0)
    for (const b of btns) expect(b).toBeDisabled()
  })
})
