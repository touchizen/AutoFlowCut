import { describe, expect, it } from 'vitest'
import * as settings from '../../electron/flow-composer-settings.js'
import { buildSettingsPanel } from '../fixtures/flow-live-dom-20260924.js'

describe('read-only native settings planner', () => {
  it('returns the next radio without changing the shared DOM', () => {
    document.body.innerHTML = buildSettingsPanel()
    const before = document.body.innerHTML
    expect(settings.planNativeSettings).toBeTypeOf('function')
    const result = settings.planNativeSettings(document, { mode: 'image', ratio: '9:16' }, 2,
      { scan: settings.scanSettingsPanel, plan: settings.planSettingsClicks })
    expect(result.action).toMatchObject({ type: 'radio', group: 'ratio', key: 'crop_9_16' })
    expect(result.el.getAttribute('role')).toBe('radio')
    expect(document.body.innerHTML).toBe(before)
  })
  it('refuses an unknown panel without a speculative click', () => {
    document.body.innerHTML = '<main>unknown controls</main>'
    expect(settings.planNativeSettings).toBeTypeOf('function')
    expect(settings.planNativeSettings(document, { mode: 'image' }, 1,
      { scan: settings.scanSettingsPanel, plan: settings.planSettingsClicks })).toMatchObject({ ok: false })
  })
})
