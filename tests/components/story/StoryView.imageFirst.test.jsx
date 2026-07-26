/**
 * M1a step 7 — StoryView image-first(D24a/D24b) 모드.
 *
 * ① D24a 라우팅: progress step(script/scenes done)보다 roster 확정이 우선 — roster-confirm 화면 +
 *    시놉시스 pill 활성 + 제목 안내 없음(input.type='storyboard' → synopsis mode 'pasted' 고정).
 * ② 불법 control 전면 비노출: setup primary/검수 토글 · 대본 검수/다시쓰기/이어쓰기/분리시작 ·
 *    씬 검수/재분리 · 프롬프트 검수/재생성 (렌더는 되는데 handler가 거절되는 죽은 버튼 금지).
 * ③ 거절 표면(runStep): fixed-scenes-immutable / fixed-audio-required / fixed-scenes-stale →
 *    toast 정확히 1회. 나머지 5개 silent site는 busy/unconfirmed에 toast 0회(기존 의미 보존).
 * ④ 교착 방지: image-first는 prompts가 audio done을 요구한다 — 자동 audio를 렌더 시점에 강제 on.
 * ⑤ fixedSceneError → role='alert' 재발행/취소 패널.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../src/components/LiveTimeline', () => ({ default: () => <div data-testid="lt" /> }))
vi.mock('../../../src/components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { toast } from '../../../src/components/Toast'

import StoryView from '../../../src/components/story/StoryView.jsx'
import en from '../../../src/locales/en.js'
import ko from '../../../src/locales/ko.js'

const mkSteps = (over) => ({
  script: { status: 'done' },
  scenes: { status: 'done' },
  audio: { status: 'pending' },
  prompts: { status: 'pending' },
  ...over,
})

const SPEAKERS = [
  { id: 'hong', name: '홍길동' },
  { id: 'narrator', name: '나레이션' },
]

const SCENES = [
  { storyId: 's1', imagePrompt: 'IMG1', videoPrompt: 'VID1', segments: [{ id: 'g1', speaker: 'hong', text: '대사', status: 'done', audioPath: '/a.wav' }] },
  { storyId: 's2', imagePrompt: 'IMG2', videoPrompt: 'VID2', segments: [{ id: 'g2', speaker: 'narrator', text: '나레이션' }] },
]

// image-first(D24a storyboard) durable state — stageImageFirst가 남긴 모양 그대로.
const imageFirstState = ({ steps, imageFirstVariant = 'storyboard', ...over } = {}) => ({
  steps: mkSteps(steps),
  input: { type: 'storyboard', title: 'T', variant: imageFirstVariant, fixedSceneRevision: 'rev-1' },
  sceneMode: 'image-first',
  imageFirstVariant,
  fixedSceneRevision: 'rev-1',
  fixedScenes: [
    { ordinal: 1, storyId: 's1', rendererSceneId: 'r1' },
    { ordinal: 2, storyId: 's2', rendererSceneId: 'r2' },
  ],
  charactersConfirmed: false,
  speakers: SPEAKERS,
  ...over,
})

// audio-first(기존) durable state — 회귀 기준.
const audioFirstState = ({ steps, ...over } = {}) => ({
  steps: mkSteps(steps),
  input: { type: 'title', title: 'T' },
  speakers: SPEAKERS,
  ...over,
})

// main machine.start()의 image-first 가드를 그대로 흉내낸다 — 렌더러가 거절을 삼키는지 본다.
const machineStart = (state) => vi.fn(async (step) => {
  if (state.sceneMode === 'image-first' && (step === 'script' || step === 'scenes')) {
    return { error: 'fixed-scenes-immutable' }
  }
  if (state.sceneMode === 'image-first' && step === 'prompts' && state.steps.audio?.status !== 'done') {
    return { error: 'fixed-audio-required' }
  }
  return { operationId: 'op-1' }
})

const pipeline = (state, over = {}) => ({
  state,
  scenes: SCENES,
  streamingText: '',
  scriptText: '스토리보드에서 만든 대본',
  start: over.start || machineStart(state),
  abort: vi.fn(),
  openError: null,
  ttsPreview: vi.fn(),
  generateTitle: vi.fn().mockResolvedValue({ title: 'T' }),
  generateSynopsis: vi.fn().mockResolvedValue({}),
  reviewSynopsis: vi.fn().mockResolvedValue({}),
  confirmSynopsis: vi.fn().mockResolvedValue({ ok: true }),
  charactersConfirmed: state.charactersConfirmed,
  characters: [{ id: 'hong', name: '홍길동', gender: 'male', role: '주인공' }],
  synopsisText: '줄거리',
  ...over,
})

beforeEach(() => {
  toast.error.mockClear()
  toast.success.mockClear()
})

// 스텝퍼 pill 클릭(탭 이동) — 활성 pill만 role='button'이다.
const clickTab = (name) => fireEvent.click(screen.getByRole('button', { name }))

describe('image-first ① D24a 라우팅 + 시놉시스 모드 고정', () => {
  it('progress step이 done이어도 charactersConfirmed=false면 roster-confirm 화면으로 간다', async () => {
    const st = imageFirstState()
    render(<StoryView pipeline={pipeline(st)} voices={[]} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
    // 대본(editor)로 가지 않는다 — script/scenes done이 roster 확정을 앞지르지 못한다.
    expect(screen.queryByTestId('story-editor')).not.toBeInTheDocument()
    // storyboard → synopsis mode 'pasted' 고정 → [등장인물 확정]
    expect(screen.getByRole('button', { name: '등장인물 확정' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이 시놉시스로 대본 생성' })).not.toBeInTheDocument()
  })

  it('시놉시스 pill이 활성이고 synopsisTitleMissing=false(제목 안내 없음)', async () => {
    const st = imageFirstState({ input: { type: 'storyboard', variant: 'storyboard', fixedSceneRevision: 'rev-1' } }) // 제목 없음
    render(<StoryView pipeline={pipeline(st)} voices={[]} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '시놉시스' })).toBeInTheDocument()
    // pasted 모드라 제목이 없어도 생성/확정이 막히지 않는다.
    expect(screen.queryByText(/제목이 필요합니다/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '등장인물 확정' })).not.toBeDisabled()
  })

  it('D24b image-only는 script done 전까지 roster route와 pill을 모두 막는다', async () => {
    const st = imageFirstState({
      imageFirstVariant: 'image-only',
      steps: { script: { status: 'pending' }, scenes: { status: 'pending' } },
    })
    render(<StoryView pipeline={pipeline(st, { scriptText: '' })} voices={[]} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByTestId('story-setup')).toBeInTheDocument())
    expect(screen.queryByTestId('story-synopsis')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '시놉시스' })).not.toBeInTheDocument()
  })

  it('stale한 로컬 synopsisLocalMode=title이 durable input.type을 이기지 못한다(pasted 고정)', async () => {
    // audio-first setup에서 [✨ 시작] → synopsisLocalMode='title'을 세운 뒤 image-first state가 도착.
    const a = audioFirstState({ steps: { script: { status: 'pending' }, scenes: { status: 'pending' } }, charactersConfirmed: undefined })
    const { rerender } = render(
      <StoryView pipeline={pipeline(a, { scriptText: '', charactersConfirmed: undefined, characters: [] })} voices={[]} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '이 시놉시스로 대본 생성' })).toBeInTheDocument())

    const st = imageFirstState()
    rerender(<StoryView pipeline={pipeline(st)} voices={[]} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '등장인물 확정' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '이 시놉시스로 대본 생성' })).not.toBeInTheDocument()
    expect(screen.queryByText(/제목이 필요합니다/)).not.toBeInTheDocument()
  })

  it('image-first에서 시놉시스 검수는 stage가 시딩한 등장인물 명단을 덮지 않는다', async () => {
    const st = imageFirstState()
    const reviewSynopsis = vi.fn().mockResolvedValue({
      synopsisMd: '검수된 줄거리',
      characters: [{ id: 'ghost', name: '유령', role: '없음' }],
    })
    render(<StoryView pipeline={pipeline(st, { reviewSynopsis })} voices={[]} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '시놉시스 검수' }))
    await waitFor(() => expect(reviewSynopsis).toHaveBeenCalled())
    // 검수 결과의 characters로 roster를 갈아끼우면 confirm이 storyboard-roster-incomplete로 죽는다.
    await waitFor(() => expect(screen.getByDisplayValue('홍길동')).toBeInTheDocument())
    expect(screen.queryByDisplayValue('유령')).not.toBeInTheDocument()
  })

  it('roster 확정은 fixed scene 신원(sceneMode/variant/revision)을 함께 커밋한다', async () => {
    const st = imageFirstState()
    const confirmSynopsis = vi.fn().mockResolvedValue({ ok: true })
    render(<StoryView pipeline={pipeline(st, { confirmSynopsis })} voices={[]} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '등장인물 확정' }))
    await waitFor(() => expect(confirmSynopsis).toHaveBeenCalledWith(expect.objectContaining({
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: 'rev-1',
    })))
  })

  it('roster 확정 실패(storyboard-roster-incomplete)는 빠진 화자와 함께 toast 1회', async () => {
    const st = imageFirstState()
    const confirmSynopsis = vi.fn().mockResolvedValue({
      success: false, error: 'storyboard-roster-incomplete', speakers: ['철수', '영희'],
    })
    render(<StoryView pipeline={pipeline(st, { confirmSynopsis })} voices={[]} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '등장인물 확정' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toContain('storyboard-roster-incomplete')
    expect(toast.error.mock.calls[0][0]).toContain('철수, 영희')
  })
})

describe('image-first ② 불법 control 전면 비노출', () => {
  const confirmed = (over = {}) => imageFirstState({ charactersConfirmed: true, ...over })

  const expectNoSetupControls = () => {
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '시작' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '변경사항으로 다시 시작' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '완료됨' })).not.toBeInTheDocument()
    // setup의 세 자동검수 토글
    expect(screen.queryByLabelText('대본 자동 검수')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('씬 자동 검수')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('프롬프트 자동 검수')).not.toBeInTheDocument()
  }

  it('setup: primary(시작/다시 시작)와 세 review toggle이 없다 — setupAlreadyApplied=true(dirty여도)', async () => {
    render(<StoryView pipeline={pipeline(confirmed())} voices={[]} onClose={vi.fn()} />)
    clickTab('설정')
    await waitFor(() => expect(screen.getByTestId('story-setup')).toBeInTheDocument())
    // dirty로 만든다 — audio-first였다면 [↻ 변경사항으로 다시 시작]이 뜨는 자리다(tautology 방지).
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: '바뀐 제목' } })
    expectNoSetupControls()
  })

  it('setup: primary와 세 review toggle이 없다 — setupAlreadyApplied=false(D24b script pending)', async () => {
    const st = confirmed({
      imageFirstVariant: 'image-only',
      steps: { script: { status: 'pending' }, scenes: { status: 'pending' } },
    })
    render(<StoryView pipeline={pipeline(st, { scriptText: '' })} voices={[]} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('story-setup')).toBeInTheDocument())
    expectNoSetupControls()
  })

  it('대본 탭: 검수/다시쓰기/이어쓰기/분리시작이 모두 없다', async () => {
    render(<StoryView pipeline={pipeline(confirmed())} voices={[]} onClose={vi.fn()} />)
    clickTab('대본')
    await waitFor(() => expect(screen.getByTestId('story-editor')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '대본 검수' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시쓰기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이어쓰기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '분리시작' })).not.toBeInTheDocument()
  })

  it('씬 탭: 씬 검수/씬 재분리 control이 없다', async () => {
    render(<StoryView pipeline={pipeline(confirmed())} voices={[]} onClose={vi.fn()} />)
    clickTab('씬 분리')
    await waitFor(() => expect(screen.queryByRole('button', { name: /씬 재분리/ })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '씬 검수' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('씬 분리 단위 (재분리)')).not.toBeInTheDocument()
  })

  it('프롬프트 탭: 프롬프트 검수/다시 생성 control이 없다', async () => {
    const st = confirmed({ steps: { audio: { status: 'done' }, prompts: { status: 'done' } } })
    render(<StoryView pipeline={pipeline(st)} voices={[]} onClose={vi.fn()} />)
    clickTab('프롬프트')
    await waitFor(() => expect(screen.getByText('IMG1')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /프롬프트 다시 생성/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '프롬프트 검수' })).not.toBeInTheDocument()
    // 이름만 바꾼 재생성도 안 된다 — done인 prompts를 [▶ 진행]으로 다시 돌리는 primary도 없어야 한다.
    expect(screen.queryByRole('button', { name: '프롬프트 실행' })).not.toBeInTheDocument()
  })

  it('오디오 재생성·세그먼트 재생성은 남는다(합법 — fixed set을 건드리지 않는다)', async () => {
    const st = confirmed({ steps: { audio: { status: 'done' } } })
    render(<StoryView pipeline={pipeline(st)} voices={[]} onClose={vi.fn()} />)
    clickTab('오디오')
    await waitFor(() => expect(screen.getByRole('button', { name: /오디오 다시 생성/ })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'g1 재생성' })).toBeInTheDocument()
  })
})

describe('image-first ③ 거절 표면(runStep) — toast 정확히 1회', () => {
  it('scenes(fixed-scenes-immutable): 자동 진행이 scenes를 밀어도 toast 1회 + 자동 진행 정지', async () => {
    // script done / scenes pending인 image-first — 자동 진행의 첫 스텝이 scenes로 잡힌다.
    const st = imageFirstState({ charactersConfirmed: true, steps: { scenes: { status: 'pending' } } })
    const start = machineStart(st)
    render(<StoryView pipeline={pipeline(st, { start })} voices={[]} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /전체 진행/ }))
    await waitFor(() => expect(start).toHaveBeenCalledWith('scenes', expect.anything()))
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toContain('fixed-scenes-immutable')
  })

  it('prompts(fixed-audio-required): 하단 primary가 거절되면 toast 1회', async () => {
    // 렌더러 state는 audio done으로 보이지만 main은 아직 아니라고 한다(불일치) — 거절이 조용히 묻히면 안 된다.
    const st = imageFirstState({ charactersConfirmed: true, steps: { audio: { status: 'done' } } })
    const start = vi.fn().mockResolvedValue({ error: 'fixed-audio-required' })
    render(<StoryView pipeline={pipeline(st, { start })} voices={[]} onClose={vi.fn()} />)

    clickTab('프롬프트') // 진행 탭으로 이동 — 하단 primary가 [▶ 진행](prompts)이 된다
    fireEvent.click(screen.getByRole('button', { name: '프롬프트 실행' }))
    await waitFor(() => expect(start).toHaveBeenCalledWith('prompts', expect.anything()))
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toContain('fixed-audio-required')
  })

  it('script(fixed-scenes-stale): story state가 아직 audio-first여도 toast 1회', async () => {
    // committed-but-unstaged — project는 image-first로 커밋됐는데 story state는 아직 옛 audio-first다.
    // stale 검사를 sceneMode==='image-first' 가드 *안*에 넣으면 정작 이 케이스에서 영영 안 뜬다.
    const st = audioFirstState({
      steps: { script: { status: 'error', error: 'boom' }, scenes: { status: 'pending' } },
      charactersConfirmed: undefined,
    })
    const start = vi.fn().mockResolvedValue({ error: 'fixed-scenes-stale' })
    render(
      <StoryView
        pipeline={pipeline(st, { start, scriptText: '', charactersConfirmed: undefined, characters: [] })}
        voices={[]}
        onClose={vi.fn()}
      />,
    )
    // 하단 generic primary [↻ 다시 시도] → handlePrimaryAction → startScriptFromTitle → runStep('script')
    fireEvent.click(screen.getByRole('button', { name: '재실행' }))

    await waitFor(() => expect(start).toHaveBeenCalledWith('script', expect.anything()))
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0][0]).toContain('fixed-scenes-stale')
  })

  it('audio-first에서 5개 silent site는 busy/unconfirmed에 toast를 띄우지 않는다', async () => {
    const busy = () => vi.fn().mockResolvedValue({ error: 'busy' })

    // (1) 대본 수동 검수 (2) 다시쓰기 (3) 이어쓰기 — editor
    const editorStart = busy()
    const editorState = audioFirstState({ charactersConfirmed: true })
    const { unmount } = render(<StoryView pipeline={pipeline(editorState, { start: editorStart })} voices={[]} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('story-editor')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '대본 검수' }))
    fireEvent.click(screen.getByRole('button', { name: '다시쓰기' }))
    fireEvent.click(screen.getByRole('button', { name: '이어쓰기' }))
    await waitFor(() => expect(editorStart).toHaveBeenCalledTimes(3))
    unmount()

    // (세그먼트 재생성은 더 이상 silent site가 아니다 — 명시적 액션이라 busy/generic을 표면화한다.
    //  그 회귀 핀은 storyAudioGate.test.jsx로 옮겼다.)

    // (4) 붙여넣기 시작 — setup [✨ 시작] (scriptText 있음)
    const pasteStart = busy()
    const pasteState = audioFirstState({ steps: { script: { status: 'pending' }, scenes: { status: 'pending' } }, input: { type: 'pasted', title: 'T' }, charactersConfirmed: undefined })
    const paste = render(
      <StoryView pipeline={pipeline(pasteState, { start: pasteStart, charactersConfirmed: undefined, characters: [] })} voices={[]} onClose={vi.fn()} />,
    )
    clickTab('설정')
    await waitFor(() => expect(screen.getByTestId('story-setup')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    await waitFor(() => expect(pasteStart).toHaveBeenCalledWith('script', expect.objectContaining({ pastedScript: expect.any(String) })))
    paste.unmount()

    // (5) title 시놉시스 확정 → start('script')
    const confirmStart = busy()
    const confirmState = audioFirstState({ steps: { script: { status: 'pending' }, scenes: { status: 'pending' } }, charactersConfirmed: false })
    render(
      <StoryView
        pipeline={pipeline(confirmState, { start: confirmStart, scriptText: '', charactersConfirmed: false, characters: [] })}
        voices={[]}
        onClose={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: '이 시놉시스로 대본 생성' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '이 시놉시스로 대본 생성' }))
    await waitFor(() => expect(confirmStart).toHaveBeenCalledWith('script', expect.anything()))

    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('image-first ④ 자동 진행 교착 방지(audio 강제)', () => {
  it('roster 확정 후 기본 [전체 진행]은 audio를 먼저 부르고 prompts로 간다 — fixed-audio-required 0회', async () => {
    const st = imageFirstState({ charactersConfirmed: true })
    const results = []
    const base = machineStart(st)
    const start = vi.fn(async (step, params) => {
      const r = await base(step, params)
      results.push({ step, error: r.error })
      return r
    })
    const { rerender } = render(<StoryView pipeline={pipeline(st, { start })} voices={[]} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /전체 진행/ }))
    await waitFor(() => expect(start).toHaveBeenCalledWith('audio', expect.anything()))
    expect(start.mock.calls[0][0]).toBe('audio') // audio 먼저

    // audio done → prompts
    const st2 = imageFirstState({ charactersConfirmed: true, steps: { audio: { status: 'done' } } })
    const start2 = vi.fn(async (step, params) => {
      const r = await machineStart(st2)(step, params)
      results.push({ step, error: r.error })
      return r
    })
    rerender(<StoryView pipeline={pipeline(st2, { start: start2 })} voices={[]} onClose={vi.fn()} />)
    await waitFor(() => expect(start2).toHaveBeenCalledWith('prompts', expect.anything()))

    expect(results.map((r) => r.step)).toEqual(['audio', 'prompts'])
    expect(results.some((r) => r.error === 'fixed-audio-required')).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('오디오 자동 토글은 image-first에서 끌 수 없다(checked + disabled)', async () => {
    const st = imageFirstState({ charactersConfirmed: true })
    render(<StoryView pipeline={pipeline(st)} voices={[]} onClose={vi.fn()} />)
    // 자동 토글은 요약 버튼 팝오버 안에 있다(main 리팩터) — 먼저 연다.
    fireEvent.click(document.querySelector('.story-auto-summary'))
    const auto = screen.getByLabelText('오디오 자동')
    expect(auto).toBeChecked()
    expect(auto).toBeDisabled()
  })

  it('회귀(audio-first): 오디오 자동 토글 off + 조작 가능, setup primary·검수 토글 유지', async () => {
    const st = audioFirstState({ steps: { script: { status: 'pending' }, scenes: { status: 'pending' } }, charactersConfirmed: undefined })
    render(
      <StoryView pipeline={pipeline(st, { scriptText: '', charactersConfirmed: undefined, characters: [] })} voices={[]} onClose={vi.fn()} />,
    )
    fireEvent.click(document.querySelector('.story-auto-summary'))
    const auto = screen.getByLabelText('오디오 자동')
    expect(auto).not.toBeChecked()
    expect(auto).not.toBeDisabled()
    // 기존 setup primary(✨ 시작) + 세 자동검수 토글은 그대로.
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '시작' })).toBeInTheDocument()
    expect(screen.getByLabelText('대본 자동 검수')).toBeInTheDocument()
    expect(screen.getByLabelText('씬 자동 검수')).toBeInTheDocument()
    expect(screen.getByLabelText('프롬프트 자동 검수')).toBeInTheDocument()
  })
})

describe('image-first ⑤ fixedSceneError 복구 패널', () => {
  it('state.fixedSceneError면 role=alert 재발행/취소 패널을 렌더한다', async () => {
    const st = imageFirstState({ charactersConfirmed: true, fixedSceneError: 'fixed-scenes-stale' })
    const onReissueImageFirst = vi.fn()
    const onCancelImageFirst = vi.fn()
    render(
      <StoryView
        pipeline={pipeline(st)}
        voices={[]}
        onClose={vi.fn()}
        onReissueImageFirst={onReissueImageFirst}
        onCancelImageFirst={onCancelImageFirst}
      />,
    )
    const alert = screen.getByTestId('story-fixed-scene-alert')
    expect(alert).toHaveAttribute('role', 'alert')
    // 사람이 읽는 문구여야 한다 — raw 코드('fixed-scenes-stale')를 사용자에게 보여주지 않는다.
    expect(alert).toHaveTextContent('이미지 세트가 프로젝트와 어긋났습니다')
    expect(alert).not.toHaveTextContent('fixed-scenes-stale')

    fireEvent.click(screen.getByRole('button', { name: /이미지 세트 다시 임포트/ }))
    expect(onReissueImageFirst).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancelImageFirst).toHaveBeenCalled()
  })

  it('fixedSceneError가 없으면 패널이 없다', () => {
    render(<StoryView pipeline={pipeline(imageFirstState({ charactersConfirmed: true }))} voices={[]} onClose={vi.fn()} />)
    expect(screen.queryByTestId('story-fixed-scene-alert')).not.toBeInTheDocument()
  })

  it.each([
    ['brand-new old story', { pendingPushRevision: 0, lastPushedRevision: 0 }],
    ['fully-synced old story', { pendingPushRevision: 3, lastPushedRevision: 3 }],
  ])('%s에 파생된 marker도 recovery panel과 re-issue route를 노출한다', async (_label, revisions) => {
    const st = audioFirstState({
      ...revisions,
      fixedSceneError: 'fixed-scenes-stale',
      charactersConfirmed: undefined,
    })
    const onReissueImageFirst = vi.fn()
    render(
      <StoryView
        pipeline={pipeline(st, { charactersConfirmed: undefined })}
        voices={[]}
        onClose={vi.fn()}
        onReissueImageFirst={onReissueImageFirst}
      />,
    )

    expect(screen.getByTestId('story-fixed-scene-alert')).toHaveAttribute('role', 'alert')
    fireEvent.click(screen.getByRole('button', { name: /이미지 세트 다시 임포트/ }))
    expect(onReissueImageFirst).toHaveBeenCalledTimes(1)
  })
})

describe('등록된 등장인물 0명', () => {
  it('ko/en locale도 narrator-only를 주장하지 않는 중립 문구다', () => {
    expect(ko.story.synopsis.rosterEmpty).toContain('등록된 등장인물이 없습니다')
    expect(ko.story.synopsis.rosterEmpty).not.toContain('나레이터')
    expect(en.story.synopsis.rosterEmpty).toContain('No characters are registered')
    expect(en.story.synopsis.rosterEmpty).not.toContain('Narrator')
  })

  it('visual-only board도 확인하지 않은 narrator 사실을 주장하지 않고 중립 안내를 보여준다', async () => {
    const st = imageFirstState()
    const visualOnlyScenes = [
      { storyId: 's1', imagePrompt: 'Sunset', videoPrompt: '', segments: [] },
      { storyId: 's2', imagePrompt: 'Night sky', videoPrompt: '', segments: [] },
    ]
    render(
      <StoryView
        pipeline={pipeline(st, { characters: [], scenes: visualOnlyScenes })}
        voices={[]}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
    expect(screen.getByTestId('story-roster-empty')).toHaveTextContent('등록된 등장인물이 없습니다')
    expect(screen.getByTestId('story-roster-empty')).not.toHaveTextContent('나레이터')
  })

  it('등장인물이 있으면 안내를 보여주지 않는다', async () => {
    const st = imageFirstState()
    render(<StoryView pipeline={pipeline(st)} voices={[]} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
    expect(screen.queryByTestId('story-roster-empty')).not.toBeInTheDocument()
  })
})
