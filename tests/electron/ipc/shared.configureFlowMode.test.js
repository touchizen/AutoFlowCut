// @vitest-environment node

/**
 * configureFlowMode — aspect-ratio tab integration (Step 4.5)
 *
 * Regression (P1): an earlier attempt synced Flow's aspect-ratio tab AFTER
 * configureFlowMode returned. But configureFlowMode opens Flow's settings
 * dropdown, configures mode/batch, and CLOSES it (Step 5, Escape). Radix
 * unmounts the menu content on close, so a post-hoc querySelector for the tab
 * always failed — the fix never synced the UI in the real path.
 *
 * The fix moves the aspect-ratio click INSIDE configureFlowMode, as Step 4.5,
 * while the settings menu is still open (before the Step 5 close).
 */

import { describe, it, expect, vi } from 'vitest'
import { createSharedHelpers } from '../../../electron/ipc/shared.js'

function harness(result = { ok: true, method: 'already_active', batch: 'already_set', aspect: 'clicked' }) {
  const scripts = []
  const flowView = {
    webContents: {
      executeJavaScript: vi.fn(async (script) => {
        scripts.push(script)
        return result
      }),
    },
  }
  const helpers = createSharedHelpers({
    getFlowView: () => flowView,
    getMainWindow: () => null,
    constants: {},
  })
  return { helpers, scripts }
}

describe('configureFlowMode — aspect-ratio tab (Step 4.5)', () => {
  it('embeds the PORTRAIT trigger suffix for a 9:16 project', async () => {
    const { helpers, scripts } = harness()
    const r = await helpers.configureFlowMode('IMAGE', 2, '9:16')
    expect(r.success).toBe(true)
    expect(scripts[0]).toContain("const aspectSuffix = '-trigger-PORTRAIT';")
  })

  it('embeds the LANDSCAPE trigger suffix for a 16:9 project', async () => {
    const { helpers, scripts } = harness()
    await helpers.configureFlowMode('IMAGE', 1, '16:9')
    expect(scripts[0]).toContain("const aspectSuffix = '-trigger-LANDSCAPE';")
  })

  it('embeds aspectSuffix=null when no aspect ratio is passed (back-compat)', async () => {
    const { helpers, scripts } = harness()
    await helpers.configureFlowMode('IMAGE', 1)
    expect(scripts[0]).toContain('const aspectSuffix = null;')
  })

  it('selects the aspect-ratio tab BEFORE the menu-closing step (P1 regression guard)', async () => {
    const { helpers, scripts } = harness()
    await helpers.configureFlowMode('IMAGE', 1, '9:16')
    const s = scripts[0]
    const aspectAt = s.indexOf('aspectSuffix')
    const closeAt = s.indexOf('Step 5')
    expect(aspectAt).toBeGreaterThan(-1)
    expect(closeAt).toBeGreaterThan(-1)
    // Step 4.5 (aspect-ratio) must run while the menu is still open.
    expect(aspectAt).toBeLessThan(closeAt)
  })

  it('uses an exact-suffix (endsWith) match — never a contains match', async () => {
    const { helpers, scripts } = harness()
    await helpers.configureFlowMode('IMAGE', 1, '9:16')
    expect(scripts[0]).toContain('b.id.endsWith(aspectSuffix)')
  })

  it('treats a tab as active on aria-selected OR data-state (codebase convention)', async () => {
    const { helpers, scripts } = harness()
    await helpers.configureFlowMode('IMAGE', 1, '16:9')
    const s = scripts[0]
    expect(s).toContain("getAttribute('aria-selected') === 'true'")
    expect(s).toContain("getAttribute('data-state') === 'active'")
  })

  it('propagates the aspect result back to the caller', async () => {
    const { helpers } = harness({ ok: true, method: 'switched', batch: 'clicked', aspect: 'already_set' })
    const r = await helpers.configureFlowMode('IMAGE', 1, '9:16')
    expect(r.aspect).toBe('already_set')
  })
})
