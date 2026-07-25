/**
 * PaywallModal — 결제 모달을 열면 월간 요금이 먼저 보여야 한다.
 *
 * 기본 선택이 연간이면 사용자가 처음 보는 금액이 $99.99 라 부담스럽게 읽힌다.
 * 월간($9.99)을 기본으로 두고, 연간은 사용자가 토글로 고르게 한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ subscription: { status: 'active', canExport: true }, isAuthenticated: true }),
}))

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (key) => key, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (key) => key, lang: 'en', setLang: vi.fn() }),
}))

vi.mock('../../src/firebase/functions', () => ({
  createCheckoutSession: vi.fn(),
  // 실제 가격표가 도착해도 기본 선택은 월간이어야 한다.
  getPricing: vi.fn().mockResolvedValue({
    prices: [
      { priceId: 'price_m', amount: 9.99, currency: 'USD', interval: 'month', productName: 'Pro Monthly' },
      { priceId: 'price_y', amount: 99.99, currency: 'USD', interval: 'year', productName: 'Pro Yearly' },
    ],
  }),
}))

import { PaywallModal } from '../../src/components/PaywallModal'

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.window = globalThis.window || {}
  window.electronAPI = { setModalVisible: vi.fn() }
})
afterEach(() => { delete window.electronAPI })

const priceAmount = () => document.querySelector('.price-amount')?.textContent
const toggleBtn = (i18nKey) => screen.getByText(i18nKey).closest('.plan-toggle-btn')

describe('PaywallModal 기본 요금 주기', () => {
  it('열자마자 월간 금액(9.99)을 보여준다 — 연간(99.99) 아님', () => {
    render(<PaywallModal isOpen onClose={vi.fn()} reason="trial_expired" />)
    expect(priceAmount()).toContain('9.99')
    expect(priceAmount()).not.toContain('99.99')
  })

  it('월간 토글이 처음부터 선택(active)되어 있다', () => {
    render(<PaywallModal isOpen onClose={vi.fn()} reason="trial_expired" />)
    expect(toggleBtn('paywall.monthly').classList.contains('active')).toBe(true)
    expect(toggleBtn('paywall.yearly').classList.contains('active')).toBe(false)
  })

  it('기본이 월간이라 연간에만 붙는 월 환산 안내는 처음엔 없다', () => {
    render(<PaywallModal isOpen onClose={vi.fn()} reason="trial_expired" />)
    expect(document.querySelector('.price-monthly-equivalent')).toBeNull()
  })

  it('연간을 고르면 연간 금액으로 바뀐다(토글은 그대로 동작)', () => {
    render(<PaywallModal isOpen onClose={vi.fn()} reason="trial_expired" />)
    fireEvent.click(toggleBtn('paywall.yearly'))
    expect(priceAmount()).toContain('99.99')
    expect(toggleBtn('paywall.yearly').classList.contains('active')).toBe(true)
    expect(document.querySelector('.price-monthly-equivalent')).toBeTruthy()
  })
})
