import { createFlowSafety, flowSafetyConfig, FLOW_DETECTION_PROBE } from './flow-safety.js'

const GENERATE = new Set(['flow:generate-image', 'flow:generate-video-t2v', 'flow:generate-video-i2v',
  'flow:generate-character', 'flow:reroll-character', 'flow:generate-scene', 'flow:dom-send-prompt',
  'flow:upscale-image', 'flow:upscale-video'])
const MUTATING = new Set(['flow:dom-execute', 'flow:dom-click-enter-tool', 'flow:apply-agent-defaults',
  'flow:list-agent-models', 'flow:get-recaptcha-token', 'flow:upload-reference', 'flow:upload-character-entity',
  'flow:rename-character', 'flow:register-character-entity'])
const READ = new Set(['flow:check-generation', 'flow:collect-generation', 'flow:check-video-status'])
const aborted = () => ({ success: false, error: 'aborted', errorKind: 'aborted', aborted: true })
const unavailable = () => ({ success: false, error: 'flow-safety-page-unavailable', errorKind: 'flow-safety-page-unavailable' })

/** Decorates only Flow generation/status IPC. API-mode handlers are untouched. */
export function createFlowSafetyIPC(ipcMain, deps) {
  const config = deps.config || flowSafetyConfig(deps.env || process.env)
  const clock = deps.clock || Date.now
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const random = deps.random || Math.random
  const safety = createFlowSafety(config, { onStop(result) {
    try { deps.getMainWindow?.()?.webContents?.send('flow-status', { safetyStop: result }) } catch { /* window closed */ }
    try { deps.onStop?.(result) } catch { /* gate remains latched */ }
  } })
  let serial = Promise.resolve()
  let nextAt = null
  let epoch = 0
  const cancelPending = () => { epoch++ }
  ipcMain.handle('flow:safety-cancel-pending', () => { cancelPending(); return { success: true, aborted: 1 } })
  const context = () => {
    const view = deps.getFlowView?.()
    return { view, url: view?.webContents?.getURL?.(), epoch }
  }
  const changed = c => c.epoch !== epoch || c.view !== deps.getFlowView?.() || c.url !== c.view?.webContents?.getURL?.()
    || c.view?.webContents?.isDestroyed?.() || (deps.getCurrentMode && deps.getCurrentMode() !== 'flow')

  async function probe() {
    if (safety.blocked()) return safety.blocked()
    const wc = deps.getFlowView?.()?.webContents
    if (!wc || wc.isDestroyed?.() || typeof wc.executeJavaScriptInIsolatedWorld !== 'function') return unavailable()
    let timer
    try {
      const detected = await Promise.race([
        wc.executeJavaScriptInIsolatedWorld(998, [{ code: FLOW_DETECTION_PROBE }], true),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('probe timeout')), 5000) }),
      ])
      return (detected === true || (Array.isArray(detected) && detected.length === 1 && detected[0] === true)) ? safety.stop('flow-unusual-activity') : null
    } catch { return unavailable() } finally { clearTimeout(timer) }
  }
  const proxy = Object.create(ipcMain)
  proxy.handle = (channel, handler) => {
    if (channel === 'flow:clear-generations') {
      return ipcMain.handle(channel, (...args) => { cancelPending(); return handler(...args) })
    }
    if (MUTATING.has(channel)) return ipcMain.handle(channel, async (...args) => {
      const warning = await probe()
      return warning || handler(...args)
    })
    if (!GENERATE.has(channel) && !READ.has(channel)) return ipcMain.handle(channel, handler)
    return ipcMain.handle(channel, async (...args) => {
      if (!GENERATE.has(channel)) {
        // Preserve already-submitted results for recovery; only new submissions are blocked.
        const warning = await probe()
        if (warning?.safetyStop) return warning
        const result = await handler(...args)
        if (channel === 'flow:check-video-status' && result?.success && Array.isArray(result.statuses)) {
          const ids = args[1]?.generationIds || []
          for (let i = 0; i < result.statuses.length; i++) {
            const item = result.statuses[i]
            if (item?.status === 'complete' && item.mediaId && ids[i]) safety.observe({ success: true, completed: true }, { generationId: ids[i] })
          }
        }
        const stop = safety.observe(result, { generation: channel === 'flow:collect-generation', generationId: args[1]?.generationId })
        return stop ? { ...result, ...stop } : result
      }
      const submittedContext = context()
      const run = async () => {
        if (safety.blocked()) return safety.blocked()
        if (changed(submittedContext)) return aborted()
        while (nextAt != null && clock() < nextAt) {
          await sleep(Math.min(250, nextAt - clock()))
          if (safety.blocked()) return safety.blocked()
          if (changed(submittedContext)) return aborted()
        }
        const warning = await probe()
        if (warning) return warning
        if (changed(submittedContext)) return aborted()
        let result
        let monitoring = false
        const monitor = setInterval(async () => {
          if (monitoring || safety.blocked()) return
          monitoring = true
          try { await probe() } finally { monitoring = false }
        }, 2000)
        monitor.unref?.()
        try { result = await handler(...args) } catch (error) {
          result = { success: false, error: error?.message || String(error),
            ...(error?.errorKind ? { errorKind: error.errorKind } : {}) }
        } finally {
          clearInterval(monitor)
          // End-to-start spacing is conservative: setup/DOM time cannot compress actual submissions.
          const n = Math.max(0, Math.min(1, Number(random()) || 0))
          nextAt = clock() + config.minIntervalMs + Math.floor(n * config.jitterMs)
        }
        const detected = await probe()
        const stop = safety.observe(result, { generationId: result?.success === false ? result?.generationId : undefined })
        return detected?.safetyStop || stop ? { ...result, ...(detected?.safetyStop ? detected : stop) } : result
      }
      const result = serial.then(run, run)
      serial = result.then(() => {}, () => {})
      return result
    })
  }
  return { ipcMain: proxy, safety, probe, stop: safety.stop, cancelPending }
}
