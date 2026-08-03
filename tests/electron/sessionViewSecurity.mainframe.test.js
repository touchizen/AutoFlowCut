// tests/electron/sessionViewSecurity.mainframe.test.js
// @vitest-environment node
//
// The main-frame guard (will-navigate / will-redirect) used to preventDefault SILENTLY —
// a real ChatGPT session hopping through a non-allowlisted origin left the view blank with
// zero diagnostics. These tests pin the diagnostics: every blocked main-frame exit logs
// (origin only, never the signed path/query), and did-fail-load on the reserved view logs
// the error code + failed origin so a failed load is distinguishable from a blocked hop.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installReservedSessionSecurity } from '../../electron/sessionViewSecurity.js'

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

const blockedMainFrameLogs = (warn) =>
  warn.mock.calls.filter(([msg]) => String(msg).includes('Blocked main-frame navigation'))

let warn
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { warn.mockRestore() })

describe('main-frame navigation guard diagnostics', () => {
  it('logs exactly one blocked entry for a blocked will-navigate, and still prevents it', () => {
    const view = fakeView()
    installReservedSessionSecurity(view, electronSession())
    const preventDefault = vi.fn()

    view.listeners.get('will-navigate')({ preventDefault }, 'https://sso.example/login')

    expect(preventDefault).toHaveBeenCalledOnce()
    const logs = blockedMainFrameLogs(warn)
    expect(logs).toHaveLength(1)
    expect(JSON.stringify(logs[0])).toContain('will-navigate')
    expect(JSON.stringify(logs[0])).toContain('https://sso.example')
  })

  it('distinguishes will-redirect from will-navigate in the blocked log', () => {
    const view = fakeView()
    installReservedSessionSecurity(view, electronSession())
    const preventDefault = vi.fn()

    view.listeners.get('will-redirect')({ preventDefault }, 'https://openai.com/challenge')

    expect(preventDefault).toHaveBeenCalledOnce()
    const logs = blockedMainFrameLogs(warn)
    expect(logs).toHaveLength(1)
    expect(JSON.stringify(logs[0])).toContain('will-redirect')
    expect(JSON.stringify(logs[0])).not.toContain('will-navigate')
  })

  it('POSITIVE CONTROL: an allowed main-frame navigation produces no blocked log and no preventDefault', () => {
    const view = fakeView()
    installReservedSessionSecurity(view, electronSession())
    const preventDefault = vi.fn()

    view.listeners.get('will-navigate')({ preventDefault }, 'https://chatgpt.com/c/abc')
    view.listeners.get('will-redirect')({ preventDefault }, 'https://auth.openai.com/authorize')

    expect(preventDefault).not.toHaveBeenCalled()
    expect(blockedMainFrameLogs(warn)).toHaveLength(0)
  })

  it('logs origin only — never the signed path, query, or fragment', () => {
    const view = fakeView()
    installReservedSessionSecurity(view, electronSession())

    view.listeners.get('will-navigate')(
      { preventDefault: vi.fn() },
      'https://cdn.example/private/file?sig=SECRET#fragment',
    )
    view.listeners.get('will-redirect')(
      { preventDefault: vi.fn() },
      'https://cdn.example/private/file?sig=SECRET#fragment',
    )

    const flat = JSON.stringify(warn.mock.calls)
    expect(flat).toContain('https://cdn.example')
    expect(flat).not.toMatch(/private|SECRET|fragment/)
  })

  it('logs <invalid-origin> for an unparseable blocked URL instead of echoing it', () => {
    const view = fakeView()
    installReservedSessionSecurity(view, electronSession())

    view.listeners.get('will-navigate')({ preventDefault: vi.fn() }, 'not a url with token=SECRET')

    const flat = JSON.stringify(blockedMainFrameLogs(warn))
    expect(flat).toContain('<invalid-origin>')
    expect(flat).not.toContain('SECRET')
  })
})

describe('reserved view did-fail-load diagnostics', () => {
  it('logs the error code and failed origin only — never the full URL', () => {
    const view = fakeView()
    installReservedSessionSecurity(view, electronSession())
    const handler = view.listeners.get('did-fail-load')
    expect(handler).toBeTypeOf('function')

    handler({}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://chatgpt.com/backend/private?sig=SECRET', true)

    const logs = warn.mock.calls.filter(([msg]) => String(msg).includes('did-fail-load'))
    expect(logs).toHaveLength(1)
    const flat = JSON.stringify(logs[0])
    expect(flat).toContain('-105')
    expect(flat).toContain('ERR_NAME_NOT_RESOLVED')
    expect(flat).toContain('https://chatgpt.com')
    expect(flat).not.toMatch(/backend|private|SECRET/)
    // A failed load must not read as a blocked navigation — they need different fixes.
    expect(blockedMainFrameLogs(warn)).toHaveLength(0)
  })

  it('marks whether the failure was the main frame', () => {
    const view = fakeView()
    installReservedSessionSecurity(view, electronSession())

    view.listeners.get('did-fail-load')({}, -106, 'ERR_INTERNET_DISCONNECTED', 'https://chatgpt.com/', false)

    const logs = warn.mock.calls.filter(([msg]) => String(msg).includes('did-fail-load'))
    expect(logs).toHaveLength(1)
    expect(logs[0].some((arg) => arg && typeof arg === 'object' && arg.isMainFrame === false)).toBe(true)
  })
})
