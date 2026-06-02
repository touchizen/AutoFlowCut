/**
 * WelcomeScreen Component - 시작 화면
 *
 * BYOK API 키가 없을 때 키 설정으로 안내. (구 Flow 로그인 화면을 대체)
 */

import { useState, useEffect, useRef } from 'react'
import { useI18n } from '../hooks/useI18n'
import { TIMING } from '../config/defaults'
import './WelcomeScreen.css'
import appIconUrl from '/assets/icon128.png'

export default function WelcomeScreen({ getAccessToken, onReady, onSetupKey }) {
  const { t } = useI18n()
  const [authStatus, setAuthStatus] = useState('checking') // 'checking' | 'authenticated' | 'unauthenticated' | 'waiting'
  const pollingRef = useRef(null)

  useEffect(() => {
    checkAuth(true) // quickCheck 모드
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  const checkAuth = async (quickCheck = false) => {
    setAuthStatus('checking')
    try {
      const token = await getAccessToken(false, quickCheck)
      if (token) {
        setAuthStatus('authenticated')
        stopPolling()
        // 1초 후 app 탭으로 자동 전환
        setTimeout(() => {
          window.electronAPI?.switchTab?.('app')
        }, 1000)
        onReady?.()
      } else {
        setAuthStatus('unauthenticated')
      }
    } catch (e) {
      setAuthStatus('unauthenticated')
    }
  }
  
  const startPolling = () => {
    if (pollingRef.current) return
    
    pollingRef.current = setInterval(async () => {
      try {
        const token = await getAccessToken(false, true) // quickCheck
        if (token) {
          setAuthStatus('authenticated')
          stopPolling()
          // 1초 후 app 탭으로 자동 전환
          setTimeout(() => {
            window.electronAPI?.switchTab?.('app')
          }, 1000)
          onReady?.()
        }
      } catch (e) {}
    }, TIMING.AUTH_POLL_INTERVAL) // 2초마다 확인
  }
  
  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }
  
  // BYOK 모드: API Key 설정 탭을 연다. 폴링 없음 — 키가 저장되면 useApiKey 가 쏘는
  // 'byok-key-changed' 이벤트를 App 이 받아 authReady=true 로 만들고, 그러면 이 WelcomeScreen
  // 은 언마운트된다(App 의 !authReady 조건). 취소해도 화면은 버튼 그대로 남는다.
  const openFlow = () => {
    onSetupKey?.()
  }
  
  if (authStatus === 'checking') {
    return (
      <div className="welcome-screen">
        <div className="welcome-content">
          <div className="welcome-icon">⏳</div>
          <h2>{t('welcome.checking')}</h2>
        </div>
      </div>
    )
  }
  
  if (authStatus === 'authenticated') {
    return null // 인증되면 숨김
  }
  
  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <img src={appIconUrl} alt="AutoFlowCut" className="welcome-logo" />
        <h1>{t('welcome.title')}</h1>
        <p className="welcome-desc">
          {t('welcome.description').split('\n').map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
        </p>
        
        <div className="welcome-auth">
          <button className="btn-flow" onClick={openFlow}>
            🔑 {t('welcome.openFlow')}
          </button>
        </div>

        <div className="welcome-hint">
          💡 {t('welcome.loginHint')}
        </div>
      </div>
    </div>
  )
}
