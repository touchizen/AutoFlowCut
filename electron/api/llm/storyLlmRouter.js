import { normalizeStoryLlmOptions } from './storyLlmCatalog.js'

const METHOD_OPTION_INDEX = {
  generateScript: 1,
  generateSynopsis: 1,
  splitScenes: 1,
  writePrompts: 2,
  generateTitle: 1,
  continueScript: 1,
  reviewScript: 1,
  reviseScript: 2,
  // 시놉시스 검수(spec 2026-07-10): reviewSynopsis(synopsisMd, characters, opts, ctx),
  // reviseSynopsis(synopsisMd, characters, critique, opts, ctx).
  reviewSynopsis: 2,
  reviseSynopsis: 3,
  reviewScenes: 3,
  reviseScenes: 4,
  reviewPrompts: 2,
  revisePrompts: 3,
  // 리서치 §3.4 (D10): 구조분석만 라우팅(양 어댑터 구현 필수, N1).
  // factCheckClaims는 라우터에 넣지 않는다(M1 — Claude 강제, machine에 factCheck deps로 직접 주입).
  analyzeResearch: 1,
}

function pickAdapter(adapters, opts) {
  return opts.engine === 'codex' ? adapters.codex : adapters.claude
}

function wrapMethod(method, adapters) {
  const optionIndex = METHOD_OPTION_INDEX[method]
  return async (...args) => {
    const opts = normalizeStoryLlmOptions(args[optionIndex] || {})
    const adapter = pickAdapter(adapters, opts)
    if (!adapter?.[method]) {
      throw new Error(`Story LLM adapter '${opts.engine}' does not implement ${method}`)
    }
    const nextArgs = [...args]
    nextArgs[optionIndex] = opts
    return adapter[method](...nextArgs)
  }
}

export function createStoryLlmRouter(adapters) {
  return Object.fromEntries(
    Object.keys(METHOD_OPTION_INDEX).map((method) => [method, wrapMethod(method, adapters)]),
  )
}
