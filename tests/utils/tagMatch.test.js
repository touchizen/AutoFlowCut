import { describe, it, expect } from 'vitest'
import { checkTagMatch, collectTagErrors, splitTags } from '../../src/utils/tagMatch'

describe('splitTags', () => {
  it('returns empty for falsy input', () => {
    expect(splitTags('')).toEqual([])
    expect(splitTags(null)).toEqual([])
  })

  it('splits on comma/semicolon/colon and lowercases', () => {
    expect(splitTags('A, B; C:D')).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('checkTagMatch — character/scene types', () => {
  it('returns null for empty tag', () => {
    expect(checkTagMatch('', [{ id: 1, type: 'character', name: 'Hero' }], 'character')).toBeNull()
  })

  it('marks tag matched when ref name matches (case-insensitive)', () => {
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    const result = checkTagMatch('hero', refs, 'character')
    expect(result.allMatched).toBe(true)
    expect(result.matchedTags).toEqual(['hero'])
  })

  it('marks tag unmatched when no ref matches', () => {
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    const result = checkTagMatch('villain', refs, 'character')
    expect(result.allMatched).toBe(false)
    expect(result.unmatchedTags).toEqual(['villain'])
  })
})

describe('checkTagMatch — style type recognizes presets', () => {
  it('recognizes ref name (existing behavior)', () => {
    const refs = [{ id: 1, type: 'style', name: 'Custom Noir' }]
    const result = checkTagMatch('custom noir', refs, 'style')
    expect(result.allMatched).toBe(true)
  })

  it('recognizes preset id as a valid style match', () => {
    // preset id 'cinematic' must match scene tag 'cinematic' even when no style ref has that name
    const result = checkTagMatch('cinematic', [], 'style')
    expect(result.allMatched).toBe(true)
    expect(result.matchedTags).toEqual(['cinematic'])
  })

  it('recognizes preset name_ko (Korean preset name)', () => {
    // STYLE_PRESETS includes 시네마틱 / 누아르 etc.
    const result = checkTagMatch('시네마틱', [], 'style')
    expect(result.allMatched).toBe(true)
  })

  it('does not affect non-style types (no preset lookup for character)', () => {
    // 'cinematic' would be a preset id, but for character type it must be unmatched
    const result = checkTagMatch('cinematic', [], 'character')
    expect(result.allMatched).toBe(false)
    expect(result.unmatchedTags).toEqual(['cinematic'])
  })

  it('mixed multi-tag — some preset, some unmatched', () => {
    const result = checkTagMatch('cinematic, totally-fake-style', [], 'style')
    expect(result.allMatched).toBe(false)
    expect(result.matchedTags).toEqual(['cinematic'])
    expect(result.unmatchedTags).toEqual(['totally-fake-style'])
  })
})

describe('collectTagErrors — preset-aware', () => {
  it('does not flag a scene whose style_tag is a valid preset id', () => {
    const scenes = [{ style_tag: 'cinematic' }]
    const errors = collectTagErrors(scenes, [])
    expect(errors).toEqual([])
  })

  it('still flags genuinely unmatched style tags', () => {
    const scenes = [{ style_tag: 'totally-fake-style' }]
    const errors = collectTagErrors(scenes, [])
    expect(errors.length).toBe(1)
    expect(errors[0].errors[0].type).toBe('style')
  })

  // ─── sceneIndex 가 원본 scenes 인덱스를 가리키는지 ──
  it('sceneIndex 는 전체 scenes 의 인덱스 (filter 무관)', () => {
    const scenes = [
      { id: 's1', style_tag: 'cinematic' }, // OK
      { id: 's2', style_tag: 'cinematic' }, // OK
      { id: 's3', style_tag: 'totally-fake-style' }, // error
      { id: 's4', style_tag: 'cinematic' }, // OK
    ]
    const errors = collectTagErrors(scenes, [])
    expect(errors).toHaveLength(1)
    expect(errors[0].sceneIndex).toBe(2) // s3 의 원본 index
  })

  it('filter 옵션 — 일부 씬만 검사하되 sceneIndex 는 원본 인덱스 유지', () => {
    const scenes = [
      { id: 's1', prompt: 'p1', style_tag: 'totally-fake' }, // 검사 대상, error
      { id: 's2', prompt: '',   style_tag: 'totally-fake' }, // filter 제외 (검사 X)
      { id: 's3', prompt: 'p3', style_tag: 'cinematic' },    // 검사 대상, OK
      { id: 's4', prompt: 'p4', style_tag: 'also-fake' },    // 검사 대상, error
    ]
    const errors = collectTagErrors(scenes, [], { filter: s => !!s.prompt })
    expect(errors).toHaveLength(2)
    expect(errors[0].sceneIndex).toBe(0) // s1
    expect(errors[1].sceneIndex).toBe(3) // s4 — 원본 인덱스 보존
  })
})
