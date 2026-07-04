/**
 * Gemini TTS 어댑터 — POST v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=API_KEY.
 * responseModalities:['AUDIO'] + speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName.
 * 응답은 raw PCM(L16, 예: 24kHz mono)이라 WAV 헤더로 래핑해 재생/실측 가능하게 한다.
 * 키는 genai(Gemini) 키 재사용. 계약: https://ai.google.dev/gemini-api/docs/speech-generation
 */
const MODEL = 'gemini-2.5-flash-preview-tts'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

// Gemini prebuilt 보이스(문서화된 안정 목록, 다국어). 한국어 합성 지원.
const KNOWN_VOICES = [
  { id: 'Kore', name: 'Kore', language: 'multi', previewUrl: null },
  { id: 'Puck', name: 'Puck', language: 'multi', previewUrl: null },
  { id: 'Charon', name: 'Charon', language: 'multi', previewUrl: null },
  { id: 'Aoede', name: 'Aoede', language: 'multi', previewUrl: null },
  { id: 'Leda', name: 'Leda', language: 'multi', previewUrl: null },
]

function parseRate(mimeType) {
  const m = /rate=(\d+)/.exec(mimeType || '')
  return m ? parseInt(m[1], 10) : 24000
}

// raw PCM(16bit LE mono) → WAV(44B 헤더). music-metadata probe/브라우저 재생이 가능하게.
function pcmToWav(pcm, { rate = 24000, channels = 1, bits = 16 } = {}) {
  const byteRate = (rate * channels * bits) / 8
  const blockAlign = (channels * bits) / 8
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bits, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export function createGeminiAdapter({ getKey, fetch }) {
  return {
    capabilities() {
      return { supportsEmotion: false, maxCharsPerRequest: 5000, outputFormats: ['wav'], supportsPreview: true, maxConcurrency: 2 }
    },
    listVoices() {
      return KNOWN_VOICES.map((v) => ({ ...v }))
    },
    async synthesize({ text, voiceId, signal }) {
      const key = getKey()
      if (!key) throw new Error('No Gemini API key')
      const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId || 'Kore' } } },
          },
        }),
        signal,
      })
      if (!res.ok) {
        const detail = await (res.text?.() ?? Promise.resolve(''))
        throw new Error(`Gemini TTS failed: ${res.status} ${detail}`)
      }
      const json = await res.json()
      const inline = json?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData)?.inlineData
      if (!inline?.data) throw new Error('Gemini TTS: no audio data in response')
      const pcm = Buffer.from(inline.data, 'base64')
      return { audio: pcmToWav(pcm, { rate: parseRate(inline.mimeType) }), format: 'wav' }
    },
  }
}
