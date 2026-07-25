/**
 * 슬라이스5(spec §3.5 + §v2.5/§v2.8 B1/§v2.9/§v2.10/§v2.11) — 시놉시스 게이트 UI 통합 테스트.
 * - showSynopsis 렌더 조건: title/pasted 노출, imported/continue/legacy-done 미노출
 * - setup 시작 → synopsis phase 전이 + generateSynopsis 호출(title/pasted 각각)
 * - 등장인물 카드 편집(성별 select, 행 추가/삭제)
 * - 확정 버튼: title = confirm→start('script',{synopsis}) 순서 + 공백 비활성, pasted = confirm만
 * - 재오픈 hydrate 4분기(§v2.11)
 * - synopsis phase에서 bottom generic 컨트롤 suppress
 * - 리네임: 스텝퍼 '대본'→'대본'
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

const pipeline = (over = {}) => ({
  state: {
    steps: {
      script: { status: 'pending' }, scenes: { status: 'pending' },
      audio: { status: 'pending' }, prompts: { status: 'pending' },
    },
  },
  scenes: [],
  streamingText: '',
  scriptText: '',
  start: vi.fn().mockResolvedValue({}),
  abort: vi.fn(),
  openError: null,
  generateSynopsis: vi.fn().mockResolvedValue({ synopsisMd: '', characters: [] }),
  confirmSynopsis: vi.fn().mockResolvedValue({ ok: true }),
  synopsisStreamingText: '',
  synopsisGenerating: false,
  synopsisError: null,
  synopsisText: '',
  hasSynopsis: false,
  characters: [],
  charactersConfirmed: undefined,
  ...over,
})

// 재오픈된 title 경로 미확정 프로젝트(=synopsis phase 복원 대상).
const reopenedTitleUnconfirmed = (over = {}) => {
  const p = pipeline({
    synopsisText: '저장된 줄거리',
    hasSynopsis: true,
    characters: [{ id: '리안', name: '리안', gender: 'unknown', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'young woman' }],
    charactersConfirmed: false,
    ...over,
  })
  p.state.input = p.state.input || { type: 'title', title: '복원 제목', options: {} }
  return p
}

const pillOf = (label) => screen.getByText(label).closest('.story-gate-tab, .story-rail-step')
const queryPill = (label) => screen.queryByText(label)?.closest('.story-gate-tab, .story-rail-step') ?? null

// §v2.12 B: pill 자리는 항상 렌더(숨김 폐지) — 활성/비활성만 상태로 가른다.
// 활성: type∈{title,pasted} 신규(charactersConfirmed≠undefined). 비활성: imported/legacy.
describe('시놉시스 pill 렌더/활성 조건 (§v2.10/§v2.11 → §v2.12 B)', () => {
  it('input.type=title + charactersConfirmed=false → 시놉시스 pill 활성 렌더(무배지)', () => {
    render(<StoryView pipeline={reopenedTitleUnconfirmed()} />)
    const pill = pillOf('시놉시스')
    expect(pill).toBeTruthy()
    // 진입 탭은 실행 스텝의 상태 자리를 갖지 않는다.
    expect(pill.querySelector('.story-rail-num')).toBeNull()
    expect(pill.classList.contains('story-step-disabled')).toBe(false)
    // 설정(0)·리서치(1) 뒤 — 진입 탭 세 번째
    const gates = [...document.querySelectorAll('.story-gate-tab')]
    expect(gates.indexOf(pill)).toBe(2)
  })

  it('input.type=pasted + charactersConfirmed=false → 시놉시스 pill 활성', () => {
    const p = pipeline({ scriptText: '붙여넣은 대본', charactersConfirmed: false })
    p.state.input = { type: 'pasted', title: 'T', options: {} }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    expect(queryPill('시놉시스')).toBeTruthy()
    expect(queryPill('시놉시스').classList.contains('story-step-disabled')).toBe(false)
  })

  it('charactersConfirmed=true(확정 완료)여도 title/pasted면 pill 활성(통과 표시)', () => {
    const p = pipeline({ scriptText: '완성 대본', charactersConfirmed: true })
    p.state.input = { type: 'title', title: 'T', options: {} }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    expect(queryPill('시놉시스')).toBeTruthy()
    expect(queryPill('시놉시스').classList.contains('story-step-disabled')).toBe(false)
  })

  it('input.type=imported(비 title/pasted) → pill은 렌더되나 비활성(클릭 불가)', () => {
    const p = pipeline({ scriptText: '임포트 대본', charactersConfirmed: false })
    p.state.input = { type: 'imported', title: 'T', options: {} }
    render(<StoryView pipeline={p} />)
    const pill = queryPill('시놉시스')
    expect(pill).toBeTruthy()
    expect(pill.classList.contains('story-step-disabled')).toBe(true)
    fireEvent.click(pill)
    expect(screen.queryByTestId('story-synopsis')).toBeNull() // 클릭해도 게이트 미진입
  })

  it('input 없음(continue/manual 등) → pill 렌더 + 비활성', () => {
    render(<StoryView pipeline={pipeline({ scriptText: '기존 대본' })} />)
    const pill = queryPill('시놉시스')
    expect(pill).toBeTruthy()
    expect(pill.classList.contains('story-step-disabled')).toBe(true)
  })

  it('legacy-done(charactersConfirmed=undefined + script done) → pill 렌더 + 비활성', () => {
    const p = pipeline({ scriptText: '레거시 대본' })
    p.state.input = { type: 'title', title: 'T', options: {} }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    const pill = queryPill('시놉시스')
    expect(pill).toBeTruthy()
    expect(pill.classList.contains('story-step-disabled')).toBe(true)
    fireEvent.click(pill)
    expect(screen.queryByTestId('story-synopsis')).toBeNull()
  })

  // §v2.12 B 버그 고정: "설정 탭 진입 시 시놉시스 사라짐" — setup phase에서도 title/pasted면
  // pill이 활성으로 남고, 클릭하면 synopsis 게이트로 복귀한다.
  it('설정 탭 진입(setup phase)해도 시놉시스 pill이 활성으로 남는다(사라짐 버그 해소)', () => {
    render(<StoryView pipeline={reopenedTitleUnconfirmed()} />)
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    // 설정 탭으로 이동
    fireEvent.click(pillOf('설정'))
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    const pill = queryPill('시놉시스')
    expect(pill).toBeTruthy()
    expect(pill.classList.contains('story-step-disabled')).toBe(false)
    // 클릭 → synopsis 게이트 복귀
    fireEvent.click(pill)
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
  })
})

describe('setup 시작 → synopsis phase 전이 (§v2.8 B1)', () => {
  it('제목 경로: [시작] → synopsis phase + generateSynopsis({type:title}) 호출, start는 호출 안 함', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: '운수 좋은 날' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    expect(p.generateSynopsis).toHaveBeenCalledWith({
      type: 'title',
      title: '운수 좋은 날',
      options: expect.objectContaining({ genre: 'bespoke', language: 'ko' }),
    })
    expect(p.start).not.toHaveBeenCalled()
    // 스텝퍼 시놉시스 pill이 active
    expect(pillOf('시놉시스').classList.contains('active')).toBe(true)
  })

  it('붙여넣기 경로: [시작] → start(script,{pastedScript}) 선행 → synopsis phase + 역추출 generateSynopsis({type:pasted})', async () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/붙여넣/), { target: { value: '내가 쓴 대본' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
    // 현행 유지: 대본 영속 start가 먼저
    expect(p.start).toHaveBeenCalledWith('script', expect.objectContaining({
      pastedScript: '내가 쓴 대본',
      input: { type: 'pasted', title: '' },
    }))
    expect(p.generateSynopsis).toHaveBeenCalledWith({
      type: 'pasted',
      pastedScript: '내가 쓴 대본',
      options: expect.any(Object),
    })
    // 순서: start('script') → generateSynopsis (§v2.8 B1)
    expect(p.start.mock.invocationCallOrder[0]).toBeLessThan(p.generateSynopsis.mock.invocationCallOrder[0])
  })

  it('붙여넣기 모드 synopsis 패널도 (대본 역추출) 줄거리를 편집 노출 + [등장인물 확정] 버튼', async () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/붙여넣/), { target: { value: '내가 쓴 대본' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
    // pasted 도 대본에서 역추출한 시놉시스를 편집 가능하게 노출한다(구조/hook/몰입감 리뷰).
    await waitFor(() => expect(screen.getByLabelText('줄거리')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '등장인물 확정' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이 시놉시스로 대본 생성' })).toBeNull()
  })
})

describe('synopsis 패널 — 줄거리/등장인물 편집', () => {
  it('재오픈(title 미확정): 저장된 줄거리와 등장인물 카드가 편집 가능하게 표시된다', async () => {
    render(<StoryView pipeline={reopenedTitleUnconfirmed()} />)
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    // 줄거리는 대본과 같은 Lexical 편집기 — value가 아니라 textContent이고, SyncPlugin이 effect에서 채운다.
    await waitFor(() => expect(screen.getByLabelText('줄거리')).toHaveTextContent('저장된 줄거리'))
    expect(screen.getByLabelText('이름')).toHaveValue('리안')
    expect(screen.getByLabelText('출신')).toHaveValue('한국인') // §v2.12 ethnicity 칸
  })

  it('§v2.12: 출신(ethnicity) 편집 후 확정하면 confirmSynopsis characters에 반영된다', async () => {
    const p = reopenedTitleUnconfirmed()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByLabelText('출신'), { target: { value: 'Korean' } })
    fireEvent.click(screen.getByRole('button', { name: '이 시놉시스로 대본 생성' }))
    await waitFor(() => expect(p.confirmSynopsis).toHaveBeenCalledWith({
      synopsisMd: '저장된 줄거리',
      characters: [expect.objectContaining({ id: '리안', ethnicity: 'Korean' })],
    }))
  })

  it('등장인물 성별 select 편집 + 행 추가/삭제(로컬 편집 상태)', () => {
    render(<StoryView pipeline={reopenedTitleUnconfirmed()} />)
    // 성별 변경
    fireEvent.change(screen.getByLabelText('성별'), { target: { value: 'female' } })
    expect(screen.getByLabelText('성별')).toHaveValue('female')
    // 행 추가
    fireEvent.click(screen.getByRole('button', { name: /행 추가/ }))
    expect(screen.getAllByLabelText('이름')).toHaveLength(2)
    // 행 삭제
    fireEvent.click(screen.getAllByRole('button', { name: '행 삭제' })[1])
    expect(screen.getAllByLabelText('이름')).toHaveLength(1)
  })

  it('생성 완료(generateSynopsis resolve) 시 줄거리/등장인물 편집 상태가 결과로 채워진다', async () => {
    const p = pipeline({
      generateSynopsis: vi.fn().mockResolvedValue({
        synopsisMd: '생성된 줄거리',
        characters: [{ name: '강산', gender: 'male' }],
      }),
    })
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    await waitFor(() => expect(screen.getByLabelText('줄거리')).toHaveTextContent('생성된 줄거리'))
    expect(screen.getByLabelText('이름')).toHaveValue('강산')
    expect(screen.getByLabelText('성별')).toHaveValue('male')
  })
})

describe('확정 버튼 (§v2.9)', () => {
  it('title: [이 시놉시스로 대본 생성] = confirmSynopsis 선행 → start(script,{synopsis}) + editor 전이', async () => {
    const p = reopenedTitleUnconfirmed({ scriptText: '' })
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByLabelText('성별'), { target: { value: 'female' } })
    fireEvent.click(screen.getByRole('button', { name: '이 시놉시스로 대본 생성' }))
    await waitFor(() => expect(p.start).toHaveBeenCalled())
    expect(p.confirmSynopsis).toHaveBeenCalledWith({
      synopsisMd: '저장된 줄거리',
      characters: [expect.objectContaining({ id: '리안', name: '리안', gender: 'female', age: '20대', role: '주인공' })],
    })
    // 커밋(confirm)이 재생성(start)보다 선행
    expect(p.confirmSynopsis.mock.invocationCallOrder[0]).toBeLessThan(p.start.mock.invocationCallOrder[0])
    expect(p.start).toHaveBeenCalledWith('script', expect.objectContaining({
      input: { type: 'title', title: '복원 제목' },
      synopsis: '저장된 줄거리',
      options: expect.any(Object),
    }))
    await waitFor(() => expect(screen.getByTestId('story-editor')).toBeInTheDocument())
  })

  it('title: 줄거리가 공백이면 확정 버튼 비활성', () => {
    render(<StoryView pipeline={reopenedTitleUnconfirmed({ synopsisText: '   ' })} />)
    expect(screen.getByRole('button', { name: '이 시놉시스로 대본 생성' })).toBeDisabled()
  })

  it('pasted: [등장인물 확정] = confirmSynopsis만(synopsisMd:"") — start 재호출 없음 + editor 전이', async () => {
    const p = pipeline({
      scriptText: '붙여넣은 대본',
      charactersConfirmed: false,
      characters: [{ id: '리안', name: '리안', gender: 'female', age: '', role: '', appearance: '' }],
    })
    p.state.input = { type: 'pasted', title: 'T', options: {} }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '등장인물 확정' }))
    await waitFor(() => expect(p.confirmSynopsis).toHaveBeenCalledWith({
      synopsisMd: '',
      characters: [expect.objectContaining({ id: '리안', gender: 'female' })],
    }))
    await waitFor(() => expect(screen.getByTestId('story-editor')).toBeInTheDocument())
    expect(p.start).not.toHaveBeenCalled()
  })

  it('[시놉시스 다시] → generateSynopsis 재호출', () => {
    const p = reopenedTitleUnconfirmed()
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '시놉시스 다시' }))
    expect(p.generateSynopsis).toHaveBeenCalledWith(expect.objectContaining({ type: 'title', title: '복원 제목' }))
  })

  it("'설정으로' 버튼은 없고 상단 스텝퍼 [설정] 탭으로 setup 에 간다", () => {
    render(<StoryView pipeline={reopenedTitleUnconfirmed()} />)
    // 중복 제거: synopsis phase의 '설정으로' 버튼은 없다(스텝퍼 0번 설정 탭으로 대체).
    expect(screen.queryByRole('button', { name: /설정으로/ })).toBeNull()
    fireEvent.click(document.querySelector('.story-step-setup'))
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    expect(screen.queryByTestId('story-synopsis')).toBeNull()
  })
})

describe('synopsis phase bottom generic 컨트롤 suppress', () => {
  it('synopsis phase에서는 하단 제네릭 컨트롤(.story-controls)이 렌더되지 않는다(게이트 우회 방지)', () => {
    const { container } = render(<StoryView pipeline={reopenedTitleUnconfirmed()} />)
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    expect(container.querySelector('.story-controls')).toBeNull()
    expect(screen.queryByRole('button', { name: '대본 생성' })).toBeNull()
    expect(screen.queryByRole('button', { name: '시작' })).toBeNull()
  })
})

describe('재오픈 hydrate phase 판정 (§v2.11 3-state)', () => {
  it('① type∉{title,pasted}: charactersConfirmed=false여도 synopsis 미적용(현행 editor)', () => {
    const p = pipeline({ scriptText: '임포트 대본', charactersConfirmed: false })
    p.state.input = { type: 'imported', title: 'T', options: {} }
    render(<StoryView pipeline={p} />)
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('story-synopsis')).toBeNull()
  })

  it('② charactersConfirmed=true: 기존 규칙(script done → editor)', () => {
    const p = pipeline({ scriptText: '완성 대본', charactersConfirmed: true })
    p.state.input = { type: 'title', title: 'T', options: {} }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('story-synopsis')).toBeNull()
  })

  it('③ charactersConfirmed=false: script done이어도 synopsis phase(pasted 게이트 보존)', () => {
    const p = pipeline({ scriptText: '붙여넣은 대본', charactersConfirmed: false })
    p.state.input = { type: 'pasted', title: 'T', options: {} }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    expect(screen.queryByTestId('story-editor')).toBeNull()
  })

  it('④ charactersConfirmed=undefined(legacy): script done이면 editor(synopsis 강제 안 함)', () => {
    const p = pipeline({ scriptText: '레거시 대본' })
    p.state.input = { type: 'title', title: 'T', options: {} }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    expect(screen.getByTestId('story-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('story-synopsis')).toBeNull()
  })

  it('④ legacy + script 미완 + scriptText 없음 → 기존 규칙(setup)', () => {
    const p = pipeline()
    p.state.input = { type: 'title', title: 'T', options: {} }
    render(<StoryView pipeline={p} />)
    expect(screen.getByTestId('story-setup')).toBeInTheDocument()
    expect(screen.queryByTestId('story-synopsis')).toBeNull()
  })

  it('hydrate 지연 도착: charactersConfirmed=false가 늦게 rerender로 와도 synopsis phase로 복원된다', () => {
    const { rerender } = render(<StoryView pipeline={pipeline({ state: null })} />)
    rerender(<StoryView pipeline={reopenedTitleUnconfirmed()} />)
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
  })
})

describe('스텝퍼 라우팅 (synopsis 게이트 탭)', () => {
  it('시놉시스 pill 클릭 → synopsis phase(다른 패널에서 복귀, generic leak 차단)', () => {
    const p = reopenedTitleUnconfirmed()
    p.state.steps.script.status = 'done'
    p.state.steps.scenes.status = 'done'
    render(<StoryView pipeline={p} />)
    // 씬 분리 패널로 나갔다가
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    expect(screen.queryByTestId('story-synopsis')).toBeNull()
    // 시놉시스 게이트 탭 클릭 → 복귀
    fireEvent.click(screen.getByRole('button', { name: '시놉시스' }))
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    expect(pillOf('시놉시스').classList.contains('active')).toBe(true)
  })
})

// FIX-2(UI 이중 방어): 미확정(type∈{title,pasted} && charactersConfirmed===false)이면 Run All과
// scenes/audio/prompts 진행 버튼을 disable — main start() 가드('unconfirmed')와 이중.
describe('미확정 게이트 UI (FIX-2)', () => {
  const reopenedPastedUnconfirmed = () => {
    const p = pipeline({
      scriptText: '붙여넣은 대본',
      charactersConfirmed: false,
      characters: [{ id: '민수', name: '민수', gender: 'male', age: '', role: '', appearance: '' }],
    })
    p.state.input = { type: 'pasted', title: 'T', options: {} }
    p.state.steps.script.status = 'done'
    return p
  }

  it('미확정이면 [전체 진행](Run All) 비활성', () => {
    render(<StoryView pipeline={reopenedPastedUnconfirmed()} />)
    expect(screen.getByRole('button', { name: '전체 진행' })).toBeDisabled()
  })

  it('미확정이면 씬 분리 탭 하단 [▶ 진행] 비활성', () => {
    render(<StoryView pipeline={reopenedPastedUnconfirmed()} />)
    fireEvent.click(screen.getByRole('button', { name: '씬 분리' }))
    expect(screen.getByRole('button', { name: '씬 분리 실행' })).toBeDisabled()
  })

  // FIX-6(R2): 미확정 중 대본 탭은 editor로 열리지 않고 synopsis phase로 라우팅된다 —
  // editor의 다시쓰기/이어쓰기(start('script',{rewrite|continue}))로 게이트를 우회하지 못한다(§v2.8 B1).
  it('미확정이면 대본 탭 클릭 → synopsis phase 유지(editor 미진입 — rewrite/continue 접근 불가)', () => {
    const p = reopenedPastedUnconfirmed()
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    expect(screen.queryByTestId('story-editor')).toBeNull()
    expect(screen.queryByRole('button', { name: '다시쓰기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '이어쓰기' })).toBeNull()
    expect(p.start).not.toHaveBeenCalled()
  })

  it('확정(charactersConfirmed=true) 후에는 Run All/분리시작이 정상 활성', () => {
    const p = reopenedPastedUnconfirmed()
    p.charactersConfirmed = true
    render(<StoryView pipeline={p} />)
    expect(screen.getByRole('button', { name: '전체 진행' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '대본' }))
    expect(screen.getByRole('button', { name: '분리시작' })).toBeEnabled()
  })

  it('legacy(charactersConfirmed=undefined)는 게이트 미적용 — Run All 활성', () => {
    const p = pipeline({ scriptText: '레거시 대본' })
    p.state.input = { type: 'title', title: 'T', options: {} }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    expect(screen.getByRole('button', { name: '전체 진행' })).toBeEnabled()
  })
})

// FIX-4(§3.3 abort 대칭): synopsis 생성 중 [중단] 버튼 → pipeline.abort() (main abort()는 이미
// synopsisController 중단 대칭 구현 — 호출만).
describe('synopsis 생성 중 [중단] (FIX-4)', () => {
  it('synopsisGenerating 중 synopsis 패널에 [중단] 버튼이 렌더되고 클릭 시 abort를 호출한다', () => {
    const p = reopenedTitleUnconfirmed({ synopsisGenerating: true })
    render(<StoryView pipeline={p} />)
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: '⏹ 중단' })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(p.abort).toHaveBeenCalled()
  })

  it('생성 중이 아니면 synopsis 패널에 [중단] 버튼이 없다', () => {
    render(<StoryView pipeline={reopenedTitleUnconfirmed()} />)
    expect(screen.queryByRole('button', { name: '⏹ 중단' })).toBeNull()
  })
})

// '시나리오'는 영화 시나리오 형식(씬 번호·슬러그라인·지문)을 가리킨다. 이 스텝의 산출물은
// 나레이션·대사가 흐르는 산문이고 씬 분리는 다음 스텝이라, '대본'이 맞다.
describe('리네임 — 시나리오→대본', () => {
  it('스텝퍼 script 라벨이 "대본"으로 렌더된다("시나리오" 라벨 없음)', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(pillOf('대본')).toBeTruthy()
    expect(screen.queryByText('시나리오')).toBeNull()
  })
})
