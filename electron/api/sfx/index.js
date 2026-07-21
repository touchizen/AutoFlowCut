/** provider명 → SFX 어댑터. TTS 어댑터 패턴과 동일하되 별도 모듈(tts 오버로드 X). */
import { createElevenLabsSfxAdapter } from './elevenlabs.js'
import { createLibrarySfxAdapter } from './library.js'

const FACTORIES = {
  elevenlabs: createElevenLabsSfxAdapter,
  library: createLibrarySfxAdapter,
}

export function createSfxAdapter(provider, deps) {
  const make = FACTORIES[provider]
  if (!make) throw new Error(`Unsupported SFX provider: ${provider}`)
  return make({ ...deps, provider })
}

export default { createSfxAdapter }
