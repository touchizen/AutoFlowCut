/**
 * UserMenu - 사용자 메뉴 컴포넌트
 *
 * 로그인된 사용자 정보, 구독 상태, 로그아웃 버튼
 */

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { createPortalSession } from '../firebase/functions'
import { useI18n } from '../hooks/useI18n'
import { useCachedAvatar } from '../hooks/useCachedAvatar'
import './UserMenu.css'

/**
 * Google 프로필 사진 URL 의 size 파라미터를 원하는 크기로 리라이트.
 * 형식: `https://lh3.googleusercontent.com/a/<token>=s<size>-c`
 *   - s 뒤 숫자만 바꿔주면 됨. 패턴 매칭 실패 시 원본 그대로 반환 (안전).
 * 작은 이미지 = 로드 빠름 + Google CDN 429 throttle 도 덜 걸림.
 */
function resizeGoogleAvatarUrl(url, size) {
  if (!url || typeof url !== 'string') return url
  // =s<digits>-c 또는 =s<digits> 패턴이면 size 만 교체
  return url.replace(/=s\d+(-c)?$/, `=s${size}-c`)
}

export function UserMenu({ onLoginClick, onUpgradeClick }) {
  const { t } = useI18n()
  const { user, isAuthenticated, subscription, logout, loading } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const menuRef = useRef(null)

  // photoURL 을 24h base64 로 localStorage 캐시하여 표시.
  // 첫 로드 후엔 Google CDN 안 때림 → 429 원천 차단.
  // onImageError: <img> 디코드 실패 시 캐시 invalidate + placeholder 폴백 (정상 이미지만 캐시 유지).
  const normalizedPhotoUrl = user?.photoURL
    ? resizeGoogleAvatarUrl(user.photoURL, 64)
    : null
  const {
    src: cachedAvatarSrc,
    failed: avatarFetchFailed,
    onImageError: handleAvatarError
  } = useCachedAvatar(normalizedPhotoUrl)

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 로그인하지 않은 경우
  if (!isAuthenticated) {
    return (
      <button
        className="user-menu-login-btn"
        onClick={onLoginClick}
        disabled={loading}
        data-tooltip={t('header.login')}
      >
        <span className="login-icon">👤</span>
      </button>
    )
  }

  const handleLogout = async () => {
    try {
      setIsOpen(false)
      await logout()
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  const handleManageSubscription = async () => {
    try {
      setPortalLoading(true)
      const { url } = await createPortalSession()
      if (url) {
        window.open(url, '_blank')
      }
    } catch (error) {
      console.error('Portal session failed:', error)
    } finally {
      setPortalLoading(false)
      setIsOpen(false)
    }
  }

  const getStatusBadge = () => {
    if (subscription.status === 'active') {
      return <span className="user-badge user-badge--pro">{t('subscription.proBadge')}</span>
    }
    if (subscription.status === 'trial') {
      return <span className="user-badge user-badge--trial">{t('subscription.trial')}</span>
    }
    if (subscription.status === 'expired') {
      return <span className="user-badge user-badge--expired">{t('subscription.expiredBadge')}</span>
    }
    return null
  }

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        className="user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        {cachedAvatarSrc && !avatarFetchFailed ? (
          <img
            // useCachedAvatar 가 24h localStorage 에 base64 로 보관 → 캐시 hit 시 네트워크 X.
            // fetch 단계에서 content-type/size 검증을 통과한 경우만 캐시되지만,
            // 캐시 데이터 손상 / 브라우저 디코드 실패 등 극단 케이스 폴백용으로 onError 유지.
            // (onError → 캐시 invalidate + placeholder, 다음 mount 에 재시도)
            src={cachedAvatarSrc}
            alt={user.displayName || 'User'}
            className="user-avatar"
            onError={handleAvatarError}
          />
        ) : (
          <div className="user-avatar-placeholder">
            {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
          </div>
        )}
        {getStatusBadge()}
      </button>

      {isOpen && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header">
            <div className="user-info">
              <span className="user-name">{user.displayName || 'User'}</span>
              <span className="user-email">{user.email}</span>
            </div>
          </div>

          <div className="user-menu-status">
            {subscription.status === 'active' && (
              <div className="status-item status-item--pro">
                <span className="status-icon">⭐</span>
                <span>{t('subscription.proActive')}</span>
              </div>
            )}
            {subscription.status === 'trial' && (
              <div className="status-item status-item--trial">
                <span className="status-icon">🎁</span>
                <span>{t('subscription.trialRemaining', { exports: subscription.exportsRemaining, days: subscription.daysRemaining })}</span>
              </div>
            )}
            {subscription.status === 'expired' && (
              <div className="status-item status-item--expired">
                <span className="status-icon">⏰</span>
                <span>{t('subscription.trialExpired')}</span>
              </div>
            )}
          </div>

          <div className="user-menu-actions">
            {(subscription.status === 'trial' || subscription.status === 'expired') && onUpgradeClick && (
              <button
                className="user-menu-item user-menu-item--upgrade"
                onClick={() => { setIsOpen(false); onUpgradeClick() }}
              >
                <span className="menu-icon">⭐</span>
                <span>{t('subscription.upgrade')}</span>
              </button>
            )}
            {subscription.status === 'active' && (
              <button
                className="user-menu-item"
                onClick={handleManageSubscription}
                disabled={portalLoading}
              >
                <span className="menu-icon">{subscription.plan === 'yearly' ? '👑' : '💎'}</span>
                <span>{portalLoading ? t('subscription.loadingPortal') : t('subscription.manageSubscription')}</span>
              </button>
            )}
            <button className="user-menu-item user-menu-item--logout" onClick={handleLogout}>
              <span className="menu-icon">🚪</span>
              <span>{t('subscription.logout')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default UserMenu
