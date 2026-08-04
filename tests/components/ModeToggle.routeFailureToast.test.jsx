import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ModeProvider } from '../../src/contexts/ModeContext.jsx'
import { I18nProvider } from '../../src/hooks/useI18n.jsx'
import ModeToggle from '../../src/components/ModeToggle.jsx'
import { toast } from '../../src/components/Toast.jsx'
import { MODE_STORAGE_KEY, SESSION_TARGET_STORAGE_KEY } from '../../src/config/appRoute.js'

const renderToggle = () => render(
  <I18nProvider>
    <ModeProvider>
      <ModeToggle />
    </ModeProvider>
  </I18nProvider>,
)

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  localStorage.setItem('autoflowcut_lang', 'en')
  localStorage.setItem(MODE_STORAGE_KEY, 'api')
  localStorage.setItem(SESSION_TARGET_STORAGE_KEY, 'flow')
})

describe('ModeToggle route failure feedback', () => {
  it('adopts a successful non-default route without showing an error', async () => {
    const errorToast = vi.spyOn(toast, 'error')
    window.electronAPI = {
      setRoute: vi.fn().mockResolvedValue({
        ok: true,
        route: { mode: 'flow', sessionTarget: 'flow' },
        revision: 29,
      }),
    }
    renderToggle()

    fireEvent.click(screen.getByTestId('mode-toggle-flow'))

    await waitFor(() => {
      expect(screen.getByTestId('mode-toggle-flow')).toHaveAttribute('aria-pressed', 'true')
    })
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('surfaces a rejected mode toggle while preserving the adopted route', async () => {
    const errorToast = vi.spyOn(toast, 'error')
    window.electronAPI = {
      setRoute: vi.fn().mockRejectedValue(new Error('toggle-route-rejected-73')),
    }
    renderToggle()

    fireEvent.click(screen.getByTestId('mode-toggle-flow'))

    await waitFor(() => {
      expect(errorToast).toHaveBeenCalledWith(
        'Could not switch generation mode: toggle-route-rejected-73',
      )
    })
    expect(screen.getByTestId('mode-toggle-api')).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('api')
    expect(localStorage.getItem(SESSION_TARGET_STORAGE_KEY)).toBe('flow')
  })
})
