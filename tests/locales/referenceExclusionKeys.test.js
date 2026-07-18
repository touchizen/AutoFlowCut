import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en'
import ko from '../../src/locales/ko'

function placeholders(value) {
  return [...String(value).matchAll(/\{(\w+)\}/g)]
    .map(match => match[1])
    .sort()
}

describe('primary reference exclusion locale keys', () => {
  it.each([
    ['unusableRefsExcluded', ['count', 'details']],
    ['unusableRefsExcludedMore', ['count', 'details', 'more']],
  ])('%s exists in ko/en with matching placeholders', (key, expected) => {
    expect(typeof ko.toast[key]).toBe('string')
    expect(typeof en.toast[key]).toBe('string')
    expect(placeholders(ko.toast[key])).toEqual(expected)
    expect(placeholders(en.toast[key])).toEqual(expected)
  })
})
