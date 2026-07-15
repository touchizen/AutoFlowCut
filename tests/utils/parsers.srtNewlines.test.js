/**
 * SRT 임포트는 파일이 어떤 줄바꿈을 쓰든 동작해야 한다.
 *
 * 실측 버그(2026-07-14): 사용자가 받은 SRT 는 **CRLF**(\r\n) 였다 — 윈도우·유튜브·대부분의 자막
 * 도구가 그렇게 쓴다. 그런데 파서는 블록 구분자를 `/\n\n+/` 로 찾았다. CRLF 파일의 블록 사이는
 * "\r\n\r\n" 이라 \n 이 연속하지 않는다 → **한 번도 안 걸린다** → 파일 전체가 블록 하나 →
 * 자막 700줄짜리 파일이 씬 1개로 들어왔다.
 *
 * 특수문자 문제가 아니었다. 줄바꿈 문제였다.
 */

import { describe, it, expect } from 'vitest'
import { parseSRTToTrack, parseSRTToScenes, mergeSRTIntoScenes, parseTextToScenes } from '../../src/utils/parsers'
import { parseCSVTextToRows } from '../../src/utils/csvParser'

/** 실제 파일에서 그대로 가져온 두 블록 (CRLF). */
const CRLF = [
  '1',
  '00:00:00,166 --> 00:00:01,766',
  'billions of people from different worlds',
  '',
  '2',
  '00:00:01,766 --> 00:00:03,566',
  'were suddenly transported',
  '',
].join('\r\n')

const LF = CRLF.replace(/\r\n/g, '\n')
const CR_ONLY = CRLF.replace(/\r\n/g, '\r') // 구형 맥
const BOM = '﻿' + CRLF

describe('SRT 임포트는 줄바꿈 방식에 묶이면 안 된다', () => {
  it.each([
    ['LF', LF],
    ['CRLF (실제 사용자 파일)', CRLF],
    ['CR only (구형 맥)', CR_ONLY],
    ['BOM + CRLF', BOM],
  ])('%s: 블록을 각각의 씬으로 나눈다', (_label, text) => {
    const { srtTrack, scenes } = parseSRTToTrack(text)

    expect(srtTrack).toHaveLength(2)
    expect(scenes).toHaveLength(2)
    expect(srtTrack[0]).toMatchObject({ startTime: 0.166, endTime: 1.766, text: 'billions of people from different worlds' })
    expect(srtTrack[1]).toMatchObject({ startTime: 1.766, endTime: 3.566, text: 'were suddenly transported' })
  })

  it('자막 텍스트에 \\r 이 남지 않는다', () => {
    const { srtTrack } = parseSRTToTrack(CRLF)
    for (const line of srtTrack) expect(line.text).not.toMatch(/\r/)
  })

  it('parseSRTToScenes 도 CRLF 를 나눈다', () => {
    const scenes = parseSRTToScenes(CRLF)
    expect(scenes).toHaveLength(2)
    expect(scenes[0].subtitle).toBe('billions of people from different worlds')
  })

  it('mergeSRTIntoScenes 도 CRLF 를 나눈다', () => {
    const existing = [
      { id: 'scene_1', subtitle: '', prompt: 'keep me' },
      { id: 'scene_2', subtitle: '', prompt: 'keep me too' },
    ]
    const merged = mergeSRTIntoScenes(existing, CRLF)
    expect(merged).toHaveLength(2)
    expect(merged[0].subtitle).toBe('billions of people from different worlds')
    expect(merged[1].subtitle).toBe('were suddenly transported')
  })

  it('인덱스 줄이 없는 SRT 도 받는다 (도구마다 생략한다)', () => {
    const noIndex = '00:00:00,166 --> 00:00:01,766\r\nfirst\r\n\r\n00:00:01,766 --> 00:00:03,566\r\nsecond\r\n'
    const { srtTrack } = parseSRTToTrack(noIndex)
    expect(srtTrack.map((l) => l.text)).toEqual(['first', 'second'])
  })

  it('여러 줄짜리 자막은 줄바꿈을 보존한다', () => {
    const multi = '1\r\n00:00:00,000 --> 00:00:02,000\r\nline one\r\nline two\r\n'
    const { srtTrack } = parseSRTToTrack(multi)
    expect(srtTrack[0].text).toBe('line one\nline two')
  })
})

/**
 * SRT 를 고치면서 CSV·TXT 도 같은 병인지 확인했다 — 아니었다(csvParser 가 이미 CRLF/BOM 을 처리한다).
 * 그 보증을 여기 못 박아 둔다. 나중에 누가 깨뜨리면 이 테스트가 잡는다.
 */
describe('CSV·TXT 임포트도 Windows 파일에서 깨지지 않는다', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n')

  it('CSV: CRLF 와 BOM 을 모두 흡수한다', () => {
    const expected = { headers: ['a', 'b'], rows: [{ a: '1', b: '2' }] }
    expect(parseCSVTextToRows(crlf('a,b\n1,2\n'))).toEqual(expected)
    expect(parseCSVTextToRows('﻿' + crlf('a,b\n1,2\n'))).toEqual(expected)
  })

  it('TXT: 줄 끝에 \\r 이 남지 않는다', () => {
    const scenes = parseTextToScenes(crlf('first line\nsecond line\n'))
    expect(scenes).toHaveLength(2)
    for (const s of scenes) expect(JSON.stringify(s)).not.toMatch(/\\r/)
  })
})
