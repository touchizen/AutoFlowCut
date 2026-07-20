import { describe, it, expect } from 'vitest'
import {
  extractMentionNames,
  formatMentionToken,
  isPlainSafeMentionName,
  iterateMentions,
  resolveMentions,
  stripMentionPrefixes,
  stripMentionsForNames,
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

  it('extracts braced names with spaces and exact punctuation', () => {
    expect(extractMentionNames('@{도둑 우두머리}와 @{Mina-style}')).toEqual([
      '도둑 우두머리',
      'Mina-style',
    ])
  })

  it('accepts an adjacent suffix after a closed braced mention', () => {
    expect(extractMentionNames('@{도둑 우두머리}A young man')).toEqual(['도둑 우두머리'])
  })

  it.each([
    '@{도둑 우두머리',
    '@{}',
    '@{도둑{우두머리}}',
    '@{도둑\n우두머리}',
    '@{outer @hero',
    '@{outer{@hero}}',
  ])('treats malformed braced syntax as plain text: %s', (text) => {
    expect(extractMentionNames(text)).toEqual([])
  })
})

describe('mention token helpers', () => {
  it('exports the shared mention lead-character regex', async () => {
    const parserModule = await import('../../src/utils/mentionParser')

    expect(parserModule.MENTION_LEAD_CHAR_RE).toBeInstanceOf(RegExp)
    expect(parserModule.MENTION_LEAD_CHAR_RE.test('}')).toBe(true)
    expect(parserModule.MENTION_LEAD_CHAR_RE.test('x')).toBe(false)
  })

  it('iterates plain and braced tokens without positional capture assumptions', () => {
    expect([...iterateMentions('x (@hero) @{도둑 우두머리}A')]).toEqual([
      { index: 3, name: 'hero', braced: false, tokenLength: 5 },
      { index: 10, name: '도둑 우두머리', braced: true, tokenLength: 10 },
    ])
  })

  it.each([
    ['@{a}@{b}', ['a', 'b']],
    ['@{a}@bob', ['a', 'bob']],
  ])('reuses a closing brace as the boundary before an adjacent mention: %s', (text, names) => {
    expect([...iterateMentions(text)].map(({ name }) => name)).toEqual(names)
  })

  it('uses one plain-safe predicate and formatter for emitted tokens', () => {
    expect(isPlainSafeMentionName('Mina-style_2')).toBe(true)
    expect(isPlainSafeMentionName('도둑 우두머리')).toBe(false)
    expect(formatMentionToken('Mina-style_2')).toBe('@Mina-style_2')
    expect(formatMentionToken('도둑 우두머리')).toBe('@{도둑 우두머리}')
    expect(formatMentionToken(' \t ')).toBeNull()
    expect(formatMentionToken('brace{name')).toBeNull()
    expect(formatMentionToken('line\nname')).toBeNull()
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

  it('matches known mention prefix when Hangul particle is attached', () => {
    const { matched, missing } = resolveMentions('@alice가 @FOREST에서 걷는다', refs)
    expect(matched.map((r) => r.id)).toEqual([1, 2])
    expect(missing).toEqual([])
  })

  it('matches Hangul mention name when Hangul particle is attached', () => {
    const hangulRefs = [{ id: 10, name: '철수', type: 'character' }]
    const { matched, missing } = resolveMentions('@철수가 걷는다', hangulRefs)
    expect(matched.map((r) => r.id)).toEqual([10])
    expect(missing).toEqual([])
  })

  it('does not split English suffixes as mention prefixes', () => {
    const { matched, missing } = resolveMentions('@aliceville', refs)
    expect(matched).toEqual([])
    expect(missing).toEqual(['aliceville'])
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

  it('resolves a braced mention by exact full name, case-insensitively', () => {
    const spaceRef = { id: 20, name: '도둑 우두머리', type: 'character' }
    expect(resolveMentions('@{도둑 우두머리} 등장', [spaceRef])).toEqual({
      matched: [spaceRef],
      missing: [],
    })
  })

  it('does not strip a Korean particle from inside braces', () => {
    const hangulRefs = [{ id: 10, name: '철수', type: 'character' }]
    expect(resolveMentions('@{철수가} 걷는다', hangulRefs)).toEqual({
      matched: [],
      missing: ['철수가'],
    })
  })

  it('resolves @{Mina-style} as one exact braced name', () => {
    const ref = { id: 21, name: 'Mina-style', type: 'character' }
    expect(resolveMentions('@{Mina-style}', [ref])).toEqual({ matched: [ref], missing: [] })
  })

  it('resolves adjacent braced and plain mentions without dropping the second ref', () => {
    const adjacentRefs = [
      { id: 22, name: 'a', type: 'character' },
      { id: 23, name: 'b', type: 'character' },
      { id: 24, name: 'bob', type: 'character' },
    ]

    expect(resolveMentions('@{a}@{b}', adjacentRefs).matched.map(({ id }) => id)).toEqual([22, 23])
    expect(resolveMentions('@{a}@bob', adjacentRefs).matched.map(({ id }) => id)).toEqual([22, 24])
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

  it('strips @ from known mention prefix while preserving attached Hangul particle', () => {
    expect(stripMentionPrefixes('@alice가 숲으로 간다', refs)).toBe('alice가 숲으로 간다')
  })

  it('strips @ from Hangul mention name while preserving attached Hangul particle', () => {
    const hangulRefs = [{ name: '철수' }]
    expect(stripMentionPrefixes('@철수가 숲으로 간다', hangulRefs)).toBe('철수가 숲으로 간다')
  })

  it('does not strip @ from English suffix composition', () => {
    expect(stripMentionPrefixes('@aliceville', refs)).toBe('@aliceville')
  })

  it('returns input as-is when no references known', () => {
    expect(stripMentionPrefixes('@alice walks', [])).toBe('@alice walks')
  })

  it('handles non-string input safely', () => {
    expect(stripMentionPrefixes(null, refs)).toBe('')
    expect(stripMentionPrefixes(undefined, refs)).toBe('')
  })

  it('strips the whole resolved braced token without adding whitespace', () => {
    const spaceRefs = [{ name: '도둑 우두머리' }]
    expect(stripMentionPrefixes('@{도둑 우두머리}A young man', spaceRefs)).toBe(
      '도둑 우두머리A young man'
    )
  })

  it('leaves unresolved braced tokens verbatim', () => {
    expect(stripMentionPrefixes('@{도둑 우두머리} 등장', refs)).toBe('@{도둑 우두머리} 등장')
  })

  it('does not particle-strip when deciding whether to strip braces', () => {
    expect(stripMentionPrefixes('@{철수가} 걷는다', [{ name: '철수' }])).toBe('@{철수가} 걷는다')
  })
})

describe('stripMentionsForNames (V2 collision)', () => {
  it('지정 이름의 @만 떼고 다른 멘션은 보존', () => {
    expect(stripMentionsForNames('@민수 와 @서준 이 걷는다', ['민수'])).toBe('민수 와 @서준 이 걷는다')
  })
  it('한글 조사 붙은 멘션도 이름만 매칭해 @ 제거', () => {
    expect(stripMentionsForNames('@민수가 갔다', ['민수'])).toBe('민수가 갔다')
  })
  it('대상 없으면 원본 그대로', () => {
    expect(stripMentionsForNames('@민수 걷는다', [])).toBe('@민수 걷는다')
    expect(stripMentionsForNames('@서준 걷는다', ['민수'])).toBe('@서준 걷는다')
  })
  it('non-string 안전', () => {
    expect(stripMentionsForNames(null, ['민수'])).toBe('')
  })
  it('braced 대상은 전체 토큰을 inner name으로 바꾸고 미대상은 그대로 둔다', () => {
    expect(
      stripMentionsForNames('@{도둑 우두머리}A와 @{거리 배경}', ['도둑 우두머리'])
    ).toBe('도둑 우두머리A와 @{거리 배경}')
  })
  it('braced 대상에는 조사 접두 매칭을 적용하지 않는다', () => {
    expect(stripMentionsForNames('@{철수가} 걷는다', ['철수'])).toBe('@{철수가} 걷는다')
  })
})
