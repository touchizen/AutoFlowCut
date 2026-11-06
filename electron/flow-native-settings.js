import { scanSettingsPanel, planSettingsClicks, planNativeSettings, ratioLigature } from './flow-composer-settings.js'
import { FIND_SETTINGS_TRIGGER_JS, READ_SETTINGS_SUMMARY_JS } from './flow-composer-dom.js'

const lib = () => `const scan = ${scanSettingsPanel.toString()}; const plan = ${planSettingsClicks.toString()}; const next = ${planNativeSettings.toString()};`
const stateJs = (targets, phase, action) => `(function () {
  ${lib()}
  const r = next(document, ${JSON.stringify(targets)}, ${phase}, {scan, plan});
  ${action ? `return JSON.stringify(r.action) === ${JSON.stringify(JSON.stringify(action))} ? r.el : null;` : 'delete r.el; return r;'}
})()`
const openJs = `!!document.querySelector('button.mat-button-toggle-button[role="radio"], [role="menu"]')`
const modelTriggerJs = `(function () { const scan = ${scanSettingsPanel.toString()}; return scan(document).model?.trigger || null })()`

/** No synthetic page events or network hooks. Every action is re-resolved at dispatch. */
export async function applyNativeSettings(flowView, opts, deps) {
  const wc = flowView.webContents
  const initialUrl = wc.getURL()
  const targets = { ...opts, mode: opts?.mode === 'video' ? 'video' : 'image' }
  const steps = {}
  const clicked = new Set()
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const guard = () => {
    if (deps.isAborted?.() || wc.isDestroyed() || wc.getURL() !== initialUrl) throw new Error('dom-stage-aborted')
  }
  const read = async code => {
    guard()
    let timer
    try {
      const r = await Promise.race([
        wc.executeJavaScriptInIsolatedWorld(996, [{ code }]),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('settings-probe-timeout')), 3000) }),
      ])
      guard()
      return Array.isArray(r) ? r[0] : r
    } finally { clearTimeout(timer) }
  }
  const click = async selector => {
    guard()
    const r = await deps.trustedClickOnFlowView(selector, { required: true, step: 'settings-native', beforeDispatch: async () => {
      try { guard(); return true } catch { return false }
    } })
    guard()
    if (!r?.success) throw new Error('settings-click-failed')
  }
  const fail = (reason, extra = {}) => ({ ok: false, kind: 'flow-settings-not-applied', reason, steps, ...extra })
  let opened = false
  const close = async () => {
    if (!opened) return
    // Close the known model menu first, then the settings panel, using their own triggers.
    const modelOpen = await read(`(function () { const scan = ${scanSettingsPanel.toString()}; return !!scan(document).model?.expanded })()`)
    if (modelOpen) await click(modelTriggerJs)
    if (await read(openJs)) await click(FIND_SETTINGS_TRIGGER_JS)
    for (let n = 0; n < 30 && await read(openJs); n++) await sleep(50)
    if (await read(openJs)) throw new Error('panel-not-closed')
    opened = false
  }
  try {
    if (!await read(READ_SETTINGS_SUMMARY_JS)) return fail('settings-trigger-not-found')
    // A previous interrupted settings operation may have left the panel open.
    if (!await read(openJs)) await click(FIND_SETTINGS_TRIGGER_JS)
    opened = true
    for (const phase of [1, 2]) {
      let settled = false
      for (let attempt = 0; attempt < 16; attempt++) {
        let r = await read(stateJs(targets, phase))
        if (r?.reason === 'panel-not-open') {
          for (let n = 0; n < 60 && r?.reason === 'panel-not-open'; n++) {
            await sleep(50); r = await read(stateJs(targets, phase))
          }
        }
        if (!r?.ok) { await close(); return fail(r?.reason || 'settings-unreadable', { ...(r?.kind ? { kind: r.kind } : {}), ...(r?.params ? { params: r.params } : {}) }) }
        if (r.action) {
          const key = JSON.stringify(r.action)
          if (clicked.has(key)) { await close(); return fail('settings-not-reflected') }
          clicked.add(key)
          await click(stateJs(targets, phase, r.action))
          if (r.action.type === 'model-select') steps.model = 'clicked'
          // Allow model/mode dependent controls to settle before planning again.
          await sleep(r.action.type === 'model-select' || r.action.group === 'mode' ? 1500 : 200)
          continue
        }
        // Observe the whole panel for 1.5s. Missing groups and delayed resets must
        // not silently count as a successful configuration.
        let stable = true
        for (let n = 0; n < 30; n++) {
          await sleep(50)
          const next = await read(stateJs(targets, phase))
          if (!next?.ok || next.action || next.signature !== r.signature) { stable = false; break }
        }
        if (!stable) continue
        Object.assign(steps, r.steps, steps.model === 'clicked' ? { model: 'clicked' } : {})
        settled = true
        break
      }
      if (!settled) { await close(); return fail('settings-not-settled') }
    }
    await close()
    const summary = await read(READ_SETTINGS_SUMMARY_JS)
    if (targets.ratio !== undefined && !summary?.ligatures?.includes(ratioLigature(targets.ratio))) return fail('ratio-not-reflected')
    for (const [field, pattern] of [['duration', /(\d{1,2})\s*(?:초|s)(?![a-z0-9])/i], ['resolution', /(\d{3,4})p(?![a-z0-9])/i]]) {
      if (!String(steps[field] || '').startsWith('fixed(')) continue
      const m = pattern.exec(summary?.text || '')
      if (m && Number(m[1]) !== Number(String(targets[field]).replace(/\D/g, ''))) return fail(`${field}-not-reflected`)
    }
    return { ok: true, steps }
  } catch (error) {
    try { guard(); await close() } catch { /* Cancelled work must not touch the page again. */ }
    return fail(error.message)
  }
}
