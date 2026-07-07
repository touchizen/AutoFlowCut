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
  reviewScenes: 3,
  reviseScenes: 4,
  reviewPrompts: 2,
  revisePrompts: 3,
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
