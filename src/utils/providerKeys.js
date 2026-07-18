/**
 * providerKeys — 멀티 provider 배치 시작 게이트 (스펙 §5.7 authReady 재정의).
 *
 * 배경: 기존 `getAccessToken()`(=hasKey=google 키만 읽음)을 배치 시작 게이트로 쓰면
 * google 키 없이 OpenAI/Grok 키만 있는 사용자가 dispatcher 도달 전에 차단된다.
 * 대신 필요한 provider 집합을 get-key-status 의 byProvider map 과 대조한다.
 */

/**
 * scene plan 이 요구하는 provider 집합이 모두 키를 갖췄는지 판정.
 *
 * @param {string[]} providerIds - 배치가 필요로 하는 provider id 목록(중복 허용)
 * @param {Record<string, boolean>} byProvider - get-key-status 의 provider별 키 존재 map
 * @returns {boolean} 모든 필요 provider 에 키가 있으면 true. 요구가 없으면 true.
 *
 * fail-closed: 요구가 있는데 byProvider 를 모르거나 provider 가 map 에 없으면 false
 * (키 확인 불가를 "있음"으로 오판해 죽은 키 배치를 시작하지 않게).
 */
export function hasRequiredProviderKeys(providerIds, byProvider) {
  if (!Array.isArray(providerIds) || providerIds.length === 0) return true
  if (!byProvider || typeof byProvider !== 'object') return false
  const required = new Set(providerIds)
  for (const id of required) {
    if (byProvider[id] !== true) return false
  }
  return true
}
