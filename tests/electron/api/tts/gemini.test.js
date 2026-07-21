import { describe, it, expect } from 'vitest'
import { createGeminiAdapter } from '../../../../electron/api/tts/gemini.js'

describe('Gemini 어댑터 gender 필드', () => {
  it('KNOWN_VOICES carry adapter gender; Pulcherrima unknown', () => {
    const a = createGeminiAdapter({ getKey: () => 'k', fetch: async () => ({}) })
    const voices = a.listVoices()
    const kore = voices.find((v) => v.id === 'Kore')
    expect(kore).toMatchObject({ gender: 'female', genderSource: 'adapter' })
    const puck = voices.find((v) => v.id === 'Puck')
    expect(puck).toMatchObject({ gender: 'male', genderSource: 'adapter' })
    const pul = voices.find((v) => v.id === 'Pulcherrima')
    expect(pul.gender).toBeNull()
    expect(pul.genderSource).toBeNull()
  })
})

// 회귀: emotion(happy/sad/angry) 프롬프트가 "Say the following in a ... tone:" 형태였을 때
// Gemini가 400 "Model tried to generate text, but it should only be used for TTS"를 던졌다.
// 공식 문서(https://ai.google.dev/gemini-api/docs/speech-generation)의 검증된 예시는
// "Say cheerfully: Have a wonderful day!" / "Say in an spooky whisper: '...'" 형태뿐이며
// "tone"이라는 메타 단어나 "the following" 같은 완충어는 등장하지 않는다.
// 그 차이를 없애 문서가 실제로 검증한 패턴과 일치시킨다.
describe('Gemini 어댑터 emotion 프롬프트 — 400 회귀 방지', () => {
  const makeAdapter = (captured) => {
    const pcm = Buffer.from([0, 1])
    const fetch = async (url, opts) => {
      captured.push(JSON.parse(opts.body))
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm.toString('base64') } }] } }] }) }
    }
    return createGeminiAdapter({ getKey: () => 'gm-key', fetch })
  }

  it('emotion별 프롬프트에 400을 유발했던 "the following"/"tone" 문구가 더 이상 없다', async () => {
    const captured = []
    const a = makeAdapter(captured)
    await a.synthesize({ text: '오늘은 날씨가 좋다', voiceId: 'Kore', emotion: 'happy' })
    await a.synthesize({ text: '오늘은 날씨가 좋다', voiceId: 'Kore', emotion: 'sad' })
    await a.synthesize({ text: '오늘은 날씨가 좋다', voiceId: 'Kore', emotion: 'angry' })
    const texts = captured.map((b) => b.contents[0].parts[0].text)
    for (const t of texts) {
      expect(t.toLowerCase()).not.toContain('the following')
      expect(t.toLowerCase()).not.toContain('tone')
      expect(t).toContain('오늘은 날씨가 좋다')
    }
  })

  it('happy emotion은 문서에 검증된 그대로 "Say cheerfully:" 접두사를 쓴다', async () => {
    const captured = []
    const a = makeAdapter(captured)
    await a.synthesize({ text: 'hello', voiceId: 'Kore', emotion: 'happy' })
    expect(captured[0].contents[0].parts[0].text).toBe('Say cheerfully: hello')
  })
})

// 회귀: emotion 없는(normal) 세그먼트에서도 res.ok=200인데 candidates에 inlineData 없이
// 텍스트만 오는 경우가 있다 ("Gemini TTS: no audio data in response"). 공식 문서:
// "The model occasionally returns text tokens instead of audio tokens... implement automated
// retry logic." systemInstruction은 이 TTS 모델 문서의 Capabilities 표에 전혀 없음
// (지원 목록엔 "Audio generation"뿐) — 지원 여부가 검증되지 않아 채택하지 않고, 문서가
// 명시적으로 권장하는 재시도로 대응한다.
describe('Gemini 어댑터 — 오디오 없이 텍스트만 온 응답 재시도 (no audio data 회귀)', () => {
  const textOnlyResponse = { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '죄송합니다, 이 요청은 처리할 수 없습니다.' }] } }] }) }
  const audioResponse = (pcm) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm.toString('base64') } }] } }] }) })

  it('1차 응답이 오디오 없이 텍스트만 오면 1회 재시도해서 2차에서 오디오를 받으면 성공한다', async () => {
    const pcm = Buffer.from([9, 9])
    let calls = 0
    const fetch = async () => {
      calls += 1
      return calls === 1 ? textOnlyResponse : audioResponse(pcm)
    }
    const a = createGeminiAdapter({ getKey: () => 'gm-key', fetch })
    const { audio, format } = await a.synthesize({ text: '평온한 나레이션', voiceId: 'Kore', emotion: 'normal' })
    expect(calls).toBe(2)
    expect(format).toBe('wav')
    expect(audio.slice(0, 4).toString()).toBe('RIFF')
  })

  it('재시도 후에도 계속 텍스트만 오면 기존과 동일한 에러로 실패한다(최대 재시도 후 종료)', async () => {
    let calls = 0
    const fetch = async () => {
      calls += 1
      return textOnlyResponse
    }
    const a = createGeminiAdapter({ getKey: () => 'gm-key', fetch })
    await expect(a.synthesize({ text: '평온한 나레이션', voiceId: 'Kore', emotion: 'normal' })).rejects.toThrow(/no audio/)
    expect(calls).toBe(2) // 무한 재시도 아님 — 최대 2회 시도 후 종료
  })

  it('1차 시도에서 바로 오디오가 오면 재시도 없이 1회만 fetch한다(기존 성공 경로 회귀 없음)', async () => {
    const pcm = Buffer.from([1, 2, 3])
    let calls = 0
    const fetch = async () => {
      calls += 1
      return audioResponse(pcm)
    }
    const a = createGeminiAdapter({ getKey: () => 'gm-key', fetch })
    const { format } = await a.synthesize({ text: 'hi', voiceId: 'Kore' })
    expect(format).toBe('wav')
    expect(calls).toBe(1)
  })

  it('진짜 HTTP 에러(4xx/5xx)는 재시도하지 않고 즉시 던진다', async () => {
    let calls = 0
    const fetch = async () => {
      calls += 1
      return { ok: false, status: 400, text: async () => 'bad request' }
    }
    const a = createGeminiAdapter({ getKey: () => 'gm-key', fetch })
    await expect(a.synthesize({ text: 'hi', voiceId: 'Kore' })).rejects.toThrow(/400/)
    expect(calls).toBe(1)
  })
})

