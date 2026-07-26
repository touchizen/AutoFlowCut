import { describe, it, expect, beforeEach } from 'vitest'
import { createGeminiAdapter, deriveVoiceSeed, geminiRateLimiter } from '../../../../electron/api/tts/gemini.js'

// 분당 한도는 모듈 공유라 테스트끼리 예산을 갉아먹는다(10회를 넘기면 진짜로 1분을 기다린다).
beforeEach(() => geminiRateLimiter.reset())

// 공용 fixture(중복 제거). 오디오 성공 응답 / 특정 400("tried to generate text").
const audioResponse = (pcm) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm.toString('base64') } }] } }] }) })
const textGenerate400 = {
  ok: false,
  status: 400,
  text: async () =>
    JSON.stringify({ error: { code: 400, message: 'Model tried to generate text, but it should only be used for TTS. Make sure your instructions are clear to only generate audio from a given text transcript.', status: 'INVALID_ARGUMENT' } }),
}

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

// 음성 일관성: 같은 성우(voiceId)로 여러 세그먼트를 합성할 때 매번 다른 음성이 나오는 문제.
// 원인=Gemini TTS가 seed 없이는 비결정적(실측 2026-07-21: 같은 text 2회 다른 바이트).
// deriveVoiceSeed(voiceId)로 성우별 결정적 seed를 파생해 generationConfig.seed로 고정하고,
// temperature도 함께 고정한다(문서: temperature가 바뀌면 같은 seed라도 출력이 달라질 수 있음).
// seed는 voiceId만으로 파생 — 감정(happy/sad)은 프롬프트로 제어되므로 seed에 넣지 않아,
// 같은 성우는 감정이 달라도 "동일인"으로 들린다. (⚠️ seed는 TTS 미문서화·best-effort·preview라
// 실측 근거로만 채택. GA/Gemini 3.x 전환 시 재검토.)
describe('Gemini 어댑터 — 음성 일관성(seed/temperature 고정)', () => {
  const textOnlyResponse = { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '텍스트만' }] } }] }) }

  it('deriveVoiceSeed: 같은 voiceId는 항상 같은 seed(결정적)', () => {
    expect(deriveVoiceSeed('Kore')).toBe(deriveVoiceSeed('Kore'))
    expect(deriveVoiceSeed('Puck')).toBe(deriveVoiceSeed('Puck'))
  })

  it('deriveVoiceSeed: 다른 voiceId는 다른 seed', () => {
    expect(deriveVoiceSeed('Kore')).not.toBe(deriveVoiceSeed('Puck'))
    expect(deriveVoiceSeed('Zephyr')).not.toBe(deriveVoiceSeed('Charon'))
  })

  it('deriveVoiceSeed: 양의 32-bit 정수 범위(Gemini seed 안전 범위)', () => {
    for (const v of ['Kore', 'Puck', 'Zephyr', 'Rasalgethi', 'Zubenelgenubi']) {
      const s = deriveVoiceSeed(v)
      expect(Number.isInteger(s)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(0x7fffffff)
    }
  })

  it('deriveVoiceSeed: voiceId 없으면 기본 Kore로 파생(결정적 fallback, synthesize의 voiceName fallback과 일치)', () => {
    expect(deriveVoiceSeed(undefined)).toBe(deriveVoiceSeed('Kore'))
    expect(deriveVoiceSeed(null)).toBe(deriveVoiceSeed('Kore'))
    expect(deriveVoiceSeed('')).toBe(deriveVoiceSeed('Kore'))
  })

  it('synthesize: generationConfig에 voiceId 파생 seed와 temperature=1.0을 싣는다', async () => {
    const captured = []
    const fetch = async (url, opts) => { captured.push(JSON.parse(opts.body)); return audioResponse(Buffer.from([1, 2])) }
    const a = createGeminiAdapter({ getKey: () => 'k', fetch })
    await a.synthesize({ text: 'hi', voiceId: 'Kore' })
    const gc = captured[0].generationConfig
    expect(gc.seed).toBe(deriveVoiceSeed('Kore'))
    expect(gc.temperature).toBe(1.0)
  })

  it('synthesize: 같은 성우는 emotion이 달라도 같은 seed를 싣는다(감정은 seed 무관)', async () => {
    const captured = []
    const fetch = async (url, opts) => { captured.push(JSON.parse(opts.body)); return audioResponse(Buffer.from([1])) }
    const a = createGeminiAdapter({ getKey: () => 'k', fetch })
    await a.synthesize({ text: 'hi', voiceId: 'Kore', emotion: 'happy' })
    await a.synthesize({ text: 'hi', voiceId: 'Kore', emotion: 'sad' })
    expect(captured[0].generationConfig.seed).toBe(captured[1].generationConfig.seed)
  })

  it('synthesize: 다른 성우는 다른 seed를 싣는다', async () => {
    const captured = []
    const fetch = async (url, opts) => { captured.push(JSON.parse(opts.body)); return audioResponse(Buffer.from([1])) }
    const a = createGeminiAdapter({ getKey: () => 'k', fetch })
    await a.synthesize({ text: 'hi', voiceId: 'Kore' })
    await a.synthesize({ text: 'hi', voiceId: 'Puck' })
    expect(captured[0].generationConfig.seed).not.toBe(captured[1].generationConfig.seed)
  })

  it('synthesize: retry(2차)에도 같은 seed/temperature를 유지한다(일관성이 재시도로 깨지지 않음)', async () => {
    const bodies = []
    let calls = 0
    const fetch = async (url, opts) => { calls += 1; bodies.push(JSON.parse(opts.body)); return calls === 1 ? textOnlyResponse : audioResponse(Buffer.from([1])) }
    const a = createGeminiAdapter({ getKey: () => 'k', fetch })
    await a.synthesize({ text: 'hi', voiceId: 'Kore' })
    expect(calls).toBe(2)
    expect(bodies[1].generationConfig.seed).toBe(bodies[0].generationConfig.seed)
    expect(bodies[1].generationConfig.temperature).toBe(bodies[0].generationConfig.temperature)
  })
})

