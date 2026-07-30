// tests/electron/sessionViewSecurity.test.js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  RESERVED_SESSION_PARTITION, reservedSessionWebPreferences,
  isReservedNavigationAllowed, installReservedSessionSecurity,
} from '../../electron/sessionViewSecurity.js'

describe('reserved session view security', () => {
  it('uses isolated persistent storage and never copies Flow preload/security exceptions', () => {
    expect(RESERVED_SESSION_PARTITION).toBe('persist:chatgpt')
    const prefs = reservedSessionWebPreferences()
    expect(prefs).toEqual({
      partition: 'persist:chatgpt', contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true,
    })
    expect(prefs).not.toHaveProperty('preload')
  })

  it.each([
    ['https://chatgpt.com/', true],
    ['https://chatgpt.com/auth/callback', true],
    ['https://auth.openai.com/authorize', true],
    ['https://evil.example/chatgpt.com', false],
    ['file:///tmp/token', false],
  ])('navigation allowlist %s → %s', (url, allowed) => {
    expect(isReservedNavigationAllowed(url)).toBe(allowed)
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
    installReservedSessionSecurity(view, session)
    const preventDefault = vi.fn()
    listeners['will-navigate']({ preventDefault }, 'https://evil.example/')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(view.webContents.setWindowOpenHandler.mock.calls[0][0]({ url: 'https://chatgpt.com/' }))
      .toEqual({ action: 'deny' })
    const permissionCallback = vi.fn()
    session.setPermissionRequestHandler.mock.calls[0][0](null, 'camera', permissionCallback)
    expect(permissionCallback).toHaveBeenCalledWith(false)
  })
})
