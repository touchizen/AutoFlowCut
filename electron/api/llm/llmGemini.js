/**
 * Gemini 텍스트 LLM 어댑터 — 스펙 §5. genai.js(이미지/비디오)와 별개 신규 모듈.
 * 스트리밍(generateScript)은 streamGenerateContent SSE를 청크 단위로 점진 파싱해
 * onDelta를 실시간 호출한다. structured output은 responseSchema.
 * 재시도(스펙 §7): JSON 파싱 실패 → 즉시 1회 재요청 / HTTP 429·5xx → 1초 백오프 후
 * 1회 재시도 / 그 외 HTTP 에러(400 등) → 재시도 없이 throw / abort → 즉시 throw.
 * 키는 헤더(x-goog-api-key)로만 전달.
 */
import { SCENES_SCHEMA, PROMPTS_SCHEMA, validateScenesSegments } from './schemas.js'
import { buildScriptPrompt, buildSplitPrompt, buildPromptsPrompt } from './prompts.js'

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
  const scenes = out.scenes || []
  validateScenesSegments(scenes) // M2b: loose 스키마 → type별(narration/sfx) 필수 필드 검증
  return { scenes, speakers: out.speakers || [] }
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
