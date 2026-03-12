/**
 * Firestore Database Operations
 *
 * 멀티 앱 지원 사용자 데이터 및 구독 정보 관리
 *
 * Firestore 구조:
 * - users/{userId} - 사용자 기본 정보
 * - apps/{userId}/subscriptions/{appId} - 앱별 구독 정보
 */

import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore'
import { db } from './config'

// 앱 ID (이 프로젝트용)
const APP_ID = 'flow2capcut'

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
 * @param {string} appId - 앱 ID (기본: flow2capcut)
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
 * 앱별 구독 문서 실시간 구독
 * @param {string} userId - Firebase Auth UID
 * @param {function} onData - 데이터 콜백
 * @param {function} onError - 에러 콜백
 * @param {string} appId - 앱 ID (기본: flow2capcut)
 * @returns {function} - 구독 해제 함수
 */
export function subscribeToAppDoc(userId, onData, onError, appId = APP_ID) {
  if (!userId) {
    onData(null)
    return () => {}
  }

  const appRef = doc(db, 'apps', userId, 'subscriptions', appId)

  return onSnapshot(
    appRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onData({ id: snapshot.id, ...snapshot.data() })
      } else {
        onData(null)
      }
    },
    (error) => {
      console.error('[Firestore] App subscription error:', error)
      if (onError) onError(error)
    }
  )
}

/**
 * 사용자 문서 실시간 구독 (하위 호환용)
 * @deprecated 앱별 구독은 subscribeToAppDoc 사용
 */
export function subscribeToUserDoc(userId, onData, onError) {
  // 앱 문서를 구독하도록 변경
  return subscribeToAppDoc(userId, onData, onError)
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
 * 체험판 정보 계산
 * @param {Object} appData - 앱별 구독 데이터
 * @returns {Object} - 체험판 상태 정보
 */
export function calculateTrialStatus(appData) {
  if (!appData) {
    return {
      isActive: false,
      canExport: true, // 아직 초기화 안됨 = 첫 사용 가능
      exportsRemaining: 5,
      daysRemaining: 7,
      isExpired: false,
      status: 'trial'
    }
  }

  const { subscriptionStatus, exportCount = 0, trialStartDate, subscriptionEndDate, subscriptionPlan } = appData

  // 유료 구독자
  if (subscriptionStatus === 'active') {
    return {
      isActive: true,
      canExport: true,
      exportsRemaining: Infinity,
      daysRemaining: Infinity,
      isExpired: false,
      status: 'active',
      expiresAt: subscriptionEndDate ? toDate(subscriptionEndDate) : null,
      plan: subscriptionPlan || 'monthly' // 'monthly' | 'yearly'
    }
  }

  // 체험판
  if (subscriptionStatus === 'trial') {
    const startDate = toDate(trialStartDate)
    const now = new Date()

    if (!startDate) {
      // 체험 시작일이 없으면 아직 시작 안함 — 카운팅 전
      return {
        isActive: true,
        canExport: true,
        exportsRemaining: 5,
        daysRemaining: 7,
        isExpired: false,
        status: 'trial'
      }
    }

    const daysPassed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24))
    const daysRemaining = Math.max(0, 7 - daysPassed)
    const exportsRemaining = Math.max(0, 5 - exportCount)

    const isExpired = daysRemaining <= 0 || exportsRemaining <= 0

    return {
      isActive: !isExpired,
      canExport: !isExpired,
      exportsRemaining,
      daysRemaining,
      isExpired,
      status: isExpired ? 'expired' : 'trial'
    }
  }

  // 만료됨
  return {
    isActive: false,
    canExport: false,
    exportsRemaining: 0,
    daysRemaining: 0,
    isExpired: true,
    status: 'expired'
  }
}
