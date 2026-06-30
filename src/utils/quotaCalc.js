/**
 * quotaCalc.js — 클라이언트 쪽 무료 사용 한도 계산 (GCF mirror)
 *
 * **GCF (`whisk2capcut/functions/src/quota.js`) 와 동일 로직**.
 * 두 곳이 같은 결정을 내려야 시각/실제 export 의 일관성이 유지된다.
 *
 * 실제 차단/카운팅은 GCF 가 수행. 이 모듈은 UI 표시용 (배지, 모달 메시지 등).
 *
 * 모델: B-3
 *   - 월 5회 quota (UTC 1일 자동 리셋)
 *   - 가입 시 부여되는 5회 영구 보너스 풀 (소진까지 보존)
 *   - 보너스 우선 소진, 그 다음 월 quota
 *   - 활성 구독자는 quota 무관 무제한
 *   - 7일 만료 로직 없음 (월간 모델로 대체)
 */

/** 월 quota — 무료 사용자의 매월 한도 */
export const MONTHLY_QUOTA = 5

/** 가입 시 부여되는 영구 보너스 풀 */
export const BONUS_GRANT = 5

/**
 * UTC 기준 어떤 시점의 "달의 시작" Date 반환.
 * @param {Date} date
 * @returns {Date}
 */
export function utcMonthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

/**
 * 두 시점이 같은 UTC 월에 속하는지.
 * @param {Date|null|undefined} a
 * @param {Date|null|undefined} b
 * @returns {boolean}
 */
export function sameUtcMonth(a, b) {
  if (!a || !b) return false
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  )
}

/**
 * Firestore Timestamp 또는 raw Date 를 Date 로 정규화.
 * @param {Date|{toDate: () => Date}|null|undefined} v
 * @returns {Date|null}
 */
function asDate(v) {
  if (!v) return null
  if (v instanceof Date) return v
  if (typeof v.toDate === 'function') {
    try {
      return v.toDate()
    } catch {
      return null
    }
  }
  return null
}

/**
 * appData 의 quota 상태 계산 (현재 시점 기준).
 *
 * **순수 함수.** GCF 의 computeQuotaState 와 동일 결정.
 *
 * @param {object|null} appData - Firestore subscription doc data
 * @param {Date} now - 현재 시점 (테스트 가능성)
 * @returns {{
 *   isActive: boolean,
 *   isExpired: boolean,
 *   subscriptionStatus: 'active'|'trial'|'expired',
 *   bonusRemaining: number,
 *   monthlyUsed: number,
 *   monthlyQuota: number,
 *   monthlyRemaining: number,
 *   effectiveRemaining: number,
 * }}
 */
/**
 * 무제한 구독 혜택을 받는 상태인지 판단. (GCF `src/quota.js` 의 hasUnlimitedAccess 와 동일)
 *
 * - 'active': 정상 구독 → 무제한
 * - 'cancelled': 갱신 취소했지만 subscriptionEndDate(=ends_at) 까지는 유효 → now < endDate 면 무제한.
 *   endDate 를 진실의 원천으로 삼아 expired webhook 누락에도 날짜로 자동 차단.
 *
 * @param {object} appData
 * @param {Date} now
 * @returns {boolean}
 */
export function hasUnlimitedAccess(appData, now) {
  const status = appData?.subscriptionStatus
  if (status === 'active') return true
  if (status === 'cancelled') {
    const endDate = asDate(appData.subscriptionEndDate)
    return !!endDate && now < endDate
  }
  return false
}

/** 배치 다운로드 월 quota */
export const BATCH_MONTHLY_QUOTA = 5

/** 배치 다운로드 가입 시 부여 보너스 */
export const BATCH_BONUS_GRANT = 5

/**
 * 배치 다운로드 풀 — GCF computePoolState(BATCH_POOL) 의 클라 미러.
 *
 * @param {object|null|undefined} appData - Firestore subscription doc data
 * @param {Date} now
 * @returns {{ isActive: boolean, bonusRemaining: number, monthlyUsed: number, effectiveRemaining: number }}
 */
export function computeBatchQuotaState(appData, now) {
  if (!appData) {
    return { isActive: false, bonusRemaining: BATCH_BONUS_GRANT, monthlyUsed: 0,
      effectiveRemaining: BATCH_BONUS_GRANT + BATCH_MONTHLY_QUOTA }
  }
  if (hasUnlimitedAccess(appData, now)) {
    return { isActive: true, bonusRemaining: appData.batchBonusRemaining ?? 0,
      monthlyUsed: appData.batchMonthlyUsed ?? 0, effectiveRemaining: Infinity }
  }
  const bonusRemaining = appData.batchBonusRemaining ?? BATCH_BONUS_GRANT
  const storedPeriodStart = asDate(appData.batchQuotaPeriodStart)
  const needsReset = !storedPeriodStart || !sameUtcMonth(storedPeriodStart, now)
  const monthlyUsed = needsReset ? 0 : (appData.batchMonthlyUsed ?? 0)
  const monthlyRemaining = Math.max(0, BATCH_MONTHLY_QUOTA - monthlyUsed)
  return { isActive: false, bonusRemaining, monthlyUsed, effectiveRemaining: bonusRemaining + monthlyRemaining }
}

export function computeQuotaState(appData, now) {
  // 신규 사용자 (doc 없음)
  if (!appData) {
    return {
      isActive: false,
      isExpired: false,
      subscriptionStatus: 'trial',
      bonusRemaining: BONUS_GRANT,
      monthlyUsed: 0,
      monthlyQuota: MONTHLY_QUOTA,
      monthlyRemaining: MONTHLY_QUOTA,
      effectiveRemaining: BONUS_GRANT + MONTHLY_QUOTA,
    }
  }

  // 활성 구독자 (active, 또는 cancelled+grace) — 무제한.
  // grace period 도 'active' 로 정규화 → 호출자(calculateTrialStatus 등) 무제한 분기 그대로.
  if (hasUnlimitedAccess(appData, now)) {
    return {
      isActive: true,
      isExpired: false,
      subscriptionStatus: 'active',
      bonusRemaining: appData.bonusRemaining ?? 0,
      monthlyUsed: appData.monthlyUsed ?? 0,
      monthlyQuota: Infinity,
      monthlyRemaining: Infinity,
      effectiveRemaining: Infinity,
    }
  }

  // 무료 사용자 — B-3 quota 계산
  const bonusRemaining = appData.bonusRemaining ?? BONUS_GRANT  // lazy migrate
  const storedPeriodStart = asDate(appData.quotaPeriodStart)
  const inSamePeriod = sameUtcMonth(storedPeriodStart, now)
  const monthlyUsed = inSamePeriod ? (appData.monthlyUsed ?? 0) : 0
  const monthlyRemaining = Math.max(0, MONTHLY_QUOTA - monthlyUsed)
  const effectiveRemaining = bonusRemaining + monthlyRemaining
  const isExpired = effectiveRemaining <= 0

  return {
    isActive: !isExpired,
    isExpired,
    subscriptionStatus: isExpired ? 'expired' : 'trial',
    bonusRemaining,
    monthlyUsed,
    monthlyQuota: MONTHLY_QUOTA,
    monthlyRemaining,
    effectiveRemaining,
  }
}
