/**
 * Authentication Context
 *
 * Firebase 인증 상태를 앱 전체에서 사용할 수 있도록 제공
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import {
  signInWithGoogle,
  signOut,
  onAuthChange,
  initializeUser
} from '../firebase'
import {
  getAppDoc,
  calculateTrialStatus
} from '../firebase/firestore'

// Context 생성
const AuthContext = createContext(null)

/**
 * AuthProvider - 인증 상태 관리 Provider
 */
export function AuthProvider({ children }) {
  // 인증 상태
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const loginInProgressRef = useRef(false)  // 로그인 진행 중 플래그 (onAuthChange에서 loading 리셋 방지)

  // 사용자 데이터 (Firestore)
  const [userData, setUserData] = useState(null)
  const [subscription, setSubscription] = useState({
    isActive: false,
    canExport: false,
    exportsRemaining: 0,
    daysRemaining: 0,
    isExpired: true,
    status: 'none'
  })

  // Firebase Auth 상태 변화 감지
  useEffect(() => {
    const unsubscribe = onAuthChange((firebaseUser) => {
      console.log('[AuthContext] Auth state changed:', firebaseUser?.email)
      setUser(firebaseUser)

      // 로그인 진행 중에는 loading을 false로 바꾸지 않음 (login()의 finally에서 처리)
      if (!loginInProgressRef.current) {
        setLoading(false)
      }

      if (!firebaseUser) {
        setUserData(null)
        setSubscription({
          isActive: false,
          canExport: false,
          exportsRemaining: 0,
          daysRemaining: 0,
          isExpired: true,
          status: 'none'
        })
      }
    })

    return () => unsubscribe()
  }, [])

  // Firestore 사용자 데이터 1회 fetch (실시간 리스너 X — read 비용 절감)
  // 변경이 필요한 시점(결제, export 후)엔 refreshSubscription()으로 명시적 재조회
  const fetchUserData = useCallback(async (uid) => {
    try {
      const data = await getAppDoc(uid)
      setUserData(data)
      const trialStatus = calculateTrialStatus(data)
      setSubscription(trialStatus)
    } catch (err) {
      console.error('[AuthContext] Firestore error:', err)
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    if (!user?.uid) return
    fetchUserData(user.uid)
  }, [user?.uid, fetchUserData])

  // Google 로그인
  const login = useCallback(async () => {
    try {
      loginInProgressRef.current = true
      setLoading(true)
      setError(null)

      const result = await signInWithGoogle()

      // 사용자 초기화 (첫 로그인 시 Firestore 문서 생성)
      await initializeUser()

      return result
    } catch (err) {
      console.error('[AuthContext] Login error:', err)
      setError(err.message)
      throw err
    } finally {
      loginInProgressRef.current = false
      setLoading(false)
    }
  }, [])

  // 로그아웃
  const logout = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      await signOut()
    } catch (err) {
      console.error('[AuthContext] Logout error:', err)
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  // 에러 클리어
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // 구독 정보 새로고침 (서버에서 재조회)
  const refreshSubscription = useCallback(async () => {
    if (user?.uid) {
      await fetchUserData(user.uid)
    }
  }, [user?.uid, fetchUserData])

  const value = {
    // 상태
    user,
    userData,
    subscription,
    loading,
    error,
    isAuthenticated: !!user,

    // 액션
    login,
    logout,
    clearError,
    refreshSubscription
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

/**
 * useAuth Hook - AuthContext 사용
 */
export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }

  return context
}

export default AuthContext
