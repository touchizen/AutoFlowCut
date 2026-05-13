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
})
