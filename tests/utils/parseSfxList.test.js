/**
 * parseSfxList.js 단위 테스트
 *
 * 입력: W4-3에서 생성된 `08_sfx_list.md` / `08_sfx_목록.md` markdown 테이블
 * 출력: Map<filename_stem, { partName, anchor, placement, offsetSec, prompt, durationSec, cueNo }>
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseSfxList } from '../../src/utils/parseSfxList'

// stderr warning suppression
let warnSpy
beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { warnSpy.mockRestore() })

describe('parseSfxList', () => {
  it('returns an empty Map for null / undefined / empty input', () => {
    expect(parseSfxList(null).size).toBe(0)
    expect(parseSfxList(undefined).size).toBe(0)
    expect(parseSfxList('').size).toBe(0)
    expect(parseSfxList('   \n\n  ').size).toBe(0)
  })

  it('parses a canonical English table (W4-3 spec example)', () => {
    const md = `
# Some title

| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | setup | 01_bell_toll | "the church bell struck" | concurrent | 0 | Distant church bell tolling slowly at dusk | 3 |
| 2 | setup | 02_door_creak | "the door swung open" | before | 0.5 | Heavy wooden door creaking open | 2 |
| 3 | rising | 03_rain | "the rain began to fall" | concurrent | 0 | Heavy rain on tiled rooftop | 4 |
`
    const result = parseSfxList(md)
    expect(result.size).toBe(3)

    const first = result.get('01_bell_toll')
    expect(first).toEqual({
      cueNo: 1,
      partName: 'setup',
      anchor: 'the church bell struck',
      placement: 'concurrent',
      offsetSec: 0,
      prompt: 'Distant church bell tolling slowly at dusk',
      durationSec: 3,
    })

    const second = result.get('02_door_creak')
    expect(second.cueNo).toBe(2)
    expect(second.placement).toBe('before')
    expect(second.offsetSec).toBe(0.5)
    expect(second.durationSec).toBe(2)
    expect(second.prompt).toBe('Heavy wooden door creaking open')

    expect(result.get('03_rain').partName).toBe('rising')
  })

  it('parses a Korean table (column count fixed, header text differs)', () => {
    const md = `
| # | 파트 | 파일명 | 앵커 나레이션 | 배치 | 오프셋(초) | 영문 프롬프트 | 길이(초) |
|---|------|--------|-------------|------|-----------|-------------|---------|
| 1 | 기 | 01_주판_구슬_튕기기 | "주판알이 튕기며" | concurrent | 0 | Wooden abacus beads clicking gently | 3 |
| 2 | 기 | 02_문_삐걱 | "문이 열리고" | before | 0.5 | Creaking wooden door slowly opening | 2 |
`
    const result = parseSfxList(md)
    expect(result.size).toBe(2)
    const abacus = result.get('01_주판_구슬_튕기기')
    expect(abacus).toBeDefined()
    expect(abacus.partName).toBe('기')
    expect(abacus.anchor).toBe('주판알이 튕기며')
    expect(abacus.prompt).toBe('Wooden abacus beads clicking gently')
    expect(abacus.durationSec).toBe(3)
  })

  it('strips surrounding quotes from anchor (single, double, smart quotes)', () => {
    const md = `
| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | a | dq | "double" | concurrent | 0 | prompt | 1 |
| 2 | a | sq | 'single' | concurrent | 0 | prompt | 1 |
| 3 | a | smart | “smart double” | concurrent | 0 | prompt | 1 |
| 4 | a | bare | no quotes | concurrent | 0 | prompt | 1 |
`
    const r = parseSfxList(md)
    expect(r.get('dq').anchor).toBe('double')
    expect(r.get('sq').anchor).toBe('single')
    expect(r.get('smart').anchor).toBe('smart double')
    expect(r.get('bare').anchor).toBe('no quotes')
  })

  it('skips rows missing Filename column (tolerant, never throws)', () => {
    const md = `
| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | a | 01_ok | "anchor" | concurrent | 0 | prompt one | 1 |
| 2 | a |  | "anchor" | concurrent | 0 | prompt skipped | 1 |
| 3 | a | 03_ok | "anchor" | concurrent | 0 | prompt three | 1 |
`
    const r = parseSfxList(md)
    expect(r.size).toBe(2)
    expect(r.has('01_ok')).toBe(true)
    expect(r.has('03_ok')).toBe(true)
  })

  it('skips header separator rows (|---|---| pattern) and the header itself', () => {
    const md = `
| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | a | 01_x | "anchor" | concurrent | 0 | prompt | 1 |
`
    const r = parseSfxList(md)
    expect(r.size).toBe(1)
    expect(r.has('01_x')).toBe(true)
    // Should NOT have 'Filename' or '----------' as keys
    expect(r.has('Filename')).toBe(false)
    expect(r.has('----------')).toBe(false)
    expect(r.has('파일명')).toBe(false)
  })

  it('treats malformed offset / duration as 0 (no throw, logs a warning)', () => {
    const md = `
| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | a | 01_x | "anchor" | concurrent | abc | prompt | xyz |
`
    const r = parseSfxList(md)
    expect(r.size).toBe(1)
    const meta = r.get('01_x')
    expect(meta.offsetSec).toBe(0)
    expect(meta.durationSec).toBe(0)
  })

  it('preserves placement string as-is (before / concurrent / after)', () => {
    const md = `
| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | a | 01_b | "a" | before | 0.5 | p | 1 |
| 2 | a | 02_c | "a" | concurrent | 0 | p | 1 |
| 3 | a | 03_a | "a" | after | 1.2 | p | 1 |
`
    const r = parseSfxList(md)
    expect(r.get('01_b').placement).toBe('before')
    expect(r.get('02_c').placement).toBe('concurrent')
    expect(r.get('03_a').placement).toBe('after')
  })

  it('handles partName containing spaces (e.g. "part 1 setup")', () => {
    const md = `
| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | part 1 setup | 01_x | "anchor" | concurrent | 0 | prompt | 1 |
`
    const r = parseSfxList(md)
    expect(r.get('01_x').partName).toBe('part 1 setup')
  })

  it('ignores blank lines and stray prose between table rows', () => {
    const md = `
Some narrative paragraph above the table.

| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | a | 01_x | "anchor" | concurrent | 0 | prompt | 1 |

Some text after.

| 2 | a | 02_y | "anchor2" | concurrent | 0 | prompt2 | 2 |
`
    const r = parseSfxList(md)
    expect(r.size).toBe(2)
    expect(r.get('01_x')).toBeDefined()
    expect(r.get('02_y')).toBeDefined()
  })

  it('does not throw on a completely malformed table (returns whatever it could parse)', () => {
    const md = `
| broken | row |
| ok | filename | anchor |
`
    // Should not throw — returns empty or partial Map
    expect(() => parseSfxList(md)).not.toThrow()
    const r = parseSfxList(md)
    expect(r.size).toBe(0)
  })

  it('trims surrounding whitespace from all cells', () => {
    const md = `
| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
|   1   |   setup   |   01_bell_toll   |   "anchor text"   |   concurrent   |   0   |   trimmed prompt   |   3   |
`
    const r = parseSfxList(md)
    const meta = r.get('01_bell_toll')
    expect(meta.partName).toBe('setup')
    expect(meta.anchor).toBe('anchor text')
    expect(meta.prompt).toBe('trimmed prompt')
    expect(meta.cueNo).toBe(1)
    expect(meta.durationSec).toBe(3)
  })

  it('keeps cueNo null if # column is non-numeric (does not crash)', () => {
    const md = `
| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| - | a | 01_x | "anchor" | concurrent | 0 | prompt | 1 |
`
    const r = parseSfxList(md)
    const meta = r.get('01_x')
    expect(meta).toBeDefined()
    expect(meta.cueNo).toBe(null)
  })

  it('handles escaped pipes (\\|) inside prompt cell', () => {
    const md = `
| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | setup | 01_clock | "the clock chimed" | concurrent | 0 | metronome \\| ticking, slow | 3 |
`
    const r = parseSfxList(md)
    const meta = r.get('01_clock')
    expect(meta).toBeDefined()
    expect(meta.prompt).toBe('metronome | ticking, slow')
    expect(meta.durationSec).toBe(3)
  })

  it('rejoins prompt when literal | appears without escaping (overflow recovery)', () => {
    // Author forgot to escape pipe — row has 9 cells instead of 8. Recovery
    // rule: when the LAST cell is numeric, treat it as duration and join the
    // overflow middle cells back into the prompt.
    const md = `
| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | setup | 01_clock | "the clock chimed" | concurrent | 0 | metronome | ticking slow | 3 |
`
    const r = parseSfxList(md)
    const meta = r.get('01_clock')
    expect(meta).toBeDefined()
    expect(meta.prompt).toBe('metronome|ticking slow')
    expect(meta.durationSec).toBe(3)
  })

  it('overflow recovery is skipped when last cell is non-numeric (no false correction)', () => {
    // Last cell is not a number → recovery rule does NOT fire. Row still
    // parses with whatever destructure result we get; durationSec falls back
    // to 0 via toNumber, prompt is the FIRST overflow segment. We assert the
    // result is at least non-throwing and stable (no exception).
    const md = `
| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | setup | 01_x | "anchor" | concurrent | 0 | a | b | c |
`
    expect(() => parseSfxList(md)).not.toThrow()
    const r = parseSfxList(md)
    const meta = r.get('01_x')
    expect(meta).toBeDefined()
    expect(meta.durationSec).toBe(0)
  })
})
