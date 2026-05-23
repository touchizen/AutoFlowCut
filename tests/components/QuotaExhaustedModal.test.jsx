import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QuotaExhaustedModalProvider } from '../../src/components/QuotaExhaustedModal'
import {
  emitQuotaStop,
  isQuotaBlocked,
  __resetQuotaStopForTests,
} from '../../src/utils/quotaStop'

// useI18n mock — t(key) → key 그대로 통과 (locale 텍스트 의존성 제거)
vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))

beforeEach(() => {
  __resetQuotaStopForTests()
  globalThis.window.electronAPI = { setModalVisible: vi.fn() }
})

afterEach(() => {
  delete globalThis.window.electronAPI
  vi.restoreAllMocks()
})

describe('QuotaExhaustedModal', () => {
  it('starts hidden — Provider mount만으로는 모달이 뜨지 않는다', () => {
    render(<QuotaExhaustedModalProvider><div>child</div></QuotaExhaustedModalProvider>)
    expect(screen.queryByText('quotaExhausted.title')).toBeNull()
  })

  it('emitQuotaStop() 발사 시 모달이 뜨고 메시지/확인 버튼이 보인다', () => {
    render(<QuotaExhaustedModalProvider><div>child</div></QuotaExhaustedModalProvider>)
    act(() => { emitQuotaStop({ stopRequestedRef: { current: false }, scope: 'Test' }) })
    expect(screen.getByText('quotaExhausted.title')).toBeTruthy()
    expect(screen.getByText('quotaExhausted.message')).toBeTruthy()
    expect(screen.getByText('quotaExhausted.ok')).toBeTruthy()
  })

  it('"확인" 클릭 시 모달 닫힘 + quota-block 해제 (다음 enqueue 허용)', () => {
    render(<QuotaExhaustedModalProvider><div>child</div></QuotaExhaustedModalProvider>)
    act(() => { emitQuotaStop({ stopRequestedRef: { current: false }, scope: 'Test' }) })
    expect(isQuotaBlocked()).toBe(true)

    fireEvent.click(screen.getByText('quotaExhausted.ok'))

    expect(screen.queryByText('quotaExhausted.title')).toBeNull()
    expect(isQuotaBlocked()).toBe(false)
  })

  it('같은 stop 안에서 emit 여러 번 와도 modal 은 한 번만 (subscriber idempotent 가드)', () => {
    render(<QuotaExhaustedModalProvider><div>child</div></QuotaExhaustedModalProvider>)
    const stopRef = { current: false }
    act(() => {
      emitQuotaStop({ stopRequestedRef: stopRef, scope: 'T' })
      emitQuotaStop({ stopRequestedRef: stopRef, scope: 'T' })
      emitQuotaStop({ stopRequestedRef: stopRef, scope: 'T' })
    })
    // 모달은 한 번만 떠있음 (3개가 떠있지 않음)
    expect(screen.getAllByText('quotaExhausted.title').length).toBe(1)
  })
})
