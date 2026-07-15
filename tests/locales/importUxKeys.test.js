// @vitest-environment node
import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en'
import ko from '../../src/locales/ko'

const COUNT_KEYS = ['largeSrtConfirm', 'largeTextConfirm', 'largeCsvConfirm']
const ALL_KEYS = [...COUNT_KEYS, 'processing']

describe('import UX locale keys', () => {
  it('keeps the new English and Korean keys in parity', () => {
    expect(ALL_KEYS.map(key => typeof en.import[key])).toEqual(ALL_KEYS.map(() => 'string'))
    expect(ALL_KEYS.map(key => typeof ko.import[key])).toEqual(ALL_KEYS.map(() => 'string'))
  })

  it.each(COUNT_KEYS)('%s states the same actual count for input and scenes', (key) => {
    expect(en.import[key].match(/\{count\}/g)).toHaveLength(2)
    expect(ko.import[key].match(/\{count\}/g)).toHaveLength(2)
  })
})
