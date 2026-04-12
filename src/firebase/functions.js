/**
 * Firebase Cloud Functions Client
 *
 * 멀티 앱 지원 서버 측 함수 호출 (내보내기 카운트, 결제 등)
 */

import { httpsCallable } from 'firebase/functions'
import { functions } from './config'

// 앱 ID (이 프로젝트용)
const APP_ID = 'flow2capcut'

/**
 * OS 감지 (navigator.userAgentData 우선, fallback: userAgent 파싱)
 * @returns {string} "Windows", "macOS", "Chrome OS", "Linux", "Android", "iOS", "Unknown"
 */
function getOS() {
  try {
    // Chrome 90+ User-Agent Client Hints API
    if (navigator.userAgentData?.platform) {
      return navigator.userAgentData.platform
    }
    const ua = navigator.userAgent
    if (/CrOS/.test(ua)) return 'Chrome OS'
    if (/Win/.test(ua)) return 'Windows'
    if (/Mac/.test(ua)) return 'macOS'
    if (/Android/.test(ua)) return 'Android'
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
    if (/Linux/.test(ua)) return 'Linux'
    return 'Unknown'
  } catch {
    return 'Unknown'
  }
}

/**
 * 브라우저 감지
 * @returns {string} "Chrome 125", "Edge 125", "Unknown"
 */
function getBrowser() {
  try {
    if (navigator.userAgentData?.brands?.length) {
      // Chromium 기반 브라우저 — 가장 구체적인 브랜드 사용
      const brand = navigator.userAgentData.brands.find(b => /Chrome|Edge|Brave|Opera|Whale/.test(b.brand))
        || navigator.userAgentData.brands[0]
      return `${brand.brand} ${brand.version}`
    }
    const ua = navigator.userAgent
    const match = ua.match(/(Edg|Chrome|Safari|Firefox|OPR|Whale|Brave)\/(\d+)/)
    if (match) {
      const name = match[1] === 'Edg' ? 'Edge' : match[1] === 'OPR' ? 'Opera' : match[1]
      return `${name} ${match[2]}`
    }
    return 'Unknown'
  } catch {
    return 'Unknown'
  }
}

/**
 * 플랫폼 정보 수집
 */
function getPlatformInfo() {
  return {
    os: getOS(),
    browser: getBrowser(),
    language: navigator.language || '',
    clientType: 'desktop'
  }
}

// 함수 환경 (test/prod) - 환경변수로 제어
// VITE_FUNCTION_ENV=prod 이면 _prod, 아니면 _test
export const FUNCTION_SUFFIX = import.meta.env.VITE_FUNCTION_ENV === 'prod' ? '_prod' : '_test'

console.log(`[Functions] Using ${FUNCTION_SUFFIX} functions`)

/**
 * 사용자 초기화 (첫 로그인 시 호출)
 * - users/{userId} 문서 생성
 * - apps/{userId}/{appId} 문서 생성
 * @returns {Promise<Object|null>}
 */
export async function initializeUser() {
  try {
    const initFn = httpsCallable(functions, `initializeUser${FUNCTION_SUFFIX}`)
    const result = await initFn({ appId: APP_ID, platform: getPlatformInfo() })
    console.log('[Functions] User initialized:', result.data)
    return result.data
  } catch (error) {
    // Cloud Function이 아직 배포되지 않은 경우 무시
    console.warn('[Functions] initializeUser not available:', error.message)
    return null
  }
}

/**
 * 내보내기 카운트 증가 (서버 측에서 처리)
 * @returns {Promise<Object>} - 업데이트된 카운트 정보
 */
export async function incrementExportCount() {
  try {
    const incrementFn = httpsCallable(functions, `incrementExportCount${FUNCTION_SUFFIX}`)
    const result = await incrementFn({ appId: APP_ID })
    console.log('[Functions] Export count incremented:', result.data)
    return result.data
  } catch (error) {
    console.error('[Functions] incrementExportCount failed:', error)
    throw error
  }
}

/**
 * 앱별 구독 상태 조회
 * @returns {Promise<Object>} - { status, exportCount, exportsRemaining, daysRemaining }
 */
export async function getAppStatus() {
  try {
    const getStatusFn = httpsCallable(functions, `getAppStatus${FUNCTION_SUFFIX}`)
    const result = await getStatusFn({ appId: APP_ID })
    console.log('[Functions] App status:', result.data)
    return result.data
  } catch (error) {
    console.error('[Functions] getAppStatus failed:', error)
    // 기본값 반환
    return {
      status: 'trial',
      exportCount: 0,
      exportsRemaining: 5,
      daysRemaining: 7
    }
  }
}

/**
 * Lemon Squeezy 체크아웃 세션 생성
 * @param {Object} options - { interval }
 * @param {string} options.interval - 'month' 또는 'year'
 * @returns {Promise<Object>} - 체크아웃 세션 정보 (url 포함)
 */
export async function createCheckoutSession({ interval } = {}) {
  try {
    const createSessionFn = httpsCallable(functions, `createCheckoutSession${FUNCTION_SUFFIX}`)
    const result = await createSessionFn({ appId: APP_ID, interval })
    console.log('[Functions] Checkout session created:', result.data)
    return result.data
  } catch (error) {
    console.error('[Functions] createCheckoutSession failed:', error)
    throw error
  }
}

/**
 * Lemon Squeezy 고객 포털 세션 생성
 * @returns {Promise<Object>} - 포털 세션 정보 (url 포함)
 */
export async function createPortalSession() {
  try {
    const createPortalFn = httpsCallable(functions, `createPortalSession${FUNCTION_SUFFIX}`)
    const result = await createPortalFn()
    console.log('[Functions] Portal session created:', result.data)
    return result.data
  } catch (error) {
    console.error('[Functions] createPortalSession failed:', error)
    throw error
  }
}

/**
 * 가격 정보 조회
 * @returns {Promise<Object>} - { prices: [{ variantId, amount, currency, interval, productName }] }
 */
export async function getPricing() {
  try {
    const getPricingFn = httpsCallable(functions, `getPricing${FUNCTION_SUFFIX}`)
    const result = await getPricingFn({ appId: APP_ID })
    console.log('[Functions] Pricing fetched:', result.data)
    return result.data
  } catch (error) {
    console.error('[Functions] getPricing failed:', error)
    // 기본값 반환
    return {
      prices: [
        { variantId: null, amount: 4.99, currency: 'USD', interval: 'month', productName: 'Pro Monthly' },
        { variantId: null, amount: 39.99, currency: 'USD', interval: 'year', productName: 'Pro Yearly' }
      ]
    }
  }
}
