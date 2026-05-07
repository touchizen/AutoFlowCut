/**
 * Firestore Database Operations
 *
 * 멀티 앱 지원 사용자 데이터 및 구독 정보 관리
 *
 * Firestore 구조:
 * - users/{userId} - 사용자 기본 정보
 * - apps/{userId}/subscriptions/{appId} - 앱별 구독 정보
 */

import { doc, getDoc } from 'firebase/firestore'
import { db, APP_ID } from './config'
import { computeQuotaState, MONTHLY_QUOTA, BONUS_GRANT } from '../utils/quotaCalc'

/**
 * 사용자 문서 가져오기
 * @param {string} userId - Firebase Auth UID
 * @returns {Promise<Object|null>}
 */
export async function getUserDoc(userId) {
  if (!userId) return null

  try {
    const userRef = doc(db, 'users', userId)
    const userSnap = await getDoc(userRef)

    if (userSnap.exists()) {
      return { id: userSnap.id, ...userSnap.data() }
    }
    return null
  } catch (error) {
    console.error('[Firestore] Failed to get user doc:', error)
    throw error
  }
}

/**
 * 앱별 구독 문서 가져오기
 * @param {string} userId - Firebase Auth UID
 * @param {string} appId - 앱 ID (기본: autoflowcut)
 * @returns {Promise<Object|null>}
 */
export async function getAppDoc(userId, appId = APP_ID) {
  if (!userId) return null

  try {
    const appRef = doc(db, 'apps', userId, 'subscriptions', appId)
    const appSnap = await getDoc(appRef)

    if (appSnap.exists()) {
      return { id: appSnap.id, ...appSnap.data() }
    }
    return null
  } catch (error) {
    console.error('[Firestore] Failed to get app doc:', error)
    throw error
  }
}

/**
 * Firestore Timestamp를 Date로 변환
 * @param {import('firebase/firestore').Timestamp} timestamp
 * @returns {Date|null}
 */
export function toDate(timestamp) {
  if (!timestamp) return null
  if (timestamp.toDate) return timestamp.toDate()
  if (timestamp instanceof Date) return timestamp
  return new Date(timestamp)
}

/**
 * 체험판 정보 계산 (B-3 모델: 월 5회 + 가입 시 5회 영구 보너스).
 *
 * 실제 quota 차단은 GCF 가 수행. 이 함수는 UI 표시용 mirror.
 * GCF 의 computeQuotaState 와 동일 로직 (`utils/quotaCalc.js` 가 공유).
 *
 * 반환 필드:
 *   - isActive, isExpired, canExport, status — 기존 UI 가 사용
 *   - exportsRemaining — 보너스 + 월 합산 (legacy compat, 유료 구독 시 Infinity)
 *   - daysRemaining — 더 이상 의미 없음 (월간 모델). 호환을 위해 Infinity 반환.
 *   - 신규: bonusRemaining, monthlyUsed, monthlyRemaining, monthlyQuota, effectiveRemaining
 *
 * @param {Object} appData - 앱별 구독 데이터
 * @returns {Object}
 */
export function calculateTrialStatus(appData) {
  const now = new Date()
  const state = computeQuotaState(appData, now)

  // 활성 구독자
  if (state.subscriptionStatus === 'active') {
    return {
      isActive: true,
      canExport: true,
      isExpired: false,
      status: 'active',
      // legacy compat
      exportsRemaining: Infinity,
      daysRemaining: Infinity,
      // 신규
      bonusRemaining: state.bonusRemaining,
      monthlyUsed: state.monthlyUsed,
      monthlyQuota: state.monthlyQuota,
      monthlyRemaining: state.monthlyRemaining,
      effectiveRemaining: state.effectiveRemaining,
      // 기존 active 응답 필드 유지
      expiresAt: appData?.subscriptionEndDate ? toDate(appData.subscriptionEndDate) : null,
      plan: appData?.subscriptionPlan || 'monthly',
    }
  }

  // 무료 사용자 (trial / expired)
  return {
    isActive: state.isActive,
    canExport: !state.isExpired,
    isExpired: state.isExpired,
    status: state.subscriptionStatus,
    // legacy compat: exportsRemaining = 보너스 + 월 합산
    exportsRemaining: state.effectiveRemaining,
    // legacy compat: 월간 모델엔 무의미 — Infinity 로 두면 기존 UI 가 "/Infinity 일" 같이 깨질 수 있음.
    // → 1 로 두어 "오늘 안에는 OK"라는 약한 신호. 새 UI 는 monthlyRemaining 등 신규 필드 사용.
    daysRemaining: state.isExpired ? 0 : 1,
    // 신규 필드
    bonusRemaining: state.bonusRemaining,
    monthlyUsed: state.monthlyUsed,
    monthlyQuota: state.monthlyQuota,
    monthlyRemaining: state.monthlyRemaining,
    effectiveRemaining: state.effectiveRemaining,
  }
}
