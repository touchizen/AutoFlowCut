import { describe, it, expect, vi } from 'vitest'
import { parseVideoDetails, getVideoDetails } from '../../../../electron/api/youtube/getVideoDetails.js'

const SAMPLE = JSON.stringify({
  id: 'dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  channel: 'Rick Astley',
  uploader: 'Rick Astley',
  channel_follower_count: 4520000,
  upload_date: '20091025',
  view_count: 1790462958,
  like_count: 19235402,
  duration: 213,
  duration_string: '3:33',
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
})

describe('parseVideoDetails', () => {
  it('maps yt-dlp single-json fields', () => {
    const d = parseVideoDetails(SAMPLE)
    expect(d).toMatchObject({
      videoId: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      channelTitle: 'Rick Astley',
      subscribers: 4520000,
      uploadDate: '20091025',
      viewCount: 1790462958,
      likeCount: 19235402,
      durationSec: 213,
      durationString: '3:33',
    })
  })

  it('falls back thumbnail to hqdefault when NA', () => {
    const d = parseVideoDetails(JSON.stringify({ id: 'abc123', thumbnail: 'NA' }))
    expect(d.thumbnailUrl).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg')
  })

  it('treats hidden likes / missing subs as null', () => {
    const d = parseVideoDetails(JSON.stringify({ id: 'x', view_count: 10, like_count: null }))
    expect(d.likeCount).toBeNull()
    expect(d.subscribers).toBeNull()
  })

  it('returns null on non-JSON / empty', () => {
    expect(parseVideoDetails('')).toBeNull()
    expect(parseVideoDetails('not json')).toBeNull()
    expect(parseVideoDetails('[1,2,3]')).toBeNull()
  })
})

describe('getVideoDetails', () => {
  it('rejects empty / unsafe video id without spawning yt-dlp', async () => {
    const runYtDlp = vi.fn()
    expect(await getVideoDetails({ videoId: '' }, { runYtDlp })).toEqual({ error: 'empty-video-id' })
    expect(await getVideoDetails({ videoId: 'a b; rm -rf' }, { runYtDlp })).toEqual({ error: 'invalid-video-id' })
    expect(runYtDlp).not.toHaveBeenCalled()
  })

  it('returns details with viral metrics on success', async () => {
    const runYtDlp = vi.fn().mockResolvedValue({ stdout: SAMPLE, stderr: '', code: 0 })
    const r = await getVideoDetails({ videoId: 'dQw4w9WgXcQ' }, { runYtDlp })
    expect(runYtDlp.mock.calls[0][0]).toContain('--dump-single-json')
    expect(runYtDlp.mock.calls[0][0]).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(r.details.videoId).toBe('dQw4w9WgXcQ')
    expect(r.details.viral).toBeDefined()
    expect(r.details.viral.tier).toBe('explosive') // 17.9억 조회 / 452만 구독 ≈ 396배
  })

  it('propagates binary-not-found', async () => {
    const runYtDlp = vi.fn().mockRejectedValue(new Error('binary-not-found'))
    expect(await getVideoDetails({ videoId: 'abc' }, { runYtDlp })).toEqual({ error: 'binary-not-found' })
  })

  it('returns parse-failed when yt-dlp output is not parseable', async () => {
    const runYtDlp = vi.fn().mockResolvedValue({ stdout: 'garbage', stderr: '', code: 0 })
    expect(await getVideoDetails({ videoId: 'abc' }, { runYtDlp })).toEqual({ error: 'parse-failed' })
  })
})