// 회귀: 짧고/모호한 text("짧은 한마디." 등)는 매번 400 "Model tried to generate text, but it
// should only be used for TTS..."로 실패했다(간헐 아님, 결정적). 공식 문서 Limitations
// §"Prompt classifier false rejections": "Vague prompts may fail to trigger the speech synthesis
// classifier... Validate your prompts by adding a clear preamble instructing the model to
// synthesize speech, and explicitly label where the actual spoken transcript begins."
// → 이 400(비-auth)만 재시도 대상에 넣고, 재시도 시 프롬프트에 그 전조사+라벨을 붙인다.
// API_KEY_INVALID(auth) 400은 반드시 즉시 throw — 이 구분이 핵심이라 별도로 고정한다.
describe('Gemini 어댑터 — "tried to generate text" 400 재시도 (결정적 실패 회귀)', () => {
  const textGenerate400 = {
    ok: false,
    status: 400,
    text: async () =>
      JSON.stringify({ error: { code: 400, message: 'Model tried to generate text, but it should only be used for TTS. Make sure your instructions are clear to only generate audio from a given text transcript.', status: 'INVALID_ARGUMENT' } }),
  }
  const audioResponse = (pcm) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm.toString('base64') } }] } }] }) })

  it('1차가 "tried to generate text" 400이면 프롬프트를 보강해 재시도하고, 2차가 성공하면 오디오를 반환한다', async () => {
    const pcm = Buffer.from([7, 7])
    const bodies = []
    let calls = 0
    const fetch = async (url, opts) => {
      calls += 1
      bodies.push(JSON.parse(opts.body))
      return calls === 1 ? textGenerate400 : audioResponse(pcm)
    }
    const a = createGeminiAdapter({ getKey: () => 'gm-key', fetch })
    const { format } = await a.synthesize({ text: '짧은 한마디.', voiceId: 'Kore', emotion: 'normal' })
    expect(format).toBe('wav')
    expect(calls).toBe(2)
    // 1차는 원문 그대로, 2차는 문서가 명시한 전조사+라벨로 보강되어야 한다
    expect(bodies[0].contents[0].parts[0].text).toBe('짧은 한마디.')
    expect(bodies[1].contents[0].parts[0].text).not.toBe('짧은 한마디.')
    expect(bodies[1].contents[0].parts[0].text).toContain('짧은 한마디.')
    expect(bodies[1].contents[0].parts[0].text.toLowerCase()).toMatch(/transcript|speak|aloud/)
  })

  it('재시도(2차)도 계속 같은 400이면 최대 시도 후 원래 400 에러 그대로 던진다', async () => {
    let calls = 0
    const fetch = async () => {
      calls += 1
      return textGenerate400
    }
    const a = createGeminiAdapter({ getKey: () => 'gm-key', fetch })
    await expect(a.synthesize({ text: '짧은 한마디.', voiceId: 'Kore', emotion: 'normal' })).rejects.toThrow(/tried to generate text/)
    expect(calls).toBe(2) // 무한 재시도 아님
  })

  it('API_KEY_INVALID(auth) 400은 이 메시지 패턴과 무관하게 절대 재시도하지 않고 즉시 ProviderAuthError를 던진다', async () => {
    let calls = 0
    const fetch = async () => {
      calls += 1
      return { ok: false, status: 400, text: async () => JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }) }
    }
    const a = createGeminiAdapter({ getKey: () => 'bad-key', fetch })
    await expect(a.synthesize({ text: '짧은 한마디.', voiceId: 'Kore' })).rejects.toMatchObject({ name: 'ProviderAuthError' })
    expect(calls).toBe(1) // auth는 재시도 절대 금지
  })
})
