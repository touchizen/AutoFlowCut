/**
 * Claude Agent SDK 대본 엔진 — llmGemini와 동일 시그니처. 대본은 스트리밍,
 * 씬분리/프롬프트는 outputFormat structured(다음 Task). 인증은 로컬 Claude 로그인.
 */
import { claudeResultToUsage, claudeThinkingTokens, claudeStreamInput, claudeStreamOutChars, estimateOutputTokens } from './usageTokens.js'
import {
  buildScriptPrompt,
  buildSplitPrompt,
  buildPromptsPrompt,
  buildSrtGroupPrompt,
  buildTitlePrompt,
  buildSynopsisPrompt,
  buildCharacterExtractPrompt,
  buildSynopsisFromScriptPrompt,
  buildContinuePrompt,
  buildReviewPrompt,
  buildRevisePrompt,
  buildSynopsisReviewPrompt,
  buildSynopsisRevisePrompt,
  buildScenesReviewPrompt,
  buildScenesRevisePrompt,
  buildPromptsReviewPrompt,
  buildPromptsRevisePrompt,
  buildResearchAnalyzePrompt,
  buildFactCheckPrompt,
} from './prompts.js'
import { buildClaudeSdkOptions, extractClaudeSdkResult, bridgeAbortSignal, extractTextDelta, readStructuredResult } from './claudeSdk.js'
import { splitSynopsisOutput, parseCharactersJson, createSynopsisDeltaGate } from './synopsisOutput.js'
import { toJsonSchema } from './toJsonSchema.js'
import { GROUPS_SCHEMA, SCENES_SCHEMA, PROMPTS_SCHEMA, REVIEW_SCHEMA, SCORED_REVIEW_SCHEMA, clampReviewScore, RESEARCH_ANALYSIS_SCHEMA, FACTCHECK_SCHEMA, validateScenesSegments } from './schemas.js'
import { validatePromptScenesExactOnce } from './srtPrompts.js'
import { createPartialScenesParser } from './partialScenes.js'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

export const DEFAULT_MODEL = 'claude-opus-4-8'

