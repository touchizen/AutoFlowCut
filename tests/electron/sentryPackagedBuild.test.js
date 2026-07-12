// @vitest-environment node
//
// Sentry was disabled in every packaged build, silently.
//
// vite.config inlines the toggle/DSN into the main bundle via
//   define: { 'process.env.ENABLE_SENTRY': '"1"', ... }
// because packaged apps don't ship .env — the comment there says exactly that. But
// define only substitutes the literal member expression `process.env.ENABLE_SENTRY`.
// sentry-init read it through an alias (`env.ENABLE_SENTRY`, env = process.env), so
// nothing was substituted and the packaged app read a runtime process.env that has
// none of these set. enabled === false, forever, with no way to notice: prod builds
// also drop console, so even the "[Sentry] disabled" line was compiled away.
//
// These two tests pin the invariant that broke.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('@sentry/electron/main', () => ({ init: vi.fn(), captureMessage: vi.fn() }))

const { buildSentryOptions } = await import('../../electron/sentry-init.js')

const SRC = readFileSync(fileURLToPath(new URL('../../electron/sentry-init.js', import.meta.url)), 'utf8')

describe('Sentry in packaged builds', () => {
  const saved = { ...process.env }
  beforeEach(() => { Object.assign(process.env, { ENABLE_SENTRY: '1', SENTRY_DSN: 'https://x@sentry.io/1', VITE_FUNCTION_ENV: 'prod' }) })
  afterEach(() => { process.env = { ...saved } })

  it('enables Sentry from the default env, with no env argument passed', () => {
    // main.js calls initSentryMain() with no args — this is the path that ships.
    const opts = buildSentryOptions({ version: '3.0.1' })
    expect(opts.enabled).toBe(true)
    expect(opts.environment).toBe('prod')
  })

  it('reads the toggle as a LITERAL process.env member expression, so vite can inline it', () => {
    // The bug: `const { ENABLE_SENTRY } = env` or `env.ENABLE_SENTRY` compiles to a runtime
    // lookup that vite's define never touches, and a packaged app has nothing to look up.
    // Only a literal `process.env.ENABLE_SENTRY` in the source gets substituted at build time.
    for (const key of ['ENABLE_SENTRY', 'SENTRY_DSN', 'VITE_FUNCTION_ENV']) {
      expect(SRC).toContain(`process.env.${key}`)
    }
  })
})
