import { describe, it, expect } from 'vitest'
import { shouldCreateWindowOnActivate } from '../../electron/appActivation.js'

describe('shouldCreateWindowOnActivate', () => {
  // Sentry 실측 크래시: macOS 의 'activate' 가 app.whenReady 전에 발생하면
  // createWindow() → new BrowserWindow() → "Cannot create BrowserWindow before app is ready".
  it('does not create a window before the app is ready (Sentry crash guard)', () => {
    expect(shouldCreateWindowOnActivate({ isReady: false, openWindowCount: 0 })).toBe(false)
  })

  it('creates a window when ready and no windows are open', () => {
    expect(shouldCreateWindowOnActivate({ isReady: true, openWindowCount: 0 })).toBe(true)
  })

  it('does not create a duplicate window when one is already open', () => {
    expect(shouldCreateWindowOnActivate({ isReady: true, openWindowCount: 1 })).toBe(false)
  })
})
