import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en'
import ko from '../../src/locales/ko'

const TEXT_KEYS = [
  'title',
  'description',
  'generateFirst',
  'excludeAndStart',
  'cancel',
  'noPrompt',
  'noneGeneratable',
  'busy',
  'failureTitle',
  'failureStopped',
  'sceneBatchNotStarted',
  'confirm',
  'referencedScenes',
]

const STAGE_KEYS = [
  'permission',
  'auth',
  'flow-ready',
  'prepare',
  'submit',
  'collect',
  'save',
  'timeout',
  'busy',
  'exception',
  'postcondition',
]

function placeholders(value) {
  return [...String(value).matchAll(/\{(\w+)\}/g)]
    .map(match => match[1])
    .sort()
}

describe('emptyRefGate locale keys', () => {
  it.each(TEXT_KEYS)('%s exists in ko/en and is not empty', (key) => {
    expect(typeof ko.emptyRefGate?.[key]).toBe('string')
    expect(typeof en.emptyRefGate?.[key]).toBe('string')
    expect(ko.emptyRefGate[key].trim()).not.toBe('')
    expect(en.emptyRefGate[key].trim()).not.toBe('')
  })

  it.each(STAGE_KEYS)('stage.%s exists in ko/en and is not empty', (key) => {
    expect(typeof ko.emptyRefGate?.stage?.[key]).toBe('string')
    expect(typeof en.emptyRefGate?.stage?.[key]).toBe('string')
    expect(ko.emptyRefGate.stage[key].trim()).not.toBe('')
    expect(en.emptyRefGate.stage[key].trim()).not.toBe('')
  })

  it('ko/en use the same key structure', () => {
    expect(Object.keys(ko.emptyRefGate).sort())
      .toEqual(Object.keys(en.emptyRefGate).sort())
    expect(Object.keys(ko.emptyRefGate.stage).sort())
      .toEqual(Object.keys(en.emptyRefGate.stage).sort())
  })

  it('referencedScenes uses the repo {scenes} placeholder convention', () => {
    expect(placeholders(ko.emptyRefGate.referencedScenes)).toEqual(['scenes'])
    expect(placeholders(en.emptyRefGate.referencedScenes)).toEqual(['scenes'])
  })
})
