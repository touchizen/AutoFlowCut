/**
 * Flow 프로젝트 채택 확인 모달을 다시 띄울지 결정한다(순수).
 *
 * 모달이 떠 있는 동안 Flow 뷰는 0×0 으로 접히므로, 취소한 직후 5초마다 같은 프로젝트로 다시
 * 물으면 사용자가 원하는 프로젝트를 고를 시간이 없다. 취소한 후보는 한동안 묻지 않는다.
 */

/** 취소한 후보를 다시 묻기까지의 침묵 시간. */
export const ADOPT_PROMPT_COOLDOWN_MS = 10 * 60 * 1000

/**
 * @param {string|null|undefined} projectId 이번에 물으려는 Flow 프로젝트 id
 * @param {Map<string, number>} cancelledAt id → 취소한 시각(ms)
 * @param {number} now 현재 시각(ms)
 * @param {number} [cooldownMs]
 */
export function shouldPromptAdopt(projectId, cancelledAt, now, cooldownMs = ADOPT_PROMPT_COOLDOWN_MS) {
  if (!projectId) return false
  const at = cancelledAt?.get?.(projectId)
  if (at === undefined) return true
  // 기록이 미래면(시계 역행/수동 조정) 남은 시간이 무한대가 된다 — 영구 침묵보다 다시 묻는 쪽.
  if (at > now) return true
  return now - at >= cooldownMs
}
