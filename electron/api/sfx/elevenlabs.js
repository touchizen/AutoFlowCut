/**
 * ElevenLabs SFX 어댑터 — POST /v1/sound-generation, xi-api-key 헤더, mp3.
 * getKey/fetch 주입으로 단위 테스트. 세그먼트=단일 요청(description → 효과음).
 * 계약(M2b-0 확인): https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert
 *   body { text, model_id:'eleven_text_to_sound_v2', duration_seconds?:0.5~30(null=자동), prompt_influence?, loop? }
 */
import { MissingProviderKeyError, ProviderAuthError, isAuthResponse } from '../keyErrors.js'

const URL = 'https://api.elevenlabs.io/v1/sound-generation'

export function createElevenLabsSfxAdapter({ getKey, fetch, provider = 'elevenlabs' }) {
  return {
    capabilities() {
      return { outputFormats: ['mp3'], durationRange: [0.5, 30], maxConcurrency: 2 }
    },
    async generate({ description, durationSeconds = null, signal } = {}) {
      const key = getKey()
      if (key == null) throw new MissingProviderKeyError(provider)
      const body = { text: description, model_id: 'eleven_text_to_sound_v2' }
      // duration_seconds는 지정 시에만 전송(생략하면 API가 자동 추정).
      if (durationSeconds != null) body.duration_seconds = durationSeconds
      const res = await fetch(`${URL}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        const detail = await (res.text?.() ?? Promise.resolve(''))
        if (isAuthResponse(res.status, detail)) throw new ProviderAuthError(provider, { status: res.status, detail })
        throw new Error(`ElevenLabs SFX failed: ${res.status} ${detail}`)
      }
      return { audio: Buffer.from(await res.arrayBuffer()), format: 'mp3' }
    },
  }
}
