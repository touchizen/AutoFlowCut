// @vitest-environment node

import { describe, it, expect, vi } from 'vitest'

vi.mock('@sentry/electron/main', () => ({ init: vi.fn() }))

const { buildSentryOptions, initSentryMain } = await import('../../electron/sentry-init.js')

describe('buildSentryOptions', () => {
  const prodEnabled = (extra = {}) => ({
    ENABLE_SENTRY: '1',
    SENTRY_DSN: 'https://x@sentry.io/1',
    VITE_FUNCTION_ENV: 'prod',
    ...extra,
  })

  it('returns enabled=false when ENABLE_SENTRY is not "1"', () => {
    const opts = buildSentryOptions({ env: { SENTRY_DSN: 'https://x@sentry.io/1', VITE_FUNCTION_ENV: 'prod' }, version: '0.9.15' })
    expect(opts.enabled).toBe(false)
  })

  it('returns enabled=false when DSN missing even if ENABLE_SENTRY=1', () => {
    const opts = buildSentryOptions({ env: { ENABLE_SENTRY: '1', VITE_FUNCTION_ENV: 'prod' }, version: '0.9.15' })
    expect(opts.enabled).toBe(false)
  })

  it('returns enabled=false when VITE_FUNCTION_ENV != "prod" (test env)', () => {
    const opts = buildSentryOptions({ env: prodEnabled({ VITE_FUNCTION_ENV: 'test' }), version: '0.9.15' })
    expect(opts.enabled).toBe(false)
  })

  it('returns enabled=false in dev mode (no VITE_FUNCTION_ENV)', () => {
    const opts = buildSentryOptions({
      env: { ENABLE_SENTRY: '1', SENTRY_DSN: 'https://x@sentry.io/1' },
      version: '0.9.15',
    })
    expect(opts.enabled).toBe(false)
  })

  it('returns enabled=true with full options in prod env with flag+DSN', () => {
    const opts = buildSentryOptions({
      env: prodEnabled({ SENTRY_TRACES_SAMPLE_RATE: '0.25' }),
      version: '0.9.15',
    })
    expect(opts.enabled).toBe(true)
    expect(opts.dsn).toBe('https://x@sentry.io/1')
    expect(opts.environment).toBe('prod')
    expect(opts.release).toBe('autoflowcut@0.9.15')
    expect(opts.tracesSampleRate).toBe(0.25)
  })

  it('defaults tracesSampleRate to 0.1 in prod', () => {
    const opts = buildSentryOptions({ env: prodEnabled(), version: '0.9.15' })
    expect(opts.tracesSampleRate).toBe(0.1)
    expect(opts.environment).toBe('prod')
  })

  it('falls back to VITE_SENTRY_DSN if SENTRY_DSN missing', () => {
    const opts = buildSentryOptions({
      env: { ENABLE_SENTRY: '1', VITE_FUNCTION_ENV: 'prod', VITE_SENTRY_DSN: 'https://y@sentry.io/2' },
      version: '0.9.15',
    })
    expect(opts.dsn).toBe('https://y@sentry.io/2')
    expect(opts.enabled).toBe(true)
  })

  describe('beforeSend PII scrubbing', () => {
    const baseOpts = () => buildSentryOptions({
      env: { ENABLE_SENTRY: '1', SENTRY_DSN: 'https://x@sentry.io/1', VITE_FUNCTION_ENV: 'prod' },
      version: '0.9.15',
    })

    it('strips user.email and user.ip_address', () => {
      const { beforeSend } = baseOpts()
      const event = { user: { id: 'uid123', email: 'a@b.com', ip_address: '1.2.3.4' } }
      const result = beforeSend(event)
      expect(result.user.id).toBe('uid123')
      expect(result.user.email).toBeUndefined()
      expect(result.user.ip_address).toBeUndefined()
    })

    it('strips request body data', () => {
      const { beforeSend } = baseOpts()
      const event = { request: { url: 'http://x', data: { secret: 's' } } }
      const result = beforeSend(event)
      expect(result.request.data).toBeUndefined()
      expect(result.request.url).toBe('http://x')
    })

    it('strips extra fields matching prompt/input/filename/path', () => {
      const { beforeSend } = baseOpts()
      const event = {
        extra: {
          userPrompt: 'private',
          inputData: 'secret',
          fileName: 'video.mp4',
          filePath: '/Users/x/secret/path',
          safeContext: 'keep',
        },
      }
      const result = beforeSend(event)
      expect(result.extra.userPrompt).toBeUndefined()
      expect(result.extra.inputData).toBeUndefined()
      expect(result.extra.fileName).toBeUndefined()
      expect(result.extra.filePath).toBeUndefined()
      expect(result.extra.safeContext).toBe('keep')
    })

    it('returns event unchanged when no sensitive fields present', () => {
      const { beforeSend } = baseOpts()
      const event = { tags: { feature: 'export' } }
      expect(beforeSend(event)).toEqual({ tags: { feature: 'export' } })
    })
  })
})

describe('initSentryMain', () => {
  it('does NOT call sentry.init when disabled', () => {
    const sentry = { init: vi.fn() }
    const result = initSentryMain({ sentry, env: {} })
    expect(sentry.init).not.toHaveBeenCalled()
    expect(result.initialized).toBe(false)
  })

  it('does NOT call sentry.init in test env even with full config', () => {
    const sentry = { init: vi.fn() }
    const env = {
      ENABLE_SENTRY: '1',
      SENTRY_DSN: 'https://x@sentry.io/1',
      VITE_FUNCTION_ENV: 'test',
    }
    const result = initSentryMain({ sentry, env })
    expect(sentry.init).not.toHaveBeenCalled()
    expect(result.initialized).toBe(false)
  })

  it('calls sentry.init with options (without "enabled" key) when prod-enabled', () => {
    const sentry = { init: vi.fn() }
    const env = {
      ENABLE_SENTRY: '1',
      SENTRY_DSN: 'https://x@sentry.io/1',
      VITE_FUNCTION_ENV: 'prod',
    }
    const result = initSentryMain({ sentry, env })
    expect(sentry.init).toHaveBeenCalledTimes(1)
    const arg = sentry.init.mock.calls[0][0]
    expect(arg.dsn).toBe('https://x@sentry.io/1')
    expect(arg.environment).toBe('prod')
    expect(arg.enabled).toBeUndefined()  // not forwarded to Sentry SDK
    expect(typeof arg.beforeSend).toBe('function')
    expect(result.initialized).toBe(true)
  })
})
