/**
 * Google Cloud Text-to-Speech 어댑터 — POST v1/text:synthesize?key=API_KEY.
 * body { input:{text}, voice:{languageCode,name}, audioConfig:{audioEncoding:'MP3'} } → { audioContent:base64 }.
 * getKey/fetch 주입. 계약: https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
 */
const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'
const VOICES_ENDPOINT = 'https://texttospeech.googleapis.com/v1/voices'

// 한국어 보이스(문서화된 안정 name). voiceId = name, languageCode는 name 접두(ko-KR)에서 파생.
const KNOWN_VOICES = [
  { id: 'ko-KR-Neural2-A', name: 'Neural2-A', language: 'ko-KR', previewUrl: null, traits: ['female', 'neural2'], source: 'seed' },
  { id: 'ko-KR-Neural2-B', name: 'Neural2-B', language: 'ko-KR', previewUrl: null, traits: ['female', 'neural2'], source: 'seed' },
  { id: 'ko-KR-Neural2-C', name: 'Neural2-C', language: 'ko-KR', previewUrl: null, traits: ['male', 'neural2'], source: 'seed' },
  { id: 'ko-KR-Wavenet-A', name: 'Wavenet-A', language: 'ko-KR', previewUrl: null, traits: ['female', 'wavenet'], source: 'seed' },
  { id: 'ko-KR-Wavenet-C', name: 'Wavenet-C', language: 'ko-KR', previewUrl: null, traits: ['male', 'wavenet'], source: 'seed' },
  { id: 'ko-KR-Wavenet-D', name: 'Wavenet-D', language: 'ko-KR', previewUrl: null, traits: ['male', 'wavenet'], source: 'seed' },
]

function genderTrait(gender) {
  const g = String(gender || '').toLowerCase()
  return g === 'male' || g === 'female' ? g : ''
}

function displayName(id) {
  const parts = String(id || '').split('-')
  return parts.length > 2 ? parts.slice(2).join('-') : id
}

function normalizeGoogleVoice(voice) {
  const id = voice?.name
  const language = Array.isArray(voice?.languageCodes) && voice.languageCodes.length
    ? voice.languageCodes[0]
    : String(id || '').split('-').slice(0, 2).join('-') || 'multi'
  return {
    id,
    name: displayName(id),
    language,
    previewUrl: null,
    traits: [
      genderTrait(voice?.ssmlGender),
      voice?.naturalSampleRateHertz ? `${voice.naturalSampleRateHertz}hz` : '',
    ].filter(Boolean),
    source: 'google',
  }
}

export function createGoogleTtsAdapter({ getKey, fetch }) {
  return {
    capabilities() {
      return { supportsEmotion: false, maxCharsPerRequest: 5000, outputFormats: ['mp3'], supportsPreview: true, maxConcurrency: 4 }
    },
    async listVoices({ language } = {}) {
      const key = getKey()
      if (!key) return KNOWN_VOICES.map((v) => ({ ...v }))
      try {
        const url = new URL(VOICES_ENDPOINT)
        if (language) url.searchParams.set('languageCode', language)
        const res = await fetch(url.toString(), { headers: { 'x-goog-api-key': key } })
        if (!res?.ok) return KNOWN_VOICES.map((v) => ({ ...v }))
        const json = await res.json()
        const voices = (json?.voices || []).map(normalizeGoogleVoice).filter((v) => v.id)
        return voices.length ? voices : KNOWN_VOICES.map((v) => ({ ...v }))
      } catch {
        return KNOWN_VOICES.map((v) => ({ ...v }))
      }
    },
    async synthesize({ text, voiceId, signal }) {
      const key = getKey()
      if (!key) throw new Error('No Google TTS API key')
      const languageCode = (voiceId || '').split('-').slice(0, 2).join('-') || 'ko-KR'
      // API 키는 URL 쿼리(?key=, 로그/URL 노출) 대신 x-goog-api-key 헤더로 전달(Google 권장).
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ input: { text }, voice: { languageCode, name: voiceId }, audioConfig: { audioEncoding: 'MP3' } }),
        signal,
      })
      if (!res.ok) {
        const detail = await (res.text?.() ?? Promise.resolve(''))
        throw new Error(`Google TTS failed: ${res.status} ${detail}`)
      }
      const json = await res.json()
      if (!json?.audioContent) throw new Error('Google TTS: no audioContent in response')
      return { audio: Buffer.from(json.audioContent, 'base64'), format: 'mp3' }
    },
  }
}
