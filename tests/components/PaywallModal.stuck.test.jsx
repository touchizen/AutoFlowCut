/**
 * PaywallModal — Flow WebContentsView 영구 숨김 stuck state 회귀 방지
 *
 * 시나리오: isOpen=true 인데 subscription.status === 'loading' / 'error' 인 경우.
 *   잘못 짜면 useModalVisibility(isOpen) 가 먼저 동작해 Flow 뷰를 숨기고,
 *   그 다음 컴포넌트가 return null 로 모달 UI 를 안 그려서 사용자가 닫을 길이 없다.
 *   → setModalVisible({ visible: true }) 가 절대 호출되면 안 된다 (paywall 비표시 시).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'

// useAuth 모킹 — subscription 상태를 테스트별로 주입
const mockSubscription = vi.fn()
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({
    subscription: mockSubscription(),
    isAuthenticated: true
  })
}))

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (key) => key, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (key) => key, lang: 'en', setLang: vi.fn() })
}))

vi.mock('../../src/firebase/functions', () => ({
  createCheckoutSession: vi.fn(),
  getPricing: vi.fn().mockResolvedValue({ prices: [] })
}))

import { PaywallModal } from '../../src/components/PaywallModal'

const setModalVisibleSpy = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  setModalVisibleSpy.mockClear()
  // electronAPI.setModalVisible 가 useModalVisibility 가 호출하는 IPC
  globalThis.window = globalThis.window || {}
  window.electronAPI = {
    setModalVisible: (...args) => setModalVisibleSpy(...args)
  }
})

afterEach(() => {
  delete window.electronAPI
})

describe('PaywallModal — Flow webview stuck state 방지', () => {
  it('isOpen=true + subscription.status="loading" 이면 setModalVisible 호출 안 함 (Flow 뷰 숨김 안 됨)', () => {
    mockSubscription.mockReturnValue({ status: 'loading', canExport: false })

    render(<PaywallModal isOpen={true} onClose={vi.fn()} reason="trial_expired" />)

    // Flow 뷰가 숨겨지면 모달이 안 그려져 사용자가 닫을 길이 없다 → 숨김 자체를 막아야 함
    expect(setModalVisibleSpy).not.toHaveBeenCalled()
  })

  it('isOpen=true + subscription.status="error" 이면 setModalVisible 호출 안 함', () => {
    mockSubscription.mockReturnValue({ status: 'error', canExport: false, isExpired: true })

    render(<PaywallModal isOpen={true} onClose={vi.fn()} reason="trial_expired" />)

    expect(setModalVisibleSpy).not.toHaveBeenCalled()
  })

  it('isOpen=true + subscription.status="expired" (정상 paywall 케이스) 이면 setModalVisible({visible:true}) 호출됨', () => {
    mockSubscription.mockReturnValue({
      status: 'expired',
      canExport: false,
      exportsRemaining: 0,
      daysRemaining: 0,
      isExpired: true
    })

    render(<PaywallModal isOpen={true} onClose={vi.fn()} reason="trial_expired" />)

    expect(setModalVisibleSpy).toHaveBeenCalledWith({ visible: true })
  })

  it('isOpen=false 이면 어떤 상태에서도 setModalVisible 호출 안 함', () => {
    mockSubscription.mockReturnValue({ status: 'expired', canExport: false, exportsRemaining: 0, daysRemaining: 0, isExpired: true })

    render(<PaywallModal isOpen={false} onClose={vi.fn()} reason="trial_expired" />)

    expect(setModalVisibleSpy).not.toHaveBeenCalled()
  })
})
