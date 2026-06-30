/**
 * #R5-3 / #R6-9 — Header unauth action is mode-aware.
 *
 * API mode  → clicking the unauth button opens apiKey settings (onSettings('apiKey')).
 * Flow mode → clicking the unauth button calls electronAPI.setMode + setLayout + shows toast.
 *             Does NOT dispatch 'flow-login-expired'. Does NOT call onSettings('apiKey').
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../src/hooks/useI18n', () => ({
  useI18n: () => ({
    t: (k) => k,
    lang: 'ko',
    changeLang: vi.fn(),
    languages: [{ code: 'ko', name: 'KO', country: 'kr' }],
  }),
  LANGUAGES: [{ code: 'ko', name: 'KO', country: 'kr' }],
}))

vi.mock('../../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { listProjects: vi.fn().mockResolvedValue({ success: true, projects: [] }) },
}))

vi.mock('../../../src/components/UserMenu', () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}))

vi.mock('../../../src/components/ModeToggle', () => ({
  default: () => <div data-testid="mode-toggle" />,
}))

vi.mock('../../../src/components/SideDrawer', () => ({
  SideDrawer: () => <div data-testid="side-drawer" />,
}))

vi.mock('../../../src/components/Modal', () => ({
  default: ({ isOpen, children, footer }) =>
    isOpen ? <div data-testid="modal">{children}{footer}</div> : null,
}))

vi.mock('../../../src/components/ExportSplitButton', () => ({
  default: () => <div data-testid="export-btn" />,
}))

const toastInfo = vi.fn()
vi.mock('../../../src/components/Toast', () => ({
  toast: { info: (...a) => toastInfo(...a) },
}))

// ModeContext mock — mode is injectable via module-level variable.
let mockMode = 'api'
vi.mock('../../../src/contexts/ModeContext', () => ({
  useMode: () => ({ mode: mockMode }),
}))

import Header from '../../../src/components/Header'

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderHeader(onSettings = vi.fn()) {
  return render(
    <Header
      onSettings={onSettings}
      authReady={false}   // forces 'unauthenticated' state → shows unauth button
      onAuthRecovered={vi.fn()}
    />
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Header project selector — disabled contract (#R26-2/#R26-3)', () => {
  beforeEach(() => {
    mockMode = 'api'
    window.electronAPI = { setMode: vi.fn(), setLayout: vi.fn(), onFlowStatus: vi.fn().mockReturnValue(() => {}) }
  })

  function renderWithDisabled(disabled) {
    return render(
      <Header
        onSettings={vi.fn()} authReady={true} onAuthRecovered={vi.fn()}
        saveMode="folder" projectName="myproj" projects={['myproj', 'other']}
        onProjectChange={vi.fn()} disabled={disabled}
      />
    )
  }

  it('project switch button is disabled when disabled=true (busy state blocks project switch)', () => {
    renderWithDisabled(true)
    const btn = screen.getByText('myproj').closest('button')
    expect(btn).toBeDisabled()
  })

  it('project switch button is enabled when disabled=false', () => {
    renderWithDisabled(false)
    const btn = screen.getByText('myproj').closest('button')
    expect(btn).not.toBeDisabled()
  })
})

describe('Header auth action — mode-aware (#R5-3 / #R6-9)', () => {
  beforeEach(() => {
    mockMode = 'api'
    toastInfo.mockClear()
    // Reset electronAPI stubs
    window.electronAPI = {
      setMode: vi.fn(),
      setLayout: vi.fn(),
      onFlowStatus: vi.fn().mockReturnValue(() => {}),
    }
  })

  it('API mode: unauth button calls onSettings("apiKey")', () => {
    const onSettings = vi.fn()
    renderHeader(onSettings)

    // The unauth button shows a key icon and 'header.login' text
    const btn = screen.getByRole('button', { name: /header\.login/i })
    fireEvent.click(btn)

    expect(onSettings).toHaveBeenCalledWith('apiKey')
  })

  it('API mode: unauth button does NOT dispatch flow-login-expired', () => {
    const listener = vi.fn()
    window.addEventListener('flow-login-expired', listener)
    const onSettings = vi.fn()
    renderHeader(onSettings)

    fireEvent.click(screen.getByRole('button', { name: /header\.login/i }))

    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener('flow-login-expired', listener)
  })

  it('Flow mode: unauth button calls electronAPI.setMode (NOT flow-login-expired) (#R6-9)', async () => {
    mockMode = 'flow'
    const listener = vi.fn()
    window.addEventListener('flow-login-expired', listener)
    const onSettings = vi.fn()
    renderHeader(onSettings)

    fireEvent.click(screen.getByRole('button', { name: /header\.login/i }))

    // #R14-10: openFlow 가 setMode/setLayout 을 await 하므로 microtask flush 후 검증.
    // Must call setMode to re-attach Flow WebContentsView
    await waitFor(() => expect(window.electronAPI.setMode).toHaveBeenCalledWith({ mode: 'flow' }))
    // Must call setLayout to show the split pane — 기본 split-left (Flow 왼쪽, Shell split 복원)
    await waitFor(() => expect(window.electronAPI.setLayout).toHaveBeenCalledWith({ mode: 'split-left', ratio: 0.5 }))
    // Must NOT dispatch the ignored event
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener('flow-login-expired', listener)
  })

  it('Flow mode: unauth button shows toast hint (#R6-9)', async () => {
    mockMode = 'flow'
    renderHeader()

    fireEvent.click(screen.getByRole('button', { name: /header\.login/i }))

    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1))
  })

  it('Flow mode: unauth button does NOT call onSettings("apiKey")', () => {
    mockMode = 'flow'
    const onSettings = vi.fn()
    renderHeader(onSettings)

    fireEvent.click(screen.getByRole('button', { name: /header\.login/i }))

    expect(onSettings).not.toHaveBeenCalledWith('apiKey')
  })
})
