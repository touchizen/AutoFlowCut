import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RecaptchaModal from '../../src/components/RecaptchaModal'

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
    const { container } = render(<RecaptchaModal open={false} t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows auto-resume title with minutes when open', () => {
    render(<RecaptchaModal open mode="auto" waitMs={300000} onClose={() => {}} t={t} />)
    expect(screen.getByText(/paused 5/)).toBeTruthy()
  })

  it('shows manual title when mode=manual', () => {
    render(<RecaptchaModal open mode="manual" onClose={() => {}} t={t} />)
    expect(screen.getByText('manual')).toBeTruthy()
  })

  it('confirm button calls onClose', () => {
    const onClose = vi.fn()
    render(<RecaptchaModal open mode="auto" waitMs={300000} onClose={onClose} t={t} />)
    fireEvent.click(screen.getByText('OK'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
