// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSharedHelpers } from '../../../electron/ipc/shared.js'

function makeHelpers(executeJavaScript, timeoutMs = 25) {
  return createSharedHelpers({
    getFlowView: () => ({ webContents: { executeJavaScript } }),
    getMainWindow: () => null,
    constants: {
      SESSION_URL: 'https://example.test/session',
      MEDIA_REDIRECT_URL: 'https://example.test/media',
      RECAPTCHA_SITE_KEY: 'site',
      RECAPTCHA_ACTION: 'action',
    },
    flowPageFetchTimeoutMs: timeoutMs,
  })
}

afterEach(() => vi.useRealTimers())

describe('flowPageFetch timeout/abort', () => {
  it('executeJavaScript/IPC 가 영원히 settle 하지 않아도 제한시간 뒤 reject 해 lock 해제를 허용한다', async () => {
    vi.useFakeTimers()
    const { flowPageFetch } = makeHelpers(vi.fn(() => new Promise(() => {})), 25)
    let outcome = 'pending'
    flowPageFetch('https://example.test/entities').then(
      value => { outcome = value },
      error => { outcome = error },
    )

    await vi.advanceTimersByTimeAsync(26)

    expect(outcome).toBeInstanceOf(Error)
    expect(outcome.message).toContain('timed out')
  })

  it('페이지 fetch 자체에도 AbortController signal 을 넣어 underlying 요청을 중단한다', async () => {
    let injected = ''
    const executeJavaScript = vi.fn(async (script) => {
      injected = script
      return { ok: true, status: 200, text: '{}' }
    })
    const { flowPageFetch } = makeHelpers(executeJavaScript, 25)

    await flowPageFetch('https://example.test/entities')

    expect(injected).toContain('new AbortController()')
    expect(injected).toContain('signal: controller.signal')
    expect(injected).toContain('controller.abort()')
  })
})
