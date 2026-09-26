// @vitest-environment node
import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en'
import ko from '../../src/locales/ko'

const EXPORT_MODAL_KEYS = [
  'renderTitle',
  'renderTab',
  'renderPackage',
  'renderPackageDesc',
  'renderMode',
  'renderModePreview',
  'renderModeFinal',
  'renderBurnSubtitle',
  'renderBurnSubtitleHint',
  'renderProgress',
  'renderCancel',
]

describe('self-render locale keys', () => {
  it.each(EXPORT_MODAL_KEYS)('exportModal.%s exists in ko/en', (key) => {
    expect(typeof ko.exportModal[key]).toBe('string')
    expect(typeof en.exportModal[key]).toBe('string')
    expect(ko.exportModal[key].trim()).not.toBe('')
    expect(en.exportModal[key].trim()).not.toBe('')
  })

  it('keeps action and toast keys in parity', () => {
    for (const [section, key] of [
      ['actions', 'exportRender'],
      ['toast', 'renderComplete'],
      ['toast', 'renderCancelled'],
    ]) {
      expect(typeof ko[section][key]).toBe('string')
      expect(typeof en[section][key]).toBe('string')
      expect(ko[section][key].trim()).not.toBe('')
      expect(en[section][key].trim()).not.toBe('')
    }
  })
})
