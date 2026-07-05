/**
 * Typecast TTS 어댑터 — 스펙 §6. 실호출은 CLAUDE.md 값(api.typecast.ai, ssfm-v21).
 * getKey/fetch 주입으로 단위 테스트. 세그먼트=단일 요청(어댑터는 이어붙이지 않음).
 */
const ENDPOINT = 'https://api.typecast.ai/v1/text-to-speech'

// 알려진 Typecast 성우(CLAUDE.md). M2a-3b는 정적 목록 — 사용자가 쓰는 성우가 명확하고 Typecast
// 목록 API가 불확실하다. 라이브 /voices fetch는 후속(previewUrl도 그때 채움).
const KNOWN_VOICES = [
  { id: 'tc_6436dbbb602bde66c6b39504', name: 'Joonkyu', language: 'ko', previewUrl: null, traits: ['male'], source: 'seed' },
  { id: 'tc_68257f68bc6e3c161ab5078d', name: 'Piljae', language: 'ko', previewUrl: null, traits: ['male'], source: 'seed' },
  { id: 'tc_6800a387534948f191cc952b', name: 'Taewoo', language: 'ko', previewUrl: null, traits: ['male'], source: 'seed' },
  { id: 'tc_6731b3ac075b04a944644234', name: 'Hanyoung', language: 'ko', previewUrl: null, traits: ['female'], source: 'seed' },
  { id: 'tc_6059dad0b83880769a50502f', name: 'Changsu', language: 'ko', previewUrl: null, traits: ['male'], source: 'seed' },
  { id: 'tc_677f2aa4a854ddffa0ebda89', name: 'Hangyeol', language: 'ko', previewUrl: null, traits: ['male'], source: 'seed' },
  { id: 'tc_66d000ee0742c43c93a0ada1', name: 'Dohyun', language: 'ko', previewUrl: null, traits: ['male'], source: 'seed' },
  { id: 'tc_66627b3a554eb156f28b97a4', name: 'Sunghoon', language: 'ko', previewUrl: null, traits: ['male'], source: 'seed' },
  { id: 'tc_63edf3df06ab09dfc77193fc', name: 'Jaeho', language: 'ko', previewUrl: null, traits: ['male'], source: 'seed' },
]

export function createTypecastAdapter({ getKey, fetch }) {
  return {
    capabilities() {
      return { supportsEmotion: true, maxCharsPerRequest: 2000, outputFormats: ['wav'], supportsPreview: true, maxConcurrency: 2 }
    },
    listVoices() {
      return KNOWN_VOICES.map((v) => ({ ...v }))
    },
    async synthesize({ text, voiceId, emotion = 'normal', signal }) {
      const key = getKey()
      if (!key) throw new Error('No Typecast API key')
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ text, voice_id: voiceId, model: 'ssfm-v21', emotion }),
        signal,
      })
      if (!res.ok) {
        const detail = await (res.text?.() ?? Promise.resolve(''))
        throw new Error(`Typecast TTS failed: ${res.status} ${detail}`)
      }
      const buf = Buffer.from(await res.arrayBuffer())
      return { audio: buf, format: 'wav' }
    },
  }
}
