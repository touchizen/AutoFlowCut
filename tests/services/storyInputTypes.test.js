import { describe, expect, it } from 'vitest'
import {
  ROSTER_GATED_INPUT_TYPES,
  isRosterGatedInputType,
  synopsisModeForInputType,
} from '../../src/services/storyInputTypes'

describe('story input type decisions', () => {
  it('roster-gated input types are exactly title, pasted, and storyboard', () => {
    expect(ROSTER_GATED_INPUT_TYPES).toBeInstanceOf(Set)
    expect([...ROSTER_GATED_INPUT_TYPES]).toEqual(['title', 'pasted', 'storyboard'])
  })

  it.each(['title', 'pasted', 'storyboard'])(
    'treats %s as roster-gated',
    (type) => expect(isRosterGatedInputType(type)).toBe(true),
  )

  it.each(['manual', 'continue', 'imported', '', undefined, null])(
    'does not roster-gate %s',
    (type) => expect(isRosterGatedInputType(type)).toBe(false),
  )

  it.each([
    ['title', 'title'],
    ['pasted', 'pasted'],
    ['storyboard', 'pasted'],
    ['manual', null],
    ['continue', null],
    ['', null],
    [undefined, null],
    [null, null],
  ])('maps synopsis mode for %s to %s independently', (type, expected) => {
    expect(synopsisModeForInputType(type)).toBe(expected)
  })
})
