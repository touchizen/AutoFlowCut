/**
 * Flow 프로젝트 채택 확인 모달을 다시 띄울지 결정한다(순수).
 *
 * 모달이 떠 있는 동안 Flow 뷰는 0×0 으로 접히므로, 취소한 직후 5초마다 같은 프로젝트로 다시
 * 물으면 사용자가 원하는 프로젝트를 고를 시간이 없다. 취소한 후보는 한동안 묻지 않는다.
 */

/** 사용자가 **거절한** 후보를 다시 묻기까지의 침묵 시간. */
export const ADOPT_PROMPT_COOLDOWN_MS = 10 * 60 * 1000

/**
 * 사용자가 **승인했는데 채택이 실패한** 후보를 다시 묻기까지의 침묵 시간.
 * 실패는 대개 일시적이고(Flow 뷰가 그 순간 바쁨, 디스크 일시 실패) 사용자의 의사는 이미 확인됐다 —
 * 거절과 같은 길이로 재우면 "다시 시도하세요"라는 토스트를 띄워 놓고 10분간 물어보지 않는다.
 */
export const ADOPT_RETRY_COOLDOWN_MS = 30 * 1000

/**
 * @param {string|null|undefined} key 후보의 쿨다운 키(호출부가 만든다 — 로컬 프로젝트 × Flow id)
 * @param {Map<string, {at: number, cooldownMs: number}>} cancelledAt 키 → 침묵 시작 시각과 길이.
 *   길이를 항목이 들고 다닌다 — 거절과 "승인했는데 실패"는 다시 물어야 할 시점이 다르다.
 * @param {number} now 현재 시각(ms)
 * @param {number} [fallbackCooldownMs] 항목에 길이가 없을 때
 */
export function shouldPromptAdopt(key, cancelledAt, now, fallbackCooldownMs = ADOPT_PROMPT_COOLDOWN_MS) {
  if (!key) return false
  const entry = cancelledAt?.get?.(key)
  if (entry === undefined) return true
  const at = entry.at
  const cooldownMs = entry.cooldownMs ?? fallbackCooldownMs
  // 기록이 미래면(시계 역행/수동 조정) 남은 시간이 무한대가 된다 — 영구 침묵보다 다시 묻는 쪽.
  if (at > now) return true
  return now - at >= cooldownMs
}
