/**
 * Claude Agent SDK 대본 엔진 — llmGemini와 동일 시그니처. 대본은 스트리밍,
 * 씬분리/프롬프트는 outputFormat structured(다음 Task). 인증은 로컬 Claude 로그인.
 */
import { buildScriptPrompt, buildSplitPrompt, buildPromptsPrompt, buildTitlePrompt, buildContinuePrompt, buildReviewPrompt, buildRevisePrompt } from './prompts.js'
import { buildClaudeSdkOptions, extractClaudeSdkResult, bridgeAbortSignal, extractTextDelta, readStructuredResult } from './claudeSdk.js'
import { toJsonSchema } from './toJsonSchema.js'
import { SCENES_SCHEMA, PROMPTS_SCHEMA, REVIEW_SCHEMA, validateScenesSegments } from './schemas.js'

export const DEFAULT_MODEL = 'claude-opus-4-8'

async function* defaultQuery(args) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  yield* query(args)
}

export async function generateScript(input, opts = {}, { onDelta, signal, queryImpl = defaultQuery } = {}) {
  const prompt = buildScriptPrompt(input, opts)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  let full = ''
  try {
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, { includePartialMessages: true })
    for await (const m of queryImpl({ prompt, options })) {
      const delta = extractTextDelta(m)
      if (delta != null) {
        if (signal?.aborted) break
        full += delta
        onDelta?.(delta)
        continue
      }
      if (m.type === 'result') return { scriptMd: extractClaudeSdkResult(m) }
    }
    if (signal?.aborted) throw new Error('Aborted')
    return { scriptMd: full } // result 없이 스트림 종료 시 누적 델타 반환
  } catch (err) {
    if (signal?.aborted) throw new Error('Aborted')
    throw new Error(`Claude SDK failed: ${err.message}`)
  } finally {
    cleanup()
  }
}

export async function generateTitle(scriptMd, opts = {}, { signal, queryImpl = defaultQuery } = {}) {
  const prompt = buildTitlePrompt(scriptMd, opts)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  try {
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController)
    for await (const m of queryImpl({ prompt, options })) {
      if (m.type === 'result') return { title: extractClaudeSdkResult(m).split('\n')[0].trim() }
    }
    throw new Error('no result message returned')
  } catch (err) {
    if (signal?.aborted) throw new Error('Aborted')
    throw new Error(`Claude SDK failed: ${err.message}`)
  } finally { cleanup() }
}

export async function continueScript(existingScript, opts = {}, { onDelta, signal, queryImpl = defaultQuery } = {}) {
  const prompt = buildContinuePrompt(existingScript, opts)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  let added = ''
  try {
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, { includePartialMessages: true })
    for await (const m of queryImpl({ prompt, options })) {
      if (signal?.aborted) break
      const delta = extractTextDelta(m)
      if (delta != null) { added += delta; onDelta?.(delta); if (signal?.aborted) break; continue }
      if (m.type === 'result') return { scriptMd: `${existingScript}\n\n${extractClaudeSdkResult(m)}` }
    }
    if (signal?.aborted) throw new Error('Aborted')
    return { scriptMd: `${existingScript}\n\n${added}` }
  } catch (err) {
    if (signal?.aborted) throw new Error('Aborted')
    throw new Error(`Claude SDK failed: ${err.message}`)
  } finally { cleanup() }
}

function parseJsonLoose(text) {
  let t = (text || '').trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fence) t = fence[1].trim()
  const s = t.indexOf('{'); const e = t.lastIndexOf('}')
  if (s >= 0 && e > s) t = t.slice(s, e + 1)
  return JSON.parse(t)
}

// Gemini 대문자 스키마(SCENES_SCHEMA/PROMPTS_SCHEMA) 기준 재귀 검증. required 미충족 시 throw.
function assertSchema(data, schema, path = 'root') {
  const type = schema.type
  if (type === 'OBJECT') {
    if (data == null || typeof data !== 'object' || Array.isArray(data)) throw new Error(`structured output: ${path} expected object`)
    for (const key of schema.required || []) {
      if (!(key in data)) throw new Error(`structured output: missing required '${key}' at ${path}`)
      if (schema.properties?.[key]) assertSchema(data[key], schema.properties[key], `${path}.${key}`)
    }
  } else if (type === 'ARRAY') {
    if (!Array.isArray(data)) throw new Error(`structured output: ${path} expected array`)
    if (schema.items) data.forEach((item, i) => assertSchema(item, schema.items, `${path}[${i}]`))
  } else if (type === 'STRING') {
    if (typeof data !== 'string') throw new Error(`structured output: ${path} expected string`)
  } else if (type === 'INTEGER') {
    if (!Number.isInteger(data)) throw new Error(`structured output: ${path} expected integer`)
  } else if (type === 'NUMBER') {
    if (typeof data !== 'number') throw new Error(`structured output: ${path} expected number`)
  } else if (type === 'BOOLEAN') {
    if (typeof data !== 'boolean') throw new Error(`structured output: ${path} expected boolean`)
  }
}

