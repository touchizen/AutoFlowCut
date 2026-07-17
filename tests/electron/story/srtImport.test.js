import { describe, it, expect } from 'vitest'
import { parseSrtCues, validateCues, cueCoverage, alignSegmentsToSource, isImportVoice, isImportedSegment } from '../../../electron/story/srtImport.js'

const CUE = (i, a, b, t) => `${i}\n${a} --> ${b}\n${t}\n`

describe('parseSrtCues', () => {
  it('기본 큐 파싱 (ms 단위)', () => {
    const srt = `${CUE(1, '00:00:00,000', '00:00:00,990', '꼬끼오——')}\n${CUE(2, '00:00:00,990', '00:00:05,280', '사내는 눈을 뜨자마자')}`
    expect(parseSrtCues(srt)).toEqual([
      { index: 1, startMs: 0, endMs: 990, text: '꼬끼오——' },
      { index: 2, startMs: 990, endMs: 5280, text: '사내는 눈을 뜨자마자' },
    ])
  })

  it('BOM을 제거한다 — 없으면 첫 블록 인덱스 줄이 깨진다', () => {
    const srt = `﻿${CUE(1, '00:00:01,000', '00:00:02,000', '가')}`
    expect(parseSrtCues(srt)).toHaveLength(1)
    expect(parseSrtCues(srt)[0].text).toBe('가')
  })

  it('CRLF 구분자를 처리한다 — Windows SRT가 한 블록으로 뭉치면 안 된다', () => {
    const srt = '1\r\n00:00:00,000 --> 00:00:01,000\r\n가\r\n\r\n2\r\n00:00:01,000 --> 00:00:02,000\r\n나\r\n'
    expect(parseSrtCues(srt).map((c) => c.text)).toEqual(['가', '나'])
  })

  it('인덱스 줄이 없어도 타임코드 줄을 찾아 파싱한다', () => {
    expect(parseSrtCues('00:00:00,000 --> 00:00:01,500\n대사').map((c) => c.text)).toEqual(['대사'])
  })

  it('여러 줄 자막을 한 줄로 합친다', () => {
    expect(parseSrtCues(CUE(1, '00:00:00,000', '00:00:02,000', '첫 줄\n둘째 줄'))[0].text).toBe('첫 줄 둘째 줄')
  })

  it('빈 텍스트/역전 구간은 버린다', () => {
    const srt = `${CUE(1, '00:00:02,000', '00:00:01,000', '역전')}\n${CUE(2, '00:00:03,000', '00:00:04,000', '')}\n${CUE(3, '00:00:05,000', '00:00:06,000', '정상')}`
    expect(parseSrtCues(srt).map((c) => c.text)).toEqual(['정상'])
  })

  it('점 소수 구분자(00:00:01.500)도 받는다', () => {
    expect(parseSrtCues('00:00:01.500 --> 00:00:02.250\n가')[0]).toMatchObject({ startMs: 1500, endMs: 2250 })
  })

  it('빈 입력이면 빈 배열', () => {
    expect(parseSrtCues('')).toEqual([])
    expect(parseSrtCues(null)).toEqual([])
  })
})

describe('validateCues', () => {
  const cues = [
    { index: 1, startMs: 0, endMs: 1000, text: 'a' },
    { index: 2, startMs: 1000, endMs: 2000, text: 'b' },
  ]

  it('정상이면 오류 없음', () => {
    expect(validateCues(cues, { audioDurationMs: 2000 })).toEqual([])
  })

  // main의 오류는 IPC를 건너오며 번역될 수 없다 — 문장이 아니라 안정적인 kind를 돌려주고
  // renderer가 로케일에서 문구를 찾는다(tests/electron/noKoreanIpcErrors.test.js 계약).
  it('사람이 읽을 문장이 아니라 안정적인 kind 코드를 돌려준다', () => {
    const errs = validateCues([], { audioDurationMs: 1000 })
    expect(errs).toEqual([{ kind: 'story-srt-no-cues' }])
  })

  it('겹치는 큐를 잡는다 — 겹치면 오디오를 자를 수 없다', () => {
    const bad = [{ startMs: 0, endMs: 2000, text: 'a' }, { startMs: 1000, endMs: 3000, text: 'b' }]
    expect(validateCues(bad, { audioDurationMs: 3000 })[0].kind).toBe('story-srt-cues-overlap')
  })

  it('SRT가 오디오보다 길면 짝이 틀린 것 — 조용히 넘어가면 안 된다', () => {
    expect(validateCues(cues, { audioDurationMs: 500 })[0].kind).toBe('story-srt-longer-than-audio')
  })

  it('인코더 패딩 수준(허용치 이내) 초과는 봐준다', () => {
    expect(validateCues(cues, { audioDurationMs: 1999, toleranceMs: 1000 })).toEqual([])
  })

  // UI가 t()로 찾는 키가 로케일에 없으면 fallback(한국어 리터럴)이 그대로 나간다 — 컴포넌트
  // 테스트는 t를 주입하므로 이 구멍을 못 본다. 실제 로케일 파일을 직접 확인한다(한 번 당했다).
  it('UI가 쓰는 키가 두 로케일에 다 있다', async () => {
    const ko = (await import('../../../src/locales/ko.js')).default
    const en = (await import('../../../src/locales/en.js')).default
    for (const k of ['pickSrt', 'srtFilter', 'pickMp3', 'mp3Filter']) {
      expect(ko.story.audioImport[k], `ko: ${k}`).toBeTruthy()
      expect(en.story.audioImport[k], `en: ${k}`).toBeTruthy()
    }
    for (const k of ['addMp3', 'addSrt', 'clear', 'fromFile', 'voiceLocked', 'needSrt', 'needMp3', 'errKind', 'errPath']) {
      expect(ko.story.audio.source[k], `ko: source.${k}`).toBeTruthy()
      expect(en.story.audio.source[k], `en: source.${k}`).toBeTruthy()
    }
  })

  const KINDS = ['story-srt-no-cues', 'story-srt-cues-overlap', 'story-srt-longer-than-audio',
    'story-audio-import-unreadable', 'story-audio-import-missing', 'story-audio-import-stale',
    'story-audio-import-invalid-path', 'story-audio-import-unmatched', 'story-audio-stale-manifest', 'story-audio-manifest-corrupt', 'story-audio-out-of-sync', 'story-audio-state-corrupt', 'story-audio-speaker-empty', 'story-audio-import-no-audio']

  it('모든 errorKind가 두 로케일에 문구를 갖는다 — 코드만 노출되면 안 된다', async () => {
    const ko = (await import('../../../src/locales/ko.js')).default
    const en = (await import('../../../src/locales/en.js')).default
    for (const k of KINDS) {
      expect(ko.errorSection.kind[k], `ko: ${k}`).toBeTruthy()
      expect(en.errorSection.kind[k], `en: ${k}`).toBeTruthy()
    }
  })

  it('영어 로케일에 한글이 섞여 있지 않다 — fallback이 새면 여기서 걸린다', async () => {
    const en = (await import('../../../src/locales/en.js')).default
    const hangul = (v) => /[가-힣]/.test(String(v))
    for (const [k, v] of Object.entries(en.story.audioImport)) expect(hangul(v), `en.story.audioImport.${k}`).toBe(false)
    for (const [k, v] of Object.entries(en.story.audio.source)) expect(hangul(v), `en.story.audio.source.${k}`).toBe(false)
    for (const k of KINDS) expect(hangul(en.errorSection.kind[k]), `en.errorSection.kind['${k}']`).toBe(false)
  })
})

