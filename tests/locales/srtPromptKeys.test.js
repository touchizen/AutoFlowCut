import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en'
import ko from '../../src/locales/ko'

function leafKeys(value, prefix = '') {
  return Object.entries(value || {}).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return child && typeof child === 'object' ? leafKeys(child, path) : [path]
  })
}

describe('SRT prompt locale parity', () => {
  it('keeps every SRT prompt key in ko/en and exposes the SceneList entry label', () => {
    expect(leafKeys(ko.srtPrompt).sort()).toEqual(leafKeys(en.srtPrompt).sort())
    expect(en.sceneList.generateAiPrompts).toBeTruthy()
    expect(ko.sceneList.generateAiPrompts).toBeTruthy()
    expect(en.srtPrompt.progress).toContain('{current}')
    expect(ko.srtPrompt.progress).toContain('{current}')
    expect(en.srtPrompt.retryFailed).toBeTruthy()
    expect(ko.srtPrompt.retryFailed).toBeTruthy()
    expect(en.srtPrompt.report.stale).toBeTruthy()
    expect(ko.srtPrompt.report.stale).toBeTruthy()
    expect(en.srtPrompt.report.blocked).toBeTruthy()
    expect(ko.srtPrompt.report.blocked).toBeTruthy()
  })
})
