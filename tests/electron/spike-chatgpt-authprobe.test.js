import { describe, it, expect, vi } from 'vitest'
import { AUTH_PROBE, isLoggedIn, whenLoaded, ensureLoggedIn } from '../../electron/spike-chatgpt-authprobe.js'

describe('AUTH_PROBE executed in jsdom', () => {
  const run = () => new Function(`return (${AUTH_PROBE})`)()   // eslint-disable-line no-new-func
  it('reports composer:true when the composer is rendered (logged in)', () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true"></div>'
    expect(run()).toEqual({ composer: true, loginCta: false })
  })
  it('reports composer:false + loginCta:true on the logged-out page', () => {
    document.body.innerHTML = '<a href="https://auth.openai.com/auth/login">Log in</a>'
    expect(run()).toEqual({ composer: false, loginCta: true })
  })
  it('reports both false on a blank/error page', () => {
    document.body.innerHTML = ''
    expect(run()).toEqual({ composer: false, loginCta: false })
  })
  it('contains no Node/CDP tokens', () => {
    for (const bad of ['require(', 'process.', 'webContents', 'Debugger.']) expect(AUTH_PROBE).not.toContain(bad)
  })
})

describe('isLoggedIn', () => {
  it('requires a composer without a logged-out login CTA', () => {
    expect(isLoggedIn({ composer: true, loginCta: false })).toBe(true)
    expect(isLoggedIn({ composer: true, loginCta: true })).toBe(false)
    expect(isLoggedIn({ composer: false, loginCta: false })).toBe(false)
    expect(isLoggedIn(null)).toBe(false)
    expect(isLoggedIn({ error: 'boom' })).toBe(false)
  })
})

function fakeWc({ loading = false, loadingSeq = null } = {}) {
  const handlers = {}
  const seq = loadingSeq ? [...loadingSeq] : null
  return {
    // loadingSeq 를 주면 호출마다 다음 값을 준다(등록 직후 재확인 경로 검증용).
    isLoading: vi.fn(() => (seq ? (seq.length > 1 ? seq.shift() : seq[0]) : loading)),
    on: vi.fn((ev, cb) => { (handlers[ev] ||= []).push(cb) }),
    removeListener: vi.fn((ev, cb) => { handlers[ev] = (handlers[ev] || []).filter((h) => h !== cb) }),
    emit: (ev) => (handlers[ev] || []).slice().forEach((h) => h()),
    handlers,
  }
}

describe('whenLoaded', () => {
  it('resolves immediately when the view is not loading', async () => {
    const wc = fakeWc({ loading: false })
    await expect(whenLoaded({ webContents: wc })).resolves.toBe(false)
    expect(wc.on).not.toHaveBeenCalled()
  })
  it('waits for did-finish-load and detaches its listeners', async () => {
    const wc = fakeWc({ loading: true })
    const p = whenLoaded({ webContents: wc })
    wc.emit('did-finish-load')
    await expect(p).resolves.toBe(true)
    expect(wc.removeListener).toHaveBeenCalledTimes(2)
  })
  it('resolves false on did-fail-load', async () => {
    const wc = fakeWc({ loading: true })
    const p = whenLoaded({ webContents: wc })
    wc.emit('did-fail-load')
    await expect(p).resolves.toBe(false)
  })
  it('resolves false on timeout (never hangs the shortcut)', async () => {
    const wc = fakeWc({ loading: true })
    await expect(whenLoaded({ webContents: wc }, { timeoutMs: 5 })).resolves.toBe(false)
  })
  it('re-checks isLoading after subscribing (load finished in the gap → no 15s hang)', async () => {
    const wc = fakeWc({ loadingSeq: [true, false] })   // 첫 확인엔 로딩 중, 등록 직후엔 이미 끝남
    await expect(whenLoaded({ webContents: wc }, { timeoutMs: 60000 })).resolves.toBe(false)
    expect(wc.isLoading).toHaveBeenCalledTimes(2)
    expect(wc.removeListener).toHaveBeenCalledTimes(2)
  })
})

describe('ensureLoggedIn', () => {
  const sleep = vi.fn(async () => {})
  it('true on the first probe when the composer is there — and does not sleep', async () => {
    const executeInView = vi.fn(async () => ({ composer: true, loginCta: false }))
    const s = vi.fn(async () => {})
    await expect(ensureLoggedIn({}, { executeInView, sleep: s })).resolves.toBe(true)
    expect(executeInView).toHaveBeenCalledOnce()
    expect(s).not.toHaveBeenCalled()
  })
  it('waits ~500ms between probes while the SPA hydrates (probe → sleep → probe)', async () => {
    const order = []
    let n = 0
    const executeInView = vi.fn(async () => { order.push('probe'); return ++n < 3 ? { composer: false } : { composer: true } })
    const s = vi.fn(async (ms) => { order.push(`sleep:${ms}`) })
    await expect(ensureLoggedIn({}, { executeInView, sleep: s })).resolves.toBe(true)
    expect(executeInView).toHaveBeenCalledTimes(3)
    expect(order).toEqual(['probe', 'sleep:500', 'probe', 'sleep:500', 'probe'])   // sleep 을 빼면 실패
  })
  it('false after all attempts and logs the last probe', async () => {
    const executeInView = vi.fn(async () => ({ composer: false, loginCta: true }))
    const log = { error: vi.fn(), info: vi.fn() }
    await expect(ensureLoggedIn({}, { executeInView, sleep, attempts: 3, log })).resolves.toBe(false)
    expect(executeInView).toHaveBeenCalledTimes(3)
    expect(log.error).toHaveBeenCalled()
  })
  it('treats a rejected eval as not-logged-in instead of throwing', async () => {
    const executeInView = vi.fn(async () => { throw new Error('context destroyed') })
    await expect(ensureLoggedIn({}, { executeInView, sleep, attempts: 2, log: { error: vi.fn() } })).resolves.toBe(false)
  })
})
