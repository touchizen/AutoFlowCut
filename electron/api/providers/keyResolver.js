/**
 * composite 키 리졸버 (스펙 §5.5, R2 BLOCKER: 경로 불일치로 키 소실 방지).
 *
 * 두 저장소의 시그니처가 다르다:
 *   - genaiKeyStore.getKey()          (무인자, google 전용, userData/genai-key.enc)
 *   - multiKeyStore.getKey('xai')     (슬롯 인자, 신규 provider, userData/keys/*.enc)
 *
 * 호출부가 분기하지 않도록 **동일한 무인자 op wrapper**를 반환한다. google 은 기존
 * genaiKeyStore 경로/포맷을 그대로 위임(마이그레이션 0), 신규 provider 만 multiKeyStore
 * 슬롯을 쓴다. unknown provider 는 null(명시 실패, §5.10) — silent fallback 금지.
 */

// provider id → multiKeyStore 슬롯명. id 와 슬롯이 다른 경우만 매핑됨(grok→xai).
// null-proto 로 프로토타입 멤버(constructor/__proto__ 등) 오염 방지.
const SLOT_BY_PROVIDER = Object.assign(Object.create(null), {
  openai: 'openai',
  grok: 'xai',
  fal: 'fal',
  wavespeed: 'wavespeed',
  higgsfield: 'higgsfield',
})

/**
 * @param {string} providerId
 * @param {{ genaiKeyStore: object, multiKeyStore: object }} deps
 * @returns {{ getKey():string|null, setKey(k:string):object, clearKey():object, hasKey():boolean } | null}
 */
export function resolveKeyOps(providerId, { genaiKeyStore, multiKeyStore }) {
  if (providerId === 'google') {
    return {
      getKey: () => genaiKeyStore.getKey(),
      setKey: (k) => genaiKeyStore.setKey(k),
      clearKey: () => genaiKeyStore.clearKey(),
      hasKey: () => genaiKeyStore.hasKey(),
    }
  }
  const slot = Object.hasOwn(SLOT_BY_PROVIDER, providerId) ? SLOT_BY_PROVIDER[providerId] : undefined
  if (!slot) return null // unknown/prototype 멤버 → 명시 실패(§5.10)
  return {
    getKey: () => multiKeyStore.getKey(slot),
    setKey: (k) => multiKeyStore.setKey(slot, k),
    clearKey: () => multiKeyStore.clearKey(slot),
    hasKey: () => multiKeyStore.hasKey(slot),
  }
}
