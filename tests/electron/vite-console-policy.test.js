// @vitest-environment node
//
// Two console policies, and each one is load-bearing in the opposite direction:
//
//   MAIN bundle     — console is KEPT. @sentry/electron turns main-process console output into
//                     breadcrumbs, and that [Flow API]/[TrustedClick] trail is what makes a Sentry
//                     event diagnosable without asking the user for logs. Dropping it blinds us —
//                     it already did, for every release we ever shipped.
//   RENDERER bundle — console is DROPPED. The renderer logs character names, emails, and file
//                     paths in a dozen places; they are only safe because they do not survive the
//                     production build. If this drop is ever removed, every one of them becomes a
//                     live Sentry breadcrumb, and tests/electron/noUserContentInLogs.test.js must
//                     be widened to scan src/ before that happens.
//
// Neither policy is obvious from reading the code, so pin both.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CONFIG = readFileSync(fileURLToPath(new URL('../../vite.config.js', import.meta.url)), 'utf8')

// The main-process config lives inside electron([{ ... }]); the renderer's is the top-level one.
const mainSection = CONFIG.slice(CONFIG.indexOf("entry: 'electron/main.js'"), CONFIG.indexOf('renderer()'))
const rendererSection = CONFIG.slice(CONFIG.indexOf('renderer()'))

describe('vite console policy', () => {
  it('keeps console in the MAIN bundle — it is the Sentry breadcrumb trail', () => {
    const drop = mainSection.match(/drop:\s*\[([^\]]*)\]/)
    expect(drop, 'main process esbuild.drop not found').toBeTruthy()
    expect(drop[1]).not.toContain('console')
  })

  it('drops console in the RENDERER bundle — its logs carry names, emails and paths', () => {
    const drop = rendererSection.match(/drop:\s*\[([^\]]*)\]/)
    expect(drop, 'renderer esbuild.drop not found').toBeTruthy()
    expect(drop[1]).toContain('console')
  })
})
