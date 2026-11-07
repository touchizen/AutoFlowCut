import { createHash, randomUUID } from 'node:crypto'
import { applyNativeSettings } from './flow-native-settings.js'
import { FIND_GENERATE_BUTTON_JS, findPromptEditor } from './flow-composer-dom.js'
import { composerStateJs } from './flow-composer-refs.js'
import { normalizePrompt } from './flow-rpc-protocol.js'

const EDITOR = `(${findPromptEditor.toString()})(document)`
const READY = `!!(${EDITOR})`
const AGENT_OFF = `document.querySelector('flow-agent-mode-toggle-chip button[aria-pressed]')?.getAttribute('aria-pressed') === 'false'`
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function readPassiveDom(wc, code, signal) {
  if (signal?.aborted || wc.isDestroyed?.()) throw new Error('capture-aborted')
  let timer, abort
  try {
    const result = await Promise.race([
      wc.executeJavaScriptInIsolatedWorld(995, [{ code }]),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('dom-read-timeout')), 3000)
        abort = () => reject(new Error('capture-aborted'))
        signal?.addEventListener('abort', abort, { once: true })
      }),
    ])
    if (signal?.aborted) throw new Error('capture-aborted')
    return Array.isArray(result) ? result[0] : result
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
export async function passiveSessionReady(wc) {
  try {
    if (!/^https:\/\/flow\.google\.com\/project\/[0-9a-f-]{36}\/?$/.test(wc.getURL())) return { ready: false, reason: 'not-on-flow' }
    return await readPassiveDom(wc, READY) ? { ready: true, credits: null } : { ready: false, reason: 'composer-missing' }
  } catch { return { ready: false, reason: 'page-unreadable' } }
}

/** Plain image lane. Deliberately completes capture+download before acknowledging
 * an async submit, so the existing queue cannot overlap two ownership windows. */
