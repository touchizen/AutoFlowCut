import { describe, it, expect } from 'vitest'
import { createElevenLabsAdapter } from '../../../../electron/api/tts/elevenlabs.js'
import { createGoogleTtsAdapter } from '../../../../electron/api/tts/googletts.js'
import { createGeminiAdapter } from '../../../../electron/api/tts/gemini.js'

function expectVoiceMetadata(voice) {
  expect(typeof voice.id).toBe('string')
  expect(typeof voice.name).toBe('string')
  expect(typeof voice.language).toBe('string')
  expect('previewUrl' in voice).toBe(true)
  expect(Array.isArray(voice.traits)).toBe(true)
  expect(typeof voice.source).toBe('string')
}

describe('ElevenLabs 어댑터', () => {
  it('synthesize: voice_id 경로 + xi-api-key 헤더 + model_id, mp3 Buffer 반환', async () => {
    let cap
    const fetch = async (url, opts) => { cap = { url, opts }; return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } }
    const a = createElevenLabsAdapter({ getKey: () => 'el-key', fetch })
    const { audio, format } = await a.synthesize({ text: '안녕', voiceId: 'v_rachel' })
    expect(format).toBe('mp3')
    expect([...audio]).toEqual([1, 2, 3])
    expect(cap.url).toContain('/v1/text-to-speech/v_rachel')
    expect(cap.opts.headers['xi-api-key']).toBe('el-key')
    expect(JSON.parse(cap.opts.body).text).toBe('안녕')
    expect(JSON.parse(cap.opts.body).model_id).toBeTruthy()
  })
  it('키 없으면 throw / HTTP 실패 throw', async () => {
    await expect(createElevenLabsAdapter({ getKey: () => null, fetch: async () => {} }).synthesize({ text: 'x', voiceId: 'v' })).rejects.toThrow(/ElevenLabs API key/)
    const fetch = async () => ({ ok: false, status: 401, text: async () => 'nope' })
    await expect(createElevenLabsAdapter({ getKey: () => 'k', fetch }).synthesize({ text: 'x', voiceId: 'v' })).rejects.toThrow(/401/)
  })
  it('listVoices: Liam/Adam seed와 검색용 metadata를 반환한다', async () => {
    const voices = await createElevenLabsAdapter({ getKey: () => 'k', fetch: async () => {} }).listVoices()
    expect(voices.length).toBeGreaterThan(0)
    voices.forEach(expectVoiceMetadata)
    expect(voices.find((v) => v.id === 'TX3LPaxmHKxFdv7VOQHJ')).toMatchObject({
      name: 'Liam',
      language: 'en',
      source: 'seed',
    })
    expect(voices.find((v) => v.id === 'pNInz6obpgDQGcFmaJgB')).toMatchObject({
      name: 'Adam',
      source: 'seed',
    })
  })
  it('listVoices: 계정 보이스와 shared voices를 live API에서 가져와 정규화한다', async () => {
    const calls = []
    const fetch = async (url, opts = {}) => {
      calls.push({ url, opts })
      if (String(url).includes('/v2/voices')) {
        return {
          ok: true,
          json: async () => ({
            voices: [{
              voice_id: 'acct_voice',
              name: 'My Clone',
              preview_url: 'https://example.com/acct.mp3',
              labels: { gender: 'female', accent: 'american' },
              verified_languages: [{ language: 'en', locale: 'en-US' }],
            }],
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          voices: [{
            voice_id: 'shared_liam',
            name: 'Liam Shared',
            language: 'en',
            preview_url: 'https://example.com/liam.mp3',
            gender: 'Male',
            age: 'young',
            accent: 'american',
            descriptive: 'energetic',
            use_case: 'social_media',
          }],
          has_more: false,
        }),
      }
    }
    const voices = await createElevenLabsAdapter({ getKey: () => 'el-key', fetch }).listVoices({ query: 'Liam', includeShared: true, limit: 100 })
    expect(calls[0].url).toBe('https://api.elevenlabs.io/v2/voices')
    expect(calls[0].opts.headers['xi-api-key']).toBe('el-key')
    expect(String(calls[1].url)).toContain('https://api.elevenlabs.io/v1/shared-voices')
    expect(String(calls[1].url)).toContain('page_size=100')
    expect(String(calls[1].url)).toContain('search=Liam')
    expect(voices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'acct_voice', name: 'My Clone', language: 'en-US', previewUrl: 'https://example.com/acct.mp3', source: 'account', traits: expect.arrayContaining(['female', 'american']) }),
      expect.objectContaining({ id: 'shared_liam', name: 'Liam Shared', language: 'en', previewUrl: 'https://example.com/liam.mp3', source: 'shared', traits: expect.arrayContaining(['male', 'young', 'american', 'energetic', 'social_media']) }),
    ]))
  })
})

