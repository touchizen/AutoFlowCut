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
    t: (k) => ({
      'header.apiKey': 'API 키',
      'header.flowLogin': '로그인',
      'header.login': 'SHARED_LOGIN',
      'header.checking': '확인 중',
      'header.authenticated': '인증됨',
      'header.unavailable': '지원 안 됨',
      'header.waitingLogin': '로그인 대기',
      'toast.flowLoginHint': 'Flow 창에서 로그인',
    }[k] || k),
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

describe('Header workflow entry label', () => {
  beforeEach(() => {
    mockMode = 'api'
    window.electronAPI = { onFlowStatus: vi.fn().mockReturnValue(() => {}) }
  })

  it('story project는 Story 진입점으로 표시한다', () => {
    render(
      <Header
        onSettings={vi.fn()}
        authReady={true}
        workflowType="story"
        onStoryClick={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /📖 Story/ })).toBeTruthy()
  })

  it('shopping-short project는 쇼핑 숏츠 진입점으로 표시한다', () => {
    render(
      <Header
        onSettings={vi.fn()}
        authReady={true}
        workflowType="shopping-short"
        onStoryClick={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /🛍 쇼핑 숏츠/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /📖 Story/ })).toBeNull()
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

    const btn = screen.getByRole('button', { name: /API 키/i })
    fireEvent.click(btn)

    expect(onSettings).toHaveBeenCalledWith('apiKey')
  })

  it('Flow mode: unauth button is labeled Login, not API Key', () => {
    mockMode = 'flow'
    renderHeader()

    expect(screen.getByRole('button', { name: /로그인/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /API 키/i })).toBeNull()
  })

  it('API mode: unauth button is labeled API Key, not shared Login', () => {
    renderHeader()

    expect(screen.getByRole('button', { name: /API 키/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /SHARED_LOGIN/i })).toBeNull()
  })

  it('API mode: unauth button does NOT dispatch flow-login-expired', () => {
    const listener = vi.fn()
    window.addEventListener('flow-login-expired', listener)
    const onSettings = vi.fn()
    renderHeader(onSettings)

    fireEvent.click(screen.getByRole('button', { name: /API 키/i }))

    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener('flow-login-expired', listener)
  })

  it('Flow mode: unauth button calls electronAPI.setMode (NOT flow-login-expired) (#R6-9)', async () => {
    mockMode = 'flow'
    const listener = vi.fn()
    window.addEventListener('flow-login-expired', listener)
    const onSettings = vi.fn()
    renderHeader(onSettings)

    fireEvent.click(screen.getByRole('button', { name: /로그인/i }))

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

    fireEvent.click(screen.getByRole('button', { name: /로그인/i }))

    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1))
  })

  it('Flow mode: unauth button does NOT call onSettings("apiKey")', () => {
    mockMode = 'flow'
    const onSettings = vi.fn()
    renderHeader(onSettings)

    fireEvent.click(screen.getByRole('button', { name: /로그인/i }))

    expect(onSettings).not.toHaveBeenCalledWith('apiKey')
  })
})
