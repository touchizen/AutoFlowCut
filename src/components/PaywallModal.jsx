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

  // 실제 paywall 을 그릴지 여부 — useModalVisibility 보다 먼저 계산해야 한다.
  // 'loading'/'error' 인 상태에서 isOpen 만 true 로 useModalVisibility 를 켜면
  // Flow WebContentsView 는 숨겨지는데 모달은 return null 로 안 그려져서
  // X 버튼/오버레이가 없어 사용자가 닫을 길이 없고 Flow 뷰가 영구 숨김 상태로 갇힌다.
  //
  // Defense in depth — useExport gateway 가 'loading'/'error' 에선 paywall 을 안 띄우지만,
  // 다른 경로로 onPaywallRequired 가 호출돼도 0/0 garbage 메시지가 새지 않게 차단.
  //   - 'loading': fresh 해진 뒤 다시 트리거되어야 정확한 메시지 노출됨
  //   - 'error':   재시도/에러 토스트 경로로 처리되어야 함 (paywall 이 아님)
  const blockedBySubscriptionState =
    subscription?.status === 'loading' || subscription?.status === 'error'
  const shouldShowPaywall = isOpen && !blockedBySubscriptionState

  // 가격 정보 로드 — 실제로 모달을 그릴 때만 필요
  useEffect(() => {
    if (shouldShowPaywall) {
      getPricing()
        .then(data => {
          if (data?.prices) {
            setPrices(data.prices)
          }
        })
        .catch(console.error)
    }
  }, [shouldShowPaywall])

  // 모달 열릴 때 Flow 뷰 숨기기 — shouldShowPaywall 로 게이트해서
  // 'loading'/'error' 윈도우에 Flow 뷰가 숨겨진 채 모달 UI 가 비어버리는 stuck 상태 방지
  useModalVisibility(shouldShowPaywall)

  if (!shouldShowPaywall) return null

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