// 리뷰(Fable5+Codex, 2026-07-21) findings 회귀 방지.
describe('Gemini 어댑터 — 리뷰 findings 회귀', () => {
  // [Fable Med / Codex Low] 재시도 프롬프트가 emotion 스타일 지시("Say cheerfully:")를 Transcript
  // 라벨 뒤에 넣으면 모델이 그 지시를 소리내어 읽는다(문서가 경고한 실패). 스타일은 Transcript 앞
  // 지시부에만 두고, Transcript 뒤에는 순수 발화문만 와야 한다.
  it('emotion 세그먼트가 400 후 재시도할 때 스타일 지시는 Transcript 밖 지시부에, Transcript 뒤엔 raw text만 온다', async () => {
    const bodies = []
    let calls = 0
    const fetch = async (url, opts) => { calls += 1; bodies.push(JSON.parse(opts.body)); return calls === 1 ? textGenerate400 : audioResponse(Buffer.from([1])) }
    const a = createGeminiAdapter({ getKey: () => 'k', fetch })
    await a.synthesize({ text: '오늘은 날씨가 좋다', voiceId: 'Kore', emotion: 'happy' })
    expect(calls).toBe(2)
    const retryText = bodies[1].contents[0].parts[0].text
    const [instruction, transcript] = retryText.split('Transcript:')
    // 발화문(Transcript 뒤)에는 스타일 지시가 절대 섞이지 않는다
    expect(transcript).toContain('오늘은 날씨가 좋다')
    expect(transcript.toLowerCase()).not.toContain('cheerfully')
    expect(transcript).not.toContain('Say cheerfully')
    // 스타일은 지시부(Transcript 앞)에 보존된다
    expect(instruction.toLowerCase()).toContain('cheerfully')
  })

  // [Codex Low] "should only be used for TTS" 문구가 400이 아닌 429/5xx에 있으면 재시도 대상이
  // 아니다 — status 게이트가 없으면 rate-limit에도 불필요한 즉시 재요청을 보낸다.
  it('같은 문구라도 status가 400이 아니면(예: 429) 재시도하지 않고 즉시 실패한다', async () => {
    let calls = 0
    const fetch = async () => { calls += 1; return { ok: false, status: 429, text: async () => 'rate limited: should only be used for tts' } }
    const a = createGeminiAdapter({ getKey: () => 'k', fetch })
    await expect(a.synthesize({ text: 'x', voiceId: 'Kore' })).rejects.toThrow(/429/)
    expect(calls).toBe(1)
  })

  // [Codex Low] auth 시그니처와 text-error 시그니처가 한 400 응답에 모두 있어도, isAuthResponse가
  // 먼저 처리되어 재시도 없이 즉시 ProviderAuthError여야 한다(두 분기 순서 검증 — 뒤집으면 실패).
  it('한 400에 API_KEY_INVALID와 "tried to generate text"가 함께 있어도 auth가 우선해 즉시 ProviderAuthError(재시도 없음)', async () => {
    let calls = 0
    const fetch = async () => {
      calls += 1
      return { ok: false, status: 400, text: async () => JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key. Model tried to generate text, should only be used for TTS.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }) }
    }
    const a = createGeminiAdapter({ getKey: () => 'bad-key', fetch })
    await expect(a.synthesize({ text: 'x', voiceId: 'Kore' })).rejects.toMatchObject({ name: 'ProviderAuthError' })
    expect(calls).toBe(1)
  })

  // [Fable Low] 두 시도 모두 오디오 없이 텍스트만 오면(정책 거부 등) 그 텍스트를 에러에 담아
  // "왜 실패했는지"를 남긴다(조용한 일반 에러 방지 — 프로젝트의 "모든 실패 출구 계측" 교훈).
  it('두 시도 모두 텍스트만 오면 모델이 반환한 텍스트를 에러 메시지에 담는다', async () => {
    const fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '정책상 이 요청은 생성할 수 없습니다' }] } }] }) })
    const a = createGeminiAdapter({ getKey: () => 'k', fetch })
    await expect(a.synthesize({ text: 'x', voiceId: 'Kore' })).rejects.toThrow(/정책상 이 요청은 생성할 수 없습니다/)
  })

  // [Codex R2 Low] no-audio 진단 경로가 절대 크래시로 덮이면 안 된다 — text가 계약을 어긴
  // 비-string(예: { message: 'blocked' })이어도 TypeError 없이 no-audio 에러를 던져야 한다.
  it('text가 비정상(비-string) 형태여도 no-audio 진단 경로가 크래시하지 않는다', async () => {
    const fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: { message: 'blocked' } }] } }] }) })
    const a = createGeminiAdapter({ getKey: () => 'k', fetch })
    await expect(a.synthesize({ text: 'x', voiceId: 'Kore' })).rejects.toThrow(/no audio data/)
  })

  // [Codex R3 Low] String()조차 던지는 원시변환 불가 객체(toString/valueOf가 null)여도 — valid
  // JSON이라 실제로 올 수 있다 — no-audio 에러로 안전하게 떨어져야 한다(진단 경로 완전 봉인).
  it('text가 원시변환 불가 객체({toString:null,valueOf:null})여도 TypeError 없이 no-audio 에러를 던진다', async () => {
    const fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.parse('{"toString":null,"valueOf":null}') }] } }] }) })
    const a = createGeminiAdapter({ getKey: () => 'k', fetch })
    await expect(a.synthesize({ text: 'x', voiceId: 'Kore' })).rejects.toThrow(/no audio data/)
  })
})
