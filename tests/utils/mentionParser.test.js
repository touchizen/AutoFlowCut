import { describe, it, expect } from 'vitest'
import {
  extractMentionNames,
  resolveMentions,
  stripMentionPrefixes,
} from '../../src/utils/mentionParser'

describe('extractMentionNames', () => {
  it('returns [] for empty / non-string input', () => {
    expect(extractMentionNames('')).toEqual([])
    expect(extractMentionNames(null)).toEqual([])
    expect(extractMentionNames(undefined)).toEqual([])
    expect(extractMentionNames(123)).toEqual([])
  })

  it('extracts a single @name at start of string', () => {
    expect(extractMentionNames('@alice walks')).toEqual(['alice'])
  })

  it('extracts multiple @names after whitespace', () => {
    expect(extractMentionNames('A wizard @alice walking in @forest')).toEqual([
      'alice',
      'forest',
    ])
  })

  it('extracts @name after punctuation', () => {
    expect(extractMentionNames('(she) said,"@alice!"')).toEqual(['alice'])
  })

  it('does not match emails or mid-word @', () => {
    expect(extractMentionNames('contact user@example.com')).toEqual([])
    expect(extractMentionNames('foo@bar')).toEqual([])
  })

  it('dedups by lowercase name, preserves first-seen casing', () => {
    expect(extractMentionNames('@Alice and @alice and @ALICE')).toEqual(['Alice'])
  })

  it('supports Hangul names', () => {
    expect(extractMentionNames('@캐릭터1 가 등장하고 @배경 도 같이')).toEqual([
      '캐릭터1',
      '배경',
    ])
  })

  it('supports hyphen and underscore', () => {
    expect(extractMentionNames('@main-hero with @side_kick')).toEqual([
      'main-hero',
      'side_kick',
    ])
  })

  it('handles newline as boundary', () => {
    expect(extractMentionNames('line1\n@alice line2')).toEqual(['alice'])
  })
})

describe('resolveMentions', () => {
  const refs = [
    { id: 1, name: 'Alice', type: 'character' },
    { id: 2, name: 'forest', type: 'scene' },
    { id: 3, name: 'noir', type: 'style' },
  ]

  it('returns empty matched/missing when no @ mentions', () => {
    expect(resolveMentions('plain text', refs)).toEqual({ matched: [], missing: [] })
  })

  it('matches mentions case-insensitively', () => {
    const { matched, missing } = resolveMentions('@alice in @FOREST', refs)
    expect(matched.map((r) => r.id)).toEqual([1, 2])
    expect(missing).toEqual([])
  })

  it('reports unknown mentions in missing[]', () => {
    const { matched, missing } = resolveMentions('@alice and @ghost', refs)
    expect(matched.map((r) => r.id)).toEqual([1])
    expect(missing).toEqual(['ghost'])
  })

  it('preserves mention order from prompt', () => {
    const { matched } = resolveMentions('@forest with @alice and @noir', refs)
    expect(matched.map((r) => r.id)).toEqual([2, 1, 3])
  })

  it('handles missing or empty references gracefully', () => {
    expect(resolveMentions('@alice', null)).toEqual({ matched: [], missing: ['alice'] })
    expect(resolveMentions('@alice', [])).toEqual({ matched: [], missing: ['alice'] })
  })
})

describe('stripMentionPrefixes', () => {
  const refs = [{ name: 'alice' }, { name: 'forest' }]

  it('strips @ from known mentions', () => {
    expect(stripMentionPrefixes('A wizard @alice walks in @forest', refs)).toBe(
      'A wizard alice walks in forest'
    )
  })

  it('leaves unknown @ tokens intact as visible miss cue', () => {
    expect(stripMentionPrefixes('@alice met @ghost', refs)).toBe('alice met @ghost')
  })

  it('preserves leading whitespace / punctuation around mention', () => {
    expect(stripMentionPrefixes('(@alice)', refs)).toBe('(alice)')
  })

  it('returns input as-is when no references known', () => {
    expect(stripMentionPrefixes('@alice walks', [])).toBe('@alice walks')
  })

  it('handles non-string input safely', () => {
    expect(stripMentionPrefixes(null, refs)).toBe('')
    expect(stripMentionPrefixes(undefined, refs)).toBe('')
  })
})
