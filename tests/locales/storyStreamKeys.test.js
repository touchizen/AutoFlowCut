import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en'
import ko from '../../src/locales/ko'

describe('story.stream revise locale keys', () => {
  it.each(['sceneRevisionProgress', 'promptRevisionProgress'])('%s exists in the real ko/en story.stream block', (key) => {
    expect(typeof ko.story?.stream?.[key]).toBe('string')
    expect(typeof en.story?.stream?.[key]).toBe('string')
    expect(ko.story.stream[key].trim()).not.toBe('')
    expect(en.story.stream[key].trim()).not.toBe('')
  })

  it('ko/en placeholders match', () => {
    const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    for (const key of ['sceneRevisionProgress', 'promptRevisionProgress']) {
      expect(placeholders(ko.story.stream[key])).toEqual(['count', 'total'])
      expect(placeholders(en.story.stream[key])).toEqual(['count', 'total'])
    }
  })
})
