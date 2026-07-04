/**
 * ElevenLabs TTS 어댑터 — POST /v1/text-to-speech/{voice_id}, xi-api-key 헤더, mp3.
 * getKey/fetch 주입으로 단위 테스트. 세그먼트=단일 요청.
 * 계약: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 */
const BASE = 'https://api.elevenlabs.io/v1/text-to-speech'

// ElevenLabs 기본 공용 보이스(안정 id). 다국어 모델(eleven_multilingual_v2)로 한국어 합성 가능.
const KNOWN_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', language: 'multi', previewUrl: null },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', language: 'multi', previewUrl: null },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', language: 'multi', previewUrl: null },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', language: 'multi', previewUrl: null },
]

export function createElevenLabsAdapter({ getKey, fetch }) {
  return {
    capabilities() {
      return { supportsEmotion: false, maxCharsPerRequest: 5000, outputFormats: ['mp3'], supportsPreview: true, maxConcurrency: 2 }
    },
    listVoices() {
      return KNOWN_VOICES.map((v) => ({ ...v }))
    },
    async synthesize({ text, voiceId, signal }) {
      const key = getKey()
      if (!key) throw new Error('No ElevenLabs API key')
      const res = await fetch(`${BASE}/${voiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
        signal,
      })
      if (!res.ok) {
        const detail = await (res.text?.() ?? Promise.resolve(''))
        throw new Error(`ElevenLabs TTS failed: ${res.status} ${detail}`)
      }
      return { audio: Buffer.from(await res.arrayBuffer()), format: 'mp3' }
    },
  }
}
