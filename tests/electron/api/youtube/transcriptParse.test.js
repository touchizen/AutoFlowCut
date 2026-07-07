import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  parseSrv3,
  parseVtt,
  parseSubtitle,
  segmentsToSrt,
  segmentsToPlainText,
} from '../../../../electron/api/youtube/transcriptParse.js'

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'youtube')
const manualSrv3 = readFileSync(path.join(FIXTURES, 'manual-en.srv3'), 'utf8')
const autoSrv3 = readFileSync(path.join(FIXTURES, 'auto-ko.srv3'), 'utf8')
const manualVtt = readFileSync(path.join(FIXTURES, 'manual-en.vtt'), 'utf8')

describe('parseSrv3 — 수동 자막(<p t d>텍스트</p>)', () => {
  it('실측 manual-en.srv3 → 세그먼트 {start,dur,text}', () => {
    const segs = parseSrv3(manualSrv3)
    expect(segs.length).toBe(6)
    expect(segs[0]).toEqual({ start: 1200, dur: 2160, text: 'All right, so here we are, in front of the elephants' })
    expect(segs[3].text).toBe("and that's cool") // &#39; 디코드
    expect(segs[5].start).toBe(16881)
  })
})

describe('parseSrv3 — 자동생성 자막(<p t d><s>단어</s>...)', () => {
  it('실측 auto-ko.srv3 → <s> 조각 join, 빈 append(p a="1") 제외', () => {
    const segs = parseSrv3(autoSrv3)
    expect(segs.length).toBeGreaterThan(0)
    expect(segs[0].start).toBe(9960)
    expect(segs[0].dur).toBe(3920)
    expect(segs[0].text).toBe('오반 강남 스타일')
    // 빈 줄바꿈만 있는 append 세그먼트는 제외돼야 함
    expect(segs.every((s) => s.text.trim().length > 0)).toBe(true)
  })
})

describe('parseVtt — WebVTT cue 블록', () => {
  it('실측 manual-en.vtt → 세그먼트, 개행 합침', () => {
    const segs = parseVtt(manualVtt)
    expect(segs.length).toBe(6)
    expect(segs[0].start).toBe(1200)
    expect(segs[0].dur).toBe(2160) // 3.360 - 1.200
    expect(segs[0].text).toBe('All right, so here we are, in front of the elephants')
  })

  it('WEBVTT 헤더/NOTE/빈 cue 무시', () => {
    const vtt = 'WEBVTT\n\nNOTE this is a note\n\n00:00:00.000 --> 00:00:01.000\nhi\n\n00:00:01.000 --> 00:00:02.000\n\n'
    const segs = parseVtt(vtt)
    expect(segs.length).toBe(1)
    expect(segs[0].text).toBe('hi')
  })
})

describe('parseSubtitle — 확장자/포맷 자동 분기', () => {
  it('srv3 → parseSrv3', () => {
    expect(parseSubtitle(manualSrv3, 'srv3').length).toBe(6)
  })
  it('vtt → parseVtt', () => {
    expect(parseSubtitle(manualVtt, 'vtt').length).toBe(6)
  })
  it('내용으로 자동 판별(WEBVTT 헤더)', () => {
    expect(parseSubtitle(manualVtt).length).toBe(6)
    expect(parseSubtitle(manualSrv3).length).toBe(6)
  })
  it('빈/깨진 입력 → []', () => {
    expect(parseSubtitle('')).toEqual([])
    expect(parseSubtitle(null)).toEqual([])
    expect(parseSubtitle('garbage not xml not vtt')).toEqual([])
  })
})

describe('segmentsToSrt', () => {
  it('SRT 블록 — 콤마 소수점, 1-base, start+dur=end', () => {
    const srt = segmentsToSrt([
      { start: 1200, dur: 2160, text: 'hello' },
      { start: 5318, dur: 2656, text: 'world' },
    ])
    expect(srt).toBe(
      '1\n00:00:01,200 --> 00:00:03,360\nhello\n\n2\n00:00:05,318 --> 00:00:07,974\nworld\n'
    )
  })
  it('dur 없으면 다음 시작(마지막 +3초)으로 보정', () => {
    const srt = segmentsToSrt([
      { start: 0, text: 'a' },
      { start: 2000, text: 'b' },
    ])
    expect(srt).toContain('00:00:00,000 --> 00:00:02,000')
    expect(srt).toContain('00:00:02,000 --> 00:00:05,000')
  })
  it('빈 → 빈 문자열', () => {
    expect(segmentsToSrt([])).toBe('')
  })
})

describe('segmentsToPlainText', () => {
  it('텍스트 공백 join + 다중공백 정리', () => {
    expect(segmentsToPlainText([{ text: '오반 ' }, { text: ' 강남' }, { text: '스타일' }])).toBe('오반 강남 스타일')
  })
})
