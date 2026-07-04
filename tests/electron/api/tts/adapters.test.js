import { describe, it, expect } from 'vitest'
import { createElevenLabsAdapter } from '../../../../electron/api/tts/elevenlabs.js'
import { createGoogleTtsAdapter } from '../../../../electron/api/tts/googletts.js'
import { createGeminiAdapter } from '../../../../electron/api/tts/gemini.js'

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
  it('listVoices 비어있지 않음', () => {
    expect(createElevenLabsAdapter({ getKey: () => 'k', fetch: async () => {} }).listVoices().length).toBeGreaterThan(0)
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
})