// 패키지된 Electron 앱에서 SDK는 app.asar 내부의 claude 바이너리를 spawn하려다 실패한다
// (아카이브 내부 실행파일은 spawn 불가). 실제 파일은 asarUnpack로 app.asar.unpacked에 풀려 있으므로
// 그 경로를 pathToClaudeCodeExecutable로 명시한다. dev/미해석 시 null → SDK 기본 해석에 위임.
let cachedClaudePath
function claudeExecutablePath() {
  if (cachedClaudePath !== undefined) return cachedClaudePath
  try {
    const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`
    const bin = process.platform === 'win32' ? 'claude.exe' : 'claude'
    const dir = path.dirname(require.resolve(`${pkg}/package.json`))
    let p = path.join(dir, bin)
    if (p.includes(`app.asar${path.sep}`)) {
      p = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    }
    cachedClaudePath = p
  } catch {
    cachedClaudePath = null
  }
  return cachedClaudePath
}

function withClaudePath(args) {
  const exe = claudeExecutablePath()
  if (!exe || args?.options?.pathToClaudeCodeExecutable) return args
  return { ...args, options: { ...args.options, pathToClaudeCodeExecutable: exe } }
}

// --- token usage tap --------------------------------------------------------
// 이 파일의 모든 `for await (const m of queryImpl(...))` 루프(대본/시놉/이어쓰기 스트리밍,
// structuredClaudeCall 1차·폴백, 제목/재작성 등)는 전부 이 tap 하나(defaultQuery)를 지난다 —
// 각 루프에 usage 파싱을 흩뿌리면 새 루프가 생길 때 조용히 샌다(조용히 틀린 합계가 이 기능의
// 유일한 실패 모드다). structuredClaudeCall 재시도는 1차·폴백 양쪽이 지나 둘 다 과금되고,
// 실패 result 도 파서가 throw 하기 전에 여기를 지난다.
let claudeUsageSink = null

/** main 이 tracker 를 물린다. null 로 해제. */
export function setClaudeUsageSink(fn) { claudeUsageSink = fn }

// sink 는 **호출 시작의 동기 지점에서** 캡처해 여기로 넘긴다 — 메시지마다 전역을 다시 읽거나,
// async 경계(dynamic import) 뒤에 읽으면 안 된다. abort() 는 취소만 하고 드레인하지 않는다:
// 프로젝트 전환은 abort 직후 새 machine 을 만들며 전역 sink 를 B 로 바꾸고, A 의 SDK 는 graceful
// close 동안 버퍼된 result 를 더 뱉는다. 캡처가 늦으면(예: `await import` 뒤) 그 늦은 보고가 B 의
// 합계에 들어간다 — 조용히 틀린 합계. 캡처된 sink 로 넘기면 늦은 보고는 죽은 A 의 tracker 로 간다.
// pending 키 시퀀스 — tapQuery 호출(=쿼리)마다 고유. 구조화 재시도의 1차/폴백도 각기 다른 키라
// 서로의 진행 표시를 안 덮는다. Date/random 불필요.
let pendingKeySeq = 0

// sink 프로토콜:
//   진행:  sink({ pendingKey, input, output })            → tracker.setPending   (key 별 교체, 추정치)
//   확정:  sink({ pendingKey, commit:true, input, output }) → clearPending + addDelta (원샷 — 사이에 0/0
//            snapshot 이 안 생겨 UI 가 안 깜빡인다)
//   정리:  sink({ pendingKey, clear:true })                → clearPending (result 없이 끝났을 때)
//   비스트림: sink({ input, output })                       → addDelta (기존 경로)
// pending 을 커밋/정리 없이 두면 추정치가 세션 합계에 영구히 남는다 — 이 기능의 유일 실패 모드.
function tapQuery(makeStream, sink) {
  return async function* (args) {
    let key = null      // 이 쿼리의 pending 키(usage 있는 첫 이벤트에서 지연 생성)
    let pin = 0         // 입력(message_start 누적, 즉시 정확)
    let ochars = 0      // 스트리밍된 출력 문자수(text+thinking+structured JSON)
    // system 추정치는 thinking 블록별 누적이라 새 블록에서 작아질 수 있다. 호출 안에서는 max 로
    // 단조 증가시키고, 마지막 result 정확치가 최종 보정한다.
    let thinkingEstTokens = 0
    let lastIn = -1, lastOut = -1 // 마지막 emit 값 — 추정치가 안 바뀌면(3자 미만 증가) IPC 를 아낀다.
    const estimatedOutput = () => estimateOutputTokens(ochars) + thinkingEstTokens
    const emitPending = () => {
      const out = estimatedOutput()
      if (pin === lastIn && out === lastOut) return
      lastIn = pin; lastOut = out
      sink({ pendingKey: (key ??= `claude-pending-${++pendingKeySeq}`), input: pin, output: out })
    }
    try {
      for await (const m of makeStream(args)) {
        // 계측 실패가 생성을 죽이면 안 된다.
        if (sink) {
          try {
            if (m?.type === 'result') {
              const u = claudeResultToUsage(m)
              // pending 제거 + 확정치 가산을 한 번에(commit). 스트림이 아니었으면(key 없음) 기존대로 가산.
              // result 에 usage 가 없는 비정상 응답이면(SDK 상 필수라 방어적) 마지막 추정치로 커밋 —
              // 0/0 으로 커밋하면 이미 쓴 토큰을 통째로 버린다.
              if (key) { sink({ pendingKey: key, commit: true, input: u ? u.input : pin, output: u ? u.output : estimatedOutput() }); key = null }
              else if (u) sink(u)
            } else {
              const thinking = claudeThinkingTokens(m)
              if (thinking != null) { thinkingEstTokens = Math.max(thinkingEstTokens, thinking || 0); emitPending() }
              else {
                const inp = claudeStreamInput(m)
                if (inp != null) { pin += inp; emitPending() }        // message_start: 입력 즉시 반영
                else { const c = claudeStreamOutChars(m); if (c) { ochars += c; emitPending() } } // 델타: 출력 추정 상승
              }
            }
          } catch { /* best-effort */ }
        }
        yield m
      }
    } finally {
      // result 없이 스트림 종료(abort/EOF/에러 — 소비자가 break/return 하면 여기로 온다):
      // pending 추정치를 지운다. 안 지우면 세션 합계에 영구히 박히고 Map 이 샌다.
      // (중단 시엔 정확치를 못 받으므로 그 부분 토큰은 미집계 — 기존 result-tap 동작과 동일.)
      if (sink && key) { try { sink({ pendingKey: key, clear: true }) } catch { /* best-effort */ } }
    }
  }
}

/** @internal 테스트 전용 — 현재 전역 sink 로 tap 한다(실제 SDK 없이 동작 고정). */
export const __tapQueryForTest = (makeStream) => tapQuery(makeStream, claudeUsageSink)

async function* defaultQuery(args) {
  // 이 첫 줄은 generator 의 첫 next() 에서 실행되고, 그 시점은 아직 호출자(A) 스택 안이다.
  // dynamic import 는 이벤트 루프를 양보하므로 그 뒤에 잡으면 B 로 바뀌어 있을 수 있다 —
  // 반드시 import 전에 잡는다.
  const sink = claudeUsageSink
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  yield* tapQuery((a) => query(withClaudePath(a)), sink)(args)
}

// defaultQuery는 async generator라 Query 객체(=supportedModels 보유)를 잃는다. 조회는 직접 부른다.
async function rawQuery(args) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  return query(withClaudePath(args))
}

/**
 * 설치된 Claude Agent SDK가 보고하는 모델 목록(ModelInfo[]).
 * CLI 프로세스를 띄우므로 실패/지연이 설정 화면을 막으면 안 된다 — 던지지 않고 []로 떨어진다.
 */
export async function listClaudeModels({ queryImpl = rawQuery, timeoutMs = 15000 } = {}) {
  let q = null
  let timer = null
  let abandoned = false
  const interrupt = (query) => { try { query?.interrupt?.() } catch { /* 이미 끝난 쿼리 */ } }
  try {
    // 타임아웃은 조회 전체를 감싼다 — queryImpl()(SDK 로드 + CLI spawn) 단계에서 멈출 수도 있다.
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('listClaudeModels timeout')), timeoutMs)
    })
    const fetchModels = (async () => {
      const query = await queryImpl({
        prompt: 'list models',
        options: { maxTurns: 1, tools: [], settingSources: [], skills: [] },
      })
      // 타임아웃이 이미 이겼으면 여기서 정리한다 — finally 는 q 가 null 이라 못 잡는다.
      if (abandoned) { interrupt(query); return [] }
      q = query
      if (typeof q?.supportedModels !== 'function') return []
      return q.supportedModels()
    })()
    fetchModels.catch(() => {}) // 타임아웃이 이기면 이쪽 reject 가 unhandled 가 된다
    const models = await Promise.race([fetchModels, timeout])
    return Array.isArray(models) ? models : []
  } catch {
    return []
  } finally {
    abandoned = true
    if (timer) clearTimeout(timer)
    interrupt(q)
  }
}

function withReasoningEffort(opts = {}, extra = {}) {
  // resolvedModel: model 이 SDK 별칭일 때 thinking 세대를 판별하려면 정규 id 가 필요하다.
  return { ...extra, reasoningEffort: opts.reasoningEffort, resolvedModel: opts.resolvedModel }
}

export async function generateScript(input, opts = {}, { onDelta, signal, queryImpl = defaultQuery } = {}) {
  const prompt = buildScriptPrompt(input, opts)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  let full = ''
  try {
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, withReasoningEffort(opts, { includePartialMessages: true }))
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

// §3.1 / §v2.8 M4: 시놉시스 게이트 — title은 스트리밍(줄거리+등장인물 JSON),
// pasted는 non-streaming 등장인물 역추출만. 마커 없음/JSON 깨짐은 characters=[] 폴백.
export async function generateSynopsis(input, opts = {}, { onDelta, signal, queryImpl = defaultQuery } = {}) {
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  try {
    if (input?.type === 'pasted') {
      // 대본에서 시놉시스(로그라인/훅/구조)+등장인물을 함께 역추출(비스트리밍 단일 result).
      const prompt = buildSynopsisFromScriptPrompt(input.pastedScript, opts)
      const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, withReasoningEffort(opts, { includePartialMessages: true }))
      for await (const m of queryImpl({ prompt, options })) {
        if (m.type === 'result') return splitSynopsisOutput(extractClaudeSdkResult(m))
      }
      throw new Error('no result message returned')
    }
    const prompt = buildSynopsisPrompt(input, opts)
    const gate = createSynopsisDeltaGate(onDelta)
    let full = ''
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, withReasoningEffort(opts, { includePartialMessages: true }))
    for await (const m of queryImpl({ prompt, options })) {
      const delta = extractTextDelta(m)
      if (delta != null) {
        if (signal?.aborted) break
        full += delta
        gate?.(delta)
        continue
      }
      if (m.type === 'result') return splitSynopsisOutput(extractClaudeSdkResult(m))
    }
    if (signal?.aborted) throw new Error('Aborted')
    return splitSynopsisOutput(full) // result 없이 스트림 종료 시 누적 델타 기준
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
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, withReasoningEffort(opts, { includePartialMessages: true }))
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
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, withReasoningEffort(opts, { includePartialMessages: true }))
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

async function structuredClaudeCall(prompt, geminiSchema, opts, { signal, queryImpl = defaultQuery, sdkExtra = {}, onPartialText, onPartialReset, onThinkingActivity } = {}) {
  const schema = toJsonSchema(geminiSchema)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  try {
    // 1차: outputFormat(json_schema) 강제. 파싱 후 스키마 검증 통과 시 반환, 실패/retry면 폴백.
    // sdkExtra(D11 — 팩트체크의 tools:['WebSearch']/maxTurns 등)는 1차·폴백 모두에 적용된다.
    // includePartialMessages: structured output 은 input_json_delta 로 JSON 을 스트리밍한다 —
    // 켜야 씬분리/프롬프트/검수도 생성 중 토큰이 실시간으로 오른다(result 파싱엔 영향 없음, 부분
    // 메시지는 아래 루프에서 'result' 아니면 skip). 입력도 message_start 로 즉시 뜬다.
    const opt1 = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, withReasoningEffort(opts, { ...sdkExtra, includePartialMessages: true, outputFormat: { type: 'json_schema', schema } }))
    let needFallback = false
    for await (const m of queryImpl({ prompt, options: opt1 })) {
      if (m.type === 'stream_event') {
        if ((m.event?.type === 'content_block_start' && (m.event?.content_block?.type === 'thinking' || m.event?.content_block?.type === 'redacted_thinking'))
          || m.event?.delta?.type === 'thinking_delta') onThinkingActivity?.()
        const delta = m.event?.delta
        if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') onPartialText?.(delta.partial_json)
        else if (delta?.type === 'text_delta' && typeof delta.text === 'string') onPartialText?.(delta.text)
      }
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
    onPartialReset?.()
    const jsonPrompt = `${prompt}\n\n반드시 아래 JSON 스키마에 맞는 JSON만 출력하라(설명/코드펜스 금지):\n${JSON.stringify(schema)}`
    const opt2 = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, withReasoningEffort(opts, { ...sdkExtra, includePartialMessages: true }))
    for await (const m of queryImpl({ prompt: jsonPrompt, options: opt2 })) {
      if (m.type === 'stream_event') {
        if ((m.event?.type === 'content_block_start' && (m.event?.content_block?.type === 'thinking' || m.event?.content_block?.type === 'redacted_thinking'))
          || m.event?.delta?.type === 'thinking_delta') onThinkingActivity?.()
        const delta = m.event?.delta
        if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') onPartialText?.(delta.partial_json)
        else if (delta?.type === 'text_delta' && typeof delta.text === 'string') onPartialText?.(delta.text)
      }
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

export async function splitScenes(scriptMd, opts = {}, {
  signal,
  queryImpl,
  onPartialText,
  onPartialReset,
  onPartialScene,
  onThinkingActivity,
} = {}) {
  const prompt = buildSplitPrompt(scriptMd, opts)
  const makePartialParser = () => createPartialScenesParser({ onItem: onPartialScene })
  let partialParser = typeof onPartialScene === 'function' ? makePartialParser() : null
  const out = await structuredClaudeCall(prompt, SCENES_SCHEMA, opts, {
    signal,
    queryImpl,
    onThinkingActivity,
    onPartialText: onPartialText || partialParser
      ? (text) => {
          onPartialText?.(text)
          partialParser?.push(text)
        }
      : undefined,
    onPartialReset: onPartialReset || partialParser
      ? () => {
          onPartialReset?.()
          if (partialParser) partialParser = makePartialParser()
        }
      : undefined,
  })
  const scenes = out.scenes || []
  validateScenesSegments(scenes) // M2b: loose 스키마 → type별(narration/sfx) 필수 필드 검증
  return { scenes, speakers: out.speakers || [] }
}

// M3: 대본 자체검토 — REVIEW_SCHEMA structured output. verdict는 pass/revise 외면 'pass'로 정규화.
export async function reviewScript(scriptMd, opts = {}, { signal, queryImpl } = {}) {
  const prompt = buildReviewPrompt(scriptMd, opts)
  const out = await structuredClaudeCall(prompt, SCORED_REVIEW_SCHEMA, opts, { signal, queryImpl })
  const verdict = out.verdict === 'revise' ? 'revise' : 'pass'
  return { verdict, critique: out.critique || '', score: clampReviewScore(out.score) }
}

// M3: critique 반영 재작성 — NON-streaming(완성본만). generateScript 스트리밍 경로와 분리.
export async function reviseScript(scriptMd, critique, opts = {}, { signal, queryImpl = defaultQuery } = {}) {
  const prompt = buildRevisePrompt(scriptMd, critique, opts)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  try {
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, withReasoningEffort(opts, { includePartialMessages: true }))
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

// 시놉시스 검수(spec 2026-07-10) — reviewScript 미러. REVIEW_SCHEMA 구조화 호출.
export async function reviewSynopsis(synopsisMd, characters = [], opts = {}, { signal, queryImpl } = {}) {
  const prompt = buildSynopsisReviewPrompt(synopsisMd, characters, opts)
  const out = await structuredClaudeCall(prompt, SCORED_REVIEW_SCHEMA, opts, { signal, queryImpl })
  const verdict = out.verdict === 'revise' ? 'revise' : 'pass'
  return { verdict, critique: out.critique || '', score: clampReviewScore(out.score) }
}

// 시놉시스는 구조화 스키마가 없다 — CHARACTERS_JSON 마커 텍스트를 splitSynopsisOutput으로 분해한다.
// reviseScript와 같은 NON-streaming 경로.
export async function reviseSynopsis(synopsisMd, characters = [], critique, opts = {}, { signal, queryImpl = defaultQuery } = {}) {
  const prompt = buildSynopsisRevisePrompt(synopsisMd, characters, critique, opts)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  try {
    if (signal?.aborted) throw new Error('Aborted')
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, withReasoningEffort(opts, { includePartialMessages: true }))
    for await (const m of queryImpl({ prompt, options })) {
      if (m.type === 'result') return splitSynopsisOutput(extractClaudeSdkResult(m))
    }
    if (signal?.aborted) throw new Error('Aborted')
    throw new Error('no result message returned')
  } catch (err) {
    if (signal?.aborted) throw new Error('Aborted')
    throw new Error(`Claude SDK failed: ${err.message}`)
  } finally { cleanup() }
}

export async function reviewScenes(scriptMd, scenes, speakers, opts = {}, { signal, queryImpl, onThinkingActivity } = {}) {
  const prompt = buildScenesReviewPrompt(scriptMd, scenes, speakers, opts)
  const out = await structuredClaudeCall(prompt, REVIEW_SCHEMA, opts, { signal, queryImpl, onThinkingActivity })
  const verdict = out.verdict === 'revise' ? 'revise' : 'pass'
  return { verdict, critique: out.critique || '' }
}

export async function reviseScenes(scriptMd, scenes, speakers, critique, opts = {}, { signal, queryImpl, onPartialScene } = {}) {
  const prompt = buildScenesRevisePrompt(scriptMd, scenes, speakers, critique, opts)
  const makePartialParser = () => createPartialScenesParser({ onItem: onPartialScene })
  let partialParser = typeof onPartialScene === 'function' ? makePartialParser() : null
  const out = await structuredClaudeCall(prompt, SCENES_SCHEMA, opts, {
    signal,
    queryImpl,
    onPartialText: partialParser ? (text) => partialParser.push(text) : undefined,
    onPartialReset: partialParser ? () => { partialParser = makePartialParser() } : undefined,
  })
  const revisedScenes = out.scenes || []
  validateScenesSegments(revisedScenes)
  return { scenes: revisedScenes, speakers: out.speakers || [] }
}

export async function reviewPrompts(scenes, context, opts = {}, { signal, queryImpl, onThinkingActivity } = {}) {
  const prompt = buildPromptsReviewPrompt(scenes, context, opts)
  const out = await structuredClaudeCall(prompt, REVIEW_SCHEMA, opts, { signal, queryImpl, onThinkingActivity })
  const verdict = out.verdict === 'revise' ? 'revise' : 'pass'
  return { verdict, critique: out.critique || '' }
}

export async function revisePrompts(scenes, context, critique, opts = {}, { signal, queryImpl, onPartialPrompt } = {}) {
  const prompt = buildPromptsRevisePrompt(scenes, context, critique, opts)
  const makePartialParser = () => createPartialScenesParser({ onItem: onPartialPrompt })
  let partialParser = typeof onPartialPrompt === 'function' ? makePartialParser() : null
  const out = await structuredClaudeCall(prompt, PROMPTS_SCHEMA, opts, {
    signal,
    queryImpl,
    onPartialText: partialParser ? (text) => partialParser.push(text) : undefined,
    onPartialReset: partialParser ? () => { partialParser = makePartialParser() } : undefined,
  })
  const byNo = new Map((out.scenes || []).map((s) => [s.sceneNo, s]))
  for (const s of scenes) {
    const p = byNo.get(s.sceneNo)
    if (!p || typeof p.imagePrompt !== 'string' || !p.imagePrompt.trim()
          || typeof p.videoPrompt !== 'string' || !p.videoPrompt.trim()) {
      throw new Error(`revisePrompts: scene ${s.sceneNo} missing/empty prompt`)
    }
  }
  return {
    scenes: scenes.map((s) => ({
      ...s,
      imagePrompt: byNo.get(s.sceneNo).imagePrompt,
      videoPrompt: byNo.get(s.sceneNo).videoPrompt,
    })),
  }
}

// 리서치 §3.4 (D10): 다수 자막 종합 구조분석 — 라우터 등록 메서드(양 어댑터 공통).
export async function analyzeResearch(transcripts, opts = {}, { signal, queryImpl } = {}) {
  const prompt = buildResearchAnalyzePrompt(transcripts, opts)
  const out = await structuredClaudeCall(prompt, RESEARCH_ANALYSIS_SCHEMA, opts, { signal, queryImpl })
  return { structure: out.structure || [], claims: out.claims || [], commonThemes: out.commonThemes || [] }
}

// 리서치 §3.5 (D11/M1/N5): 팩트체크는 Claude 전용 — 라우터 우회, machine에 `factCheck` deps로 주입.
// 사용자가 고른 engine/model과 무관하게 강제 Claude 조합만 명시 구성(스프레드 금지 — normalize
// `claude:gpt-5.5` throw 회귀 차단). WebSearch 내장 도구 + 검색 왕복용 maxTurns 상향(sdkExtra).
const FACTCHECK_LLM = Object.freeze({ engine: 'claude', model: 'claude-opus-4-8', reasoningEffort: 'off' })
const FACTCHECK_SDK_EXTRA = Object.freeze({ tools: ['WebSearch'], maxTurns: 8 })
const FACTCHECK_VERDICTS = new Set(['supported', 'refuted', 'unverified'])

export async function factCheckClaims(claims, opts = {}, { signal, queryImpl } = {}) {
  const prompt = buildFactCheckPrompt(claims, opts) // opts는 프롬프트(언어 등)에만 반영
  const out = await structuredClaudeCall(prompt, FACTCHECK_SCHEMA, FACTCHECK_LLM, { signal, queryImpl, sdkExtra: { ...FACTCHECK_SDK_EXTRA } })
  return {
    claims: (out.claims || []).map((c) => ({
      claim: c.claim,
      verdict: FACTCHECK_VERDICTS.has(c.verdict) ? c.verdict : 'unverified',
      evidence: c.evidence || [],
    })),
  }
}

export async function writePrompts(scenes, context, opts = {}, { signal, queryImpl, onPartialPrompt, onThinkingActivity } = {}) {
  const prompt = buildPromptsPrompt(scenes, context, opts)
  const makePartialParser = () => createPartialScenesParser({ onItem: onPartialPrompt })
  let partialParser = typeof onPartialPrompt === 'function' ? makePartialParser() : null
  const out = await structuredClaudeCall(prompt, PROMPTS_SCHEMA, opts, {
    signal,
    queryImpl,
    onThinkingActivity,
    onPartialText: partialParser ? (text) => partialParser.push(text) : undefined,
    onPartialReset: partialParser ? () => { partialParser = makePartialParser() } : undefined,
  })
  validatePromptScenesExactOnce(scenes.map((scene) => scene.sceneNo), out.scenes)
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

export async function groupSrtLines(numberedLines, opts = {}, { signal, queryImpl } = {}) {
  const prompt = buildSrtGroupPrompt(numberedLines, opts)
  const out = await structuredClaudeCall(prompt, GROUPS_SCHEMA, opts, { signal, queryImpl })
  return { groups: out.groups || [] }
}