describe('Google Cloud TTS 어댑터', () => {
  it('synthesize: ?key= + voice.name/languageCode, base64 audioContent → Buffer', async () => {
    let cap
    const fetch = async (url, opts) => { cap = { url, opts }; return { ok: true, json: async () => ({ audioContent: Buffer.from([9, 8, 7]).toString('base64') }) } }
    const a = createGoogleTtsAdapter({ getKey: () => 'g-key', fetch })
    const { audio, format } = await a.synthesize({ text: '안녕', voiceId: 'ko-KR-Neural2-A' })
    expect(format).toBe('mp3')
    expect([...audio]).toEqual([9, 8, 7])
    expect(cap.opts.headers['x-goog-api-key']).toBe('g-key') // URL 쿼리 아님(헤더)
    expect(cap.url).not.toContain('key=')
    const body = JSON.parse(cap.opts.body)
    expect(body.voice.name).toBe('ko-KR-Neural2-A')
    expect(body.voice.languageCode).toBe('ko-KR')
    expect(body.audioConfig.audioEncoding).toBe('MP3')
  })
  it('키 없음/HTTP 실패/audioContent 없음 throw', async () => {
    await expect(createGoogleTtsAdapter({ getKey: () => null, fetch: async () => {} }).synthesize({ text: 'x', voiceId: 'ko-KR-Neural2-A' })).rejects.toThrow(/Google TTS API key/)
    const noContent = async () => ({ ok: true, json: async () => ({}) })
    await expect(createGoogleTtsAdapter({ getKey: () => 'k', fetch: noContent }).synthesize({ text: 'x', voiceId: 'ko-KR-Neural2-A' })).rejects.toThrow(/audioContent/)
  })
  it('listVoices: fallback voices도 검색용 metadata를 포함한다', async () => {
    const voices = await createGoogleTtsAdapter({ getKey: () => null, fetch: async () => {} }).listVoices()
    expect(voices.length).toBeGreaterThan(0)
    voices.forEach(expectVoiceMetadata)
    expect(voices[0].source).toBe('seed')
  })
  it('listVoices: Google voices:list live 응답을 정규화한다', async () => {
    let captured
    const fetch = async (url, opts = {}) => {
      captured = { url, opts }
      return {
        ok: true,
        json: async () => ({
          voices: [{
            name: 'en-US-Chirp3-HD-Charon',
            languageCodes: ['en-US'],
            ssmlGender: 'MALE',
            naturalSampleRateHertz: 24000,
          }],
        }),
      }
    }
    const voices = await createGoogleTtsAdapter({ getKey: () => 'g-key', fetch }).listVoices({ language: 'en-US' })
    expect(captured.url).toBe('https://texttospeech.googleapis.com/v1/voices?languageCode=en-US')
    expect(captured.opts.headers['x-goog-api-key']).toBe('g-key')
    expect(voices).toEqual([
      expect.objectContaining({
        id: 'en-US-Chirp3-HD-Charon',
        name: 'Chirp3-HD-Charon',
        language: 'en-US',
        source: 'google',
        traits: expect.arrayContaining(['male', '24000hz']),
      }),
    ])
  })
})

describe('Gemini TTS 어댑터', () => {
  it('synthesize: prebuiltVoiceConfig.voiceName + AUDIO 모달, PCM을 WAV로 래핑', async () => {
    let cap
    const pcm = Buffer.from([0, 1, 2, 3, 4, 5]) // raw PCM
    const fetch = async (url, opts) => {
      cap = { url, opts }
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm.toString('base64') } }] } }] }) }
    }
    const a = createGeminiAdapter({ getKey: () => 'gm-key', fetch })
    const { audio, format } = await a.synthesize({ text: '안녕', voiceId: 'Kore' })
    expect(format).toBe('wav')
    // WAV 헤더(RIFF/WAVE) + PCM 데이터
    expect(audio.slice(0, 4).toString()).toBe('RIFF')
    expect(audio.slice(8, 12).toString()).toBe('WAVE')
    expect(audio.length).toBe(44 + pcm.length)
    const body = JSON.parse(cap.opts.body)
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO'])
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore')
  })
  it('키 없음/데이터 없음 throw', async () => {
    await expect(createGeminiAdapter({ getKey: () => null, fetch: async () => {} }).synthesize({ text: 'x', voiceId: 'Kore' })).rejects.toThrow(/Gemini API key/)
    const noData = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{}] } }] }) })
    await expect(createGeminiAdapter({ getKey: () => 'k', fetch: noData }).synthesize({ text: 'x', voiceId: 'Kore' })).rejects.toThrow(/no audio/)
  })
  it('listVoices: 공식 Gemini TTS 30개 보이스와 trait metadata를 반환한다', async () => {
    const voices = await createGeminiAdapter({ getKey: () => 'k', fetch: async () => {} }).listVoices()
    expect(voices).toHaveLength(30)
    voices.forEach(expectVoiceMetadata)
    expect(voices.find((v) => v.id === 'Zephyr')).toMatchObject({ name: 'Zephyr', traits: ['bright'] })
    expect(voices.find((v) => v.id === 'Kore')).toMatchObject({ name: 'Kore', traits: ['firm'] })
  })
})
