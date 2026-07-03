/**
 * provider별 멀티 키 저장소 — 스펙 §6. enum allowlist + 경로 매핑 테이블(path traversal 방어).
 * 각 provider는 기존 createKeyStore(단일 파일) 인스턴스로 위임.
 */
import { createKeyStore } from './keyStore.js'

// allowlist → 파일명 (provider 문자열을 직접 path join 하지 않는다)
const FILENAME_BY_PROVIDER = {
  genai: 'genai-key.enc',
  elevenlabs: 'elevenlabs-key.enc',
  typecast: 'typecast-key.enc',
  anthropic: 'anthropic-key.enc',
}
export const PROVIDERS = Object.keys(FILENAME_BY_PROVIDER)

export function createMultiKeyStore({ safeStorage, keysDir, fs, path }) {
  fs.mkdirSync?.(keysDir, { recursive: true })
  const cache = new Map()
  function storeFor(provider) {
    const filename = FILENAME_BY_PROVIDER[provider]
    if (!filename) return null // allowlist 밖 → 경로 생성 안 함
    if (!cache.has(provider)) {
      cache.set(provider, createKeyStore({ safeStorage, filePath: path.join(keysDir, filename), fs }))
    }
    return cache.get(provider)
  }
  return {
    PROVIDERS,
    setKey(provider, plain) {
      const s = storeFor(provider)
      return s ? s.setKey(plain) : { success: false, error: `unknown provider: ${provider}` }
    },
    getKey(provider) { return storeFor(provider)?.getKey() ?? null },
    hasKey(provider) { return storeFor(provider)?.hasKey() ?? false },
    clearKey(provider) {
      const s = storeFor(provider)
      return s ? s.clearKey() : { success: false, error: `unknown provider: ${provider}` }
    },
  }
}
