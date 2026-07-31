// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  CHATGPT_ALLOWED_ORIGINS,
  CHATGPT_START_URL,
  createChatgptTarget,
} from '../../../electron/webtargets/chatgpt/index.js'

function targetHarness({ probeSession } = {}) {
  const events = []
  const listeners = new Map()
  const electronSession = { partition: 'persist:chatgpt' }
  const view = {
    webContents: {
      session: electronSession,
      on: vi.fn((name, listener) => {
        events.push(`listener:${name}`)
        listeners.set(name, listener)
      }),
    },
  }
  class FakeWebContentsView {
    constructor(options) {
      events.push('view:create')
      expect(options).toEqual({ webPreferences: { partition: 'persist:chatgpt', sandbox: true } })
      return view
    }
  }
  const reservedSessionWebPreferences = vi.fn(() => {
    events.push('security:preferences')
    return { partition: 'persist:chatgpt', sandbox: true }
  })
  const installReservedSessionSecurity = vi.fn((receivedView, receivedSession) => {
    events.push('security:install')
    expect(receivedView).toBe(view)
    expect(receivedSession).toBe(electronSession)
  })
  const target = createChatgptTarget({
    WebContentsView: FakeWebContentsView,
    reservedSessionWebPreferences,
    installReservedSessionSecurity,
    probeSession,
  })
  return {
    target,
    events,
    listeners,
    view,
    electronSession,
    reservedSessionWebPreferences,
    installReservedSessionSecurity,
  }
}

describe('ChatGPT target definition', () => {
  it('pins the reserved partition, start URL, and exact existing origin allowlist', () => {
    const { target } = targetHarness()
    expect(target).toMatchObject({
      id: 'chatgpt',
      kind: 'image',
      partition: 'persist:chatgpt',
      startUrl: 'https://chatgpt.com/',
    })
    expect(CHATGPT_START_URL).toBe('https://chatgpt.com/')
    expect(CHATGPT_ALLOWED_ORIGINS).toEqual([
      'https://chatgpt.com',
      'https://auth.openai.com',
    ])
    expect(target.allowedOrigins).toBe(CHATGPT_ALLOWED_ORIGINS)
  })

  it('creates the view only through the P1 secure factory and installs security first', () => {
    const setup = targetHarness()

    expect(setup.target.createView()).toBe(setup.view)

    expect(setup.events).toEqual([
      'security:preferences',
      'view:create',
      'security:install',
      'listener:did-finish-load',
    ])
    expect(setup.reservedSessionWebPreferences).toHaveBeenCalledOnce()
    expect(setup.installReservedSessionSecurity).toHaveBeenCalledWith(
      setup.view,
      setup.electronSession,
    )
    expect(setup.view.webContents).not.toHaveProperty('loadURL')
  })

  it('keeps adapter construction as an explicit unimplemented injection point', () => {
    const injectedAdapter = vi.fn((input) => ({ input }))
    const setup = targetHarness()
    const target = createChatgptTarget({
      WebContentsView: class {},
      reservedSessionWebPreferences: () => ({}),
      installReservedSessionSecurity: () => {},
      createAdapter: injectedAdapter,
    })

    expect(setup.target.createAdapter()).toBeNull()
    expect(target.createAdapter('measured-later')).toEqual({ input: 'measured-later' })
    expect(injectedAdapter).toHaveBeenCalledOnce()
  })
})
