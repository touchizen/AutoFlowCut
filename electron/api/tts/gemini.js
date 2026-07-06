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
  { id: 'Zephyr', name: 'Zephyr', language: 'multi', previewUrl: null, traits: ['bright'], source: 'gemini' },
  { id: 'Puck', name: 'Puck', language: 'multi', previewUrl: null, traits: ['upbeat'], source: 'gemini' },
  { id: 'Charon', name: 'Charon', language: 'multi', previewUrl: null, traits: ['informative'], source: 'gemini' },
  { id: 'Kore', name: 'Kore', language: 'multi', previewUrl: null, traits: ['firm'], source: 'gemini' },
  { id: 'Fenrir', name: 'Fenrir', language: 'multi', previewUrl: null, traits: ['excitable'], source: 'gemini' },
  { id: 'Leda', name: 'Leda', language: 'multi', previewUrl: null, traits: ['youthful'], source: 'gemini' },
  { id: 'Orus', name: 'Orus', language: 'multi', previewUrl: null, traits: ['firm'], source: 'gemini' },
  { id: 'Aoede', name: 'Aoede', language: 'multi', previewUrl: null, traits: ['breezy'], source: 'gemini' },
  { id: 'Callirrhoe', name: 'Callirrhoe', language: 'multi', previewUrl: null, traits: ['easy-going'], source: 'gemini' },
  { id: 'Autonoe', name: 'Autonoe', language: 'multi', previewUrl: null, traits: ['bright'], source: 'gemini' },
  { id: 'Enceladus', name: 'Enceladus', language: 'multi', previewUrl: null, traits: ['breathy'], source: 'gemini' },
  { id: 'Iapetus', name: 'Iapetus', language: 'multi', previewUrl: null, traits: ['clear'], source: 'gemini' },
  { id: 'Umbriel', name: 'Umbriel', language: 'multi', previewUrl: null, traits: ['easy-going'], source: 'gemini' },
  { id: 'Algieba', name: 'Algieba', language: 'multi', previewUrl: null, traits: ['smooth'], source: 'gemini' },
  { id: 'Despina', name: 'Despina', language: 'multi', previewUrl: null, traits: ['smooth'], source: 'gemini' },
  { id: 'Erinome', name: 'Erinome', language: 'multi', previewUrl: null, traits: ['clear'], source: 'gemini' },
  { id: 'Algenib', name: 'Algenib', language: 'multi', previewUrl: null, traits: ['gravelly'], source: 'gemini' },
  { id: 'Rasalgethi', name: 'Rasalgethi', language: 'multi', previewUrl: null, traits: ['informative'], source: 'gemini' },
  { id: 'Laomedeia', name: 'Laomedeia', language: 'multi', previewUrl: null, traits: ['upbeat'], source: 'gemini' },
  { id: 'Achernar', name: 'Achernar', language: 'multi', previewUrl: null, traits: ['soft'], source: 'gemini' },
  { id: 'Alnilam', name: 'Alnilam', language: 'multi', previewUrl: null, traits: ['firm'], source: 'gemini' },
  { id: 'Schedar', name: 'Schedar', language: 'multi', previewUrl: null, traits: ['even'], source: 'gemini' },
  { id: 'Gacrux', name: 'Gacrux', language: 'multi', previewUrl: null, traits: ['mature'], source: 'gemini' },
  { id: 'Pulcherrima', name: 'Pulcherrima', language: 'multi', previewUrl: null, traits: ['forward'], source: 'gemini' },
  { id: 'Achird', name: 'Achird', language: 'multi', previewUrl: null, traits: ['friendly'], source: 'gemini' },
  { id: 'Zubenelgenubi', name: 'Zubenelgenubi', language: 'multi', previewUrl: null, traits: ['casual'], source: 'gemini' },
  { id: 'Vindemiatrix', name: 'Vindemiatrix', language: 'multi', previewUrl: null, traits: ['gentle'], source: 'gemini' },
  { id: 'Sadachbia', name: 'Sadachbia', language: 'multi', previewUrl: null, traits: ['lively'], source: 'gemini' },
  { id: 'Sadaltager', name: 'Sadaltager', language: 'multi', previewUrl: null, traits: ['knowledgeable'], source: 'gemini' },
  { id: 'Sulafat', name: 'Sulafat', language: 'multi', previewUrl: null, traits: ['warm'], source: 'gemini' },
]

// Gemini TTS는 자연어 스타일 지시로 말투/감정을 제어한다(공식 문서 controllable style prompt). normal은 지시 없이 원문 그대로(기존 동작).
const EMOTION_STYLE_PROMPTS = {
  happy: 'Say the following in a cheerful, happy tone:',
  sad: 'Say the following in a sad, somber tone:',
  angry: 'Say the following in an angry, intense tone:',
}

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
      return { supportsEmotion: true, maxCharsPerRequest: 5000, outputFormats: ['wav'], supportsPreview: true, maxConcurrency: 2 }
    },
    listVoices() {
      return KNOWN_VOICES.map((v) => ({ ...v }))
    },
    async synthesize({ text, voiceId, emotion = 'normal', signal }) {
      const key = getKey()
      if (!key) throw new Error('No Gemini API key')
      const stylePrompt = EMOTION_STYLE_PROMPTS[emotion]
      const promptText = stylePrompt ? `${stylePrompt} ${text}` : text
      const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
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
