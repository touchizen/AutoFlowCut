import { describe, it, expect } from 'vitest'
import { tokenizeMentions } from '../../src/utils/highlightMentions'

const REFS = [{ name: 'Alice' }, { name: 'forest' }]

describe('tokenizeMentions', () => {
  it('returns [] for empty / non-string input', () => {
    expect(tokenizeMentions('')).toEqual([])
    expect(tokenizeMentions(null)).toEqual([])
    expect(tokenizeMentions(undefined)).toEqual([])
  })

  it('returns single plain segment when no @', () => {
    expect(tokenizeMentions('plain text', REFS)).toEqual([
      { text: 'plain text', kind: 'plain' },
    ])
  })

  it('marks known mention', () => {
    expect(tokenizeMentions('@alice walks', REFS)).toEqual([
      { text: '@alice', kind: 'known' },
      { text: ' walks', kind: 'plain' },
    ])
  })

  it('marks unknown mention separately', () => {
    expect(tokenizeMentions('@ghost walks', REFS)).toEqual([
      { text: '@ghost', kind: 'unknown' },
      { text: ' walks', kind: 'plain' },
    ])
  })

  it('handles multiple mentions with plain interspersed', () => {
    expect(tokenizeMentions('A wizard @alice in @forest with @ghost', REFS)).toEqual([
      { text: 'A wizard ', kind: 'plain' },
      { text: '@alice', kind: 'known' },
      { text: ' in ', kind: 'plain' },
      { text: '@forest', kind: 'known' },
      { text: ' with ', kind: 'plain' },
      { text: '@ghost', kind: 'unknown' },
    ])
  })

  it('keeps boundary char with the preceding plain segment', () => {
    expect(tokenizeMentions('hi @alice', REFS)).toEqual([
      { text: 'hi ', kind: 'plain' },
      { text: '@alice', kind: 'known' },
    ])
  })

  it('does not split mid-word @', () => {
    expect(tokenizeMentions('user@example.com', REFS)).toEqual([
      { text: 'user@example.com', kind: 'plain' },
    ])
  })

  it('case-insensitive matching against references', () => {
    expect(tokenizeMentions('@ALICE', REFS)).toEqual([
      { text: '@ALICE', kind: 'known' },
    ])
  })
})
