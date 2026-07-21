/**
 * Gemini TTS 어댑터 — POST v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=API_KEY.
 * responseModalities:['AUDIO'] + speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName.
 * 응답은 raw PCM(L16, 예: 24kHz mono)이라 WAV 헤더로 래핑해 재생/실측 가능하게 한다.
 * 키는 genai(Gemini) 키 재사용. 계약: https://ai.google.dev/gemini-api/docs/speech-generation
 */
import { MissingProviderKeyError, ProviderAuthError, isAuthResponse } from '../keyErrors.js'
const MODEL = 'gemini-2.5-flash-preview-tts'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
const DEFAULT_VOICE = 'Kore'

// 음성 일관성: seed 없이는 Gemini TTS가 비결정적이라 같은 성우도 매번 다른 음성이 나온다
// (실측 2026-07-21 실 API: 같은 text 2회 다른 바이트). 성우별 결정적 seed를 파생해 고정한다.
// ⚠️ seed는 TTS 모델에 대해 문서화돼 있지 않고(speech-generation 문서는 speech_config만 명시),
// GenerationConfig의 seed도 "best effort... deterministic output isn't guaranteed"이며 이 모델은
// preview다. 실측상 같은 seed는 바이트까지 재현, 다른 seed는 다른 출력 — 현재는 존중된다.
// Google이 언제 바꿔도 계약 위반이 아니므로 GA/Gemini 3.x 전환 시 재검토한다. emotion은 프롬프트로
// 이미 제어되므로 seed에 넣지 않는다 → 같은 성우는 감정이 달라도 "동일인"으로 들린다.
// (djb2 변형, Math.imul로 32-bit 정수 곱을 보장해 플랫폼 무관 결정성 확보. 양의 31-bit로 clamp.)
export function deriveVoiceSeed(voiceId) {
  const s = String(voiceId || DEFAULT_VOICE)
  let h = 5381
  for (let i = 0; i < s.length; i++) h = Math.imul(h, 33) ^ s.charCodeAt(i)
  return h & 0x7fffffff
}

