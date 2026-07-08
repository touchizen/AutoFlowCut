/**
 * ResearchPanel 단위 테스트 — spec §3.6/§7.
 * StoryView 통합(StoryView.research.test.jsx)과 별개로 패널 자체의 입력 검증·비활성 규칙·고지를 고정.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ResearchPanel, { filterByLang } from '../../../src/components/story/ResearchPanel.jsx'

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

// 썸네일 폴백(2026-07-08 실앱 확인): flat 검색이 thumbnail을 NA/빈값으로 주는 경우가 많아
// 카드가 이미지 없이 렌더됐다 — videoId만 있으면 표준 hqdefault URL로 무조건 렌더한다.
describe('카드 썸네일 폴백 (필수)', () => {
  it('thumbnailUrl 빈값이어도 표준 hqdefault URL img를 렌더한다', () => {
    render(<ResearchPanel {...baseProps({ research: researchWith() })} />) // VIDEO.thumbnailUrl=''
    expect(screen.getByRole('img', { name: '영상X' }))
      .toHaveAttribute('src', `https://i.ytimg.com/vi/${VIDEO.videoId}/hqdefault.jpg`)
  })

  it('thumbnailUrl이 있으면 그대로 사용한다(회귀)', () => {
    const v = { ...VIDEO, thumbnailUrl: 'https://real/t.jpg' }
    render(<ResearchPanel {...baseProps({ research: researchWith({ videos: [v] }) })} />)
    expect(screen.getByRole('img', { name: '영상X' })).toHaveAttribute('src', 'https://real/t.jpg')
  })
})

// 개선1/2(2026-07-08): 검색 개수(10/20/30) + 업로드 기간(전체/1주일/30일) 컨트롤 → onSearch 전달.
describe('검색 개수·일자 필터 컨트롤 (개선1/2)', () => {
  it('개수 20 + 최근 1주일 선택 → onSearch({keyword, maxResults:20, dateFilter:"week"})', async () => {
    const p = baseProps()
    render(<ResearchPanel {...p} />)
    fireEvent.change(screen.getByPlaceholderText(/키워드/), { target: { value: '괴담' } })
    fireEvent.change(screen.getByRole('combobox', { name: '검색 개수' }), { target: { value: '20' } })
    fireEvent.change(screen.getByRole('combobox', { name: '업로드 기간' }), { target: { value: 'week' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await vi.waitFor(() => expect(p.onSearch).toHaveBeenCalledWith({ keyword: '괴담', maxResults: 20, dateFilter: 'week' }))
  })

  it('기본값: maxResults=10, 전체(dateFilter 미전달 — 현행 빠른 flat 검색 유지)', async () => {
    const p = baseProps()
    render(<ResearchPanel {...p} />)
    fireEvent.change(screen.getByPlaceholderText(/키워드/), { target: { value: '괴담' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await vi.waitFor(() => expect(p.onSearch).toHaveBeenCalledWith({ keyword: '괴담', maxResults: 10 }))
  })

  // R2 MINOR(M3 잔여): 일자필터 상세조회 실패로 flat 폴백 시 onSearch가 dateFilterFallback:true를
  // 반환 → "기간 필터를 적용하지 못해 전체 결과를 표시" 안내. 성공(플래그 없음)엔 미노출.
  it('onSearch가 dateFilterFallback:true면 기간 필터 실패 안내를 노출한다 (R2)', async () => {
    const p = baseProps({ onSearch: vi.fn(async () => ({ videos: [], dateFilterFallback: true })) })
    render(<ResearchPanel {...p} />)
    fireEvent.change(screen.getByPlaceholderText(/키워드/), { target: { value: '괴담' } })
    fireEvent.change(screen.getByRole('combobox', { name: '업로드 기간' }), { target: { value: 'week' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await vi.waitFor(() => expect(screen.getByText(/기간 필터/)).toBeInTheDocument())
  })

  it('onSearch가 정상(플래그 없음)이면 기간 필터 실패 안내가 없다 (R2)', async () => {
    const p = baseProps({ onSearch: vi.fn(async () => ({ videos: [] })) })
    render(<ResearchPanel {...p} />)
    fireEvent.change(screen.getByPlaceholderText(/키워드/), { target: { value: '괴담' } })
    fireEvent.change(screen.getByRole('combobox', { name: '업로드 기간' }), { target: { value: 'week' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await vi.waitFor(() => expect(p.onSearch).toHaveBeenCalled())
    expect(screen.queryByText(/기간 필터를 적용하지/)).toBeNull()
  })

  it('폴백 안내는 다음 정상 검색에서 사라진다 (R2 — transient)', async () => {
    const onSearch = vi.fn()
      .mockResolvedValueOnce({ videos: [], dateFilterFallback: true })
      .mockResolvedValueOnce({ videos: [] })
    const p = baseProps({ onSearch })
    render(<ResearchPanel {...p} />)
    fireEvent.change(screen.getByPlaceholderText(/키워드/), { target: { value: '괴담' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await vi.waitFor(() => expect(screen.getByText(/기간 필터/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await vi.waitFor(() => expect(screen.queryByText(/기간 필터를 적용하지/)).toBeNull())
  })
})

// 개선3(2026-07-08): 언어 필터 하이브리드 — (1) 제목/채널 문자셋 1차 필터(filterByLang 순수),
// (2) 취득 자막 lang이 설정 언어와 다르면 "OO 자막 없음" 배지.
describe('filterByLang (개선3 — 순수함수)', () => {
  const KO = { videoId: 'koVid000001', title: '조선 야담 모음', channelTitle: '야담채널' }
  const EN = { videoId: 'enVid000001', title: 'English Horror Stories', channelTitle: 'HorrorCh' }
  const KO_CH = { videoId: 'koCh0000001', title: 'EP.1', channelTitle: '한국채널' }

  it('ko: 제목 또는 채널에 한글이 있는 영상만', () => {
    expect(filterByLang([KO, EN, KO_CH], 'ko')).toEqual([KO, KO_CH])
  })

  it('en: 한글 없이 라틴 문자 제목인 영상만', () => {
    expect(filterByLang([KO, EN, KO_CH], 'en')).toEqual([EN])
  })

  it('lang 미지정/미지원 값이면 전체 유지', () => {
    expect(filterByLang([KO, EN], undefined)).toEqual([KO, EN])
    expect(filterByLang([KO, EN], 'ja')).toEqual([KO, EN])
  })
})

describe('언어 필터 UI (개선3)', () => {
  const KO_VIDEO = { videoId: 'koVid000001', title: '조선 야담', channelTitle: '채널', viewCount: 1, thumbnailUrl: '' }
  const EN_VIDEO = { videoId: 'enVid000001', title: 'English Only', channelTitle: 'Ch', viewCount: 2, thumbnailUrl: '' }

  it('language=ko면 영어 전용 카드를 숨기고 숨김 안내를 렌더한다', () => {
    render(<ResearchPanel {...baseProps({
      language: 'ko',
      research: researchWith({ videos: [KO_VIDEO, EN_VIDEO] }),
    })} />)
    expect(screen.getByText('조선 야담')).toBeInTheDocument()
    expect(screen.queryByText('English Only')).toBeNull()
    expect(screen.getByText(/언어 불일치/)).toBeInTheDocument()
  })

  it('전부 언어 불일치면 필터를 풀고 전체를 보여준다(빈 그리드 방지)', () => {
    render(<ResearchPanel {...baseProps({
      language: 'ko',
      research: researchWith({ videos: [EN_VIDEO] }),
    })} />)
    expect(screen.getByText('English Only')).toBeInTheDocument()
  })

  // m2(R1): 언어필터가 숨기려는 카드라도 이미 선택된 것은 표시한다 — 안 보이면 해제 불가 +
  // fetch에 계속 포함되는 "보이지 않는 선택"이 된다.
  it('언어 불일치로 숨길 카드라도 선택된 것이면 표시하고 해제 가능하다 (m2)', () => {
    const p = baseProps({
      language: 'ko',
      research: researchWith({ videos: [KO_VIDEO, EN_VIDEO], selectedVideoIds: [EN_VIDEO.videoId] }),
    })
    render(<ResearchPanel {...p} />)
    // EN 카드는 언어 불일치지만 선택돼 있어 보인다 + 체크됨
    expect(screen.getByText('English Only')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'English Only 선택' })).toBeChecked()
  })

  it('language 미전달이면 전부 표시(회귀)', () => {
    render(<ResearchPanel {...baseProps({ research: researchWith({ videos: [KO_VIDEO, EN_VIDEO] }) })} />)
    expect(screen.getByText('조선 야담')).toBeInTheDocument()
    expect(screen.getByText('English Only')).toBeInTheDocument()
  })

  it('취득 자막 lang이 설정 언어와 다르면 "한국어 자막 없음" 배지 (개선3 자막 배지)', () => {
    render(<ResearchPanel {...baseProps({
      language: 'ko',
      research: researchWith({
        videos: [{ ...KO_VIDEO }],
        transcripts: { [KO_VIDEO.videoId]: { ok: true, lang: 'en' } },
      }),
    })} />)
    expect(screen.getByText(/자막 확보/)).toBeInTheDocument()
    expect(screen.getByText('한국어 자막 없음')).toBeInTheDocument()
  })

  it('설정 언어 자막이면 "자막 없음" 배지가 없다(회귀)', () => {
    render(<ResearchPanel {...baseProps({
      language: 'ko',
      research: researchWith({ transcripts: { [VIDEO.videoId]: { ok: true, lang: 'ko' } } }),
    })} />)
    expect(screen.queryByText('한국어 자막 없음')).toBeNull()
  })
})

// 개선4(2026-07-08): 팩트체크 미검증/반박 주장도 채택 체크박스로 commit에 포함 가능.
describe('팩트체크 채택 체크박스 → commit adoptedIndices (개선4/m3)', () => {
  const CLAIMS = [
    { claim: '사실S', verdict: 'supported', evidence: [] },
    { claim: '사실U', verdict: 'unverified', evidence: [] },
    { claim: '사실R', verdict: 'refuted', evidence: [] },
  ]
  const ANALYSIS = { structure: [], claims: [{ claim: '사실S' }], commonThemes: [] }

  it('기본: supported만 체크, unverified/refuted는 미체크', () => {
    render(<ResearchPanel {...baseProps({ research: researchWith({ analysis: ANALYSIS, verifiedClaims: CLAIMS }) })} />)
    expect(screen.getByRole('checkbox', { name: '사실S 채택' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '사실U 채택' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: '사실R 채택' })).not.toBeChecked()
  })

  // m3(R1): 채택은 인덱스 기반 — commit 페이로드는 adoptedIndices.
  it('미검증 채택 + supported 해제 후 [확정] → onCommit adoptedIndices에 반영 (m3)', async () => {
    const p = baseProps({ research: researchWith({ analysis: ANALYSIS, verifiedClaims: CLAIMS }) })
    render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '사실U 채택' })) // idx 1 채택
    fireEvent.click(screen.getByRole('checkbox', { name: '사실S 채택' })) // idx 0 해제
    fireEvent.click(screen.getByRole('button', { name: '이 리서치로 확정' }))
    await vi.waitFor(() => expect(p.onCommit).toHaveBeenCalledWith({
      analysis: ANALYSIS, verifiedClaims: CLAIMS, adoptedIndices: [1],
    }))
  })

  it('아무것도 안 만지면 supported 인덱스만 채택돼 커밋된다 (기본 동작 회귀)', async () => {
    const p = baseProps({ research: researchWith({ analysis: ANALYSIS, verifiedClaims: CLAIMS }) })
    render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '이 리서치로 확정' }))
    await vi.waitFor(() => expect(p.onCommit).toHaveBeenCalledWith({
      analysis: ANALYSIS, verifiedClaims: CLAIMS, adoptedIndices: [0],
    }))
  })

  it('팩트체크 결과가 없으면 adoptedIndices 미전달(현행 페이로드 유지)', async () => {
    const p = baseProps({ research: researchWith({ analysis: ANALYSIS }) })
    render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '이 리서치로 확정' }))
    await vi.waitFor(() => expect(p.onCommit).toHaveBeenCalledWith({ analysis: ANALYSIS, verifiedClaims: [] }))
  })

  // m3(R1): 동일 claim 문자열이 둘이어도 체크박스가 개별 토글되고 정확히 그 인덱스만 채택.
  it('동일 claim 문자열이 중복돼도 인덱스로 개별 토글된다 (m3)', async () => {
    const dup = [
      { claim: '같은문장', verdict: 'supported', evidence: [] },
      { claim: '같은문장', verdict: 'unverified', evidence: [] },
    ]
    const p = baseProps({ research: researchWith({ analysis: ANALYSIS, verifiedClaims: dup }) })
    render(<ResearchPanel {...p} />)
    const checks = screen.getAllByRole('checkbox', { name: '같은문장 채택' })
    expect(checks[0]).toBeChecked() // supported
    expect(checks[1]).not.toBeChecked() // unverified — 함께 켜지지 않음
    fireEvent.click(screen.getByRole('button', { name: '이 리서치로 확정' }))
    await vi.waitFor(() => expect(p.onCommit).toHaveBeenCalledWith(expect.objectContaining({ adoptedIndices: [0] })))
  })

  // M1(R1): 채택 체크 후 무관한 상태갱신(카드 선택 등)으로 research가 새 배열 identity로 와도
  // 내용이 같으면 채택이 리셋되지 않는다(내용 키 기반 리셋).
  it('내용이 동일한 verifiedClaims 재전달(새 배열)에는 채택 상태를 리셋하지 않는다 (M1)', async () => {
    const research = researchWith({ analysis: ANALYSIS, verifiedClaims: CLAIMS })
    const p = baseProps({ research })
    const { rerender } = render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '사실U 채택' }))
    expect(screen.getByRole('checkbox', { name: '사실U 채택' })).toBeChecked()
    // 카드 토글 등으로 research가 새 객체·새 배열로 재전달(내용은 동일)
    const research2 = researchWith({ analysis: ANALYSIS, verifiedClaims: CLAIMS.map((c) => ({ ...c })) })
    rerender(<ResearchPanel {...baseProps({ research: research2, onCommit: p.onCommit })} />)
    expect(screen.getByRole('checkbox', { name: '사실U 채택' })).toBeChecked() // 유지
  })

  it('팩트체크 내용이 실제로 바뀌면 채택이 기본(supported)으로 리셋된다 (M1 — 재팩트체크)', () => {
    const p = baseProps({ research: researchWith({ analysis: ANALYSIS, verifiedClaims: CLAIMS }) })
    const { rerender } = render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '사실U 채택' }))
    const NEW = [{ claim: '새사실', verdict: 'supported', evidence: [] }]
    rerender(<ResearchPanel {...baseProps({ research: researchWith({ analysis: ANALYSIS, verifiedClaims: NEW }) })} />)
    expect(screen.getByRole('checkbox', { name: '새사실 채택' })).toBeChecked()
  })

  // R2 nit: factKey 구분자가 claim/verdict 텍스트에 들어 있으면(예: '|', '~~') 다른 내용이 같은
  // 키로 뭉개져 리셋 누락 — JSON.stringify로 충돌 없이 구분해야 한다. A와 B는 단순 join
  // (`${claim}|${verdict}` ~~ join)이면 둘 다 'x|y~~z~~w|supported'로 충돌하지만 내용은 다르다.
  it('claim/verdict에 구분자 문자(|, ~~)가 있어도 내용 변경을 정확히 감지해 리셋한다 (R2 nit — factKey 충돌)', () => {
    const A = [{ claim: 'x', verdict: 'y~~z', evidence: [] }, { claim: 'w', verdict: 'supported', evidence: [] }]
    const B = [{ claim: 'x', verdict: 'y', evidence: [] }, { claim: 'z~~w', verdict: 'supported', evidence: [] }]
    const p = baseProps({ research: researchWith({ analysis: ANALYSIS, verifiedClaims: A }) })
    const { rerender } = render(<ResearchPanel {...p} />)
    // A 기본 채택 = supported(idx1 'w'). 사용자가 idx0 'x'를 추가 채택.
    fireEvent.click(screen.getByRole('checkbox', { name: 'x 채택' }))
    expect(screen.getByRole('checkbox', { name: 'x 채택' })).toBeChecked()
    // 내용이 실제로 다른 B로 교체(단순 join이면 factKey 충돌 → 리셋 누락). JSON.stringify면 리셋 →
    // B 기본(supported=idx1 'z~~w')만 체크, 이전 수동 채택(idx0 'x')은 사라진다.
    rerender(<ResearchPanel {...baseProps({ research: researchWith({ analysis: ANALYSIS, verifiedClaims: B }) })} />)
    expect(screen.getByRole('checkbox', { name: 'z~~w 채택' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'x 채택' })).not.toBeChecked()
  })
})

// 개선5(2026-07-08): [한꺼번에 분석] — 자막→구조분석→팩트체크 자동 순차 실행 + 단계 진행 +
// ElapsedTime 총 경과시간. 기존 3버튼은 유지, 중간 실패 시 중단.
describe('[한꺼번에 분석] 자동 순차 실행 (개선5)', () => {
  const withSelection = (over = {}) => researchWith({ selectedVideoIds: [VIDEO.videoId], ...over })

  const seqProps = (over = {}) => {
    const calls = []
    const p = baseProps({
      research: withSelection(),
      onFetch: vi.fn(async () => { calls.push('fetch'); return { transcripts: [{ videoId: VIDEO.videoId, ok: true }] } }),
      onAnalyze: vi.fn(async () => { calls.push('analyze'); return { analysis: { structure: [], claims: [{ claim: 'c' }], commonThemes: [] } } }),
      onFactCheck: vi.fn(async () => { calls.push('factcheck'); return { verifiedClaims: [] } }),
      ...over,
    })
    return { p, calls }
  }

  it('자막→분석→팩트체크를 선택 영상으로 순차 호출한다', async () => {
    const { p, calls } = seqProps()
    render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '한꺼번에 분석' }))
    await vi.waitFor(() => expect(calls).toEqual(['fetch', 'analyze', 'factcheck']))
    expect(p.onFetch).toHaveBeenCalledWith({ videoIds: [VIDEO.videoId] })
    expect(p.onAnalyze).toHaveBeenCalledWith({ videoIds: [VIDEO.videoId] })
  })

  it('진행 표시: 현재 단계 하이라이트 + 경과시간(ElapsedTime) 렌더', async () => {
    let resolveFetch
    const { p } = seqProps({ onFetch: vi.fn(() => new Promise((r) => { resolveFetch = r })) })
    render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '한꺼번에 분석' }))
    const progress = await screen.findByTestId('research-auto-progress')
    expect(within(progress).getByText('자막').classList.contains('active')).toBe(true)
    expect(within(progress).getByText(/\d{2}:\d{2}/)).toBeInTheDocument() // 경과시간
    resolveFetch({ transcripts: [] })
    await vi.waitFor(() => expect(p.onAnalyze).toHaveBeenCalled())
  })

  it('중간 실패(analyze error) 시 중단 — 팩트체크 미호출 + 에러 표시', async () => {
    const { p } = seqProps({ onAnalyze: vi.fn(async () => ({ error: 'no-transcripts-selected' })) })
    render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '한꺼번에 분석' }))
    await vi.waitFor(() => expect(screen.getByText(/no-transcripts-selected/)).toBeInTheDocument())
    expect(p.onFactCheck).not.toHaveBeenCalled()
  })

  // M2(R1): 자막 단계가 abort(부분성공 {aborted:true})되면 다음 단계로 진행하지 않는다.
  it('자막 단계 abort({aborted:true}) 시 분석/팩트체크로 진행하지 않는다 (M2)', async () => {
    const { p } = seqProps({ onFetch: vi.fn(async () => ({ transcripts: [], aborted: true })) })
    render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '한꺼번에 분석' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '한꺼번에 분석' })).toBeEnabled())
    expect(p.onAnalyze).not.toHaveBeenCalled()
    expect(p.onFactCheck).not.toHaveBeenCalled()
  })

  it('claims가 없으면 팩트체크는 건너뛰고 완료한다(에러 아님) + 팩트체크 칩은 스킵 표시 (m4)', async () => {
    const { p } = seqProps({ onAnalyze: vi.fn(async () => ({ analysis: { structure: [], claims: [], commonThemes: [] } })) })
    render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '한꺼번에 분석' }))
    await vi.waitFor(() => expect(p.onAnalyze).toHaveBeenCalled())
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '한꺼번에 분석' })).toBeEnabled())
    expect(p.onFactCheck).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    // m4: 스킵된 팩트체크 칩은 'done'이 아니라 'skipped'로 구분 표기
    const progress = screen.getByTestId('research-auto-progress')
    const fcChip = within(progress).getByText('팩트체크')
    expect(fcChip.classList.contains('skipped')).toBe(true)
    expect(fcChip.classList.contains('done')).toBe(false)
  })

  // m4(R1): auto 완료 패널이 이후 개별 액션에 잔류하지 않는다 — 새 개별 액션 시 autoRun 클리어.
  it('auto 완료 후 개별 액션([자막 가져오기]) 시작 시 autoRun 진행 패널이 사라진다 (m4)', async () => {
    const { p } = seqProps()
    render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '한꺼번에 분석' }))
    await vi.waitFor(() => expect(screen.getByTestId('research-auto-progress')).toBeInTheDocument())
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '한꺼번에 분석' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '자막 가져오기' }))
    await vi.waitFor(() => expect(screen.queryByTestId('research-auto-progress')).toBeNull())
  })

  it('진행 중에는 개별 3버튼과 [한꺼번에 분석] 모두 비활성', async () => {
    const { p } = seqProps({ onFetch: vi.fn(() => new Promise(() => {})) })
    render(<ResearchPanel {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '한꺼번에 분석' }))
    await screen.findByTestId('research-auto-progress')
    expect(screen.getByRole('button', { name: '분석 중…' })).toBeDisabled() // 한꺼번에 버튼(busy 라벨)
    expect(screen.getByRole('button', { name: '자막 가져오기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '구조분석' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '팩트체크' })).toBeDisabled()
  })

  it('선택 영상이 없으면 [한꺼번에 분석] 비활성', () => {
    render(<ResearchPanel {...baseProps({ research: researchWith() })} />)
    expect(screen.getByRole('button', { name: '한꺼번에 분석' })).toBeDisabled()
  })
})
