/**
 * UserMenu - 사용자 메뉴 컴포넌트
 *
 * 로그인된 사용자 정보, 구독 상태, 로그아웃 버튼
 */

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { createPortalSession } from '../firebase/functions'
import { useI18n } from '../hooks/useI18n'
import './UserMenu.css'

export function UserMenu({ onLoginClick, onUpgradeClick }) {
  const { t } = useI18n()
  const { user, isAuthenticated, subscription, logout, loading } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const menuRef = useRef(null)

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
      return <span className="user-badge user-badge--pro">PRO</span>
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
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt={user.displayName || 'User'}
            className="user-avatar"
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
