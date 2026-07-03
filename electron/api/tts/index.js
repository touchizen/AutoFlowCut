/** provider명 → TTS 어댑터. M2a-1은 typecast만; elevenlabs/gemini는 후속. */
import { createTypecastAdapter } from './typecast.js'

const FACTORIES = { typecast: createTypecastAdapter }

export function createTtsAdapter(provider, deps) {
  const make = FACTORIES[provider]
  if (!make) throw new Error(`Unsupported TTS provider: ${provider}`)
  return make(deps)
}
