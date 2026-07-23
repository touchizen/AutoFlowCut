import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en'
import ko from '../../src/locales/ko'

describe('reference composer refresh failure toast i18n', () => {
  it.each([
    ['en', en],
    ['ko', ko],
  ])('%s provides the batch stop message', (_lang, locale) => {
    expect(locale.toast.flowComposerRefreshFailed).toBeTruthy()
  })
})
