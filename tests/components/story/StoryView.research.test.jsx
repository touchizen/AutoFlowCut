/**
 * 리서치 스텝 UI 슬라이스(S9) — StoryView research phase 통합 테스트.
 * spec: docs/superpowers/specs/2026-07-07-youtube-research-step-design.md §2.1/§3.6/§3.8
 * - 리서치 pill 활성/비활성(researchEnabled — synopsisEnabled 미러) + 클릭 라우팅
 * - 재오픈 hydrate: research draft(미확정) → research phase 복원, confirmed → synopsis
 * - 검색 → 카드 그리드 렌더, 선택 → 자막 가져오기 호출 + videoId별 진행 표시
 * - 구조분석/팩트체크 결과 렌더(verdict 배지 색)
 * - [이 리서치로 확정]→commit→synopsis 전이, [건너뛰기]→skip→synopsis
 * - research phase에서 하단 제네릭 컨트롤 미노출(N2 게이트 누출 회귀)
 * - 시놉시스 게이트 "리서치 컨텍스트 포함" 토글(M2/Q5 수동 주입)
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
  research: null,
  researchFetchProgress: {},
  researchSearch: vi.fn().mockResolvedValue({ videos: [] }),
  researchFetchTranscripts: vi.fn().mockResolvedValue({ transcripts: [] }),
  researchAnalyze: vi.fn().mockResolvedValue({ analysis: {} }),
  researchFactCheck: vi.fn().mockResolvedValue({ verifiedClaims: [] }),
  researchCommit: vi.fn().mockResolvedValue({ ok: true }),
  researchSkip: vi.fn().mockResolvedValue({ ok: true }),
  researchSelect: vi.fn().mockResolvedValue({ ok: true }),
  ...over,
})

const VIDEOS = [
  { videoId: 'vidAAA0001', title: '야담 영상 A', channelTitle: '채널A', viewCount: 12345, thumbnailUrl: 'https://i.ytimg.com/vi/a/hq.jpg' },
  { videoId: 'vidBBB0002', title: '야담 영상 B', channelTitle: '채널B', viewCount: 999, thumbnailUrl: 'https://i.ytimg.com/vi/b/hq.jpg' },
]

const ANALYSIS = {
  structure: [{ beat: '발단', summary: '주인공이 곤경에 처한다' }, { beat: '절정', summary: '반전이 드러난다' }],
  claims: [{ claim: '조선시대 실화 기반', sources: ['vidAAA0001'] }],
  commonThemes: ['권선징악'],
}

const researchDraft = (over = {}) => ({
  confirmed: false,
  keyword: '조선 야담',
  videos: VIDEOS,
  selectedVideoIds: [],
  transcripts: {},
  analysis: null,
  verifiedClaims: [],
  ...over,
})

// 재오픈된 title 경로 미확정 프로젝트(리서치/시놉시스 게이트 복원 대상).
const reopenedTitle = (pOver = {}) => {
  const p = pipeline({
    synopsisText: '저장된 줄거리',
    hasSynopsis: true,
    characters: [],
    charactersConfirmed: false,
    ...pOver,
  })
  p.state.input = p.state.input || { type: 'title', title: '복원 제목', options: {} }
  return p
}

const pillOf = (label) => screen.getByText(label).closest('.story-step-pill')

describe('리서치 pill 활성/비활성 + 라우팅 (§2.1/§3.6)', () => {
  it('신규 title 경로(charactersConfirmed≠undefined)면 pill 활성 — 클릭 시 research phase 진입', () => {
    render(<StoryView pipeline={reopenedTitle()} />)
    const pill = pillOf('리서치')
    expect(pill.classList.contains('story-step-disabled')).toBe(false)
    fireEvent.click(pill)
    expect(screen.getByTestId('story-research')).toBeInTheDocument()
    expect(pill.classList.contains('active')).toBe(true)
  })

  it('legacy(charactersConfirmed=undefined)는 pill 비활성 — 클릭해도 research 미진입', () => {
    const p = pipeline({ scriptText: '레거시 대본' })
    p.state.input = { type: 'title', title: 'T', options: {} }
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    const pill = pillOf('리서치')
    expect(pill.classList.contains('story-step-disabled')).toBe(true)
    fireEvent.click(pill)
    expect(screen.queryByTestId('story-research')).toBeNull()
  })

  it('imported(type∉{title,pasted})는 pill 비활성', () => {
    const p = pipeline({ scriptText: '임포트 대본', charactersConfirmed: false })
    p.state.input = { type: 'imported', title: 'T', options: {} }
    render(<StoryView pipeline={p} />)
    expect(pillOf('리서치').classList.contains('story-step-disabled')).toBe(true)
  })

  // M1(Fable R1): 신규 프로젝트는 charactersConfirmed가 in-session 전파되지 않아(undefined)
  // 기존 조건으로는 리서치 phase에 영원히 도달 불능 — 시놉시스 게이트가 뜨는 시점부터
  // (synopsisEnabled 재사용) 리서치 pill이 함께 활성이어야 한다(스텝 순서 ①리서치→②시놉시스).
  it('신규 title 경로: [✨ 시작] 직후(시놉시스 게이트)부터 리서치 pill 활성 — 클릭 시 research phase 진입 (M1)', async () => {
    const p = pipeline() // charactersConfirmed=undefined, state.input 없음 — 순수 신규
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: '새 이야기' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(await screen.findByTestId('story-synopsis')).toBeInTheDocument()
    const pill = pillOf('리서치')
    expect(pill.classList.contains('story-step-disabled')).toBe(false)
    fireEvent.click(pill)
    expect(screen.getByTestId('story-research')).toBeInTheDocument()
    expect(pill.classList.contains('active')).toBe(true)
  })

  // 버그픽스(2026-07-08): 리서치는 "이미 있는 대본"에 무의미 — 붙여넣기(pasted)는 시놉시스와
  // 달리 리서치 비활성(imported/legacy와 동일 판정). M1 시점의 "pasted도 활성"을 개정.
  it('신규 pasted 경로: 붙여넣기 [✨ 시작] 후 리서치 pill 비활성(대본이 이미 있음)', async () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/붙여넣거나/), { target: { value: '붙여넣은 대본' } })
    fireEvent.click(screen.getByRole('button', { name: '시작' }))
    expect(await screen.findByTestId('story-synopsis')).toBeInTheDocument()
    expect(pillOf('리서치').classList.contains('story-step-disabled')).toBe(true)
  })

  it('재오픈 pasted 미확정 프로젝트: 시놉시스 pill은 활성이지만 리서치 pill은 비활성', () => {
    const p = pipeline({ scriptText: '붙여넣은 대본', charactersConfirmed: false })
    p.state.input = { type: 'pasted', title: 'T', options: {} }
    render(<StoryView pipeline={p} />)
    expect(pillOf('시놉시스').classList.contains('story-step-disabled')).toBe(false)
    expect(pillOf('리서치').classList.contains('story-step-disabled')).toBe(true)
  })
})

// 버그픽스(2026-07-08): 리서치는 ① 첫 실행 스텝(설정 다음·시놉시스 앞)이고 키워드로 검색하므로
// 제목·[✨ 시작]이 불필요하다 — 신규(title 경로) 프로젝트는 setup phase(제목/시작 전)부터
// 리서치 pill이 활성이어야 한다. pasted/imported/legacy는 비활성 유지.
describe('신규 프로젝트 setup phase 리서치 진입 — 제목·시작 전 (버그픽스)', () => {
  it('순수 신규 프로젝트(setup, 제목/시작 전): 리서치 pill 활성 — 클릭 시 research phase 진입', () => {
    render(<StoryView pipeline={pipeline()} />)
    const pill = pillOf('리서치')
    expect(pill.classList.contains('story-step-disabled')).toBe(false)
    fireEvent.click(pill)
    expect(screen.getByTestId('story-research')).toBeInTheDocument()
    expect(pill.classList.contains('active')).toBe(true)
  })

  it('setup에서 대본을 붙여넣으면(로컬 입력) 리서치 pill 비활성 — 붙여넣기 경로는 리서치 무의미', () => {
    render(<StoryView pipeline={pipeline()} />)
    fireEvent.change(screen.getByPlaceholderText(/붙여넣거나/), { target: { value: '붙여넣을 대본' } })
    expect(pillOf('리서치').classList.contains('story-step-disabled')).toBe(true)
  })

  it('setup에서 리서치 진입 → [건너뛰기] → synopsis phase(기존 흐름 유지)', async () => {
    const p = pipeline({ research: researchDraft() })
    render(<StoryView pipeline={p} />)
    fireEvent.click(pillOf('리서치'))
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    await waitFor(() => expect(p.researchSkip).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
  })

  // 리서치는 제목 없이 완료 가능 — 단 시놉시스 생성(generateSynopsis)/확정(start script)은
  // 제목이 필요하므로, 제목이 비어 있으면 안내를 띄우고 생성/확정 버튼을 비활성한다
  // (사용자가 [설정으로]로 돌아가 기존 setup 제목란에 입력 — 제목 강제 생성은 하지 않음).
  it('제목 없이 리서치 확정 → synopsis phase 전이 + 제목 입력 안내 + 생성/확정 비활성', async () => {
    const p = pipeline({ research: researchDraft({ analysis: ANALYSIS }) })
    render(<StoryView pipeline={p} />)
    fireEvent.click(pillOf('리서치'))
    fireEvent.click(screen.getByRole('button', { name: '이 리서치로 확정' }))
    await waitFor(() => expect(p.researchCommit).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
    expect(screen.getByText(/설정.*제목을 입력/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '시놉시스 다시' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '이 시놉시스로 시나리오 생성' })).toBeDisabled()
  })

  it('제목이 있으면(재오픈 title) synopsis phase에 안내 없음 + 생성 버튼 활성(회귀)', () => {
    render(<StoryView pipeline={reopenedTitle()} />)
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    expect(screen.queryByText(/설정.*제목을 입력/)).toBeNull()
    expect(screen.getByRole('button', { name: '시놉시스 다시' })).not.toBeDisabled()
  })
})

describe('재오픈 hydrate — research phase 복원 (§3.8 M6)', () => {
  it('research draft(미확정)가 있으면 research phase로 복원된다', () => {
    render(<StoryView pipeline={reopenedTitle({ research: researchDraft() })} />)
    expect(screen.getByTestId('story-research')).toBeInTheDocument()
    expect(screen.queryByTestId('story-synopsis')).toBeNull()
    // draft의 검색 결과 카드도 복원 표시
    expect(screen.getByText('야담 영상 A')).toBeInTheDocument()
  })

  it('research.confirmed=true면 synopsis phase로 복원(리서치 재진입 강제 안 함)', () => {
    render(<StoryView pipeline={reopenedTitle({ research: researchDraft({ confirmed: true, analysis: ANALYSIS }) })} />)
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    expect(screen.queryByTestId('story-research')).toBeNull()
  })

  it('research 없음(null)이면 기존 synopsis phase 복원 그대로(회귀)', () => {
    render(<StoryView pipeline={reopenedTitle()} />)
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
  })
})

describe('키워드 검색 → 영상 카드 그리드 (§3.6)', () => {
  it('키워드 입력 + [검색] → researchSearch({keyword}) 호출', async () => {
    const p = reopenedTitle({ research: researchDraft({ videos: [], keyword: '' }) })
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/키워드/), { target: { value: '조선 괴담' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => expect(p.researchSearch).toHaveBeenCalledWith({ keyword: '조선 괴담' }))
  })

  it('research.videos를 카드로 렌더 — 썸네일 img·제목·채널·조회수·체크박스', () => {
    render(<StoryView pipeline={reopenedTitle({ research: researchDraft() })} />)
    expect(screen.getByRole('img', { name: '야담 영상 A' })).toHaveAttribute('src', 'https://i.ytimg.com/vi/a/hq.jpg')
    expect(screen.getByText('야담 영상 B')).toBeInTheDocument()
    expect(screen.getByText(/채널A/)).toBeInTheDocument()
    expect(screen.getByText(/12,345/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '야담 영상 A 선택' })).not.toBeChecked()
  })

  it('URL 수동 추가 — 유효한 watch URL이면 카드로 추가 + 자동 선택', () => {
    render(<StoryView pipeline={reopenedTitle({ research: researchDraft() })} />)
    fireEvent.change(screen.getByPlaceholderText(/URL/), { target: { value: 'https://www.youtube.com/watch?v=abcDEF12345' } })
    fireEvent.click(screen.getByRole('button', { name: 'URL 추가' }))
    expect(screen.getByRole('checkbox', { name: 'abcDEF12345 선택' })).toBeChecked()
  })

  it('binary-not-found 에러 → yt-dlp 설치 안내 렌더(§3.7)', async () => {
    const p = reopenedTitle({
      research: researchDraft({ videos: [], keyword: '' }),
      researchSearch: vi.fn().mockResolvedValue({ error: 'binary-not-found' }),
    })
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/키워드/), { target: { value: '괴담' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => expect(screen.getByText(/yt-dlp/)).toBeInTheDocument())
  })
})

describe('자막 가져오기 + 진행 표시 (§3.6)', () => {
  it('카드 선택 후 [자막 가져오기] → researchFetchTranscripts({videoIds:선택})', async () => {
    const p = reopenedTitle({ research: researchDraft() })
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '야담 영상 A 선택' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '야담 영상 B 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '자막 가져오기' }))
    await waitFor(() => expect(p.researchFetchTranscripts).toHaveBeenCalledWith({ videoIds: ['vidAAA0001', 'vidBBB0002'] }))
  })

  it('선택 0개면 [자막 가져오기] 비활성', () => {
    render(<StoryView pipeline={reopenedTitle({ research: researchDraft() })} />)
    expect(screen.getByRole('button', { name: '자막 가져오기' })).toBeDisabled()
  })

  it('researchFetchProgress를 videoId별 카드 배지로 표시(running/done/error)', () => {
    const p = reopenedTitle({
      research: researchDraft({ selectedVideoIds: ['vidAAA0001', 'vidBBB0002'] }),
      researchFetchProgress: { vidAAA0001: 'running', vidBBB0002: 'error' },
    })
    render(<StoryView pipeline={p} />)
    const cardA = screen.getByText('야담 영상 A').closest('.story-research-card')
    const cardB = screen.getByText('야담 영상 B').closest('.story-research-card')
    expect(within(cardA).getByText('진행 중')).toBeInTheDocument()
    expect(within(cardB).getByText(/오류|자막 없음/)).toBeInTheDocument()
  })

  it('hydrate된 transcripts 메타(ok/error)도 카드 배지로 복원 표시', () => {
    const p = reopenedTitle({
      research: researchDraft({
        selectedVideoIds: ['vidAAA0001', 'vidBBB0002'],
        transcripts: { vidAAA0001: { ok: true, lang: 'ko' }, vidBBB0002: { ok: false, error: 'no-transcript' } },
      }),
    })
    render(<StoryView pipeline={p} />)
    const cardA = screen.getByText('야담 영상 A').closest('.story-research-card')
    const cardB = screen.getByText('야담 영상 B').closest('.story-research-card')
    expect(within(cardA).getByText(/자막 확보/)).toBeInTheDocument()
    expect(within(cardB).getByText('자막 없음')).toBeInTheDocument()
    // 선택 상태도 복원
    expect(screen.getByRole('checkbox', { name: '야담 영상 A 선택' })).toBeChecked()
  })

  it('자막 취득 진행 중 [중단] 버튼 → abort 호출(MINOR 4)', async () => {
    const p = reopenedTitle({
      research: researchDraft({ selectedVideoIds: ['vidAAA0001'] }),
      researchFetchTranscripts: vi.fn(() => new Promise(() => {})),
    })
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '자막 가져오기' }))
    const stop = await screen.findByRole('button', { name: '⏹ 중단' })
    fireEvent.click(stop)
    expect(p.abort).toHaveBeenCalled()
  })
})

describe('구조분석 · 팩트체크 (§3.4/§3.5)', () => {
  it('[구조분석] → researchAnalyze({videoIds:선택}) 호출', async () => {
    const p = reopenedTitle({
      research: researchDraft({
        selectedVideoIds: ['vidAAA0001'],
        transcripts: { vidAAA0001: { ok: true, lang: 'ko' } },
      }),
    })
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '구조분석' }))
    await waitFor(() => expect(p.researchAnalyze).toHaveBeenCalledWith(expect.objectContaining({ videoIds: ['vidAAA0001'] })))
  })

  // M2(Fable R1): analyze/factcheck가 options 없이 호출되면 machine이 state.input.options
  // 폴백(리서치는 시놉시스보다 앞서므로 대부분 null) → DEFAULT_STORY_LLM/ko 고정으로
  // UI 엔진·언어 선택이 무시된다(D10 위반). 시놉시스/스크립트처럼 currentOptions()를 전달해야 한다.
  it('구조분석에 현재 UI 옵션(엔진·모델·언어)이 전달된다 (M2)', async () => {
    const p = reopenedTitle({
      research: researchDraft({
        selectedVideoIds: ['vidAAA0001'],
        transcripts: { vidAAA0001: { ok: true, lang: 'ko' } },
      }),
    })
    p.state.input.options = { engine: 'codex', model: 'gpt-5.5', language: 'en' }
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '구조분석' }))
    await waitFor(() => expect(p.researchAnalyze).toHaveBeenCalledWith(expect.objectContaining({
      videoIds: ['vidAAA0001'],
      options: expect.objectContaining({ engine: 'codex', model: 'gpt-5.5', language: 'en' }),
    })))
  })

  it('팩트체크에 현재 언어 옵션이 전달된다 (M2 — 엔진은 main이 Claude 강제, 언어만 반영)', async () => {
    const p = reopenedTitle({ research: researchDraft({ analysis: ANALYSIS }) })
    p.state.input.options = { language: 'en' }
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '팩트체크' }))
    await waitFor(() => expect(p.researchFactCheck).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ language: 'en' }),
    })))
  })

  it('analysis 결과(structure/claims/commonThemes)를 렌더', () => {
    render(<StoryView pipeline={reopenedTitle({ research: researchDraft({ analysis: ANALYSIS }) })} />)
    expect(screen.getByText('발단')).toBeInTheDocument()
    expect(screen.getByText('주인공이 곤경에 처한다')).toBeInTheDocument()
    expect(screen.getByText(/권선징악/)).toBeInTheDocument()
    expect(screen.getByText(/조선시대 실화 기반/)).toBeInTheDocument()
  })

  it('[팩트체크] → researchFactCheck 호출(analysis.claims 있을 때 활성)', async () => {
    const p = reopenedTitle({ research: researchDraft({ analysis: ANALYSIS }) })
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '팩트체크' }))
    await waitFor(() => expect(p.researchFactCheck).toHaveBeenCalled())
  })

  it('analysis 없으면 [팩트체크]/[이 리서치로 확정] 비활성', () => {
    render(<StoryView pipeline={reopenedTitle({ research: researchDraft() })} />)
    expect(screen.getByRole('button', { name: '팩트체크' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '이 리서치로 확정' })).toBeDisabled()
  })

  it('verifiedClaims verdict 배지 — supported/refuted/unverified 색 클래스 + evidence url', () => {
    const verifiedClaims = [
      { claim: '사실1', verdict: 'supported', evidence: [{ url: 'https://ex.com/1', note: '' }] },
      { claim: '사실2', verdict: 'refuted', evidence: [] },
      { claim: '사실3', verdict: 'unverified', evidence: [] },
    ]
    render(<StoryView pipeline={reopenedTitle({ research: researchDraft({ analysis: ANALYSIS, verifiedClaims }) })} />)
    expect(screen.getByText('검증됨').classList.contains('story-verdict-supported')).toBe(true)
    expect(screen.getByText('반박됨').classList.contains('story-verdict-refuted')).toBe(true)
    expect(screen.getByText('미검증').classList.contains('story-verdict-unverified')).toBe(true)
    expect(screen.getByRole('link', { name: /ex\.com/ })).toHaveAttribute('href', 'https://ex.com/1')
  })
})

describe('확정/건너뛰기 → synopsis 전이 (§3.6/§3.8)', () => {
  it('[이 리서치로 확정] → researchCommit({analysis, verifiedClaims}) → synopsis phase', async () => {
    const verifiedClaims = [{ claim: '사실1', verdict: 'supported', evidence: [] }]
    const p = reopenedTitle({ research: researchDraft({ analysis: ANALYSIS, verifiedClaims }) })
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '이 리서치로 확정' }))
    await waitFor(() => expect(p.researchCommit).toHaveBeenCalledWith({ analysis: ANALYSIS, verifiedClaims }))
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
    expect(screen.queryByTestId('story-research')).toBeNull()
  })

  it('[건너뛰기] → researchSkip → synopsis phase(리서치 없이)', async () => {
    const p = reopenedTitle({ research: researchDraft() })
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    await waitFor(() => expect(p.researchSkip).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('story-synopsis')).toBeInTheDocument())
  })
})

// m5(Fable R1): 수동 URL 카드·선택이 ResearchPanel 로컬에만 있으면 탭전환/재오픈 시 소실 —
// 선택 변경/URL 추가가 pipeline.researchSelect로 draft에 영속돼야 한다.
describe('선택·수동 URL 영속 (m5)', () => {
  it('카드 선택 토글 시 researchSelect({selectedVideoIds})로 영속한다', async () => {
    const p = reopenedTitle({ research: researchDraft() })
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '야담 영상 A 선택' }))
    await waitFor(() => expect(p.researchSelect).toHaveBeenCalledWith(
      expect.objectContaining({ selectedVideoIds: ['vidAAA0001'] }),
    ))
  })

  it('URL 수동 추가 시 researchSelect({manualVideos, selectedVideoIds})로 영속한다', async () => {
    const p = reopenedTitle({ research: researchDraft() })
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/URL/), { target: { value: 'https://youtu.be/manualXYZ01' } })
    fireEvent.click(screen.getByRole('button', { name: 'URL 추가' }))
    await waitFor(() => expect(p.researchSelect).toHaveBeenCalledWith(expect.objectContaining({
      selectedVideoIds: ['manualXYZ01'],
      manualVideos: [expect.objectContaining({ videoId: 'manualXYZ01' })],
    })))
  })
})

// N2(필수): research phase에서 하단 제네릭 컨트롤이 렌더되면 [시나리오 생성]으로 게이트가 우회된다.
describe('research phase 하단 제네릭 컨트롤 suppress (N2)', () => {
  it('research phase에서는 .story-controls가 렌더되지 않는다', () => {
    const { container } = render(<StoryView pipeline={reopenedTitle({ research: researchDraft() })} />)
    expect(screen.getByTestId('story-research')).toBeInTheDocument()
    expect(container.querySelector('.story-controls')).toBeNull()
    expect(screen.queryByRole('button', { name: '시나리오 생성' })).toBeNull()
    expect(screen.queryByRole('button', { name: '시작' })).toBeNull()
  })
})

// M2/Q5: 수동 주입 — 시놉시스 게이트의 토글이 유일 스위치.
describe('시놉시스 게이트 "리서치 컨텍스트 포함" 토글 (§3.6 M2/Q5)', () => {
  it('research.confirmed=true일 때만 토글 노출', () => {
    const { rerender } = render(<StoryView pipeline={reopenedTitle()} />)
    expect(screen.getByTestId('story-synopsis')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '리서치 컨텍스트 포함' })).toBeNull()
    rerender(<StoryView pipeline={reopenedTitle({ research: researchDraft({ confirmed: true, analysis: ANALYSIS }) })} />)
    expect(screen.getByRole('checkbox', { name: '리서치 컨텍스트 포함' })).toBeInTheDocument()
  })

  it('토글 ON + [시놉시스 다시] → generateSynopsis({useResearch:true})', () => {
    const p = reopenedTitle({ research: researchDraft({ confirmed: true, analysis: ANALYSIS }) })
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '리서치 컨텍스트 포함' }))
    fireEvent.click(screen.getByRole('button', { name: '시놉시스 다시' }))
    expect(p.generateSynopsis).toHaveBeenCalledWith(expect.objectContaining({ type: 'title', useResearch: true }))
  })

  it('토글 OFF(기본)면 useResearch 미전달(현행 그대로)', () => {
    const p = reopenedTitle({ research: researchDraft({ confirmed: true, analysis: ANALYSIS }) })
    render(<StoryView pipeline={p} />)
    fireEvent.click(screen.getByRole('button', { name: '시놉시스 다시' }))
    const call = p.generateSynopsis.mock.calls[0][0]
    expect(call.useResearch).toBeUndefined()
  })
})
