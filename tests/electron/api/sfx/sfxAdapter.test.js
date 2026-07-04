/**
 * M2b-1: SFX 소스 어댑터 (api/sfx, TTS 어댑터 패턴 재사용, tts와 분리).
 *  - elevenlabs: POST /v1/sound-generation, xi-api-key, {text,model_id,duration_seconds?}, resp audio(mp3)
 *  - library: MVP stub(throw)
 * getKey/fetch 주입으로 단위 테스트.
 */
import { describe, it, expect } from 'vitest'
import { createSfxAdapter } from '../../../../electron/api/sfx/index.js'

const okFetch = (cap) => async (url, opts) => {
  cap.url = url; cap.opts = opts
  return { ok: true, arrayBuffer: async () => new TextEncoder().encode('SFX-BYTES').buffer, text: async () => '' }
}

describe('SFX 어댑터', () => {
  it('elevenlabs generate → POST sound-generation + xi-api-key + body(text/duration)', async () => {
    const cap = {}
    const a = createSfxAdapter('elevenlabs', { getKey: () => 'k', fetch: okFetch(cap) })
    const r = await a.generate({ description: '문 여는 소리 끼익', durationSeconds: 2 })

    expect(cap.url).toContain('/v1/sound-generation')
    expect(cap.opts.method).toBe('POST')
    expect(cap.opts.headers['xi-api-key']).toBe('k')
    const body = JSON.parse(cap.opts.body)
    expect(body.text).toBe('문 여는 소리 끼익')
    expect(body.model_id).toBe('eleven_text_to_sound_v2')
    expect(body.duration_seconds).toBe(2)
    expect(r.format).toBe('mp3')
    expect(Buffer.isBuffer(r.audio)).toBe(true)
    expect(r.audio.toString()).toBe('SFX-BYTES')
  })

  it('durationSeconds 없으면 duration_seconds 생략(자동 추정)', async () => {
    const cap = {}
    const a = createSfxAdapter('elevenlabs', { getKey: () => 'k', fetch: okFetch(cap) })
    await a.generate({ description: 'x' })
    expect('duration_seconds' in JSON.parse(cap.opts.body)).toBe(false)
  })

  it('키 없으면 throw', async () => {
    const a = createSfxAdapter('elevenlabs', { getKey: () => null, fetch: okFetch({}) })
    await expect(a.generate({ description: 'x' })).rejects.toThrow(/api key/i)
  })

  it('실패 응답이면 status 포함 throw', async () => {
    const a = createSfxAdapter('elevenlabs', { getKey: () => 'k', fetch: async () => ({ ok: false, status: 422, text: async () => 'bad' }) })
    await expect(a.generate({ description: 'x' })).rejects.toThrow(/422/)
  })

  it('library는 MVP stub(throw)', async () => {
    const a = createSfxAdapter('library', {})
    await expect(a.generate({ description: 'x' })).rejects.toThrow(/library/i)
  })

  it('미지원 provider throw', () => {
    expect(() => createSfxAdapter('nope', {})).toThrow(/Unsupported SFX/i)
  })
})
