// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHUNK_MIN_CHARS,
  DEFAULT_CHUNK_TARGET_CHARS,
  findParagraphSpans,
  normalizeVerbatim,
  planScriptChunks,
  validateChunkCoverage,
  validateVerbatim,
} from '../../../electron/story/storyChunks.js'

const narrationScenes = (...texts) => [{
  sceneNo: 1,
  summary: 'test',
  segments: texts.map((text) => ({ type: 'narration', speaker: 'narrator', text })),
}]

describe('planScriptChunks', () => {
  it('원본 문자열의 문단 offset을 보존한다', () => {
    const source = '  첫 문단.\r\n이어짐!\r\n\r\n둘째 문단?\n\n셋째 문단…  '

    const spans = findParagraphSpans(source)

    expect(spans).toEqual([
      { start: 0, end: 13 },
      { start: 17, end: 23 },
      { start: 25, end: 33 },
    ])
    expect(spans.map(({ start, end }) => source.slice(start, end))).toEqual([
      '  첫 문단.\r\n이어짐!',
      '둘째 문단?',
      '셋째 문단…  ',
    ])
  })

  it('기본 임계값을 이름 있는 calibration 상수로 노출한다', () => {
    expect(DEFAULT_CHUNK_TARGET_CHARS).toBe(6_000)
    expect(DEFAULT_CHUNK_MIN_CHARS).toBe(12_000)
  })

  it('emission span을 이어 붙이면 원문 전체가 gap/overlap 없이 정확히 복원된다', () => {
    const paragraphs = Array.from({ length: 5 }, (_, i) => `${i}:${String.fromCharCode(65 + i).repeat(3_050)}`)
    const source = paragraphs.join('\r\n\r\n')

    const chunks = planScriptChunks(source)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(source)
    expect(chunks[0].start).toBe(0)
    expect(chunks.at(-1).end).toBe(source.length)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i - 1].end).toBe(chunks[i].start)
      expect(chunks[i].index).toBe(i)
    }
    for (const chunk of chunks) expect(chunk.text).toBe(source.slice(chunk.start, chunk.end))
  })

  it('target보다 큰 문단을 쪼개거나 이웃 문단과 합치지 않는다', () => {
    const oversized = `큰문단-${'가'.repeat(7_000)}`
    const source = [oversized, '나'.repeat(2_000), '다'.repeat(2_000), '라'.repeat(2_000)].join('\n\n')

    const chunks = planScriptChunks(source)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].text.trim()).toBe(oversized)
    expect(chunks[0].text).not.toContain('나'.repeat(20))
  })

  it('12,000자 미만이면 문단이 많아도 단일 chunk다', () => {
    const source = Array.from({ length: 8 }, (_, i) => `${i}-${'가'.repeat(500)}`).join('\n\n')

    expect(planScriptChunks(source)).toEqual([{
      index: 0,
      start: 0,
      end: source.length,
      text: source,
      before: '',
      after: '',
    }])
  })

  it('usable 문단 경계가 두 개 미만이면 긴 원문도 단일 chunk다', () => {
    const source = `${'가'.repeat(7_000)}\n\n${'나'.repeat(7_000)}`
    expect(planScriptChunks(source)).toHaveLength(1)
  })

  it('같은 입력과 옵션은 항상 같은 chunk를 만들고 이웃 문단을 read-only context로 둔다', () => {
    const paragraphs = Array.from({ length: 4 }, (_, i) => `문단-${i}-${String(i).repeat(3_200)}`)
    const source = paragraphs.join('\n\n')

    const first = planScriptChunks(source)
    const second = planScriptChunks(source)

    expect(second).toEqual(first)
    expect(first[1].before).toBe(paragraphs[0])
    expect(first[1].after).toBe(paragraphs[2])
    expect(first[1].text).not.toContain(paragraphs[0])
    expect(first[1].text).not.toContain(paragraphs[2])
  })
})

