// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'

vi.mock('@sentry/electron/renderer', () => ({ init: vi.fn() }))

const { buildSentryRendererOptions, initSentryRenderer } = await import('../src/sentry-init.js')

describe('buildSentryRendererOptions', () => {
  const prodEnabled = (extra = {}) => ({
    VITE_ENABLE_SENTRY: '1',
    VITE_SENTRY_DSN: 'https://x@sentry.io/1',
    VITE_FUNCTION_ENV: 'prod',
    ...extra,
  })

  it('returns enabled=false when VITE_ENABLE_SENTRY is not "1"', () => {
    const opts = buildSentryRendererOptions({ env: { VITE_SENTRY_DSN: 'https://x@sentry.io/1', VITE_FUNCTION_ENV: 'prod' }, version: '0.9.15' })
    expect(opts.enabled).toBe(false)
  })

  it('returns enabled=false when DSN missing', () => {
    const opts = buildSentryRendererOptions({ env: { VITE_ENABLE_SENTRY: '1', VITE_FUNCTION_ENV: 'prod' }, version: '0.9.15' })
    expect(opts.enabled).toBe(false)
  })

  it('returns enabled=false when VITE_FUNCTION_ENV != "prod"', () => {
    const opts = buildSentryRendererOptions({ env: prodEnabled({ VITE_FUNCTION_ENV: 'test' }), version: '0.9.15' })
    expect(opts.enabled).toBe(false)
  })

  it('returns enabled=true with full options in prod env', () => {
    const opts = buildSentryRendererOptions({
      env: prodEnabled({ VITE_SENTRY_TRACES_SAMPLE_RATE: '0.25' }),
      version: '0.9.15',
    })
    expect(opts.enabled).toBe(true)
    expect(opts.dsn).toBe('https://x@sentry.io/1')
    expect(opts.environment).toBe('prod')
    expect(opts.release).toBe('autoflowcut@0.9.15')
    expect(opts.tracesSampleRate).toBe(0.25)
  })

  it('beforeSend scrubs PII consistently with main process', () => {
    const opts = buildSentryRendererOptions({
      env: prodEnabled(),
      version: '0.9.15',
    })
    const event = {
      user: { id: 'uid123', email: 'a@b.com', ip_address: '1.2.3.4' },
      request: { url: 'http://x', data: { secret: 's' } },
      extra: { userPrompt: 'p', fileName: 'f', safe: 'keep' },
    }
    const result = opts.beforeSend(event)
    expect(result.user.id).toBe('uid123')
    expect(result.user.email).toBeUndefined()
    expect(result.user.ip_address).toBeUndefined()
    expect(result.request.data).toBeUndefined()
    expect(result.extra.userPrompt).toBeUndefined()
    expect(result.extra.fileName).toBeUndefined()
    expect(result.extra.safe).toBe('keep')
  })
})

describe('initSentryRenderer', () => {
  it('does NOT call sentry.init when disabled', () => {
    const sentry = { init: vi.fn() }
    const result = initSentryRenderer({ sentry, env: {} })
    expect(sentry.init).not.toHaveBeenCalled()
    expect(result.initialized).toBe(false)
  })

  it('does NOT call sentry.init in test env', () => {
    const sentry = { init: vi.fn() }
    const env = {
      VITE_ENABLE_SENTRY: '1',
      VITE_SENTRY_DSN: 'https://x@sentry.io/1',
      VITE_FUNCTION_ENV: 'test',
    }
    const result = initSentryRenderer({ sentry, env })
    expect(sentry.init).not.toHaveBeenCalled()
    expect(result.initialized).toBe(false)
  })

  it('calls sentry.init with options when prod-enabled', () => {
    const sentry = { init: vi.fn() }
    const env = {
      VITE_ENABLE_SENTRY: '1',
      VITE_SENTRY_DSN: 'https://x@sentry.io/1',
      VITE_FUNCTION_ENV: 'prod',
    }
    const result = initSentryRenderer({ sentry, env })
    expect(sentry.init).toHaveBeenCalledTimes(1)
    const arg = sentry.init.mock.calls[0][0]
    expect(arg.dsn).toBe('https://x@sentry.io/1')
    expect(arg.environment).toBe('prod')
    expect(arg.enabled).toBeUndefined()
    expect(result.initialized).toBe(true)
  })
})