async function structuredClaudeCall(prompt, geminiSchema, opts, { signal, queryImpl = defaultQuery }) {
  const schema = toJsonSchema(geminiSchema)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  try {
    // 1차: outputFormat(json_schema) 강제. 파싱 후 스키마 검증 통과 시 반환, 실패/retry면 폴백.
    const opt1 = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, { outputFormat: { type: 'json_schema', schema } })
    let needFallback = false
    for await (const m of queryImpl({ prompt, options: opt1 })) {
      if (m.type !== 'result') continue
      const r = readStructuredResult(m)
      if (r.kind === 'structured' || r.kind === 'text') {
        try {
          const data = r.kind === 'structured' ? r.data : parseJsonLoose(r.text)
          assertSchema(data, geminiSchema)
          return data
        } catch { needFallback = true; break }
      }
      if (r.kind === 'retry') { needFallback = true; break }
    }
    if (signal?.aborted) throw new Error('Aborted')
    if (!needFallback) throw new Error('no result message returned')
    // 2차 폴백: outputFormat 없이 JSON-only 재요청. 파싱 결과도 검증, 실패하면 그대로 throw.
    const jsonPrompt = `${prompt}\n\n반드시 아래 JSON 스키마에 맞는 JSON만 출력하라(설명/코드펜스 금지):\n${JSON.stringify(schema)}`
    const opt2 = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController)
    for await (const m of queryImpl({ prompt: jsonPrompt, options: opt2 })) {
      if (m.type === 'result') {
        const data = parseJsonLoose(extractClaudeSdkResult(m))
        assertSchema(data, geminiSchema)
        return data
      }
    }
    throw new Error('no result message returned')
  } catch (err) {
    if (signal?.aborted) throw new Error('Aborted')
    throw err
  } finally {
    cleanup()
  }
}

export async function splitScenes(scriptMd, opts = {}, { signal, queryImpl } = {}) {
  const prompt = buildSplitPrompt(scriptMd, opts)
  const out = await structuredClaudeCall(prompt, SCENES_SCHEMA, opts, { signal, queryImpl })
  const scenes = out.scenes || []
  validateScenesSegments(scenes) // M2b: loose 스키마 → type별(narration/sfx) 필수 필드 검증
  return { scenes, speakers: out.speakers || [] }
}

// M3: 대본 자체검토 — REVIEW_SCHEMA structured output. verdict는 pass/revise 외면 'pass'로 정규화.
export async function reviewScript(scriptMd, opts = {}, { signal, queryImpl } = {}) {
  const prompt = buildReviewPrompt(scriptMd, opts)
  const out = await structuredClaudeCall(prompt, REVIEW_SCHEMA, opts, { signal, queryImpl })
  const verdict = out.verdict === 'revise' ? 'revise' : 'pass'
  return { verdict, critique: out.critique || '' }
}

// M3: critique 반영 재작성 — NON-streaming(완성본만). generateScript 스트리밍 경로와 분리.
export async function reviseScript(scriptMd, critique, opts = {}, { signal, queryImpl = defaultQuery } = {}) {
  const prompt = buildRevisePrompt(scriptMd, critique, opts)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  try {
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController)
    for await (const m of queryImpl({ prompt, options })) {
      if (m.type === 'result') return { scriptMd: extractClaudeSdkResult(m) }
    }
    if (signal?.aborted) throw new Error('Aborted')
    throw new Error('no result message returned')
  } catch (err) {
    if (signal?.aborted) throw new Error('Aborted')
    throw new Error(`Claude SDK failed: ${err.message}`)
  } finally { cleanup() }
}

export async function writePrompts(scenes, context, opts = {}, { signal, queryImpl } = {}) {
  const prompt = buildPromptsPrompt(scenes, context, opts)
  const out = await structuredClaudeCall(prompt, PROMPTS_SCHEMA, opts, { signal, queryImpl })
  const byNo = new Map((out.scenes || []).map((s) => [s.sceneNo, s]))
  // 계약 검증: 입력 씬 전체가 커버되고 각 프롬프트가 non-empty string인지 (병합 폴백 전에 실패시킴)
  for (const s of scenes) {
    const p = byNo.get(s.sceneNo)
    if (!p || typeof p.imagePrompt !== 'string' || !p.imagePrompt.trim()
          || typeof p.videoPrompt !== 'string' || !p.videoPrompt.trim()) {
      throw new Error(`writePrompts: scene ${s.sceneNo} missing/empty prompt`)
    }
  }
  return {
    scenes: scenes.map((s) => ({
      ...s,
      imagePrompt: byNo.get(s.sceneNo)?.imagePrompt ?? s.imagePrompt ?? null,
      videoPrompt: byNo.get(s.sceneNo)?.videoPrompt ?? s.videoPrompt ?? null,
    })),
  }
}
