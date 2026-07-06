import { describe, it, expect } from 'vitest'
import { createTypecastAdapter } from '../../../../electron/api/tts/typecast.js'
import fixture from '../../../fixtures/typecast-voices.json'

describe('createTypecastAdapter', () => {
  it('capabilities: 감정 지원·wav', () => {
    const a = createTypecastAdapter({ getKey: () => 'tc', fetch: async () => {} })
    expect(a.capabilities().supportsEmotion).toBe(true)
    expect(a.capabilities().outputFormats).toContain('wav')
  })

  it('synthesize: x-api-key 헤더·voiceId·text·emotion을 요청에 싣고 오디오 Buffer 반환 (실제 Typecast 계약: scripts/generate_tts_typecast.py)', async () => {
    let captured
    const fetch = async (url, opts) => {
      captured = { url, opts }
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
    }
    const a = createTypecastAdapter({ getKey: () => 'tc-key', fetch })
    const { audio, format } = await a.synthesize({ text: '안녕', voiceId: 'tc_abc', emotion: 'happy' })
    expect(format).toBe('wav')
    expect(Buffer.isBuffer(audio)).toBe(true)
    expect([...audio]).toEqual([1, 2, 3])
    // 실제 계약: Authorization Bearer가 아니라 x-api-key 헤더
    expect(captured.opts.headers['x-api-key']).toBe('tc-key')
    expect(captured.opts.headers.Authorization).toBeUndefined()
    const body = JSON.parse(captured.opts.body)
    expect(body.voice_id).toBe('tc_abc')
    expect(body.text).toBe('안녕')
    expect(body.emotion).toBe('happy')
    expect(body.model).toBe('ssfm-v21')
    // 실제 계약: language 필드 없음 (script와 동일한 body shape)
    expect(body.language).toBeUndefined()
  })

  it('listVoices: 알려진 Typecast 성우 목록을 {id,name,language,previewUrl} 형태로 반환한다', async () => {
    const a = createTypecastAdapter({ getKey: () => 'tc', fetch: async () => {} })
    const voices = await a.listVoices()
    expect(Array.isArray(voices)).toBe(true)
    expect(voices.length).toBeGreaterThan(0)
    for (const v of voices) {
      expect(typeof v.id).toBe('string')
      expect(typeof v.name).toBe('string')
      expect(typeof v.language).toBe('string')
      expect('previewUrl' in v).toBe(true)
      expect(Array.isArray(v.traits)).toBe(true)
      expect(typeof v.source).toBe('string')
    }
    // CLAUDE.md 성우(Joonkyu/Piljae)가 포함된다
    expect(voices.some((v) => v.id === 'tc_6436dbbb602bde66c6b39504')).toBe(true) // Joonkyu
    expect(voices.some((v) => v.id === 'tc_68257f68bc6e3c161ab5078d')).toBe(true) // Piljae
    expect(voices.find((v) => v.id === 'tc_68257f68bc6e3c161ab5078d').traits).toContain('male')
    expect(voices.find((v) => v.id === 'tc_6800a387534948f191cc952b')).toMatchObject({ name: 'Taewoo' })
    expect(voices.find((v) => v.id === 'tc_6731b3ac075b04a944644234')).toMatchObject({ name: 'Hanyoung', traits: expect.arrayContaining(['female']) })
  })

  it('listVoices fetches live list and normalizes', async () => {
    const fetch = async () => ({ ok: true, json: async () => fixture })
    const a = createTypecastAdapter({ getKey: () => 'k', fetch })
    const voices = await a.listVoices()
    expect(voices.length).toBe(fixture.length)
    const s = voices.find((v) => v.id === 'tc_69fc0cff784968297fb45daa')
    expect(s).toMatchObject({ name: 'Sanghyun', language: 'ko', gender: null, source: 'live' })
  })

  it('listVoices overlays seed gender for known ids', async () => {
    const fetch = async () => ({ ok: true, json: async () => fixture })
    const a = createTypecastAdapter({ getKey: () => 'k', fetch })
    const voices = await a.listVoices()
    const seed = voices.find((v) => v.id === 'tc_6436dbbb602bde66c6b39504')
    expect(seed).toMatchObject({ gender: 'male', genderSource: 'seed' })
  })

  it('listVoices falls back to seeds when no key', async () => {
    const a = createTypecastAdapter({ getKey: () => null, fetch: async () => { throw new Error('nope') } })
    const voices = await a.listVoices()
    expect(voices.length).toBeGreaterThan(0)
    expect(voices.every((v) => v.source === 'seed')).toBe(true)
  })

  it('listVoices falls back to seeds when getKey throws (production no-key behavior)', async () => {
    const a = createTypecastAdapter({
      getKey: () => { throw new Error('no key configured') },
      fetch: async () => { throw new Error('should not be called') },
    })
    const voices = await a.listVoices()
    expect(voices.length).toBeGreaterThan(0)
    expect(voices.every((v) => v.source === 'seed')).toBe(true)
  })

  it('키 없으면 throw', async () => {
    const a = createTypecastAdapter({ getKey: () => null, fetch: async () => {} })
    await expect(a.synthesize({ text: 'x', voiceId: 'v' })).rejects.toThrow(/Typecast API key/)
  })

  it('HTTP 실패 시 throw', async () => {
    const fetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })
    const a = createTypecastAdapter({ getKey: () => 'k', fetch })
    await expect(a.synthesize({ text: 'x', voiceId: 'v' })).rejects.toThrow(/401/)
  })
})
