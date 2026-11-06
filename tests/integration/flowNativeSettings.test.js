import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyComposerSettings, scanSettingsPanel } from '../../electron/flow-composer-settings.js'
import { IMAGE_COMPOSER_KO, buildSettingsPanel, IMAGE_MODEL_MENU_ITEMS } from '../fixtures/flow-live-dom-20260924.js'
import { installFakeAngular, disposeFakeAngular } from '../helpers/fakeFlowAngular.js'

afterEach(() => { disposeFakeAngular(); vi.useRealTimers(); document.body.innerHTML = '' })
function harness(options = {}) {
  document.body.innerHTML = IMAGE_COMPOSER_KO
  const log = installFakeAngular(document, { modelMenuItems: IMAGE_MODEL_MENU_ITEMS, modelMenuIcon: null, ...options })
  const trigger = document.querySelector('.settings-trigger-button')
  trigger.addEventListener('click', () => {
    const panel = document.querySelector('.cdk-overlay-container')
    if (panel) {
      const scan = scanSettingsPanel(document)
      const icon = trigger.querySelector('mat-icon')
      if (scan.ok && icon) icon.textContent = scan.groups.ratio.checked.ligature
      panel.remove()
    } else document.body.insertAdjacentHTML('beforeend', buildSettingsPanel(options.panel || {}))
  })
  const wc = {
    getURL: () => 'https://flow.google.com/project/p', isDestroyed: () => false,
    executeJavaScript: vi.fn(async () => { throw new Error('Main world is forbidden') }),
    executeJavaScriptInIsolatedWorld: vi.fn(async (_id, scripts) => {
      expect(scripts[0].code).not.toMatch(/\.click\(|dispatchEvent|execCommand|\.value\s*=/)
      return window.eval(scripts[0].code)
    }),
  }
  const click = vi.fn(async selector => {
    const el = window.eval(selector)
    if (!el) return { success: false }
    el.click() // Native input boundary simulated by the DOM fixture.
    return { success: true }
  })
  return { wc, click, log, deps: { nativeInput: true, trustedClickOnFlowView: click } }
}
const target = { mode: 'image', ratio: '9:16', count: 2, model: 'Nano Banana Pro' }
async function drive(h, opts = target) {
  vi.useFakeTimers()
  const result = applyComposerSettings({ webContents: h.wc }, opts, h.deps)
  await vi.dynamicImportSettled()
  await vi.runAllTimersAsync()
  return result
}
describe('native settings through isolated probes and trusted clicks', () => {
  it('sets model, ratio and count using the existing Flow UI, without a main-world script', async () => {
    const h = harness()
    expect(await drive(h)).toMatchObject({ ok: true })
    expect(h.log).toContain('model:🍌 nano banana pro')
    expect(h.log).toContain('ratio:crop_9_16')
    expect(h.log).toContain('count:x2')
    expect(h.wc.executeJavaScript).not.toHaveBeenCalled()
    expect(document.querySelector('.cdk-overlay-container')).toBeNull()
  })
  it('rejects an unoffered model before touching ratio or count', async () => {
    const h = harness({ modelMenuItems: ['Nano Banana 2 Lite'] })
    expect(await drive(h)).toMatchObject({ ok: false, kind: 'flow-image-model-mismatch' })
    expect(h.log.some(s => /^(ratio|count):/.test(s))).toBe(false)
  })
  it('never retries an ignored settings click indefinitely', async () => {
    const h = harness({ ignoreClicks: ['ratio'] })
    expect(await drive(h)).toMatchObject({ ok: false })
    expect(h.log.filter(s => s === 'ratio:crop_9_16')).toHaveLength(1)
  })
  it('stops all clicks when cancellation arrives during an isolated read', async () => {
    const h = harness()
    let cancelled = false
    h.deps.isAborted = () => cancelled
    h.wc.executeJavaScriptInIsolatedWorld.mockImplementationOnce(async (_id, scripts) => {
      cancelled = true
      return window.eval(scripts[0].code)
    })
    expect(await drive(h)).toMatchObject({ ok: false })
    expect(h.click).not.toHaveBeenCalled()
  })
  it('rejects a delayed model reversion before reporting success', async () => {
    const h = harness({ modelSelectLater: { afterMs: 600, label: 'Nano Banana 2 Lite' } })
    expect(await drive(h)).toMatchObject({ ok: false })
    expect(h.log.filter(s => s.startsWith('model:'))).toHaveLength(1)
  })
  it('switches image to video and verifies duration, resolution, count and I2V frames', async () => {
    const h = harness({ modelMenuItems: ['Omni 1.1 Flash', 'Veo 3.1 - Fast'] })
    expect(await drive(h, { mode: 'video', model: 'Omni Flash', ratio: '9:16', duration: 8,
      resolution: '360p', count: 3, input: 'frames' })).toMatchObject({ ok: true,
      steps: { duration: 'already(8)', resolution: 'already(360p)', count: 'already(x1)', input: 'frames' } })
    expect(h.log).toEqual(expect.arrayContaining(['mode:videocam', 'ratio:crop_9_16', 'duration:8초', 'inputMode:crop_free']))
    expect(h.log).not.toContain('count:x3')
    expect(h.wc.executeJavaScript).not.toHaveBeenCalled()
  })
  it('changes the video model before selecting its newly offered duration and count', async () => {
    const h = harness({ panel: { mode: 'video', model: 'Veo 3.1 - Fast', checked: { count: 'x2' } },
      modelMenuItems: ['Omni 1.1 Flash', 'Veo 3.1 - Fast'],
      modelSelectDurations: ['4초', '6초', '8초', '10초'], modelSelectDelayMs: 600 })
    expect(await drive(h, { mode: 'video', model: 'Omni Flash', ratio: '16:9', duration: 10,
      resolution: '720p' })).toMatchObject({ ok: true })
    expect(h.log).toEqual(expect.arrayContaining(['model:omni 1.1 flash', 'duration:10초', 'count:x1']))
    expect(h.log.indexOf('model:omni 1.1 flash')).toBeLessThan(h.log.indexOf('duration:10초'))
  })
})
