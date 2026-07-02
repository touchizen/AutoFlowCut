/**
 * Gemini 텍스트 LLM 어댑터 — 스펙 §5. genai.js(이미지/비디오)와 별개 신규 모듈.
 * 스트리밍(generateScript)은 streamGenerateContent SSE를 청크 단위로 점진 파싱해
 * onDelta를 실시간 호출한다. structured output은 responseSchema.
 * 재시도(스펙 §7): JSON 파싱 실패 → 즉시 1회 재요청 / HTTP 429·5xx → 1초 백오프 후
 * 1회 재시도 / 그 외 HTTP 에러(400 등) → 재시도 없이 throw / abort → 즉시 throw.
 * 키는 헤더(x-goog-api-key)로만 전달.
 */
import { SCENES_SCHEMA, PROMPTS_SCHEMA } from './schemas.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

function headers(apiKey) {
  return { 'content-type': 'application/json', 'x-goog-api-key': apiKey }
}

class HttpError extends Error {
  constructor(status, body) {
    super(`Gemini ${status}: ${body}`)
    this.status = status
  }
}

function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseSseLine(line, onDelta) {
  const l = line.trim()
  if (!l.startsWith('data: ')) return ''
  try {
    const chunk = JSON.parse(l.slice(6))
    const t = chunk?.candidates?.[0]?.content?.parts?.[0]?.text
    if (t) { onDelta?.(t); return t }
  } catch { /* keep-alive 등 무시 */ }
  return ''
}

async function readSse(res, onDelta) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // 다음 청크로 이월할 partial line
    for (const line of lines) full += parseSseLine(line, onDelta)
  }
  full += parseSseLine(buffer, onDelta) // 마지막 라인에 개행이 없는 경우
  return full
}

export async function generateScript(input, opts, { onDelta, signal, fetchImpl = fetch } = {}) {
  const prompt = buildScriptPrompt(input, opts)
  const res = await fetchImpl(`${BASE}/${opts.model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: headers(opts.apiKey),
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
    signal,
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const scriptMd = await readSse(res, onDelta)
  return { scriptMd }
}

async function structuredCall(prompt, schema, opts, { signal, fetchImpl = fetch, delay = defaultDelay }) {
  const call = async () => {
    const res = await fetchImpl(`${BASE}/${opts.model}:generateContent`, {
      method: 'POST',
      headers: headers(opts.apiKey),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
      }),
      signal,
    })
    if (!res.ok) throw new HttpError(res.status, await res.text())
    const data = await res.json()
    return JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
  }
  try {
    return await call()
  } catch (e) {
    if (signal?.aborted) throw e // abort는 즉시 throw
    if (e instanceof HttpError) {
      if (e.status === 429 || e.status >= 500) {
        await delay(1000) // 429/5xx는 1초 백오프 후 1회 재시도
        return await call()
      }
      throw e // 400 등 그 외 HTTP 에러는 재시도 없이 throw
    }
    return await call() // JSON 파싱 실패는 즉시 1회 재요청
  }
}

export async function splitScenes(scriptMd, opts, ctx = {}) {
  const prompt = buildSplitPrompt(scriptMd, opts)
  const out = await structuredCall(prompt, SCENES_SCHEMA, opts, ctx)
  return { scenes: out.scenes || [], speakers: out.speakers || [] }
}

export async function writePrompts(scenes, context, opts, ctx = {}) {
  const prompt = buildPromptsPrompt(scenes, context, opts)
  const out = await structuredCall(prompt, PROMPTS_SCHEMA, opts, ctx)
  const byNo = new Map((out.scenes || []).map((s) => [s.sceneNo, s]))
  return {
    scenes: scenes.map((s) => ({
      ...s,
      imagePrompt: byNo.get(s.sceneNo)?.imagePrompt ?? s.imagePrompt ?? null,
      videoPrompt: byNo.get(s.sceneNo)?.videoPrompt ?? s.videoPrompt ?? null,
    })),
  }
}

// --- 프롬프트 빌더 (한국어/영어, 스펙 §4 지시 포함) ---
function buildScriptPrompt(input, opts) {
  return [
    `당신은 유튜브 스토리 채널 작가다. 아래 제목으로 ${opts.targetMinutes || 10}분 분량의 나레이션 대본을 ${opts.language === 'ko' ? '한국어' : '영어'}로 작성하라.`,
    opts.genre ? `장르: ${opts.genre}` : '',
    opts.tone ? `톤: ${opts.tone}` : '',
    `제목: ${input.title}`,
    `마크다운으로, 챕터 구분과 (대사가 있으면) 화자 표기를 포함하라.`,
  ].filter(Boolean).join('\n')
}

function buildSplitPrompt(scriptMd, opts) {
  return [
    `아래 대본을 씬으로 분리하라. 각 씬은 낭독 시 6~10초(${opts.language === 'ko' ? '한국어 기준 약 33~55자' : 'about 90~150 chars in English'}) 분량이어야 한다. 초과하면 씬을 분할하라.`,
    `각 씬의 세그먼트마다 speaker(나레이션은 "narrator", 대사는 인물 식별자)와 emotion(normal/happy/sad/angry)을 지정하라.`,
    `등장 화자 전체 목록을 speakers로 반환하라.`,
    `--- 대본 ---`,
    scriptMd,
  ].join('\n')
}

function buildPromptsPrompt(scenes, context, opts) {
  const sceneLines = scenes.map((s) => `${s.sceneNo}. ${s.summary} :: ${(s.segments || []).map((g) => g.text).join(' ')}`)
  return [
    `아래 씬들에 대해 이미지 생성 프롬프트(imagePrompt)와 비디오 생성 프롬프트(videoPrompt)를 영어로 작성하라.`,
    `캐릭터가 등장하면 외형 묘사를 프롬프트에 직접 포함해 씬 간 일관성을 유지하라 (레퍼런스 참조 문법 금지 — 플레인 텍스트).`,
    context.style ? `스타일: ${context.style}` : '',
    `--- 씬 목록 ---`,
    ...sceneLines,
  ].filter(Boolean).join('\n')
}
