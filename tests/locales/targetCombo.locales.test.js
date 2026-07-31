import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en.js'
import ko from '../../src/locales/ko.js'

describe('target combo locale copy', () => {
  it.each([
    ['en', en],
    ['ko', ko],
  ])('provides auth, failure, busy, and measured-capability copy in %s', (_name, locale) => {
    expect(locale.sessionTarget).toEqual({ flow: 'Google Flow', chatgpt: 'ChatGPT' })
    expect(locale.targetCombo.authReady).toEqual(expect.any(String))
    expect(locale.targetCombo.authRequired).toEqual(expect.any(String))
    expect(locale.targetCombo.busy).toEqual(expect.any(String))
    expect(locale.targetCombo.switchFailed).toContain('{error}')
    expect(locale.targetCombo.chatgptLimitations).toEqual({
      referencesUnmeasured: expect.any(String),
      batchCountOne: expect.any(String),
      seedUnavailable: expect.any(String),
    })
  })
})
