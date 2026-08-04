import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModeProvider } from '../../src/contexts/ModeContext'
import { I18nProvider } from '../../src/hooks/useI18n'
import ModeToggle from '../../src/components/ModeToggle'
import { MODE_STORAGE_KEY } from '../../src/hooks/useAppMode'
import en from '../../src/locales/en'

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('autoflowcut_lang', 'en')
})

function renderWithProvider(props = {}) {
  return render(<I18nProvider><ModeProvider><ModeToggle {...props} /></ModeProvider></I18nProvider>)
}

describe('ModeToggle', () => {
  it('renders nothing until a mode is chosen', () => {
    renderWithProvider()
    expect(screen.queryByTestId('mode-toggle-api')).toBe(null)
  })

  it('segment labels are the short literals, not the localized long names', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'flow')
    renderWithProvider()
    // 세그먼트 토글은 컴팩트 리터럴만 — 긴 이름(nameKey)은 툴팁/피커 전용.
    expect(screen.getByTestId('mode-toggle-api').textContent).toBe('API')
    expect(screen.getByTestId('mode-toggle-flow').textContent).toBe('Flow')
    expect(screen.queryByText(en.modeInfo.flow.name)).toBe(null)
    expect(screen.queryByText(en.modeInfo.api.name)).toBe(null)
  })

  it('shows the active mode and switches on click', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'api')
    renderWithProvider()
    const apiBtn = screen.getByTestId('mode-toggle-api')
    const flowBtn = screen.getByTestId('mode-toggle-flow')
    expect(apiBtn.getAttribute('aria-pressed')).toBe('true')
    expect(flowBtn.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(flowBtn)
    expect(screen.getByTestId('mode-toggle-flow').getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('flow')
  })

  describe('busy prop', () => {
    it('when busy=false (default), inactive button is NOT disabled', () => {
      localStorage.setItem(MODE_STORAGE_KEY, 'api')
      renderWithProvider({ busy: false })
      const flowBtn = screen.getByTestId('mode-toggle-flow')
      expect(flowBtn.disabled).toBe(false)
    })

    it('when busy=true, the inactive-mode button is disabled', () => {
      localStorage.setItem(MODE_STORAGE_KEY, 'api')
      renderWithProvider({ busy: true })
      const flowBtn = screen.getByTestId('mode-toggle-flow')
      expect(flowBtn.disabled).toBe(true)
    })

    it('when busy=true, the active-mode button is NOT disabled', () => {
      localStorage.setItem(MODE_STORAGE_KEY, 'api')
      renderWithProvider({ busy: true })
      const apiBtn = screen.getByTestId('mode-toggle-api')
      expect(apiBtn.disabled).toBe(false)
    })

    it('when busy=true, clicking the inactive button does NOT switch mode', () => {
      localStorage.setItem(MODE_STORAGE_KEY, 'api')
      renderWithProvider({ busy: true })
      const flowBtn = screen.getByTestId('mode-toggle-flow')
      fireEvent.click(flowBtn)
      // mode must remain 'api'
      expect(screen.getByTestId('mode-toggle-api').getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByTestId('mode-toggle-flow').getAttribute('aria-pressed')).toBe('false')
      expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('api')
    })

    it('when busy=true, inactive button has the busy tooltip title', () => {
      localStorage.setItem(MODE_STORAGE_KEY, 'api')
      renderWithProvider({ busy: true })
      const flowBtn = screen.getByTestId('mode-toggle-flow')
      expect(flowBtn.title).toBe(en.modeInfo.busySwitch)
    })

    it('when not busy, each button shows its mode pros/cons as a multiline tooltip', () => {
      localStorage.setItem(MODE_STORAGE_KEY, 'api')
      renderWithProvider({ busy: false })
      const apiBtn = screen.getByTestId('mode-toggle-api')
      const flowBtn = screen.getByTestId('mode-toggle-flow')
      expect(apiBtn.title).toContain(en.modeInfo.api.name)
      expect(apiBtn.title).toContain(en.modeInfo.api.speed)
      expect(flowBtn.title).toContain(en.modeInfo.flow.name)
      expect(flowBtn.title).toContain('\n') // multiline
    })

    it('when not busy, switching works normally', () => {
      localStorage.setItem(MODE_STORAGE_KEY, 'flow')
      renderWithProvider({ busy: false })
      const apiBtn = screen.getByTestId('mode-toggle-api')
      expect(apiBtn.disabled).toBe(false)
      fireEvent.click(apiBtn)
      expect(screen.getByTestId('mode-toggle-api').getAttribute('aria-pressed')).toBe('true')
      expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('api')
    })
  })
})
