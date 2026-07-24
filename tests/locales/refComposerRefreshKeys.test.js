import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en'
import ko from '../../src/locales/ko'

describe('reference batch feedback i18n', () => {
  it.each([
    ['en', en],
    ['ko', ko],
  ])('%s provides the batch stop message', (_lang, locale) => {
    expect(locale.toast.flowComposerRefreshFailed).toBeTruthy()
    expect(locale.toast.flowCharacterOperationTimedOut).toBeTruthy()
    expect(locale.reference.batchUploadBlocked).toBeTruthy()
    expect(locale.reference.batchRenameBlocked).toBeTruthy()
  })
})
