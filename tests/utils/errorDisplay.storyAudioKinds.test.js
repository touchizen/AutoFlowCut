import { describe, it, expect } from 'vitest'
import { resolveDisplayError } from '../../src/utils/errorDisplay'
import ko from '../../src/locales/ko'
import en from '../../src/locales/en'

// Minimal translator that reads a dotted key from a locale object (mirrors useI18n lookup:
// returns the value or the key itself when missing).
const makeT = (locale) => (key) => {
  const val = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), locale)
  return typeof val === 'string' ? val : key
}

describe('resolveDisplayError — story audio key errorKinds', () => {
  for (const [name, locale] of [['ko', ko], ['en', en]]) {
    const t = makeT(locale)
    it(`${name}: no-tts-key kind translates (not raw English)`, () => {
      const out = resolveDisplayError(t, 'story-audio-no-tts-key', 'audio failed: No typecast API key')
      expect(out).toBeTruthy()
      expect(out).not.toMatch(/No typecast API key/)
      expect(out).not.toBe('errorSection.kind.story-audio-no-tts-key')
    })
    it(`${name}: tts-auth kind translates`, () => {
      const out = resolveDisplayError(t, 'story-audio-tts-auth', 'Gemini TTS failed: 400')
      expect(out).toBeTruthy()
      expect(out).not.toBe('errorSection.kind.story-audio-tts-auth')
    })
  }
})