export function createPassiveImageGenerator(deps, withViewport) {
  return async function generate(payload = {}, onSubmission, beforeSubmit) {
    let flowSubmission = null
    const fail = (reason, postClick = false) => ({ success: false, errorKind: 'flow-image-ownership-unproven',
      error: 'flow-image-ownership-unproven', reason, errorParams: { reason }, retryBlocked: true, ...(postClick ? { postClick: true, safetyStop: true } : {}),
      ...(flowSubmission ? { flowSubmission: { ...flowSubmission, reason } } : {}) })
    const count = payload.batchCount == null ? 1 : Number(payload.batchCount)
    const prompt = normalizePrompt(payload.prompt)
    const plan = payload.plan
    if (!prompt || !Number.isInteger(count) || count < 1 || count > 4 || payload.seed != null
      || (payload.refs != null && (!Array.isArray(payload.refs) || payload.refs.length))
      || (payload.referenceImages != null && (!Array.isArray(payload.referenceImages) || payload.referenceImages.length))
      || (plan && (!Array.isArray(plan.segments) || !Array.isArray(plan.attach) || plan.attach.length
        || plan.segments.some(s => s?.t !== 'text' || typeof s.text !== 'string')
        || normalizePrompt(plan.segments.map(s => s.text).join(' ')) !== prompt))) return fail('unsupported-input')
    if (deps.getFlowAgentOn?.()) return fail('agent-mode')
    const capture = deps.getPassiveCapture?.() || deps.passiveCapture
    if (!capture || !deps.typeFlowText || !deps.downloadPassiveImage || !deps.startResponseCapture) return fail('capture-unavailable')
    const view = deps.getFlowView()
    const wc = view?.webContents
    const url = wc?.getURL?.()
    const project = /^https:\/\/flow\.google\.com\/project\/([0-9a-f-]{36})\/?$/.exec(url || '')?.[1]
    if (!project || (payload.projectId && payload.projectId !== project)) return fail('project-not-open')
    let lease
    try { lease = capture.begin({ webContentsId: wc.id, projectId: project, prompt, count, responseProof: true }) }
    catch (e) { return fail(e.message) }
    let dispatched = false, success = false, timer, cancellationTimer, inputWatch = false
    const recordSubmission = () => {
      if (flowSubmission) return
      dispatched = true
      flowSubmission = { id: `flow-submit-${randomUUID()}`, submittedAt: Date.now(),
        promptHash: createHash('sha256').update(prompt).digest('hex'),
        postClick: true, retryBlocked: true, reason: 'awaiting-result' }
      lease.dispatch()
      onSubmission?.({ ...flowSubmission })
    }
    let responseCapture
    const invalid = () => lease.abort('page-or-input-changed')
    const events = ['did-navigate', 'did-navigate-in-page', 'render-process-gone', 'destroyed']
    for (const event of events) wc.on(event, invalid)
    const guard = () => {
      if (lease.signal.aborted || wc.isDestroyed?.() || wc.getURL() !== url || deps.getFlowView() !== view
        || deps.isFlowSafetyBlocked?.() || (deps.getCurrentMode && deps.getCurrentMode() !== 'flow')) throw new Error('capture-aborted')
    }
    const read = async code => { guard(); const result = await readPassiveDom(wc, code, lease.signal); guard(); return result }
    const composerMatches = async () => {
      const st = await read(composerStateJs({}))
      return !!st && !st.pickerOpen && Array.isArray(st.chips) && st.chips.length === 0
        && normalizePrompt(st.editorText) === prompt && await read(AGENT_OFF)
    }
    try {
      // Bounds all work, including downloads and a renderer that stops answering.
      timer = setTimeout(() => lease.abort('capture-timeout'), 180000)
      // Cancellation must also abort an isolated read or network download that
      // is awaiting I/O, not only the next gallery polling iteration.
      cancellationTimer = setInterval(() => {
        if (deps.isFlowSafetyBlocked?.()) lease.abort('capture-aborted')
      }, 100)
      const result = await withViewport(view, '[Flow Image] [Passive]', async ctl => {
        const aborted = () => ctl.aborted || lease.signal.aborted || !!deps.isFlowSafetyBlocked?.()
        guard()
        if (!await read(READY) || !await read(AGENT_OFF)) return fail('composer-unavailable')
        const st = await read(composerStateJs({}))
        if (!st || st.pickerOpen || !Array.isArray(st.chips) || st.chips.length) return fail('composer-not-clear')
        const settings = await applyNativeSettings(view, { mode: 'image', model: payload.model,
          ratio: payload.aspectRatio, count }, { trustedClickOnFlowView: deps.trustedClickOnFlowView, isAborted: aborted })
        guard()
        if (!settings.ok || ctl.aborted) return fail('settings-not-applied')
        wc.focus()
        const focused = await deps.trustedClickOnFlowView(EDITOR, { required: true, step: 'compose-editor', beforeDispatch: async () => !aborted() })
        guard()
        if (!focused?.success) return fail('editor-not-focused')
        const typed = await deps.typeFlowText(wc, payload.prompt, { isAborted: aborted })
        guard()
        if (!typed?.ok || ctl.aborted || !await composerMatches()) return fail('text-mismatch')
        responseCapture = await deps.startResponseCapture(wc.session, { signal: lease.signal })
        guard()
        responseCapture.assertReady()
        deps.setShieldFocusTarget?.('main')
        deps.getMainWindow()?.webContents?.focus()
        await pause(500)
        // The native collector must be ready at the last dispatch gate, after
        // all asynchronous composer and current-scene checks.
        const click = await deps.trustedClickOnFlowView(FIND_GENERATE_BUTTON_JS, { required: true, step: 'compose-submit', onDispatched: recordSubmission, beforeDispatch: async () => {
          guard()
          if (aborted() || !await composerMatches()) return false
          // Last await before native dispatch: a scene can change while any of
          // the preceding isolated DOM reads are still pending.
          if (beforeSubmit && !await beforeSubmit(lease.signal)) {
            lease.abort('scene-submission-blocked')
            return false
          }
          guard()
          responseCapture.assertReady()
          lease.prepare()
          wc.on('before-input-event', invalid); inputWatch = true
          return true
        } })
        dispatched ||= !!(click?.success || click?.dispatched || lease.state().request)
        if (dispatched) { recordSubmission(); ctl.clickStarted = true }
        guard()
        if (!dispatched) throw new Error('submit-unconfirmed')
        const deadline = Date.now() + 120000
        let selected
        while (Date.now() < deadline) {
          guard()
          const state = lease.state()
          if (state.error) throw new Error(state.error)
          responseCapture.assertReady()
          if (state.complete) {
            selected = await responseCapture.finish(state.requestUrl, state.request)
            guard()
            break
          } else if (!state.request && Date.now() > deadline - 105000) throw new Error('request-not-observed')
          await pause(250)
        }
        if (!selected || selected.length !== count) throw new Error('response-proof-count')
        const images = []
        for (const item of selected) {
          guard()
          const image = await deps.downloadPassiveImage(wc.session, item, { signal: lease.signal })
          guard(); images.push(image)
        }
        guard()
        return { success: true, images, flowSubmission }
      }, { shieldFlow: true })
      if (!result?.success) return fail(result?.reason || 'capture-aborted', dispatched)
      guard() // Viewport restoration can yield; page/mode ownership must still hold.
      success = true
      if (payload.asyncMode) {
        const generationId = `passive-${randomUUID()}`
        deps.pendingGenerations.set(generationId, { passive: true, completed: true, expectedCount: count, passiveResult: result })
        return { success: true, submitted: true, generationId, flowSubmission }
      }
      return result
    } catch (e) {
      if (dispatched || lease.state().request) recordSubmission()
      return fail(lease.state().error || e.message, dispatched)
    }
    finally {
      clearTimeout(timer)
      clearInterval(cancellationTimer)
      for (const event of events) wc.removeListener(event, invalid)
      if (inputWatch) wc.removeListener('before-input-event', invalid)
      try { await responseCapture?.cancel() } catch { /* collector remains fail-closed until its drain ends */ }
      lease.release(success)
    }
  }
}
