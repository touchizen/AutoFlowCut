import { describe, it, expect, vi } from 'vitest'
import { parseSearchLines, sortByViewCount, searchVideos } from '../../../../electron/api/youtube/searchVideos.js'

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
})
