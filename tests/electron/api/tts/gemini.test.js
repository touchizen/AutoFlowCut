import { describe, it, expect } from 'vitest'
import { createGeminiAdapter } from '../../../../electron/api/tts/gemini.js'

describe('Gemini 어댑터 gender 필드', () => {
  it('KNOWN_VOICES carry adapter gender; Pulcherrima unknown', () => {
    const a = createGeminiAdapter({ getKey: () => 'k', fetch: async () => ({}) })
    const voices = a.listVoices()
    const kore = voices.find((v) => v.id === 'Kore')
    expect(kore).toMatchObject({ gender: 'female', genderSource: 'adapter' })
    const puck = voices.find((v) => v.id === 'Puck')
    expect(puck).toMatchObject({ gender: 'male', genderSource: 'adapter' })
    const pul = voices.find((v) => v.id === 'Pulcherrima')
    expect(pul.gender).toBeNull()
    expect(pul.genderSource).toBeNull()
  })
})
