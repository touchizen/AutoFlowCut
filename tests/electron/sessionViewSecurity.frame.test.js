import { describe, it, expect, vi } from 'vitest'
import { installReservedSessionSecurity } from '../../electron/sessionViewSecurity.js'

const ALLOWED_ORIGINS = ['https://target.example', 'https://auth.target.example']

function fakeView() {
  const listeners = new Map()
  return {
    listeners,
    webContents: {
      on: vi.fn((name, fn) => listeners.set(name, fn)),
      setWindowOpenHandler: vi.fn(),
    },
  }
}

const electronSession = () => ({
  setPermissionRequestHandler: vi.fn(),
  setPermissionCheckHandler: vi.fn(),
})

const install = (view, session) => (
  installReservedSessionSecurity(view, session, { allowedOrigins: ALLOWED_ORIGINS })
)

describe('session view subframe navigation guard', () => {
  it('prevents an off-origin subframe before it navigates', () => {
    const view = fakeView()
    install(view, electronSession())
    const details = { url: 'https://evil.example/frame', isMainFrame: false, preventDefault: vi.fn() }

    view.listeners.get('will-frame-navigate')(details)

    expect(details.preventDefault).toHaveBeenCalledOnce()
  })

  it('allows only an exact allowlisted subframe origin', () => {
    const view = fakeView()
    install(view, electronSession())
    const allowed = { url: 'https://target.example/backend-api/', isMainFrame: false, preventDefault: vi.fn() }
    const lookalike = { url: 'https://target.example.evil.example/', isMainFrame: false, preventDefault: vi.fn() }

    view.listeners.get('will-frame-navigate')(allowed)
    view.listeners.get('will-frame-navigate')(lookalike)

    expect(allowed.preventDefault).not.toHaveBeenCalled()
    expect(lookalike.preventDefault).toHaveBeenCalledOnce()
  })

  it('allows an allowlisted main-frame login navigation with the real one-object signature', () => {
    const view = fakeView()
    install(view, electronSession())
    const details = { url: 'https://target.example/auth/login', isMainFrame: true, preventDefault: vi.fn() }

    view.listeners.get('will-frame-navigate')(details)

    expect(details.preventDefault).not.toHaveBeenCalled()
  })

  it('logs only the blocked origin, never its signed path/query', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = fakeView()
    install(view, electronSession())
    const details = { url: 'https://evil.example/private/file?sig=SECRET#fragment', isMainFrame: false, preventDefault: vi.fn() }
    view.listeners.get('will-frame-navigate')(details)
    expect(JSON.stringify(warn.mock.calls)).toContain('https://evil.example')
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|SECRET|fragment/)
  })
})
