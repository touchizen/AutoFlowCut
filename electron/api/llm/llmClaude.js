/**
 * Claude Agent SDK 대본 엔진 — llmGemini와 동일 시그니처. 대본은 스트리밍,
 * 씬분리/프롬프트는 outputFormat structured(다음 Task). 인증은 로컬 Claude 로그인.
 */
import { buildScriptPrompt } from './prompts.js'
import { buildClaudeSdkOptions, extractClaudeSdkResult, bridgeAbortSignal, extractTextDelta } from './claudeSdk.js'

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
