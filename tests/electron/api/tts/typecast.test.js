import { describe, it, expect } from 'vitest'
import { createTypecastAdapter } from '../../../../electron/api/tts/typecast.js'

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
