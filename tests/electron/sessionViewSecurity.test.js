// tests/electron/sessionViewSecurity.test.js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  reservedSessionWebPreferences,
  isReservedNavigationAllowed, installReservedSessionSecurity,
} from '../../electron/sessionViewSecurity.js'

const ALLOWED_ORIGINS = ['https://target.example', 'https://auth.target.example']

describe('reserved session view security', () => {
  it('uses isolated persistent storage and never copies Flow preload/security exceptions', () => {
    const prefs = reservedSessionWebPreferences('persist:reserved-target')
    expect(prefs).toEqual({
      partition: 'persist:reserved-target', contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true,
    })
    expect(prefs).not.toHaveProperty('preload')
  })

  it('refuses to build preferences without an explicit partition', () => {
    expect(() => reservedSessionWebPreferences()).toThrow(TypeError)
    expect(() => reservedSessionWebPreferences('')).toThrow(TypeError)
  })

  it.each([
    ['https://target.example/', true],
    ['https://target.example/auth/callback', true],
    ['https://auth.target.example/authorize', true],
    ['https://evil.example/target.example', false],
    ['file:///tmp/token', false],
  ])('navigation allowlist %s → %s', (url, allowed) => {
    expect(isReservedNavigationAllowed(url, ALLOWED_ORIGINS)).toBe(allowed)
  })

  it('fails closed when no allowlist is provided', () => {
    expect(isReservedNavigationAllowed('https://target.example/')).toBe(false)
    expect(() => installReservedSessionSecurity(
      { webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() } },
      { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
    )).toThrow(TypeError)
  })

  it('blocks off-allowlist navigation/window-open and denies permissions', () => {
    const listeners = {}
    const view = { webContents: {
      on: vi.fn((name, fn) => { listeners[name] = fn }),
      setWindowOpenHandler: vi.fn(),
    } }
    const session = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    }
    installReservedSessionSecurity(view, session, { allowedOrigins: ALLOWED_ORIGINS })
    const preventDefault = vi.fn()
    listeners['will-navigate']({ preventDefault }, 'https://evil.example/')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(view.webContents.setWindowOpenHandler.mock.calls[0][0]({ url: 'https://target.example/' }))
      .toEqual({ action: 'deny' })
    const permissionCallback = vi.fn()
    session.setPermissionRequestHandler.mock.calls[0][0](null, 'camera', permissionCallback)
    expect(permissionCallback).toHaveBeenCalledWith(false)
  })
})
