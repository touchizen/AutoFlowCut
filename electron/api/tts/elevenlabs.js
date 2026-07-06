/**
 * ElevenLabs TTS 어댑터 — POST /v1/text-to-speech/{voice_id}, xi-api-key 헤더, mp3.
 * getKey/fetch 주입으로 단위 테스트. 세그먼트=단일 요청.
 * 계약: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 */
const BASE = 'https://api.elevenlabs.io/v1/text-to-speech'
const VOICES_ENDPOINT = 'https://api.elevenlabs.io/v2/voices'
const SHARED_VOICES_ENDPOINT = 'https://api.elevenlabs.io/v1/shared-voices'

// eleven_multilingual_v2는 discrete emotion 파라미터가 없어 voice_settings(stability↓=억양 변화↑, style↑=표현 과장↑)로 톤을 근사한다. normal은 생략(기존 동작).
const EMOTION_VOICE_SETTINGS = {
  happy: { stability: 0.35, similarity_boost: 0.75, style: 0.55 },
  sad: { stability: 0.3, similarity_boost: 0.75, style: 0.7 },
  angry: { stability: 0.2, similarity_boost: 0.75, style: 0.85 },
}

// ElevenLabs 기본/검증된 seed 보이스. 라이브 목록 실패 시 이 목록으로 폴백한다.
const KNOWN_VOICES = [
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', language: 'en', previewUrl: null, traits: ['male', 'energetic creator'], source: 'seed' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', language: 'multi', previewUrl: null, traits: ['male'], source: 'seed' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', language: 'multi', previewUrl: null, traits: ['female'], source: 'seed' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', language: 'multi', previewUrl: null, traits: ['female'], source: 'seed' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', language: 'multi', previewUrl: null, traits: ['female'], source: 'seed' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', language: 'multi', previewUrl: null, traits: ['male'], source: 'seed' },
]

function cleanTrait(value) {
  return String(value || '').trim().toLowerCase()
}

function compactTraits(values) {
  return [...new Set(values.map(cleanTrait).filter(Boolean))]
}

function firstLanguage(voice) {
  const verified = Array.isArray(voice?.verified_languages) ? voice.verified_languages[0] : null
  return verified?.locale || verified?.language || voice?.language || 'multi'
}

function normalizeAccountVoice(voice) {
  const labels = voice?.labels || {}
  return {
    id: voice.voice_id,
    name: voice.name || voice.voice_id,
    language: firstLanguage(voice),
    previewUrl: voice.preview_url || null,
    traits: compactTraits([labels.gender, labels.accent, labels.age, voice.category]),
    source: 'account',
  }
}

function normalizeSharedVoice(voice) {
  return {
    id: voice.voice_id,
    name: voice.name || voice.voice_id,
    language: voice.language || voice.locale || firstLanguage(voice),
    previewUrl: voice.preview_url || null,
    traits: compactTraits([voice.gender, voice.age, voice.accent, voice.descriptive, voice.use_case, voice.category]),
    source: 'shared',
  }
}

function uniqueVoices(voices) {
  const seen = new Set()
  const out = []
  for (const voice of voices) {
    if (!voice?.id || seen.has(voice.id)) continue
    seen.add(voice.id)
    out.push(voice)
  }
  return out
}

export function createElevenLabsAdapter({ getKey, fetch }) {
  return {
    capabilities() {
      return { supportsEmotion: true, maxCharsPerRequest: 5000, outputFormats: ['mp3'], supportsPreview: true, maxConcurrency: 2 }
    },
    async listVoices({ query = '', includeShared = false, page = 0, limit = 100, maxSharedPages = 10 } = {}) {
      const key = getKey()
      const voices = []
      const headers = key ? { 'xi-api-key': key } : {}

      if (key) {
        try {
          const res = await fetch(VOICES_ENDPOINT, { headers })
          if (res?.ok) {
            const json = await res.json()
            voices.push(...(json?.voices || []).map(normalizeAccountVoice))
          }
        } catch {
          // Seed fallback below keeps the picker usable offline or with expired keys.
        }
      }

      if (includeShared || query) {
        const startPage = Math.max(0, Number(page) || 0)
        const pageSize = String(Math.max(1, Math.min(100, Number(limit) || 100)))
        const pagesToFetch = Math.max(1, Math.min(20, Number(maxSharedPages) || 10))
        for (let offset = 0; offset < pagesToFetch; offset += 1) {
          try {
            const url = new URL(SHARED_VOICES_ENDPOINT)
            url.searchParams.set('page_size', pageSize)
            url.searchParams.set('page', String(startPage + offset))
            if (query) url.searchParams.set('search', query)
            const res = await fetch(url.toString(), { headers })
            if (!res?.ok) break
            const json = await res.json()
            voices.push(...(json?.voices || []).map(normalizeSharedVoice))
            if (!json?.has_more) break
          } catch {
            break
          }
        }
      }

      return uniqueVoices([...voices, ...KNOWN_VOICES.map((v) => ({ ...v }))])
    },
    async synthesize({ text, voiceId, emotion = 'normal', signal }) {
      const key = getKey()
      if (!key) throw new Error('No ElevenLabs API key')
      const voiceSettings = EMOTION_VOICE_SETTINGS[emotion]
      const res = await fetch(`${BASE}/${voiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', ...(voiceSettings ? { voice_settings: voiceSettings } : {}) }),
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