describe('verbatim coverage validation', () => {
  it('srtImport와 같은 NFC + Unicode whitespace/punctuation/symbol 제거 + lowercase 정규화를 쓴다', async () => {
    const source = ' A\u030A\t—한 글! 💡＂Z＂ '
    const srtImportParity = String(source || '')
      .normalize('NFC')
      .replace(/[\s\p{P}\p{S}]/gu, '')
      .toLowerCase()

    expect(normalizeVerbatim(source)).toBe(srtImportParity)
    expect(normalizeVerbatim(source)).toBe('å한글z')
    // 실소비자(srtImport.normalizeForAlign)와 직접 대조 — 인라인 복사본 핀만으로는 소비자가
    // 갈라져도 초록이라 parity를 증명하지 못한다(Fable M2 리뷰 MINOR).
    const { normalizeForAlign } = await import('../../../electron/story/srtImport.js')
    for (const s of [source, '철수: (놀라며) "안녕"', 'ＡＢＣ…—다음 줄']) {
      expect(normalizeVerbatim(s)).toBe(normalizeForAlign(s))
    }
  })

  it('여러 문단에 걸친 괄호는 stage direction으로 삼키지 않는다', () => {
    // 홀로 남은 여는 괄호가 다음 문단의 닫는 괄호와 짝지어지면 실제 나레이션이 whitelist로
    // 사라져 faithful 출력이 false-FAIL(또는 실제 누락이 false-PASS)한다.
    const source = '그가 왔다 (아마도\n\n그는 문을 열었다) 말했다'
    const faithful = [{ segments: [
      { type: 'narration', text: '그가 왔다 (아마도' },
      { type: 'narration', text: '그는 문을 열었다) 말했다' },
    ] }]
    expect(validateVerbatim(source, faithful).ok).toBe(true)
  })

  it('나레이션 서두의 "이름 - " 동격 표현을 roster label로 벗겨내지 않는다', () => {
    const source = '민수 - 조선의 명의는 그를 불렀다'
    const faithful = [{ segments: [{ type: 'narration', text: '민수 - 조선의 명의는 그를 불렀다' }] }]
    expect(validateVerbatim(source, faithful, { roster: [{ name: '민수' }] }).ok).toBe(true)
  })

  it('헤더/확정 roster label/stage direction/quote/segment whitespace 생략과 SFX를 허용한다', () => {
    const source = [
      '# 장면 1',
      '민수: “안녕,',
      '세상!” [웃는다]',
      '',
      '(문을 연다) *한숨* 다음 문장.',
    ].join('\r\n')
    const scenes = narrationScenes('안녕', '  세상 ', '다음\n문장')
    scenes[0].segments.splice(2, 0, { type: 'sfx', description: 'door opening' })

    const result = validateVerbatim(source, scenes, {
      roster: [{ id: 'minsu', name: '민수' }],
    })

    expect(result.ok).toBe(true)
    expect(result).not.toHaveProperty('missing')
    expect(result).not.toHaveProperty('duplicated')
    expect(result).not.toHaveProperty('reordered')
    expect(result.normalizedCoverage).toMatchObject({
      expectedLength: normalizeVerbatim('안녕세상다음문장').length,
      coverage: 1,
      narrationSegmentCount: 3,
      acceptedNormalization: {
        markdownHeaders: 1,
        speakerLabels: 1,
        stageDirections: 3,
      },
    })
  })

  it('확정 roster에 없는 speaker label은 whitelist로 제거하지 않는다', () => {
    const result = validateVerbatim('낯선이: 안녕', narrationScenes('안녕'), {
      roster: [{ id: 'minsu', name: '민수' }],
    })

    expect(result.ok).toBe(false)
    expect(result.missing).toBeTruthy()
  })

  it('paraphrase를 거부한다', () => {
    const result = validateVerbatim('빠른 갈색 여우', narrationScenes('재빠른 갈색 여우'))

    expect(result.ok).toBe(false)
    expect(result.modified).toBeTruthy()
  })

  it('원문 일부 omission을 거부한다', () => {
    const result = validateVerbatim('첫 문장 둘째 문장', narrationScenes('첫 문장'))

    expect(result.ok).toBe(false)
    expect(result.missing).toBeTruthy()
    expect(result.normalizedCoverage.coverage).toBeLessThan(1)
  })

  it('같은 normalized source span의 중복 emit을 거부한다', () => {
    const result = validateVerbatim('하나 둘', narrationScenes('하나', '하나', '둘'))

    expect(result.ok).toBe(false)
    expect(result.duplicated).toBeTruthy()
  })

  it('segment 순서 변경을 거부한다', () => {
    const result = validateVerbatim('하나 둘 셋', narrationScenes('둘', '하나', '셋'))

    expect(result.ok).toBe(false)
    expect(result.reordered).toBeTruthy()
  })

  it('chunk emission text만 검증한다', () => {
    const chunk = { index: 2, start: 10, end: 16, text: '본문 문장', before: '앞', after: '뒤' }
    expect(validateChunkCoverage(chunk, narrationScenes('본문문장')).ok).toBe(true)
    expect(validateChunkCoverage(chunk, narrationScenes('앞본문문장')).ok).toBe(false)
  })
})