describe('cueCoverage', () => {
  it('큐 사이 간격 총량을 잰다', () => {
    const cues = [{ startMs: 0, endMs: 1000 }, { startMs: 1500, endMs: 2000 }, { startMs: 2800, endMs: 3000 }]
    expect(cueCoverage(cues, { audioDurationMs: 3000 }).gapMs).toBe(1300)
  })

  it('자막이 안 덮는 앞/뒤 구간을 잰다 — 그 구간은 결과물에서 빠진다', () => {
    const cues = [{ startMs: 2000, endMs: 5000 }]
    const c = cueCoverage(cues, { audioDurationMs: 9000 })
    expect(c.leadingMs).toBe(2000)
    expect(c.trailingMs).toBe(4000)
  })

  it('빈틈없는 SRT는 전부 0 (무한야담2 케이스)', () => {
    const cues = [{ startMs: 0, endMs: 1000 }, { startMs: 1000, endMs: 2000 }]
    expect(cueCoverage(cues, { audioDurationMs: 2000 })).toEqual({ gapMs: 0, leadingMs: 0, trailingMs: 0 })
  })

  it('큐가 겹쳐도 음수 간격으로 세지 않는다', () => {
    expect(cueCoverage([{ startMs: 0, endMs: 3000 }, { startMs: 2000, endMs: 4000 }], { audioDurationMs: 4000 }).gapMs).toBe(0)
  })

  it('큐가 없으면 0', () => {
    expect(cueCoverage([], { audioDurationMs: 1000 })).toEqual({ gapMs: 0, leadingMs: 0, trailingMs: 0 })
  })
})

