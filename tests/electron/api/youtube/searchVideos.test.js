import { describe, it, expect, vi } from 'vitest'
import {
  parseSearchLines, sortByViewCount, searchVideos,
  dateFilterCutoff, parseUploadDateLines, filterByUploadDate,
} from '../../../../electron/api/youtube/searchVideos.js'

const SEP = String.fromCharCode(0x1f)
const line = (view, title, channel, id, dur, thumb) =>
  [view, title, channel, id, dur, thumb].join(SEP)

describe('parseSearchLines (yt-dlp --print 출력 파싱)', () => {
  it('구분자 분해 → 영상 메타 배열', () => {
    const stdout = [
      line('34845', '조선야담 잔꾀', '조선야담', 'ojKzfVlVHE0', '7667', 'https://i.ytimg.com/vi/ojKzfVlVHE0/hq.jpg'),
      line('226259', '계모 이야기', '야담한자락', '1yPYELBAqiQ', '4611', 'https://i.ytimg.com/vi/1yPYELBAqiQ/hq.jpg'),
    ].join('\n')
    const videos = parseSearchLines(stdout)
    expect(videos.length).toBe(2)
    expect(videos[0]).toEqual({
      videoId: 'ojKzfVlVHE0',
      title: '조선야담 잔꾀',
      channelTitle: '조선야담',
      viewCount: 34845,
      durationSec: 7667,
      thumbnailUrl: 'https://i.ytimg.com/vi/ojKzfVlVHE0/hq.jpg',
    })
  })

  it('view_count가 "NA"/빈값이면 0', () => {
    const videos = parseSearchLines(line('NA', 't', 'c', 'idididididi', '10', 'http://x'))
    expect(videos[0].viewCount).toBe(0)
  })

  it('제목에 구분자가 없다고 가정 — 필드 수 부족 라인은 스킵', () => {
    const stdout = 'brokenline\n' + line('5', 't', 'c', 'idididididi', '1', 'u')
    const videos = parseSearchLines(stdout)
    expect(videos.length).toBe(1)
    expect(videos[0].videoId).toBe('idididididi')
  })

  it('빈 stdout → []', () => {
    expect(parseSearchLines('')).toEqual([])
    expect(parseSearchLines(null)).toEqual([])
  })

  // 실앱 확인(2026-07-08): --flat-playlist는 %(thumbnail)s가 NA/빈값인 경우가 많아 카드 썸네일이
  // 안 보인다 — 소스 레벨에서 표준 썸네일 URL로 폴백해 보장한다.
  it('thumbnail이 NA/빈값이면 표준 hqdefault URL로 폴백한다 (썸네일 폴백)', () => {
    const stdout = [
      line('10', 't1', 'c1', 'idNA0000001', '5', 'NA'),
      line('20', 't2', 'c2', 'idEMPTY0002', '5', ''),
      line('30', 't3', 'c3', 'idOK0000003', '5', 'https://real/thumb.jpg'),
    ].join('\n')
    const videos = parseSearchLines(stdout)
    expect(videos[0].thumbnailUrl).toBe('https://i.ytimg.com/vi/idNA0000001/hqdefault.jpg')
    expect(videos[1].thumbnailUrl).toBe('https://i.ytimg.com/vi/idEMPTY0002/hqdefault.jpg')
    expect(videos[2].thumbnailUrl).toBe('https://real/thumb.jpg') // 실값은 그대로
  })
})

// ---------- 개선2: 일자 필터 순수함수 ----------
describe('dateFilterCutoff (개선2 — none|week|month → YYYYMMDD 컷오프)', () => {
  const NOW = new Date('2026-07-08T12:00:00Z')

  it('week → 7일 전(UTC) YYYYMMDD', () => {
    expect(dateFilterCutoff('week', NOW)).toBe('20260701')
  })

  it('month → 30일 전(UTC) YYYYMMDD (월 경계 넘어감)', () => {
    expect(dateFilterCutoff('month', NOW)).toBe('20260608')
  })

  it('none/미지정/알 수 없는 값 → null (필터 없음)', () => {
    expect(dateFilterCutoff('none', NOW)).toBeNull()
    expect(dateFilterCutoff(undefined, NOW)).toBeNull()
    expect(dateFilterCutoff('year', NOW)).toBeNull()
  })
})

