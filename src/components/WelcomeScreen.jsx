/**
 * WelcomeScreen Component - 시작 화면
 * 
 * 토큰 없을 때 Flow 로그인 안내
 */

import { useState, useEffect, useRef } from 'react'
import { useI18n } from '../hooks/useI18n'
import { TIMING } from '../config/defaults'
import './WelcomeScreen.css'
import appIconUrl from '/assets/icon128.png'

export default function WelcomeScreen({ getAccessToken, onReady }) {
  const { t } = useI18n()
  const [authStatus, setAuthStatus] = useState('checking') // 'checking' | 'authenticated' | 'unauthenticated' | 'waiting' | 'unavailable'
  const pollingRef = useRef(null)

  useEffect(() => {
    checkAuth(true) // quickCheck 모드

    // Flow 지역 제한 감지
    const handleFlowStatus = (data) => {
      if (data?.unavailable) {
        unavailableRef.current = true
        setAuthStatus('unavailable')
        stopPolling()
      }
    }
    window.electronAPI?.onFlowStatus?.(handleFlowStatus)

    // cleanup
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [])
  
  const unavailableRef = useRef(false)

  const checkAuth = async (quickCheck = false) => {
    if (unavailableRef.current) return // 지역 제한 시 인증 체크 중단
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
        if (!unavailableRef.current) setAuthStatus('unauthenticated')
      }
    } catch (e) {
      if (!unavailableRef.current) setAuthStatus('unauthenticated')
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
  
  const openFlow = () => {
    if (window.electronAPI?.switchTab) {
      window.electronAPI.switchTab('flow')
    }
    setAuthStatus('waiting')
    startPolling() // 로그인 대기 시작
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
          {authStatus === 'unavailable' ? (
            <button className="btn-flow unavailable" disabled>
              🌍 {t('welcome.unavailable')}
            </button>
          ) : authStatus === 'waiting' ? (
            <button className="btn-flow waiting" disabled>
              ⏳ {t('welcome.waitingLogin')}
            </button>
          ) : (
            <button className="btn-flow" onClick={openFlow}>
              🚀 {t('welcome.openFlow')}
            </button>
          )}
        </div>

        {authStatus === 'unavailable' && (
          <div className="welcome-hint unavailable-hint">
            ⚠️ {t('welcome.unavailableHint')}
          </div>
        )}
        {authStatus === 'waiting' && (
          <div className="welcome-hint">
            💡 {t('welcome.loginHint')}
          </div>
        )}
      </div>
    </div>
  )
}
