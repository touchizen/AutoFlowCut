import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModeProvider } from '../../src/contexts/ModeContext'
import { I18nProvider } from '../../src/hooks/useI18n'
import ModeGate from '../../src/components/ModeGate'
import { MODE_STORAGE_KEY } from '../../src/hooks/useAppMode'

beforeEach(() => {
  localStorage.clear()
  window.electronAPI = { setModalVisible: () => Promise.resolve({ ok: true }) }
})

function renderGate() {
  return render(
    <I18nProvider>
      <ModeProvider>
        <ModeGate>
          <div data-testid="app-root">APP</div>
        </ModeGate>
      </ModeProvider>
    </I18nProvider>
  )
}

describe('ModeGate', () => {
  it('shows the picker (not the app) when no mode is chosen', () => {
    renderGate()
    expect(screen.getByTestId('mode-selector')).toBeTruthy()
    expect(screen.queryByTestId('app-root')).toBe(null)
  })

  it('renders the app once a mode is chosen and persists it', () => {
    renderGate()
    fireEvent.click(screen.getByTestId('mode-select-api'))
    expect(screen.getByTestId('app-root')).toBeTruthy()
    expect(screen.queryByTestId('mode-selector')).toBe(null)
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('api')
  })

  it('hides the Flow native view while the picker is shown', () => {
    const setModalVisible = vi.fn(() => Promise.resolve({ ok: true }))
    window.electronAPI = { setModalVisible }
    renderGate()
    // 피커는 모달 성격 — Flow WebContentsView(네이티브 레이어)가 DOM 위를 가리지 않게 숨김 요청
    expect(setModalVisible).toHaveBeenCalledWith({ visible: true })
  })

  it('restores the Flow native view once a mode is chosen', () => {
    const setModalVisible = vi.fn(() => Promise.resolve({ ok: true }))
    window.electronAPI = { setModalVisible }
    renderGate()
    setModalVisible.mockClear()
    fireEvent.click(screen.getByTestId('mode-select-api'))
    expect(setModalVisible).toHaveBeenCalledWith({ visible: false })
  })

  it('renders the app directly when a mode is already persisted', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'flow')
    renderGate()
    expect(screen.getByTestId('app-root')).toBeTruthy()
    expect(screen.queryByTestId('mode-selector')).toBe(null)
  })
})
