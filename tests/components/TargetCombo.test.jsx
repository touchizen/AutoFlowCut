import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '../../src/hooks/useI18n.jsx'
import { ModeProvider } from '../../src/contexts/ModeContext.jsx'
import TargetCombo from '../../src/components/TargetCombo.jsx'
import {
  MODE_STORAGE_KEY,
  SESSION_TARGET_STORAGE_KEY,
} from '../../src/config/appRoute.js'

const toastMocks = vi.hoisted(() => {
  const events = []
  return {
    events,
    error: vi.fn((message) => events.push({ type: 'error', message })),
    warning: vi.fn((message) => events.push({ type: 'limitations', message })),
  }
})

vi.mock('../../src/components/Toast', () => ({
  toast: {
    error: toastMocks.error,
    warning: toastMocks.warning,
  },
}))

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function setStoredTarget(sessionTarget) {
  localStorage.setItem(MODE_STORAGE_KEY, 'flow')
  localStorage.setItem(SESSION_TARGET_STORAGE_KEY, sessionTarget)
  localStorage.setItem('autoflowcut_lang', 'en')
}

function renderCombo({
  enabled = true,
  busy = false,
  authReadyByTarget = { flow: true, chatgpt: false },
  onRouteRequest = null,
} = {}) {
  return render(
    <I18nProvider>
      <ModeProvider>
        <TargetCombo
          enabled={enabled}
          busy={busy}
          authReadyByTarget={authReadyByTarget}
          onRouteRequest={onRouteRequest}
        />
      </ModeProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  toastMocks.events.length = 0
  vi.clearAllMocks()
  window.electronAPI = {
    setLocale: vi.fn(),
    setRoute: vi.fn(),
    setMode: vi.fn(),
  }
})

afterEach(() => {
  cleanup()
  delete window.electronAPI
})

describe('TargetCombo dev gate and auth chips', () => {
  it('renders no control with the flag off and renders the full control with a flag-on positive control', () => {
    setStoredTarget('flow')
    const view = renderCombo({ enabled: false })
    expect(screen.queryByTestId('target-combo')).toBeNull()

    view.rerender(
      <I18nProvider>
        <ModeProvider>
          <TargetCombo
            enabled
            authReadyByTarget={{ flow: true, chatgpt: false }}
          />
        </ModeProvider>
      </I18nProvider>,
    )

    expect(screen.getByTestId('target-combo')).toBeInTheDocument()
    expect(screen.getByTestId('target-combo-current-label')).toHaveTextContent('Google Flow')
  })

  it('shows current-target auth and both target-specific chips in the dropdown', () => {
    setStoredTarget('chatgpt')
    renderCombo({ authReadyByTarget: { flow: true, chatgpt: false } })

    expect(screen.getByTestId('target-auth-chip-current')).toHaveTextContent('Login required')
    expect(screen.getByTestId('target-auth-chip-flow')).toHaveTextContent('Logged in')
    expect(screen.getByTestId('target-auth-chip-chatgpt')).toHaveTextContent('Login required')
  })
})

describe('TargetCombo transactional switching', () => {
  it('stays on non-default ChatGPT until setRoute returns the adopted Flow route, without setMode', async () => {
    setStoredTarget('chatgpt')
    const pending = deferred()
    window.electronAPI.setRoute.mockImplementation(() => pending.promise)
    renderCombo()

    fireEvent.change(screen.getByTestId('target-combo-trigger'), { target: { value: 'flow' } })

    expect(window.electronAPI.setRoute).toHaveBeenCalledWith({ mode: 'flow', sessionTarget: 'flow' })
    expect(window.electronAPI.setMode).not.toHaveBeenCalled()
    expect(screen.getByTestId('target-combo-current-label')).toHaveTextContent('ChatGPT')
    expect(localStorage.getItem(SESSION_TARGET_STORAGE_KEY)).toBe('chatgpt')

    await act(async () => {
      pending.resolve({
        ok: true,
        route: { mode: 'flow', sessionTarget: 'flow' },
        revision: 8,
      })
      await pending.promise
    })

    await waitFor(() => expect(screen.getByTestId('target-combo-current-label')).toHaveTextContent('Google Flow'))
    expect(localStorage.getItem(SESSION_TARGET_STORAGE_KEY)).toBe('flow')
  })

  it('keeps non-default ChatGPT selected and surfaces the main rejection, with success as a positive control', async () => {
    setStoredTarget('chatgpt')
    window.electronAPI.setRoute
      .mockResolvedValueOnce({
        ok: false,
        error: 'route-quiesce-failed',
        route: { mode: 'flow', sessionTarget: 'chatgpt' },
        revision: 4,
      })
      .mockResolvedValueOnce({
        ok: true,
        route: { mode: 'flow', sessionTarget: 'flow' },
        revision: 5,
      })
    renderCombo()

    fireEvent.change(screen.getByTestId('target-combo-trigger'), { target: { value: 'flow' } })

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith(
      expect.stringContaining('route-quiesce-failed'),
    ))
    expect(screen.getByTestId('target-combo-current-label')).toHaveTextContent('ChatGPT')
    expect(localStorage.getItem(SESSION_TARGET_STORAGE_KEY)).toBe('chatgpt')

    fireEvent.change(screen.getByTestId('target-combo-trigger'), { target: { value: 'flow' } })
    await waitFor(() => expect(screen.getByTestId('target-combo-current-label')).toHaveTextContent('Google Flow'))
  })

  it('is disabled while busy and calls setRoute when rerendered idle as a positive control', async () => {
    setStoredTarget('chatgpt')
    window.electronAPI.setRoute.mockResolvedValue({
      ok: true,
      route: { mode: 'flow', sessionTarget: 'flow' },
      revision: 2,
    })
    const view = renderCombo({ busy: true })

    expect(screen.getByTestId('target-combo-trigger')).toBeDisabled()
    fireEvent.change(screen.getByTestId('target-combo-trigger'), { target: { value: 'flow' } })
    expect(window.electronAPI.setRoute).not.toHaveBeenCalled()

    view.rerender(
      <I18nProvider>
        <ModeProvider>
          <TargetCombo
            enabled
            busy={false}
            authReadyByTarget={{ flow: true, chatgpt: false }}
          />
        </ModeProvider>
      </I18nProvider>,
    )
    fireEvent.change(screen.getByTestId('target-combo-trigger'), { target: { value: 'flow' } })
    await waitFor(() => expect(window.electronAPI.setRoute).toHaveBeenCalledOnce())
  })

  it('states only the encoded ChatGPT limitations before requesting that target', async () => {
    setStoredTarget('flow')
    window.electronAPI.setRoute.mockImplementation(async () => {
      toastMocks.events.push({ type: 'setRoute' })
      return {
        ok: false,
        error: 'test-stop',
        route: { mode: 'flow', sessionTarget: 'flow' },
      }
    })
    renderCombo()

    fireEvent.change(screen.getByTestId('target-combo-trigger'), { target: { value: 'chatgpt' } })

    await waitFor(() => expect(window.electronAPI.setRoute).toHaveBeenCalledOnce())
    expect(toastMocks.events.slice(0, 2).map(({ type }) => type)).toEqual([
      'limitations',
      'setRoute',
    ])
    const notice = toastMocks.events[0].message
    expect(notice).toMatch(/reference upload support has not been measured/i)
    expect(notice).toMatch(/one image per request/i)
    expect(notice).toMatch(/fixed seed/i)
  })
})
