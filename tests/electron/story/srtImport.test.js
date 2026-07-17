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
    'story-audio-import-invalid-path', 'story-audio-import-unmatched']

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
  const byNarrator = { belongsToSource: (s) => s.speaker === 'narrator' }
  const segsOf = (r) => r.scenes.flatMap((sc) => sc.segments)

  it('대상 화자의 세그먼트에만 mp3 구간을 붙인다', () => {
    const r = alignSegmentsToSource(scenes, narratorCues, byNarrator)
    const [a, b, c] = segsOf(r)
    expect([a.srcStartMs, a.srcEndMs]).toEqual([0, 2000])
    expect(b.srcStartMs).toBeUndefined() // 인물 대사 — 이 자리 mp3는 안 쓰고 TTS가 채운다
    expect([c.srcStartMs, c.srcEndMs]).toEqual([4000, 6000])
    expect(r).toMatchObject({ aligned: 2, missed: 0, total: 2 })
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
      const filler = '가나다라마바사아자차카타파하가나다라마바사' // 20자 삽입 > maxGap(짧은 n에선 12)
      const cues = [{ startMs: 0, endMs: 1000, text: `이웃집개가 ${filler} 짖었지요` }]
      const sc = [{ segments: [{ id: 'x', type: 'narration', speaker: 'narrator', text: '이웃집개가 짖었지요' }] }]
      const r = alignSegmentsToSource(sc, cues, byNarrator)
      expect(r).toMatchObject({ aligned: 0, missed: 1 })
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

  it('자막에 없는 텍스트는 missed로 센다 — 조용히 TTS로 새면 목소리가 섞인다', () => {
    const sc = [{ segments: [{ id: 'x', type: 'narration', speaker: 'narrator', text: '자막에 없는 지문입니다' }] }]
    const r = alignSegmentsToSource(sc, narratorCues, byNarrator)
    expect(r).toMatchObject({ aligned: 0, missed: 1, total: 1 })
    expect(segsOf(r)[0].srcStartMs).toBeUndefined()
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
      expect({ otherHit: r.otherHit, otherMiss: r.otherMiss }).toEqual({ otherHit: 0, otherMiss: 2 })
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
