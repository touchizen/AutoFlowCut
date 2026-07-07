/**
 * ResearchPanel 단위 테스트 — spec §3.6/§7.
 * StoryView 통합(StoryView.research.test.jsx)과 별개로 패널 자체의 입력 검증·비활성 규칙·고지를 고정.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ResearchPanel from '../../../src/components/story/ResearchPanel.jsx'

const noop = async () => ({})
const baseProps = (over = {}) => ({
  research: null,
  fetchProgress: {},
  onSearch: vi.fn(noop),
  onFetch: vi.fn(noop),
  onAnalyze: vi.fn(noop),
  onFactCheck: vi.fn(noop),
  onCommit: vi.fn(noop),
  onSkip: vi.fn(noop),
  onAbort: vi.fn(),
  ...over,
})

describe('ResearchPanel 기본/입력 검증', () => {
  it('ToS 고지 문구를 렌더한다(§7 — 참고·재구성 용도)', () => {
    render(<ResearchPanel {...baseProps()} />)
    expect(screen.getByText(/저작권/)).toBeInTheDocument()
  })

  it('키워드가 공백이면 [검색]을 호출하지 않는다', () => {
    const p = baseProps()
    render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    expect(p.onSearch).not.toHaveBeenCalled()
  })

  it('유효하지 않은 URL이면 카드 추가 없이 오류 안내', () => {
    render(<ResearchPanel {...baseProps()} />)
    fireEvent.change(screen.getByPlaceholderText(/URL/), { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByRole('button', { name: 'URL 추가' }))
    expect(screen.getByText(/유효한 YouTube URL/)).toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('youtu.be/shorts URL도 videoId를 파싱해 카드로 추가한다', () => {
    render(<ResearchPanel {...baseProps()} />)
    fireEvent.change(screen.getByPlaceholderText(/URL/), { target: { value: 'https://youtu.be/shortID12345' } })
    fireEvent.click(screen.getByRole('button', { name: 'URL 추가' }))
    expect(screen.getByRole('checkbox', { name: 'shortID12345 선택' })).toBeChecked()
    fireEvent.change(screen.getByPlaceholderText(/URL/), { target: { value: 'https://www.youtube.com/shorts/shortsIDx99' } })
    fireEvent.click(screen.getByRole('button', { name: 'URL 추가' }))
    expect(screen.getByRole('checkbox', { name: 'shortsIDx99 선택' })).toBeChecked()
  })

  it('검색 결과가 없으면 빈 안내를 렌더', () => {
    render(<ResearchPanel {...baseProps()} />)
    expect(screen.getByText(/검색 결과가 여기에 표시됩니다/)).toBeInTheDocument()
  })

  it('선택 없으면 자막 가져오기 비활성, analysis 없으면 팩트체크/확정 비활성 — 건너뛰기는 항상 활성', () => {
    render(<ResearchPanel {...baseProps()} />)
    expect(screen.getByRole('button', { name: '자막 가져오기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '구조분석' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '팩트체크' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '이 리서치로 확정' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '건너뛰기' })).toBeEnabled()
  })
})

const VIDEO = { videoId: 'vidX0000001', title: '영상X', channelTitle: 'chX', viewCount: 10, thumbnailUrl: '' }
const researchWith = (over = {}) => ({
  confirmed: false, keyword: 'k', videos: [VIDEO], selectedVideoIds: [], transcripts: {}, analysis: null, verifiedClaims: [],
  ...over,
})

// m2(Fable R1): fetch의 binary-not-found가 progress error로만 와서 카드가 "자막 없음"으로만
// 보이면 설치 안내(§6/§3.7)로 이어지지 않는다 — fetchProgress의 error 코드로 설치 배너를 노출한다.
describe('fetchProgress error → 설치 배너/배지 (m2/m3)', () => {
  it('fetchProgress error=binary-not-found면 yt-dlp 설치 안내 배너를 렌더한다 (m2)', () => {
    render(<ResearchPanel {...baseProps({
      research: researchWith({ selectedVideoIds: [VIDEO.videoId] }),
      fetchProgress: { [VIDEO.videoId]: { status: 'error', error: 'binary-not-found' } },
    })} />)
    expect(screen.getByText(/yt-dlp/)).toBeInTheDocument()
  })

  it('객체형 fetchProgress {status}도 카드 배지로 표시한다 (m2 계약)', () => {
    render(<ResearchPanel {...baseProps({
      research: researchWith(),
      fetchProgress: { [VIDEO.videoId]: { status: 'running' } },
    })} />)
    expect(screen.getByText('진행 중')).toBeInTheDocument()
  })

  it('hydrate된 transcripts 메타의 binary-not-found도 설치 배너로 이어진다 (m2 재오픈)', () => {
    render(<ResearchPanel {...baseProps({
      research: researchWith({ transcripts: { [VIDEO.videoId]: { ok: false, error: 'binary-not-found' } } }),
    })} />)
    expect(screen.getByText(/yt-dlp/)).toBeInTheDocument()
  })

  it('abort된 fetch(error=aborted)는 "자막 없음" 대신 중단 배지 (m3)', () => {
    render(<ResearchPanel {...baseProps({
      research: researchWith(),
      fetchProgress: { [VIDEO.videoId]: { status: 'error', error: 'aborted' } },
    })} />)
    expect(screen.getByText('중단됨')).toBeInTheDocument()
    expect(screen.queryByText('자막 없음')).toBeNull()
  })
})

// m5(Fable R1): 수동 URL 카드·fetch 전 선택은 로컬 state뿐이라 탭전환/재오픈에 소실 —
// 변경 즉시 onSelect(researchSelect)로 draft에 영속한다.
describe('선택·수동카드 영속 콜백 (m5)', () => {
  it('체크박스 토글 시 onSelect({selectedVideoIds, manualVideos}) 호출', () => {
    const p = baseProps({ research: researchWith(), onSelect: vi.fn(noop) })
    render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '영상X 선택' }))
    expect(p.onSelect).toHaveBeenCalledWith({ selectedVideoIds: [VIDEO.videoId], manualVideos: [] })
    fireEvent.click(screen.getByRole('checkbox', { name: '영상X 선택' }))
    expect(p.onSelect).toHaveBeenLastCalledWith({ selectedVideoIds: [], manualVideos: [] })
  })

  it('URL 추가 시 onSelect에 수동 카드와 선택을 함께 영속', () => {
    const p = baseProps({ onSelect: vi.fn(noop) })
    render(<ResearchPanel {...p} />)
    fireEvent.change(screen.getByPlaceholderText(/URL/), { target: { value: 'https://youtu.be/manualAB123' } })
    fireEvent.click(screen.getByRole('button', { name: 'URL 추가' }))
    expect(p.onSelect).toHaveBeenCalledWith({
      selectedVideoIds: ['manualAB123'],
      manualVideos: [expect.objectContaining({ videoId: 'manualAB123' })],
    })
  })
})

// m7(Fable R1) 미러: 새 검색이 draft의 선택을 클리어하므로 패널 로컬 선택도 함께 클리어 —
// 새 결과 위에 옛 선택(유령 선택)이 남지 않는다.
describe('새 검색 시 선택 클리어 (m7)', () => {
  it('검색 성공 후 이전 선택 체크가 해제된다', async () => {
    const p = baseProps({
      research: researchWith({ selectedVideoIds: [VIDEO.videoId] }),
      onSearch: vi.fn(async () => ({ videos: [VIDEO] })),
    })
    render(<ResearchPanel {...p} />)
    expect(screen.getByRole('checkbox', { name: '영상X 선택' })).toBeChecked()
    fireEvent.change(screen.getByPlaceholderText(/키워드/), { target: { value: '새 키워드' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await vi.waitFor(() => expect(screen.getByRole('checkbox', { name: '영상X 선택' })).not.toBeChecked())
  })
})