describe('parseUploadDateLines (id␟upload_date → 맵)', () => {
  it('줄당 id/upload_date 파싱, NA·비정상 날짜는 스킵', () => {
    const stdout = [
      ['idAAA000001', '20260705'].join(SEP),
      ['idBBB000002', 'NA'].join(SEP),
      ['NA', '20260101'].join(SEP),
      '',
      ['idCCC000003', '20260630'].join(SEP),
    ].join('\n')
    expect(parseUploadDateLines(stdout)).toEqual({ idAAA000001: '20260705', idCCC000003: '20260630' })
  })

  it('빈 stdout → {}', () => {
    expect(parseUploadDateLines('')).toEqual({})
    expect(parseUploadDateLines(null)).toEqual({})
  })
})

describe('filterByUploadDate (컷오프 경계 포함, 순수)', () => {
  const vids = [
    { videoId: 'a', uploadDate: '20260701' }, // 경계일 — 포함
    { videoId: 'b', uploadDate: '20260630' }, // 하루 전 — 제외
    { videoId: 'c', uploadDate: '20260708' },
    { videoId: 'd', uploadDate: '' }, // 날짜 미상 — 제외
    { videoId: 'e' },
  ]

  it('cutoff 이후(포함)만 남긴다 — 날짜 미상은 제외', () => {
    expect(filterByUploadDate(vids, '20260701').map((v) => v.videoId)).toEqual(['a', 'c'])
  })

  it('cutoff가 null이면 전체 유지(원본 불변)', () => {
    const out = filterByUploadDate(vids, null)
    expect(out.map((v) => v.videoId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(out).not.toBe(vids)
  })
})

describe('sortByViewCount (§Q4 — 조회수 desc 상위 N)', () => {
  it('조회수 내림차순 정렬 후 상위 maxResults', () => {
    const vids = [
      { videoId: 'a', viewCount: 100 },
      { videoId: 'b', viewCount: 5000 },
      { videoId: 'c', viewCount: 300 },
    ]
    const top = sortByViewCount(vids, 2)
    expect(top.map((v) => v.videoId)).toEqual(['b', 'c'])
  })

  it('원본 배열을 변형하지 않는다(순수)', () => {
    const vids = [{ videoId: 'a', viewCount: 1 }, { videoId: 'b', viewCount: 2 }]
    sortByViewCount(vids, 10)
    expect(vids[0].videoId).toBe('a')
  })
})

describe('searchVideos (yt-dlp 검색 호출 계약)', () => {
  const okLines = [1, 2, 3]
    .map((n) => line(String(n * 1000), `title${n}`, `ch${n}`, `id${n}0000000`, '10', 'u'))
    .join('\n')

  it('ytsearchN 쿼리 구성 + --print + --flat-playlist, 조회수 정렬 상위 maxResults', async () => {
    const runYtDlp = vi.fn(async () => ({ stdout: okLines, stderr: '', code: 0 }))
    const res = await searchVideos({ query: '조선 야담', maxResults: 2, fetchCount: 3 }, { runYtDlp })
    const args = runYtDlp.mock.calls[0][0]
    expect(args).toContain('ytsearch3:조선 야담')
    expect(args).toContain('--print')
    expect(args).toContain('--flat-playlist')
    expect(args).toContain('--skip-download')
    expect(res.videos.length).toBe(2)
    // 조회수 desc (id3=3000 > id2=2000)
    expect(res.videos[0].videoId).toBe('id30000000')
  })

  it('yt-dlp 미설치(binary-not-found) → error 전파', async () => {
    const runYtDlp = vi.fn(async () => { throw new Error('binary-not-found') })
    const res = await searchVideos({ query: 'x' }, { runYtDlp })
    expect(res.error).toBe('binary-not-found')
  })

  it('빈 쿼리 → error:empty-query (yt-dlp 호출 안 함)', async () => {
    const runYtDlp = vi.fn()
    const res = await searchVideos({ query: '  ' }, { runYtDlp })
    expect(res.error).toBe('empty-query')
    expect(runYtDlp).not.toHaveBeenCalled()
  })

  it('dateFilter 미지정/none → 상세조회 없이 1회 호출(현행 회귀)', async () => {
    const runYtDlp = vi.fn(async () => ({ stdout: okLines, stderr: '', code: 0 }))
    await searchVideos({ query: 'q', dateFilter: 'none' }, { runYtDlp })
    expect(runYtDlp).toHaveBeenCalledTimes(1)
  })
})

// ---------- 개선2: dateFilter — flat pool → 조회수 상위 후보만 상세조회(upload_date) → 필터 ----------
describe('searchVideos dateFilter (개선2 — 상세조회 분기)', () => {
  // 오늘(UTC) YYYYMMDD — week/month 컷오프보다 항상 이후.
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const flat = [1, 2, 3, 4].map((n) => line(String(n * 1000), `t${n}`, `c${n}`, `id${n}0000000`, '10', 'u')).join('\n')

  it('week: 상위 후보 URL로 2차 호출(비 flat, upload_date print) → 컷오프 필터 후 상위 maxResults', async () => {
    const dateLines = [
      [`id40000000`, today].join(SEP),
      [`id30000000`, '20200101'].join(SEP), // 오래됨 — 제외
      [`id20000000`, today].join(SEP),
      [`id10000000`, 'NA'].join(SEP), // 날짜 미상 — 제외
    ].join('\n')
    const runYtDlp = vi.fn()
      .mockResolvedValueOnce({ stdout: flat, stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: dateLines, stderr: '', code: 0 })
    const res = await searchVideos({ query: 'q', maxResults: 2, dateFilter: 'week' }, { runYtDlp })

    expect(runYtDlp).toHaveBeenCalledTimes(2)
    const args2 = runYtDlp.mock.calls[1][0]
    // 조회수 상위 maxResults*2=4 후보의 watch URL — flat이 아님(개별 상세조회로 upload_date 취득)
    expect(args2).toContain('https://www.youtube.com/watch?v=id40000000')
    expect(args2).toContain('https://www.youtube.com/watch?v=id10000000')
    expect(args2).not.toContain('--flat-playlist')
    expect(args2.some((a) => String(a).includes('upload_date'))).toBe(true)

    // 최근 것만, 조회수 desc 상위 maxResults + uploadDate 메타 부착
    expect(res.videos.map((v) => v.videoId)).toEqual(['id40000000', 'id20000000'])
    expect(res.videos[0].uploadDate).toBe(today)
  })

  // m1(R1): dateFilter 활성 시 pool을 ytsearchdate(업로드일순)로 받아 최신성 편향 제거
  // (조회수 상위 옛영상이 후보를 독점해 최근 영상이 컷오프 전에 잘리는 것 방지).
  it('m1: dateFilter 활성이면 1차 pool 쿼리가 ytsearchdate<N>:이다', async () => {
    const runYtDlp = vi.fn()
      .mockResolvedValueOnce({ stdout: flat, stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
    await searchVideos({ query: 'q', maxResults: 10, dateFilter: 'week' }, { runYtDlp })
    expect(runYtDlp.mock.calls[0][0][0]).toBe('ytsearchdate30:q')
  })

  it("m1: dateFilter='none'(기본)은 pool 쿼리가 ytsearch<N>:(현행 회귀)", async () => {
    const runYtDlp = vi.fn(async () => ({ stdout: flat, stderr: '', code: 0 }))
    await searchVideos({ query: 'q', maxResults: 10 }, { runYtDlp })
    expect(runYtDlp.mock.calls[0][0][0]).toBe('ytsearch30:q')
  })

  // M3(R1): 상세조회 타임아웃을 후보 수에 스케일(후보당 5s) — 60 후보에 180s 고정은 부족.
  it('M3: 상세조회 timeoutMs는 후보 수 × 5000으로 스케일한다', async () => {
    const runYtDlp = vi.fn()
      .mockResolvedValueOnce({ stdout: flat, stderr: '', code: 0 }) // 4개 pool
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
    await searchVideos({ query: 'q', maxResults: 2, dateFilter: 'week' }, { runYtDlp })
    // 후보 = min(maxResults*2, 30, poolLen) = min(4, 30, 4) = 4 → 20000ms
    expect(runYtDlp.mock.calls[1][1]).toMatchObject({ timeoutMs: 20000 })
  })

  it('M3: 후보 수는 30으로 상한한다(상세조회 폭주 방지)', async () => {
    const bigFlat = Array.from({ length: 100 }, (_, i) =>
      line(String(1000 - i), `t${i}`, `c${i}`, `bigid${String(i).padStart(5, '0')}`, '10', 'u')).join('\n')
    const runYtDlp = vi.fn()
      .mockResolvedValueOnce({ stdout: bigFlat, stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })
    await searchVideos({ query: 'q', maxResults: 30, dateFilter: 'week' }, { runYtDlp })
    const urls = runYtDlp.mock.calls[1][0].filter((a) => String(a).startsWith('https://'))
    expect(urls.length).toBe(30)
    expect(runYtDlp.mock.calls[1][1]).toMatchObject({ timeoutMs: 150000 }) // 30 × 5000
  })

  // M3(R1): 상세조회 실패/타임아웃 시 검색 전멸 방지 — flat 결과(조회수 상위)로 폴백한다.
  it('M3: 상세조회 실패(throw) → error 아님, flat 상위 maxResults로 폴백', async () => {
    const runYtDlp = vi.fn()
      .mockResolvedValueOnce({ stdout: flat, stderr: '', code: 0 })
      .mockRejectedValueOnce(new Error('timeout'))
    const res = await searchVideos({ query: 'q', maxResults: 2, dateFilter: 'month' }, { runYtDlp })
    expect(res.error).toBeUndefined()
    // flat 조회수 desc 상위 2 (id4=4000 > id3=3000)
    expect(res.videos.map((v) => v.videoId)).toEqual(['id40000000', 'id30000000'])
  })

  // R2 MINOR(M3 잔여): flat 폴백 시 dateFilter가 조용히 무시된다 — 사용자 신호용 플래그를 실어
  // 반환한다(패널이 "기간 필터 적용 실패" 안내). 성공/none에는 플래그 없음.
  it('R2: 상세조회 실패로 flat 폴백하면 dateFilterFallback:true를 실어 반환', async () => {
    const runYtDlp = vi.fn()
      .mockResolvedValueOnce({ stdout: flat, stderr: '', code: 0 })
      .mockRejectedValueOnce(new Error('timeout'))
    const res = await searchVideos({ query: 'q', maxResults: 2, dateFilter: 'week' }, { runYtDlp })
    expect(res.dateFilterFallback).toBe(true)
  })

  it('R2: 상세조회 성공(정상 필터)에는 dateFilterFallback 플래그가 없다', async () => {
    const runYtDlp = vi.fn()
      .mockResolvedValueOnce({ stdout: flat, stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: [['id40000000', today].join(SEP)].join('\n'), stderr: '', code: 0 })
    const res = await searchVideos({ query: 'q', maxResults: 2, dateFilter: 'week' }, { runYtDlp })
    expect(res.dateFilterFallback).toBeUndefined()
  })

  it("R2: dateFilter='none'(전체)에는 dateFilterFallback 플래그가 없다", async () => {
    const runYtDlp = vi.fn(async () => ({ stdout: flat, stderr: '', code: 0 }))
    const res = await searchVideos({ query: 'q', maxResults: 2 }, { runYtDlp })
    expect(res.dateFilterFallback).toBeUndefined()
  })

  it('flat 결과가 비면 상세조회 없이 빈 배열', async () => {
    const runYtDlp = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }))
    const res = await searchVideos({ query: 'q', dateFilter: 'week' }, { runYtDlp })
    expect(res.videos).toEqual([])
    expect(runYtDlp).toHaveBeenCalledTimes(1)
  })
})

// m6(R1): searchVideos가 videoId를 URL 템플레이팅하기 전 SAFE 패턴으로 검증(fetch 경로와 일관).
describe('searchVideos videoId 안전성 (m6)', () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  it('불안전한 videoId(경로/특수문자)는 상세조회 URL에서 제외한다', async () => {
    const flat = [
      line('9000', 'ok', 'c', 'goodID00001', '10', 'u'),
      line('8000', 'bad', 'c', '../evil', '10', 'u'),
      line('7000', 'bad2', 'c', 'a b&c', '10', 'u'),
    ].join('\n')
    const runYtDlp = vi.fn()
      .mockResolvedValueOnce({ stdout: flat, stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: [['goodID00001', today].join(SEP)].join('\n'), stderr: '', code: 0 })
    const res = await searchVideos({ query: 'q', maxResults: 5, dateFilter: 'week' }, { runYtDlp })
    const urls = runYtDlp.mock.calls[1][0].filter((a) => String(a).startsWith('https://'))
    expect(urls).toEqual(['https://www.youtube.com/watch?v=goodID00001'])
    expect(res.videos.map((v) => v.videoId)).toEqual(['goodID00001'])
  })
})
