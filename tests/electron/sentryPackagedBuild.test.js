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

const { buildSentryOptions, initSentryMain } = await import('../../electron/sentry-init.js')

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

  it('initSentryMain must not pass a runtime process.env over the inlined defaults', () => {
    // The first attempt at this fix inlined the constants into buildSentryOptions' default —
    // and shipped still-disabled, because initSentryMain ALSO defaulted `env = process.env`
    // and passed it down explicitly, overriding the default that was just fixed. A packaged
    // run proved it: "[Sentry] disabled (env=dev, prod-only)".
    //
    // Simulate the packaged app: nothing in the runtime environment.
    delete process.env.ENABLE_SENTRY
    delete process.env.SENTRY_DSN
    delete process.env.VITE_FUNCTION_ENV

    const sentry = { init: vi.fn() }
    const { options } = initSentryMain({
      sentry,
      // no `env` — exactly how main.js calls it
    })

    // With nothing in process.env, the ONLY way this can be enabled is the build-time
    // inlined defaults. In this test they aren't inlined (vitest doesn't run define), so
    // enabled is false — what we pin is that initSentryMain didn't smuggle process.env in.
    expect(options.environment).not.toBe(undefined)
    // The real guard: buildSentryOptions' default is reachable, i.e. env was passed as
    // undefined rather than as a runtime process.env object.
    expect(initSentryMain.length).toBeLessThanOrEqual(1)
    expect(SRC).not.toMatch(/initSentryMain\(\{[^}]*env\s*=\s*process\.env/)
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