// Gemini prebuilt 보이스(문서화된 안정 목록, 다국어). 한국어 합성 지원.
const KNOWN_VOICES = [
  { id: 'Zephyr', name: 'Zephyr', language: 'multi', previewUrl: null, traits: ['bright'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
  { id: 'Puck', name: 'Puck', language: 'multi', previewUrl: null, traits: ['upbeat'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Charon', name: 'Charon', language: 'multi', previewUrl: null, traits: ['informative'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Kore', name: 'Kore', language: 'multi', previewUrl: null, traits: ['firm'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
  { id: 'Fenrir', name: 'Fenrir', language: 'multi', previewUrl: null, traits: ['excitable'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Leda', name: 'Leda', language: 'multi', previewUrl: null, traits: ['youthful'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
  { id: 'Orus', name: 'Orus', language: 'multi', previewUrl: null, traits: ['firm'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Aoede', name: 'Aoede', language: 'multi', previewUrl: null, traits: ['breezy'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
  { id: 'Callirrhoe', name: 'Callirrhoe', language: 'multi', previewUrl: null, traits: ['easy-going'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
  { id: 'Autonoe', name: 'Autonoe', language: 'multi', previewUrl: null, traits: ['bright'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
  { id: 'Enceladus', name: 'Enceladus', language: 'multi', previewUrl: null, traits: ['breathy'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Iapetus', name: 'Iapetus', language: 'multi', previewUrl: null, traits: ['clear'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Umbriel', name: 'Umbriel', language: 'multi', previewUrl: null, traits: ['easy-going'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Algieba', name: 'Algieba', language: 'multi', previewUrl: null, traits: ['smooth'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Despina', name: 'Despina', language: 'multi', previewUrl: null, traits: ['smooth'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
  { id: 'Erinome', name: 'Erinome', language: 'multi', previewUrl: null, traits: ['clear'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
  { id: 'Algenib', name: 'Algenib', language: 'multi', previewUrl: null, traits: ['gravelly'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Rasalgethi', name: 'Rasalgethi', language: 'multi', previewUrl: null, traits: ['informative'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Laomedeia', name: 'Laomedeia', language: 'multi', previewUrl: null, traits: ['upbeat'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
  { id: 'Achernar', name: 'Achernar', language: 'multi', previewUrl: null, traits: ['soft'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
  { id: 'Alnilam', name: 'Alnilam', language: 'multi', previewUrl: null, traits: ['firm'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Schedar', name: 'Schedar', language: 'multi', previewUrl: null, traits: ['even'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Gacrux', name: 'Gacrux', language: 'multi', previewUrl: null, traits: ['mature'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
  { id: 'Pulcherrima', name: 'Pulcherrima', language: 'multi', previewUrl: null, traits: ['forward'], gender: null, genderSource: null, source: 'gemini' },
  { id: 'Achird', name: 'Achird', language: 'multi', previewUrl: null, traits: ['friendly'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Zubenelgenubi', name: 'Zubenelgenubi', language: 'multi', previewUrl: null, traits: ['casual'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Vindemiatrix', name: 'Vindemiatrix', language: 'multi', previewUrl: null, traits: ['gentle'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
  { id: 'Sadachbia', name: 'Sadachbia', language: 'multi', previewUrl: null, traits: ['lively'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Sadaltager', name: 'Sadaltager', language: 'multi', previewUrl: null, traits: ['knowledgeable'], gender: 'male', genderSource: 'adapter', source: 'gemini' },
  { id: 'Sulafat', name: 'Sulafat', language: 'multi', previewUrl: null, traits: ['warm'], gender: 'female', genderSource: 'adapter', source: 'gemini' },
]

// Gemini TTS는 자연어 스타일 지시로 말투/감정을 제어한다(공식 문서 controllable style prompt). normal은 지시 없이 원문 그대로(기존 동작).
// 문서가 실제로 검증한 예시는 "Say cheerfully: Have a wonderful day!" / "Say in an spooky whisper: '...'" 뿐이며
// "the following"/"tone" 같은 완충어·메타 단어는 등장하지 않는다. 과거 "Say the following in a ... tone:" 형태는
// 이 검증된 패턴에서 벗어나 있었고, 그 결과 모델이 TTS 대신 텍스트 응답을 시도해
// 400 "Model tried to generate text, but it should only be used for TTS"가 발생했다.
// 문서의 검증된 형태(Say [부사]:)와 최대한 일치시킨다.
const EMOTION_STYLE_PROMPTS = {
  happy: 'Say cheerfully:',
  sad: 'Say sadly:',
  angry: 'Say angrily:',
}

// 문서 Limitations §"Prompt classifier false rejections": "Vague prompts may fail to trigger the
// speech synthesis classifier, resulting in a rejected request (PROHIBITED_CONTENT) or causing
// the model to read your style instructions and director's notes aloud. Validate your prompts by
// adding a clear preamble instructing the model to synthesize speech, and explicitly label where
// the actual spoken transcript begins." — 짧고/모호한 text(예: "짧은 한마디.")가 이 실패 유형에
// 해당한다. 따옴표로 감싸는 방식은 문서에 근거가 없어 채택하지 않고, 문서가 명시한 그대로
// "명확한 전조사 + 트랜스크립트 라벨"만 재시도 시 덧붙인다.
// ⚠️ 스타일 지시(EMOTION_STYLE_PROMPTS의 "Say cheerfully:")는 절대 Transcript 라벨 뒤에 두지
// 않는다 — 그러면 문서가 경고한 "모델이 style instructions/director's notes를 소리내어 읽는" 바로
// 그 실패가 재발한다(재시도 프롬프트가 "Say cheerfully"를 발화). 스타일은 지시부에만, Transcript
// 뒤에는 순수 발화문(raw text)만 둔다.
function withSynthesisPreamble(text, stylePrompt) {
  // 스타일은 문서가 검증한 부사 형태(cheerfully/sadly/angrily)로 지시부에 자연스럽게 녹인다.
  // EMOTION_STYLE_PROMPTS "Say cheerfully:" → 부사 "cheerfully"만 추출. Transcript 뒤엔 발화문만.
  const adverb = stylePrompt ? stylePrompt.replace(/^Say\s+/i, '').replace(/:\s*$/, '').trim() : ''
  const style = adverb ? ` ${adverb}` : ''
  return `Read the following text aloud${style} as natural speech audio only. Do not reply, answer, or add any words of your own.\n\nTranscript: ${text}`
}

// Gemini가 TTS 대신 텍스트로 응답할 때의 특정 400 시그니처. isAuthResponse(API_KEY_INVALID)와는
// 별개 — 진짜 인증 실패는 절대 여기 걸리지 않고 즉시 throw 되어야 한다(위 isAuthResponse 분기가 먼저 처리).
function isTextInsteadOfAudioError(detail) {
  return /tried to generate text|should only be used for tts/i.test(String(detail))
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

export function createGeminiAdapter({ getKey, fetch, provider = 'gemini' }) {
  return {
    capabilities() {
      return { supportsEmotion: true, maxCharsPerRequest: 5000, outputFormats: ['wav'], supportsPreview: true, maxConcurrency: 2 }
    },
    listVoices() {
      return KNOWN_VOICES.map((v) => ({ ...v }))
    },
    async synthesize({ text, voiceId, emotion = 'normal', signal }) {
      const key = getKey()
      if (!key) throw new MissingProviderKeyError(provider)
      const stylePrompt = EMOTION_STYLE_PROMPTS[emotion]
      const basePromptText = stylePrompt ? `${stylePrompt} ${text}` : text
      // 음성 일관성: 같은 성우는 항상 같은 seed로 합성한다(attempt 무관 동일). temperature도
      // 함께 고정한다 — 문서: temperature가 바뀌면 같은 seed라도 출력이 달라질 수 있음.
      const seed = deriveVoiceSeed(voiceId)
      // 공식 문서 두 가지 근거로 재시도한다:
      // 1) "The model occasionally returns text tokens instead of audio tokens... you should
      //    implement automated retry logic." → res.ok:200인데 inlineData가 없는 경우.
      // 2) Limitations §"Prompt classifier false rejections" → 짧고/모호한 프롬프트가 분류기를
      //    못 넘겨 텍스트 응답을 시도하다 400 "Model tried to generate text..."로 거부되는 경우.
      //    isAuthResponse(API_KEY_INVALID)는 별개의 진짜 인증 실패라 절대 재시도하지 않고 즉시 throw.
      // (systemInstruction은 이 TTS 모델의 문서화된 capabilities에 없음 — "Audio generation"만
      // 지원 목록에 있고 System instructions는 언급조차 없어 검증 불가라 채택하지 않음.)
      const MAX_ATTEMPTS = 2
      let lastText = null
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // 1차는 원문 그대로, 재시도(2차)는 문서가 명시한 "명확한 전조사 + 트랜스크립트 라벨"로 보강.
        // 스타일 지시(stylePrompt)는 지시부로 넘기고 Transcript엔 raw text만(발화 방지, 위 주석 참고).
        const promptText = attempt === 1 ? basePromptText : withSynthesisPreamble(text, stylePrompt)
        const body = JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            temperature: 1.0,
            seed,
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId || DEFAULT_VOICE } } },
          },
        })
        const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal,
        })
        if (!res.ok) {
          const detail = await (res.text?.() ?? Promise.resolve(''))
          if (isAuthResponse(res.status, detail)) throw new ProviderAuthError(provider, { status: res.status, detail })
          // "tried to generate text" 재시도는 그 특정 400에만 한정한다 — status 게이트가 없으면
          // 429/5xx 응답에 우연히 같은 문구가 있을 때 즉시 실패 대신 불필요한 재요청을 보낸다.
          if (res.status === 400 && isTextInsteadOfAudioError(detail) && attempt < MAX_ATTEMPTS) continue
          throw new Error(`Gemini TTS failed: ${res.status} ${detail}`)
        }
        const json = await res.json()
        const parts = json?.candidates?.[0]?.content?.parts
        const inline = parts?.find((p) => p?.inlineData)?.inlineData
        if (inline?.data) {
          const pcm = Buffer.from(inline.data, 'base64')
          return { audio: pcmToWav(pcm, { rate: parseRate(inline.mimeType) }), format: 'wav' }
        }
        // 오디오 대신 텍스트만 온 경우(정책 거부 등) 그 텍스트를 붙잡아 둔다 — 최종 실패 시
        // "왜 실패했는지"를 에러에 담아 조용한 일반 에러가 되지 않게(모든 실패 출구에 계측).
        lastText = parts?.find((p) => p?.text)?.text || lastText
      }
      // 진단 경로는 어떤 입력에도 절대 크래시하지 않아야 한다. String() 조차 던질 수 있다 —
      // 예: text가 `{toString:null, valueOf:null}`(계약 위반이지만 valid JSON)이면
      // "Cannot convert object to primitive value" TypeError. try/catch로 완전히 봉인.
      let textNote = ''
      if (lastText) {
        try {
          textNote = ` (model returned text: ${String(lastText).slice(0, 200)})`
        } catch {
          textNote = ' (model returned non-text content)'
        }
      }
      throw new Error(`Gemini TTS: no audio data in response${textNote}`)
    },
  }
}
