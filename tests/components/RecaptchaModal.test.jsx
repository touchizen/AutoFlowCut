import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RecaptchaModal from '../../src/components/RecaptchaModal'

// useModalVisibility mock — window.electronAPI 미정의 환경 안전
beforeEach(() => {
  globalThis.window.electronAPI = { setModalVisible: vi.fn() }
})

const t = (key, vars = {}) =>
  ({
    'recaptcha.title': `paused ${vars.min}`,
    'recaptcha.titleManual': 'manual',
    'recaptcha.body': `body ${vars.min}`,
    'recaptcha.bodyManual': 'body manual',
    'recaptcha.countdown': `cd ${vars.time}`,
    'recaptcha.confirm': 'OK',
  }[key] || key)

describe('RecaptchaModal', () => {
  it('renders nothing when closed', () => {
    render(<RecaptchaModal open={false} t={t} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows auto-resume title with minutes when open', () => {
    render(<RecaptchaModal open mode="auto" waitMs={300000} onClose={() => {}} t={t} />)
    expect(screen.getByText(/paused 5/)).toBeTruthy()
  })

  it('shows manual title when mode=manual', () => {
    render(<RecaptchaModal open mode="manual" onClose={() => {}} t={t} />)
    expect(screen.getByText('manual')).toBeTruthy()
  })

  it('confirm button calls onClose AND hides the modal locally without changing parent open prop', () => {
    const onClose = vi.fn()
    render(<RecaptchaModal open mode="auto" waitMs={300000} onClose={onClose} t={t} />)
    fireEvent.click(screen.getByText('OK'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('useModalVisibility is invoked while visible', () => {
    render(<RecaptchaModal open mode="auto" waitMs={300000} onClose={() => {}} t={t} />)
    expect(window.electronAPI.setModalVisible).toHaveBeenCalledWith({ visible: true })
  })
})
