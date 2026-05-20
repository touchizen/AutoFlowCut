import { DEFAULTS } from '../config/defaults'

const { waitTiersMs, maxIncidents, resetAfterScenes } = DEFAULTS.recaptcha

/**
 * incidentCount(1-based, 증가 후 값) → 다음 대기 계획.
 * @param {number} incidentCount  연속 차단 횟수 (1,2,3,...)
 * @returns {{waitMs:number, autoResume:boolean}}
 *   autoResume=false 면 자동 재개 안 함 (4회+) — 사용자가 수동 재개해야 함.
 */
export function planRecaptchaWait(incidentCount) {
  if (incidentCount > maxIncidents) {
    return { waitMs: 0, autoResume: false }
  }
  return { waitMs: waitTiersMs[incidentCount - 1], autoResume: true }
}

/**
 * 재개 후 연속 성공 씬 수가 리셋 임계값에 도달했는지.
 * @param {number} consecutiveSuccesses
 * @returns {boolean}
 */
export function shouldResetIncidents(consecutiveSuccesses) {
  return consecutiveSuccesses >= resetAfterScenes
}
