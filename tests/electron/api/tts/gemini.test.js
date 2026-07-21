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

// 회귀: emotion(happy/sad/angry) 프롬프트가 "Say the following in a ... tone:" 형태였을 때
// Gemini가 400 "Model tried to generate text, but it should only be used for TTS"를 던졌다.
// 공식 문서(https://ai.google.dev/gemini-api/docs/speech-generation)의 검증된 예시는
// "Say cheerfully: Have a wonderful day!" / "Say in an spooky whisper: '...'" 형태뿐이며
// "tone"이라는 메타 단어나 "the following" 같은 완충어는 등장하지 않는다.
// 그 차이를 없애 문서가 실제로 검증한 패턴과 일치시킨다.
describe('Gemini 어댑터 emotion 프롬프트 — 400 회귀 방지', () => {
  const makeAdapter = (captured) => {
    const pcm = Buffer.from([0, 1])
    const fetch = async (url, opts) => {
      captured.push(JSON.parse(opts.body))
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm.toString('base64') } }] } }] }) }
    }
    return createGeminiAdapter({ getKey: () => 'gm-key', fetch })
  }

  it('emotion별 프롬프트에 400을 유발했던 "the following"/"tone" 문구가 더 이상 없다', async () => {
    const captured = []
    const a = makeAdapter(captured)
    await a.synthesize({ text: '오늘은 날씨가 좋다', voiceId: 'Kore', emotion: 'happy' })
    await a.synthesize({ text: '오늘은 날씨가 좋다', voiceId: 'Kore', emotion: 'sad' })
    await a.synthesize({ text: '오늘은 날씨가 좋다', voiceId: 'Kore', emotion: 'angry' })
    const texts = captured.map((b) => b.contents[0].parts[0].text)
    for (const t of texts) {
      expect(t.toLowerCase()).not.toContain('the following')
      expect(t.toLowerCase()).not.toContain('tone')
      expect(t).toContain('오늘은 날씨가 좋다')
    }
  })

  it('happy emotion은 문서에 검증된 그대로 "Say cheerfully:" 접두사를 쓴다', async () => {
    const captured = []
    const a = makeAdapter(captured)
    await a.synthesize({ text: 'hello', voiceId: 'Kore', emotion: 'happy' })
    expect(captured[0].contents[0].parts[0].text).toBe('Say cheerfully: hello')
  })
})
