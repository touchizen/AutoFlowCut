/** provider명 → TTS 어댑터. */
import { createTypecastAdapter } from './typecast.js'
import { createElevenLabsAdapter } from './elevenlabs.js'
import { createGoogleTtsAdapter } from './googletts.js'
import { createGeminiAdapter } from './gemini.js'

const FACTORIES = {
  typecast: createTypecastAdapter,
  elevenlabs: createElevenLabsAdapter,
  googletts: createGoogleTtsAdapter,
  gemini: createGeminiAdapter, // 키는 genai(Gemini) 키 재사용
}

export function createTtsAdapter(provider, deps) {
  const make = FACTORIES[provider]
  if (!make) throw new Error(`Unsupported TTS provider: ${provider}`)
  return make({ ...deps, provider })
}