// 보간의 근거는 **앞뒤로 잡힌 이웃**이다 — 그 사이라면 "비슷한 그 근처"가 맞고 사용자가 듣고
// 밀면 된다. 그런데 **하나도 안 잡히면** 기준 자체가 없다. 그건 대략 맞는 파일이 아니라 **다른
// 회차 파일**이고, 전체를 글자 수로 쪼개 붙이면 완전히 엉뚱한 오디오가 들어간다.
// "대략 잘라 놓고 경고" 정책은 *비슷한 게 있을 때* 성립한다 — 없으면 짝이 틀린 입력이라 막는다.
// 보간 구간은 **절대 겹치면 안 된다** — cutAudio 가 겹치는 range 를 throw 한다(audioCut.js).
// 한때 "폭 0이면 인접 앵커까지 넓혀 겹침을 허용" 하는 폴백이 있었는데, 나레이터 자막은 **연속 큐가
// 기본**이라 "대본 한 줄을 안 읽음"(missed 의 전형)이 곧 폭 0이었다. 그래서 이 정책이 구하려던 바로
// 그 케이스에서 절단기가 죽었다 — errorKind 없는 내부 영문으로.
// 논리도 틀렸다: 앵커 사이에 틈이 없다 = **그 줄의 오디오가 존재하지 않는다**. 이웃을 갖다 붙이면
// 앞뒤 대사가 두 번 들린다("엉뚱한 것"). 없는 건 없다고 두고 경고한다.
describe('alignSegmentsToSource — 보간은 겹치지 않는다', () => {
  const overlapping = (segs) => {
    const r = segs.filter((s) => Number.isFinite(s.srcStartMs)).sort((a, b) => a.srcStartMs - b.srcStartMs)
    return r.slice(1).filter((s, i) => s.srcStartMs < r[i].srcEndMs)
  }

  it('앵커가 맞닿아 틈이 없으면 구간을 주지 않는다 — 이웃을 겹쳐 쓰면 cutAudio 가 죽는다', () => {
    const cues = [ // 연속 큐 — 구멍이 없다(나레이터 자막의 기본 모양)
      { startMs: 0, endMs: 2000, text: '사내는 눈을 떴습니다' },
      { startMs: 2000, endMs: 4000, text: '마님이 말했습니다' },
    ]
    const sc = [{ segments: [
      { id: 's1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다' },
      { id: 'x', type: 'narration', speaker: 'narrator', text: '나레이터가 안 읽고 건너뛴 줄' },
      { id: 's2', type: 'narration', speaker: 'narrator', text: '마님이 말했습니다' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, { belongsToSource: (s) => s.speaker === 'narrator', coversOtherSpeakers: true })
    const segs = r.scenes.flatMap((s) => s.segments)
    expect(overlapping(segs), 'cutAudio 가 겹치는 range 를 throw 한다').toEqual([])
    expect(segs.find((s) => s.id === 'x').srcStartMs, '없는 오디오를 지어내면 안 된다').toBeUndefined()
    expect(r.missed).toBe(1) // 못 찾았다는 사실은 남는다 — 호출측이 경고한다
  })

  it('틈이 있으면 그 틈 안에서만 보간한다 — 앵커를 침범하지 않는다', () => {
    const cues = [
      { startMs: 0, endMs: 2000, text: '사내는 눈을 떴습니다' },
      { startMs: 2000, endMs: 5000, text: '자막에만 있는 다른 말' }, // 여기가 틈
      { startMs: 5000, endMs: 7000, text: '마님이 말했습니다' },
    ]
    const sc = [{ segments: [
      { id: 's1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다' },
      { id: 'x', type: 'narration', speaker: 'narrator', text: '자막과 다른 대본 줄' },
      { id: 's2', type: 'narration', speaker: 'narrator', text: '마님이 말했습니다' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, { belongsToSource: (s) => s.speaker === 'narrator', coversOtherSpeakers: true })
    const segs = r.scenes.flatMap((s) => s.segments)
    expect(overlapping(segs)).toEqual([])
    const x = segs.find((s) => s.id === 'x')
    expect(x.approx).toBe(true)
    expect(x.srcStartMs).toBeGreaterThanOrEqual(2000) // 앞 앵커 끝 이후
    expect(x.srcEndMs).toBeLessThanOrEqual(5000) // 뒤 앵커 시작 이전
  })

  it('연속 missed 가 틈보다 많아도 겹치지 않는다 — 비례 분할이 0폭을 만든다', () => {
    const cues = [
      { startMs: 0, endMs: 1000, text: '앞줄입니다' },
      { startMs: 1000, endMs: 1002, text: '가나' }, // 2ms 틈
      { startMs: 1002, endMs: 2000, text: '뒷줄입니다' },
    ]
    const sc = [{ segments: [
      { id: 'a', type: 'narration', speaker: 'narrator', text: '앞줄입니다' },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, type: 'narration', speaker: 'narrator', text: `못찾는줄${i}` })),
      { id: 'b', type: 'narration', speaker: 'narrator', text: '뒷줄입니다' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, { belongsToSource: (s) => s.speaker === 'narrator', coversOtherSpeakers: true })
    expect(overlapping(r.scenes.flatMap((s) => s.segments))).toEqual([])
  })
})

describe('alignSegmentsToSource — 앵커가 하나도 없으면 짝이 틀린 것이다', () => {
  it('한 세그먼트도 못 맞추면 보간하지 않는다 — 엉뚱한 구간을 갖다 붙이면 안 된다', () => {
    const cues = [
      { startMs: 0, endMs: 5000, text: '전혀 다른 회차의 자막입니다' },
      { startMs: 5000, endMs: 10000, text: '아무 관련 없는 내용이지요' },
    ]
    const sc = [{ segments: [
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다' },
      { id: 'n2', type: 'narration', speaker: 'narrator', text: '마님이 말했습니다' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, { belongsToSource: (s) => s.speaker === 'narrator', coversOtherSpeakers: true })
    expect(r).toMatchObject({ aligned: 0, missed: 2, approximated: 0 })
    const segs = r.scenes.flatMap((s) => s.segments)
    expect(segs.every((s) => s.srcStartMs === undefined)).toBe(true) // 구간을 주면 안 된다
    expect(r.unpaired, '짝이 틀린 입력임을 호출측에 알린다').toBe(true)
  })

  // 앵커는 **내 매칭** 기준이어야 한다. 남의 대사가 우연히 맞았다고 내 세그먼트를 보간할 근거가
  // 생기는 게 아니다 — 내 오디오가 이 자막에 하나도 없다는 뜻이니까. 남의 매칭만 보면 내 세그먼트
  // 전부가 **남의 자리**를 물어오고, 폭이 0이라 서로 겹치기까지 한다.
  it('내 대사가 하나도 안 맞으면 남의 대사가 맞아도 보간하지 않는다', () => {
    const cues = [{ startMs: 0, endMs: 3000, text: '일어나게' }] // 과부 대사만 있다
    const sc = [{ segments: [
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '완전히 바뀐 나레이션 문장입니다' },
      { id: 'd1', type: 'narration', speaker: '과부', text: '일어나게' }, // 이것만 맞는다
      { id: 'n2', type: 'narration', speaker: 'narrator', text: '이것도 바뀐 문장이지요' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, { belongsToSource: (s) => s.speaker === 'narrator', coversOtherSpeakers: true })
    expect(r).toMatchObject({ aligned: 0, missed: 2, otherHit: 1, approximated: 0, unpaired: true })
    const mine = r.scenes.flatMap((s) => s.segments).filter((s) => s.speaker === 'narrator')
    expect(mine.every((s) => s.srcStartMs === undefined), '남의 자리를 물어오면 안 된다').toBe(true)
  })

  it('하나라도 잡히면 나머지는 그 이웃 기준으로 보간한다 — 근거가 생겼다', () => {
    const cues = [
      { startMs: 0, endMs: 2000, text: '사내는 눈을 떴습니다' },   // 이게 앵커
      { startMs: 2000, endMs: 4000, text: '알아들을 수 없는 잡음' }, // n2 는 여기 어딘가
    ]
    const sc = [{ segments: [
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다' },
      { id: 'n2', type: 'narration', speaker: 'narrator', text: '마님이 말했습니다' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, { belongsToSource: (s) => s.speaker === 'narrator', coversOtherSpeakers: true })
    expect(r).toMatchObject({ aligned: 1, approximated: 1, unpaired: false })
    const n2 = r.scenes.flatMap((s) => s.segments).find((s) => s.id === 'n2')
    expect(n2.approx).toBe(true)
    expect(n2.srcStartMs).toBeGreaterThanOrEqual(2000) // 앵커 뒤 — 제 근처다
  })
})

describe('alignSegmentsToSource', () => {
  // 나레이터가 대본 전체(인물 대사 포함)를 읽은 mp3 — 무한야담2가 이 경우다(F0 실측으로 확인).
  const narratorCues = [
    { startMs: 0, endMs: 2000, text: '사내는 눈을 떴습니다' },
    { startMs: 2000, endMs: 4000, text: '"일어나게"' },
    { startMs: 4000, endMs: 6000, text: '마님이 말했습니다' },
  ]
  const scenes = [{
    sceneNo: 1,
    segments: [
      { id: 's1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다.' },
      { id: 's2', type: 'narration', speaker: '과부', text: '일어나게' },
      { id: 's3', type: 'narration', speaker: 'narrator', text: '마님이 말했습니다.' },
    ],
  }]
  // 나레이터 mp3 = 대본 전체(남의 대사 포함)를 읽은 소스. coversOtherSpeakers 는 **커서 규칙까지**
  // 좌우한다(남의 대사가 이 자막에 있으니 소비해야 뒤가 안 밀린다) — 모델을 명시한다.
  const byNarrator = { belongsToSource: (s) => s.speaker === 'narrator', coversOtherSpeakers: true }
  const segsOf = (r) => r.scenes.flatMap((sc) => sc.segments)

  it('대상 화자의 세그먼트에만 mp3 구간을 붙인다', () => {
    const r = alignSegmentsToSource(scenes, narratorCues, byNarrator)
    const [a, b, c] = segsOf(r)
    expect([a.srcStartMs, a.srcEndMs]).toEqual([0, 2000])
    expect(b.srcStartMs).toBeUndefined() // 인물 대사 — 이 자리 mp3는 안 쓰고 TTS가 채운다
    expect([c.srcStartMs, c.srcEndMs]).toEqual([4000, 6000])
    expect(r).toMatchObject({ aligned: 2, missed: 0, total: 2, approximated: 0, approximatedIds: [] })
    expect(a.approx).toBeUndefined()
    expect(c.approx).toBeUndefined()
  })

  // 여기가 핵심 — 대사 세그먼트를 건너뛰면 커서가 안 밀려 뒤 나레이터가 대사 구간에 잘못 붙는다.
  it('대사 세그먼트도 스트림을 소비한다 — 안 그러면 뒤 나레이터가 어긋난다', () => {
    const r = alignSegmentsToSource(scenes, narratorCues, byNarrator)
    const c = segsOf(r)[2]
    expect(c.srcStartMs).toBe(4000) // 2000(대사 자리)이 아니어야 한다
  })

  it('구두점/따옴표/줄바꿈이 달라도 맞춘다 — 자막과 대본은 표기가 갈린다', () => {
    const cues = [{ startMs: 0, endMs: 1000, text: '꼬끼오——' }]
    const sc = [{ segments: [{ id: 'x', type: 'narration', speaker: 'narrator', text: '꼬끼오…' }] }]
    expect(segsOf(alignSegmentsToSource(sc, cues, byNarrator))[0].srcStartMs).toBe(0)
  })

  // 실측(무한야담2): 자막(오디오)이 대본보다 글자가 더 많다 — 나레이터가 대본에 없는 "컹컹",
  // "한 번", "몽둥이를 늘어뜨린 채" 같은 토막을 세그먼트 중간에 덧읽는다. 세그먼트 텍스트가 통째로
  // 자막 안에 있는데 갈라져 indexOf가 실패해 227/230이 맞고도 3개 때문에 전체가 막혔다.
  describe('자막에 낀 삽입을 건너뛰며 맞춘다 (오탐 해결)', () => {
    it('세그먼트 중간에 낀 삽입("컹컹")을 건너뛰고 맞춘다 — 삽입 오디오는 구간에 포함', () => {
      const cues = [{ startMs: 0, endMs: 2200, text: '이웃집 개가 짖었지요 컹컹 두 번 짖고' }] // 22글자
      const sc = [{ segments: [{ id: 'x', type: 'narration', speaker: 'narrator', text: '이웃집 개가 짖었지요. 두 번 짖고.' }] }]
      const seg = segsOf(alignSegmentsToSource(sc, cues, byNarrator))[0]
      expect([seg.srcStartMs, seg.srcEndMs]).toEqual([0, 2200]) // 앞머리부터 끝까지(삽입 포함) 통으로
    })

    it('앞머리(4글자)조차 안 맞으면 삽입 매칭을 시도하지 않는다 — missed', () => {
      const cues = [{ startMs: 0, endMs: 1000, text: '완전히 다른 자막입니다' }]
      const sc = [{ segments: [{ id: 'x', type: 'narration', speaker: 'narrator', text: '이웃집 개가 짖었지요' }] }]
      const r = alignSegmentsToSource(sc, cues, byNarrator)
      expect(r).toMatchObject({ aligned: 0, missed: 1 })
    })

    it('대본 글자가 자막에서 빠지면(오디오가 덜 읽음) 맞추지 않는다 — 진짜 어긋남은 missed', () => {
      // 자막에 "짖었지요"가 없다(오디오가 대본보다 짧다) — 삽입이 아니라 삭제라 맞춰선 안 된다.
      const cues = [{ startMs: 0, endMs: 1000, text: '이웃집 개가 두 번' }]
      const sc = [{ segments: [{ id: 'x', type: 'narration', speaker: 'narrator', text: '이웃집 개가 짖었지요 두 번 짖고 그쳤다' }] }]
      const r = alignSegmentsToSource(sc, cues, byNarrator)
      expect(r).toMatchObject({ aligned: 0, missed: 1 })
    })

    it('삽입이 예산(maxGap)을 넘으면 맞추지 않는다 — 우연 일치로 먼 구간을 삼키지 않게', () => {
      const filler = '가나다라마바사아자차카타파하가나다라마바사' // 20자 삽입 > maxGap
      const cues = [{ startMs: 0, endMs: 1000, text: `이웃집개가 ${filler} 짖었지요` }]
      const sc = [{ segments: [{ id: 'x', type: 'narration', speaker: 'narrator', text: '이웃집개가 짖었지요' }] }]
      const r = alignSegmentsToSource(sc, cues, byNarrator)
      expect(r).toMatchObject({ aligned: 0, missed: 1 })
    })

    // 실측(ep02, 나레이터 237 세그먼트): 삽입 매칭이 **한 번도 쓰이지 않았다**(237개 전부 exact).
    // 애드리브는 세그먼트 *사이*로 떨어져 skipped로 처리된다. 즉 예산을 대본 길이에 비례시켜도
    // 잃는 게 없다. 반면 고정 하한(12)은 짧은 세그먼트가 제 길이의 몇 배를 삼키게 해 위험만 남는다.
    it('짧은 세그먼트가 제 길이를 넘는 삽입을 삼키지 않는다 — 의미가 반대인 문장을 조용히 가져갔다', () => {
      // 대본 "문을 열었다"(5자)가 자막 "문을 열었지만 들어가지는 않았다"에 삽입 9자로 붙어버렸다.
      // 고정 하한 12 때문에 통과했고 divergent=false라 경고조차 없었다.
      const cues = [{ startMs: 0, endMs: 5000, text: '문을 열었지만 들어가지는 않았다' }]
      const sc = [{ segments: [{ id: 'x', type: 'narration', speaker: 'narrator', text: '문을 열었다' }] }]
      const r = alignSegmentsToSource(sc, cues, byNarrator)
      expect(r).toMatchObject({ aligned: 0, missed: 1 })
    })

    it('삽입 예산은 대본 길이에 비례한다 — 긴 세그먼트의 짧은 애드리브는 그대로 통과', () => {
      // 대본 13자 + 삽입 2자("컹컹") → 비례 예산 안. 위 오탐 해결 케이스가 유지되는지 고정한다.
      const cues = [{ startMs: 0, endMs: 2200, text: '이웃집 개가 짖었지요 컹컹 두 번 짖고' }]
      const sc = [{ segments: [{ id: 'x', type: 'narration', speaker: 'narrator', text: '이웃집 개가 짖었지요. 두 번 짖고.' }] }]
      const r = alignSegmentsToSource(sc, cues, byNarrator)
      expect(r).toMatchObject({ aligned: 1, missed: 0 })
    })

    // 삽입 매칭은 추측이다 — 맞을 수도, 의미가 다른 문장을 삼킨 것일 수도 있다. 예산 안이라
    // 통과시키더라도 **조용해선 안 된다**. 호출측(stepMachine)이 경고할 수 있게 신호를 준다.
    it('삽입 매칭이 쓰이면 gapped로 센다 — 조용히 넘어가면 안 된다', () => {
      const cues = [{ startMs: 0, endMs: 2200, text: '이웃집 개가 짖었지요 컹컹 두 번 짖고' }]
      const sc = [{ segments: [{ id: 'x', type: 'narration', speaker: 'narrator', text: '이웃집 개가 짖었지요. 두 번 짖고.' }] }]
      const r = alignSegmentsToSource(sc, cues, byNarrator)
      expect(r.gapped).toBe(1)
      expect(r.gappedIds).toEqual(['x'])
    })

    it('전부 exact면 gapped는 0 — 실측 ep02가 이 경우다(237/237 exact)', () => {
      const r = alignSegmentsToSource(scenes, narratorCues, byNarrator)
      expect(r.gapped).toBe(0)
      expect(r.gappedIds).toEqual([])
    })
  })

  it('씬 구조·화자·감정을 건드리지 않는다 (원본 불변)', () => {
    const before = JSON.parse(JSON.stringify(scenes))
    const r = alignSegmentsToSource(scenes, narratorCues, byNarrator)
    expect(scenes).toEqual(before) // 입력 불변
    expect(r.scenes[0].sceneNo).toBe(1)
    expect(segsOf(r).map((s) => s.speaker)).toEqual(['narrator', '과부', 'narrator'])
  })

  it('sfx 세그먼트는 건너뛴다 — 자막에 없다', () => {
    const sc = [{ segments: [
      { id: 'f1', type: 'sfx', description: 'rooster crow' },
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다.' },
    ] }]
    const r = alignSegmentsToSource(sc, narratorCues, byNarrator)
    expect(segsOf(r)[0]).toEqual({ id: 'f1', type: 'sfx', description: 'rooster crow' })
    expect(segsOf(r)[1].srcStartMs).toBe(0)
  })

  // 내 세그먼트가 이것뿐인데 못 찾았다 = 앵커 0 = 짝이 틀린 입력이다. 보간의 근거인 "이웃"이
  // 없으므로 SRT 전체를 붙이면 엉뚱한 오디오가 된다 — 구간을 주지 않고 호출측이 막게 한다.
  it('내 세그먼트를 하나도 못 찾으면 구간을 주지 않는다 — 붙일 근거가 없다', () => {
    const sc = [{ segments: [{ id: 'x', type: 'narration', speaker: 'narrator', text: '자막에 없는 지문입니다' }] }]
    const r = alignSegmentsToSource(sc, narratorCues, byNarrator)
    expect(r).toMatchObject({ aligned: 0, missed: 1, total: 1, approximated: 0, unpaired: true })
    expect(segsOf(r)[0].srcStartMs).toBeUndefined()
  })

  it('내 세그먼트 하나라도 잡히면 못 찾은 것은 그 이웃 기준으로 보간한다', () => {
    const sc = [{ segments: [
      { id: 's1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다.' }, // 앵커
      { id: 'x', type: 'narration', speaker: 'narrator', text: '자막에 없는 지문입니다' },
    ] }]
    const r = alignSegmentsToSource(sc, narratorCues, byNarrator)
    expect(r).toMatchObject({ aligned: 1, missed: 1, approximated: 1, approximatedIds: ['x'], unpaired: false })
    const x = segsOf(r).find((g) => g.id === 'x')
    expect(x.approx).toBe(true)
    expect(x.srcStartMs).toBeGreaterThanOrEqual(2000) // 앵커(0-2000) 뒤 — 제 근처다
  })

  it('연속 missed 세그먼트는 앞뒤 매칭 사이를 글자 수 비례로 나눈다', () => {
    const cues = [
      { startMs: 0, endMs: 1000, text: '앞' },
      { startMs: 1000, endMs: 5000, text: '자막에만 있는 구간' },
      { startMs: 5000, endMs: 6000, text: '뒤' },
    ]
    const sc = [{ segments: [
      { id: 'a', type: 'narration', speaker: 'narrator', text: '앞' },
      { id: 'x1', type: 'narration', speaker: 'narrator', text: '홑' },
      { id: 'x2', type: 'narration', speaker: 'narrator', text: '겹겹겹' },
      { id: 'b', type: 'narration', speaker: 'narrator', text: '뒤' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, byNarrator)
    const segs = segsOf(r)
    expect([segs[1].srcStartMs, segs[1].srcEndMs, segs[1].approx]).toEqual([1000, 2000, true])
    expect([segs[2].srcStartMs, segs[2].srcEndMs, segs[2].approx]).toEqual([2000, 5000, true])
    expect(r).toMatchObject({ aligned: 2, missed: 2, approximated: 2, approximatedIds: ['x1', 'x2'] })
  })

  it('앞이나 뒤 앵커가 없으면 SRT 시작과 끝을 경계로 보간한다', () => {
    const cues = [
      { startMs: 0, endMs: 1000, text: '자막머리' },
      { startMs: 1000, endMs: 2000, text: '중간' },
      { startMs: 2000, endMs: 3000, text: '자막꼬리' },
    ]
    const sc = [{ segments: [
      { id: 'head', type: 'narration', speaker: 'narrator', text: '대본머리' },
      { id: 'middle', type: 'narration', speaker: 'narrator', text: '중간' },
      { id: 'tail', type: 'narration', speaker: 'narrator', text: '대본꼬리' },
    ] }]
    const segs = segsOf(alignSegmentsToSource(sc, cues, byNarrator))
    expect(segs[0]).toMatchObject({ srcStartMs: 0, srcEndMs: 1000, approx: true })
    expect(segs[2]).toMatchObject({ srcStartMs: 2000, srcEndMs: 3000, approx: true })
  })

  it('잡힌 세그먼트가 하나도 없으면 쪼개 붙이지 않는다 — 다른 회차 파일이다', () => {
    const cues = [{ startMs: 0, endMs: 4000, text: '완전히 다른 자막' }]
    const sc = [{ segments: [
      { id: 'x1', type: 'narration', speaker: 'narrator', text: '홑' },
      { id: 'x2', type: 'narration', speaker: 'narrator', text: '겹겹겹' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, byNarrator)
    expect(segsOf(r).every((g) => g.srcStartMs === undefined)).toBe(true)
    expect(r).toMatchObject({ aligned: 0, missed: 2, approximated: 0, unpaired: true })
  })

  // 인물 mp3: 그 인물 대사만 덮는 SRT. 나레이터 텍스트는 매칭이 안 돼 커서도 안 움직인다.
  it('인물 전용 mp3/SRT도 같은 함수로 처리된다', () => {
    const 과부Cues = [
      { startMs: 0, endMs: 900, text: '일어나게' },
      { startMs: 900, endMs: 1800, text: '고마워요' },
    ]
    const sc = [{ segments: [
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다.' },
      { id: 'd1', type: 'narration', speaker: '과부', text: '일어나게' },
      { id: 'n2', type: 'narration', speaker: 'narrator', text: '마님이 말했습니다.' },
      { id: 'd2', type: 'narration', speaker: '과부', text: '고마워요' },
    ] }]
    const r = alignSegmentsToSource(sc, 과부Cues, { belongsToSource: (s) => s.speaker === '과부' })
    const segs = segsOf(r)
    expect(segs[0].srcStartMs).toBeUndefined() // 나레이터 — 이 출처 소관 아님
    expect([segs[1].srcStartMs, segs[1].srcEndMs]).toEqual([0, 900])
    expect(segs[2].srcStartMs).toBeUndefined()
    expect([segs[3].srcStartMs, segs[3].srcEndMs]).toEqual([900, 1800])
    expect(r).toMatchObject({ aligned: 2, missed: 0, total: 2 })
    // 이 출처의 자막을 내 세그먼트가 빠짐없이 소비했다 — 꼬리가 없다. 아래 꼬리 감지가
    // 이 정상 케이스를 오탐하지 않는다는 고정(otherMiss는 나레이터 2개라 0이 아니다).
    expect(r.skipped).toBe(0)
    // 남의(나레이터) 세그먼트는 이 스트림 소관이 아니라 아예 안 건드린다 — 세지도 않는다.
    expect({ otherHit: r.otherHit, otherMiss: r.otherMiss }).toEqual({ otherHit: 0, otherMiss: 0 })
  })

  // 커서 앞의 구멍만 세면 **꼬리**를 놓친다. 남의 대사가 대본과 어긋나 매칭에 실패하면 커서가
  // 안 밀리고, 뒤따르는 내 세그먼트가 그 앞자리에서 자기 텍스트를 찾아 **남의 자리 오디오를
  // 물어온다**. 내 진짜 자리는 끝에 안 쓰인 채 남는데, 그게 꼬리라 skipped=0이었다 — 조용히 통과.
  it('안 쓰인 꼬리도 어긋남으로 센다 — 내 세그먼트가 남의 자리 오디오를 물어온 흔적이다', () => {
    // 나레이터 mp3(대본 전체를 읽었다) — 인물 대사 하나가 대본과 어긋난다.
    // otherHit>0(다른 인물 대사는 정상 매칭)이 "이 SRT가 남의 대사도 덮는다"는 증거다.
    const cues = [
      { startMs: 0, endMs: 1000, text: '안녕하세요' },          // 다른 인물 대사 — 정상 매칭(otherHit)
      { startMs: 1000, endMs: 4000, text: '어제 그는 떠났다' },  // kim 자리
      { startMs: 4000, endMs: 7000, text: '어제 그는 떠났다' },  // 나레이터 자리
    ]
    const sc = [{ segments: [
      { id: 'p1', type: 'narration', speaker: 'park', text: '안녕하세요' },
      { id: 'k1', type: 'narration', speaker: 'kim', text: '어제 그가 떠났다' }, // 자막과 어긋남
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '어제 그는 떠났다' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, { ...byNarrator, coversOtherSpeakers: true })
    const n1 = segsOf(r).find((s) => s.id === 'n1')
    expect(n1.srcStartMs).toBe(1000) // 실제 피해: 제자리(4000)가 아니라 kim 자리를 물어왔다
    expect(r).toMatchObject({ otherHit: 1, otherMiss: 1 })
    expect(r.dangerous).toBe(true)
    // 안 쓰인 **꼬리**(내 진짜 자리 7자)가 skipped 에 잡혀야 한다 — 커서 앞의 구멍만 세면 0이다.
    // 이 값을 안 박으면 꼬리 합산을 통째로 지워도 테스트가 통과한다(실제로 그랬다).
    expect(r.skipped).toBe(7)
    expect(r.divergent).toBe(true)
  })

  it('꼬리가 없으면 skipped 에 안 더한다 — 꼬리 합산이 정상 케이스를 오염시키면 안 된다', () => {
    const r = alignSegmentsToSource(scenes, narratorCues, { ...byNarrator, coversOtherSpeakers: true })
    expect(r.skipped).toBe(0)
    expect(r.divergent).toBe(false)
  })

  // otherHit 은 "이 SRT 가 남의 대사를 덮는다"는 증거가 **못 된다**: 인물 전용 SRT 의 애드리브가
  // 남의 짧은 대사와 우연히 일치하면 otherHit 이 선다. 그걸 dangerous 에 얹으면, 호출측이 정확히
  // false 로 알려준 정보를 우연이 뒤집어 멀쩡한 인물 import 를 막는다.
  it('인물 전용 mp3: 애드리브가 남의 대사와 우연히 일치해도 막지 않는다 — coverage 가 유일한 근거다', () => {
    const cues = [
      { startMs: 0, endMs: 1000, text: '안녕' },
      { startMs: 1000, endMs: 1500, text: '해설' }, // 애드리브가 우연히 나레이터 대사와 같다
    ]
    const sc = [{ segments: [
      { id: 'c1', type: 'narration', speaker: '철수', text: '안녕' },
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '해설' },
      { id: 'n2', type: 'narration', speaker: 'narrator', text: '이건 자막에 없다' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, { belongsToSource: (s) => s.speaker === '철수', coversOtherSpeakers: false })
    // 남의 세그먼트를 아예 안 훑으므로 우연 일치 자체가 성립하지 않는다 — otherHit 이 안 선다.
    expect(r).toMatchObject({ aligned: 1, missed: 0, otherHit: 0, otherMiss: 0 })
    expect(r.dangerous).toBe(false) // 이 mp3 는 철수 것만 덮는다
  })

  // 인물 전용 SRT 는 그 인물 대사만 담는다 — 남의 세그먼트는 **애초에 이 스트림 소관이 아니다**.
  // "남의 텍스트는 스트림에 없으니 매칭이 안 돼 커서도 안 움직인다"에 기대면 안 된다: 남이 우연히
  // 같은 말을 하면(인사·추임새는 흔하다) 그 세그먼트가 **내 자막을 먹고** 커서를 밀어, 뒤따르는
  // 내 대사가 제자리를 못 찾아 missed 가 된다 → 멀쩡한 import 가 통째로 차단된다.
  it('인물 전용 mp3: 남이 우연히 같은 말을 해도 내 자막을 먹지 않는다', () => {
    const cues = [
      { startMs: 0, endMs: 1000, text: '안녕' },
      { startMs: 1000, endMs: 2000, text: '잘가' },
    ]
    const sc = [{ segments: [
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '안녕' }, // 나레이터도 '안녕'
      { id: 'c1', type: 'narration', speaker: '철수', text: '안녕' },
      { id: 'c2', type: 'narration', speaker: '철수', text: '잘가' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, { belongsToSource: (s) => s.speaker === '철수', coversOtherSpeakers: false })
    const segs = segsOf(r)
    expect(r).toMatchObject({ aligned: 2, missed: 0, total: 2 })
    expect([segs[1].srcStartMs, segs[1].srcEndMs]).toEqual([0, 1000]) // c1 이 제 자막(0-1000)을 갖는다
    expect([segs[2].srcStartMs, segs[2].srcEndMs]).toEqual([1000, 2000])
    expect(segs[0].srcStartMs).toBeUndefined() // 나레이터는 이 출처 소관이 아니다
    expect(r.otherHit).toBe(0) // 남의 세그먼트는 이 스트림을 아예 안 건드린다
  })

  it('나레이터 mp3는 반대다 — 남의 대사가 스트림을 소비해야 뒤가 안 밀린다', () => {
    // coversOtherSpeakers=true 면 남의 대사도 이 자막에 있으므로 커서를 밀어야 한다(기존 동작 유지).
    const r = alignSegmentsToSource(scenes, narratorCues, { ...byNarrator, coversOtherSpeakers: true })
    expect(segsOf(r)[2].srcStartMs).toBe(4000) // 2000(대사 자리)이 아니어야 한다
    expect(r.otherHit).toBe(1)
  })







  it('나레이터 mp3에서 남의 대사가 다 맞으면 위험이 아니다 — 애드리브가 남아도(ep02가 이 경우)', () => {
    const cues = [
      { startMs: 0, endMs: 2000, text: '사내는 눈을 떴습니다' },
      { startMs: 2000, endMs: 4000, text: '"일어나게"' },
      { startMs: 4000, endMs: 5000, text: '꼬끼오' }, // 대본에 없는 애드리브
      { startMs: 5000, endMs: 7000, text: '마님이 말했습니다' },
    ]
    const r = alignSegmentsToSource(scenes, cues, byNarrator)
    expect(r).toMatchObject({ aligned: 2, missed: 0, otherHit: 1, otherMiss: 0 })
    expect(r.skipped).toBe(3) // '꼬끼오' 는 버려진다
    expect(r.dangerous).toBe(false) // 모든 세그먼트가 제자리를 찾았다 — 버릴 뿐 안 섞인다
  })

  // 인물 전용 mp3에선 남의(나레이터) 세그먼트가 매칭 안 되는 게 **정상**이라 otherMiss>0이
  // 기본값이고, 애드리브가 섞이는 것도 정상이다. 그래서 "안 가져간 자막(skipped)"만으로 위험을
  // 판정하면 멀쩡한 인물 mp3가 통째로 막힌다. 가르는 신호는 otherHit —
  // "이 SRT가 남의 대사도 덮는다"는 증거가 있어야 남의 대사 불일치가 위험을 뜻한다.
  it('인물 전용 mp3: 애드리브가 꼬리에 있어도 otherHit=0이라 위험이 아니다', () => {
    const cues = [
      { startMs: 0, endMs: 1000, text: '안녕' },
      { startMs: 1000, endMs: 1500, text: '하하' }, // 대본에 없는 애드리브 — 정상
    ]
    const sc = [{ segments: [
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '해설' }, // 이 SRT에 없다(정상)
      { id: 'c1', type: 'narration', speaker: '철수', text: '안녕' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, { belongsToSource: (s) => s.speaker === '철수' })
    expect(r).toMatchObject({ aligned: 1, missed: 0, otherHit: 0, otherMiss: 0 })
    expect(r.dangerous).toBe(false) // 정책 신호 — 이게 true 면 정상 프로젝트가 막힌다
  })

  it('인물 전용 mp3: 애드리브가 **중간**에 있어도 위험이 아니다 — 꼬리만 봐주면 여기서 막힌다', () => {
    const cues = [
      { startMs: 0, endMs: 1000, text: '안녕' },
      { startMs: 1000, endMs: 1500, text: '하하' }, // 대사 사이의 애드리브 — 정상
      { startMs: 1500, endMs: 2500, text: '잘가' },
    ]
    const sc = [{ segments: [
      { id: 'c1', type: 'narration', speaker: '철수', text: '안녕' },
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '해설' },
      { id: 'c2', type: 'narration', speaker: '철수', text: '잘가' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, { belongsToSource: (s) => s.speaker === '철수' })
    expect(r).toMatchObject({ aligned: 2, missed: 0, otherHit: 0, otherMiss: 0 })
    expect(r.skipped).toBe(2) // 애드리브 '하하'는 버려진다 — 세는 건 맞다(warn 용)
    expect(r.dangerous).toBe(false) // 버려질 뿐 위험은 아니다
  })

  it('내 세그먼트가 자막을 끝까지 소비하면 꼬리는 0 — 정상에 어긋남을 씌우지 않는다', () => {
    const r = alignSegmentsToSource(scenes, narratorCues, byNarrator)
    expect(r.skipped).toBe(0)
    expect(r.divergent).toBe(false)
  })

  it('한 큐가 여러 세그먼트로 쪼개지면 큐 안에서 비율로 보간한다', () => {
    const cues = [{ startMs: 0, endMs: 1000, text: '가나다라' }] // 4글자 = 1000ms
    const sc = [{ segments: [
      { id: 'a', type: 'narration', speaker: 'narrator', text: '가나' },
      { id: 'b', type: 'narration', speaker: 'narrator', text: '다라' },
    ] }]
    const segs = segsOf(alignSegmentsToSource(sc, cues, byNarrator))
    expect([segs[0].srcStartMs, segs[0].srcEndMs]).toEqual([0, 500])
    expect([segs[1].srcStartMs, segs[1].srcEndMs]).toEqual([500, 1000]) // 이어진다 — 틈/중복 없음
  })

  it('여러 큐에 걸친 세그먼트도 맞춘다', () => {
    const cues = [
      { startMs: 0, endMs: 1000, text: '앞부분' },
      { startMs: 1000, endMs: 2000, text: '뒷부분' },
    ]
    const sc = [{ segments: [{ id: 'a', type: 'narration', speaker: 'narrator', text: '앞부분 뒷부분' }] }]
    const segs = segsOf(alignSegmentsToSource(sc, cues, byNarrator))
    expect([segs[0].srcStartMs, segs[0].srcEndMs]).toEqual([0, 2000])
  })

  it('빈 큐도 안전하다', () => {
    expect(alignSegmentsToSource([], narratorCues, byNarrator).scenes).toEqual([])
  })

  // ── 어긋남 감지 ──
  // 남의 세그먼트가 자막과 안 맞으면 커서가 안 밀려서, 뒤따르는 내 세그먼트가 그 미소비 구간에서
  // 자기 텍스트를 찾아 **남의 오디오를 물어온다**. missed는 0이라 오류도 안 난다.
  // 신호는 skipped(아무도 안 가져간 자막 글자) — 정상인 두 경우는 둘 다 0이다.
  describe('어긋남 감지 (divergent)', () => {
    it('LLM이 대사를 다듬어 자막과 달라지면 잡는다 — 안 잡으면 나레이터 자리에 대사 오디오가 붙는다', () => {
      const cues = [
        { startMs: 0, endMs: 1000, text: '그는 말했다' },
        { startMs: 1000, endMs: 1400, text: '어제 떠나요' }, // 녹음된 대사
        { startMs: 2000, endMs: 3000, text: '어제……' }, // 나레이터 (짧고 반복되는 텍스트)
        { startMs: 3000, endMs: 4000, text: '비가 왔다' },
      ]
      const sc = [{ segments: [
        { id: 'n1', type: 'narration', speaker: 'narrator', text: '그는 말했다' },
        { id: 'd1', type: 'narration', speaker: '인물', text: '저는 떠날게요' }, // 자막과 다름 → 커서 정지
        { id: 'n2', type: 'narration', speaker: 'narrator', text: '어제……' },
        { id: 'n3', type: 'narration', speaker: 'narrator', text: '비가 왔다' },
      ] }]
      const r = alignSegmentsToSource(sc, cues, byNarrator)
      expect(r.missed).toBe(0) // ← missed로는 못 잡는다. 이래서 skipped가 필요하다.
      expect(r.skipped).toBeGreaterThan(0)
      expect(r.divergent).toBe(true)
    })

    it('나레이터 mp3(자막이 전부 덮음)는 divergent가 아니다', () => {
      const r = alignSegmentsToSource(scenes, narratorCues, byNarrator)
      expect({ skipped: r.skipped, divergent: r.divergent }).toEqual({ skipped: 0, divergent: false })
      expect({ otherHit: r.otherHit, otherMiss: r.otherMiss }).toEqual({ otherHit: 1, otherMiss: 0 })
    })

    it('인물 mp3(자막이 그 인물만 덮음)도 divergent가 아니다', () => {
      const cues = [{ startMs: 0, endMs: 900, text: '일어나게' }]
      const r = alignSegmentsToSource(scenes, cues, { belongsToSource: (s) => s.speaker === '과부' })
      expect({ skipped: r.skipped, divergent: r.divergent }).toEqual({ skipped: 0, divergent: false })
      expect({ otherHit: r.otherHit, otherMiss: r.otherMiss }).toEqual({ otherHit: 0, otherMiss: 0 })
    })

    it('자막에만 있고 아무 세그먼트도 안 가져간 구간이 있으면 divergent', () => {
      const cues = [
        { startMs: 0, endMs: 1000, text: '가나다' },
        { startMs: 1000, endMs: 2000, text: '아무도안가져감' },
        { startMs: 2000, endMs: 3000, text: '라마바' },
      ]
      const sc = [{ segments: [
        { id: 'a', type: 'narration', speaker: 'narrator', text: '가나다' },
        { id: 'b', type: 'narration', speaker: 'narrator', text: '라마바' },
      ] }]
      const r = alignSegmentsToSource(sc, cues, byNarrator)
      expect(r.skipped).toBe(7)
      expect(r.divergent).toBe(true)
    })
  })

  // ── 큐 사이 간격 ──
  // 세그먼트 끝을 "다음 큐의 첫 글자 시각"으로 잡으면 그 사이 간격을 통째로 삼킨다.
  describe('큐 사이 간격은 아무도 안 가져간다', () => {
    it('뒤에 긴 무자막 구간(음악/효과음)이 있어도 삼키지 않는다', () => {
      const cues = [
        { startMs: 0, endMs: 2000, text: '가나다' },
        { startMs: 12000, endMs: 14000, text: '라마바' }, // 사이 10초는 음악
      ]
      const sc = [{ segments: [{ id: 'a', type: 'narration', speaker: 'narrator', text: '가나다' }] }]
      const seg = segsOf(alignSegmentsToSource(sc, cues, byNarrator))[0]
      expect([seg.srcStartMs, seg.srcEndMs]).toEqual([0, 2000]) // 12000이 아니어야 한다
    })

    it('간격이 없으면 다음 큐 시작과 이어진다 (무한야담2 케이스)', () => {
      const cues = [
        { startMs: 0, endMs: 2000, text: '가나다' },
        { startMs: 2000, endMs: 4000, text: '라마바' },
      ]
      const sc = [{ segments: [
        { id: 'a', type: 'narration', speaker: 'narrator', text: '가나다' },
        { id: 'b', type: 'narration', speaker: 'narrator', text: '라마바' },
      ] }]
      const segs = segsOf(alignSegmentsToSource(sc, cues, byNarrator))
      expect([segs[0].srcStartMs, segs[0].srcEndMs]).toEqual([0, 2000])
      expect([segs[1].srcStartMs, segs[1].srcEndMs]).toEqual([2000, 4000]) // 빈틈 없음
    })
  })

  // 글자가 없는 세그먼트는 스트림에서 못 찾는다 → TTS 목록으로 새면 "성우 미배정"으로 막힌다.
  it('글자 없는 세그먼트("……")는 missed로 센다', () => {
    const sc = [{ segments: [{ id: 'a', type: 'narration', speaker: 'narrator', text: '……' }] }]
    const r = alignSegmentsToSource(sc, narratorCues, byNarrator)
    expect(r).toMatchObject({ aligned: 0, missed: 1, total: 1 })
  })

  // macOS 계열 도구의 자막은 한글이 자모 분해(NFD)돼 있을 수 있다 — 눈엔 같아 보여도
  // 코드포인트가 달라 전 세그먼트가 missed로 나온다("다른 회차 아니냐"는 엉뚱한 안내).
  it('NFD 자막도 맞춘다 — 보이는 글자가 같으면 맞아야 한다', () => {
    const cues = [{ startMs: 0, endMs: 1000, text: '사내는 눈을 떴습니다'.normalize('NFD') }]
    const sc = [{ segments: [{ id: 'a', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다.' }] }]
    const r = alignSegmentsToSource(sc, cues, byNarrator)
    expect(r).toMatchObject({ aligned: 1, missed: 0 })
  })

  // 진단 — 개수만 주면 사용자가 어디를 봐야 할지 모른다.
  it('첫 구멍의 위치와 못 찾은 세그먼트 id를 알려준다', () => {
    const cues = [
      { startMs: 0, endMs: 1000, text: '가나다' },
      { startMs: 1000, endMs: 2000, text: '자막에만있는것' }, // 대본에 없는 크레딧/음악 등
      { startMs: 2000, endMs: 3000, text: '라마바' },
    ]
    const sc = [{ segments: [
      { id: 'a', type: 'narration', speaker: 'narrator', text: '가나다' },
      { id: 'b', type: 'narration', speaker: 'narrator', text: '라마바' },
    ] }]
    const r = alignSegmentsToSource(sc, cues, byNarrator)
    expect(r.firstHole.atMs).toBe(1000) // 구멍이 시작하는 시각
    expect(r.divergent).toBe(true)
  })

  it('못 찾은 세그먼트 id를 몇 개 보고한다', () => {
    const sc = [{ segments: [
      { id: 'x1', type: 'narration', speaker: 'narrator', text: '자막에 없는 문장' },
      { id: 'x2', type: 'narration', speaker: 'narrator', text: '이것도 없다' },
    ] }]
    const r = alignSegmentsToSource(sc, narratorCues, byNarrator)
    expect(r.missedIds).toEqual(['x1', 'x2'])
  })
})

describe('isImportVoice', () => {
  it('mp3+SRT가 다 있으면 파일에서 가져오는 화자', () => {
    expect(isImportVoice({ provider: 'import', mp3Path: 'C:\\a.mp3', srtPath: 'C:\\a.srt' })).toBe(true)
  })

  it('TTS voice는 아니다', () => {
    expect(isImportVoice({ provider: 'typecast', voiceId: 'tc_x' })).toBe(false)
    expect(isImportVoice(null)).toBe(false)
  })

  it('반쪽 출처는 아니다 — 자막이 없으면 어느 구간인지 모른다', () => {
    expect(isImportVoice({ provider: 'import', mp3Path: 'C:\\a.mp3' })).toBe(false)
    expect(isImportVoice({ provider: 'import', srtPath: 'C:\\a.srt' })).toBe(false)
  })
})

describe('isImportedSegment', () => {
  it('src 구간이 있으면 가져온 세그먼트', () => {
    expect(isImportedSegment({ srcStartMs: 0, srcEndMs: 1000 })).toBe(true)
  })

  it('TTS 세그먼트는 아니다', () => {
    expect(isImportedSegment({ text: 'a', speaker: 'narrator' })).toBe(false)
    expect(isImportedSegment(null)).toBe(false)
  })

  it('구간이 0이거나 역전이면 아니다 — 자를 수 없는 구간', () => {
    expect(isImportedSegment({ srcStartMs: 100, srcEndMs: 100 })).toBe(false)
    expect(isImportedSegment({ srcStartMs: 200, srcEndMs: 100 })).toBe(false)
  })
})
