/**
 * PaywallModal - 결제 유도 모달
 *
 * 체험 기간 만료 또는 횟수 소진 시 표시
 * 월간/연간 플랜 선택 가능
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../contexts/AuthContext'
import { createCheckoutSession, getPricing } from '../firebase/functions'
import { useI18n } from '../hooks/useI18n'
import { useModalVisibility } from '../hooks/useModalVisibility'
import './PaywallModal.css'

export function PaywallModal({ isOpen, onClose, reason = 'trial_expired' }) {
  const { t } = useI18n()
  const { subscription, isAuthenticated } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedInterval, setSelectedInterval] = useState('year') // 기본: 연간 (더 저렴)
  const [prices, setPrices] = useState([
    { priceId: null, amount: 4.99, currency: 'USD', interval: 'month', productName: 'Pro Monthly' },
    { priceId: null, amount: 39.99, currency: 'USD', interval: 'year', productName: 'Pro Yearly' }
  ])

  // 가격 정보 로드
  useEffect(() => {
    if (isOpen) {
      getPricing()
        .then(data => {
          if (data?.prices) {
            setPrices(data.prices)
          }
        })
        .catch(console.error)
    }
  }, [isOpen])

  // 모달 열릴 때 Flow 뷰 숨기기
  useModalVisibility(isOpen)

  if (!isOpen) return null

  const selectedPrice = prices.find(p => p.interval === selectedInterval) || prices[0]
  const monthlyPrice = prices.find(p => p.interval === 'month')
  const yearlyPrice = prices.find(p => p.interval === 'year')

  // 연간 플랜의 월 환산 가격
  const yearlyMonthlyEquivalent = yearlyPrice ? (yearlyPrice.amount / 12).toFixed(2) : '3.33'

  // 할인율 계산
  const discountPercent = monthlyPrice && yearlyPrice
    ? Math.round((1 - (yearlyPrice.amount / 12) / monthlyPrice.amount) * 100)
    : 33

  const handleUpgrade = async () => {
    try {
      setLoading(true)
      setError(null)

      const { url } = await createCheckoutSession({
        priceId: selectedPrice.priceId,
        interval: selectedInterval
      })

      if (url) {
        window.open(url, '_blank')
        onClose()
      }
    } catch (err) {
      console.error('[Paywall] Checkout failed:', err)
      setError(t('paywall.error'))
    } finally {
      setLoading(false)
    }
  }

  const formatPrice = (price) => {
    const symbol = price.currency === 'USD' ? '$' : price.currency
    return `${symbol}${price.amount.toFixed(2)}`
  }

  const getMessage = () => {
    if (reason === 'login_required') {
      return {
        icon: '🔐',
        title: t('paywall.loginRequired'),
        description: t('paywall.loginDescription')
      }
    }

    if (reason === 'trial_expired') {
      const { exportsRemaining, daysRemaining } = subscription

      if (exportsRemaining <= 0 && daysRemaining <= 0) {
        return {
          icon: '⏰',
          title: t('paywall.trialEnded'),
          description: t('paywall.trialEndedDesc')
        }
      }

      if (exportsRemaining <= 0) {
        return {
          icon: '📊',
          title: t('paywall.exportsUsed'),
          description: t('paywall.exportsUsedDesc', { days: daysRemaining })
        }
      }

      if (daysRemaining <= 0) {
        return {
          icon: '📅',
          title: t('paywall.periodExpired'),
          description: t('paywall.periodExpiredDesc', { exports: exportsRemaining })
        }
      }
    }

    return {
      icon: '✨',
      title: t('paywall.upgradeTitle'),
      description: t('paywall.upgradeDesc')
    }
  }

  const message = getMessage()

  return createPortal(
    <div className="paywall-overlay" onClick={onClose}>
      <div className="paywall-modal" onClick={(e) => e.stopPropagation()}>
        <button className="paywall-close" onClick={onClose}>
          &times;
        </button>

        <div className="paywall-header">
          <div className="paywall-icon">{message.icon}</div>
          <h2>{message.title}</h2>
          <p>{message.description}</p>
        </div>

        <div className="paywall-content">
          {/* 플랜 선택 토글 */}
          <div className="paywall-plan-toggle">
            <button
              className={`plan-toggle-btn ${selectedInterval === 'month' ? 'active' : ''}`}
              onClick={() => setSelectedInterval('month')}
            >
              {t('paywall.monthly')}
            </button>
            <button
              className={`plan-toggle-btn ${selectedInterval === 'year' ? 'active' : ''}`}
              onClick={() => setSelectedInterval('year')}
            >
              {t('paywall.yearly')}
              <span className="discount-badge">-{discountPercent}%</span>
            </button>
          </div>

          {/* 선택된 플랜 */}
          <div className="paywall-plan">
            <div className="paywall-plan-header">
              <div className="paywall-plan-price">
                <span className="price-amount">{formatPrice(selectedPrice)}</span>
                <span className="price-period">
                  /{selectedInterval === 'year' ? t('paywall.year') : t('paywall.month')}
                </span>
              </div>
              {selectedInterval === 'year' && (
                <div className="price-monthly-equivalent">
                  ${yearlyMonthlyEquivalent}/{t('paywall.month')}
                </div>
              )}
            </div>

            <ul className="paywall-features">
              <li>
                <span className="feature-check">✓</span>
                <span>{t('paywall.feature1')}</span>
              </li>
              <li>
                <span className="feature-check">✓</span>
                <span>{t('paywall.feature2')}</span>
              </li>
              <li>
                <span className="feature-check">✓</span>
                <span>{t('paywall.feature3')}</span>
              </li>
              <li>
                <span className="feature-check">✓</span>
                <span>{t('paywall.feature4')}</span>
              </li>
            </ul>
          </div>

          {error && (
            <div className="paywall-error">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {reason !== 'login_required' && isAuthenticated && (
            <button
              className="paywall-upgrade-btn"
              onClick={handleUpgrade}
              disabled={loading}
            >
              {loading ? t('paywall.processing') : t('paywall.upgradeBtn')}
            </button>
          )}

          <button className="paywall-later-btn" onClick={onClose}>
            {t('paywall.later')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default PaywallModal
