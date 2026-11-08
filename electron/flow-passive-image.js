import { composeAccessible, editorNode, generationNode } from './flow-accessible-compose.js'
import { createHash, randomUUID } from 'node:crypto'
import { applyNativeSettings } from './flow-native-settings.js'
import { FIND_GENERATE_BUTTON_JS, findPromptEditor } from './flow-composer-dom.js'
import { prepareNativeReferences } from './flow-passive-references.js'
import { frameSlotsJs, composerStateJs } from './flow-composer-refs.js'
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
export async function passiveSessionReady(wc, ax) {
  try {
    if (!/^https:\/\/flow\.google\.com\/project\/[0-9a-f-]{36}\/?$/.test(wc.getURL())) return { ready: false, reason: 'not-on-flow' }
    return (ax ? editorNode(await ax.snapshot(wc)) : await readPassiveDom(wc, READY)) ? { ready: true, credits: null } : { ready: false, reason: 'composer-missing' }
  } catch(e) { return { ready:false, reason:ax && ['flow-accessibility-permission-required','flow-unusual-activity','flow-accessibility-platform'].includes(e.message)?e.message:'page-unreadable' } }
}

/** Shared native submission lane. Images finish the download before returning;
 * videos return only the proven ID to the normal status and download pipeline. */
export function createPassiveImageGenerator(deps, withViewport, referencePreflight) {
  return async function generate(payload = {}, onSubmission, beforeSubmit, videoKind = null) {
    let flowSubmission = null
    const fail = (reason, postClick = false) => {
      let kind
      if (!postClick && /^reference-registered-/.test(reason)) kind = 'flow-registered-reference-unavailable'
      else if (!postClick && /reference|clipboard|^flow-accessibility-open-unavailable/.test(reason)) kind = 'flow-reference-attach-failed'
      else if (!videoKind) kind = 'flow-image-ownership-unproven'
      else kind = postClick ? 'flow-submit-lost' : 'flow-settings-not-applied'
      return ({ success: false, errorKind: kind,
      error: kind, reason, errorParams: { reason }, retryBlocked: true, ...(postClick ? { postClick: true, ...(!videoKind ? { safetyStop: true } : {}) } : {}),
      ...(flowSubmission ? { flowSubmission: { ...flowSubmission, reason } } : {}) })
    }
    const count = Number((videoKind ? payload.videoBatchCount : payload.batchCount) ?? 1)
    const prompt = normalizePrompt(payload.prompt)
    const plan = payload.plan
    const hasRefs = Array.isArray(payload.refs) && payload.refs.length > 0
    if (!prompt || !Number.isInteger(count) || count < 1 || count > (videoKind ? 1 : 4) || payload.seed != null
      || (payload.refs != null && !Array.isArray(payload.refs))
      || (payload.referenceImages != null && (!Array.isArray(payload.referenceImages) || payload.referenceImages.length))
      || (payload.segments != null && (!Array.isArray(payload.segments) || payload.segments.length))
      || (!hasRefs && plan && (!Array.isArray(plan.segments) || !Array.isArray(plan.attach) || plan.attach.length
        || plan.segments.some(s => s?.t !== 'text' || typeof s.text !== 'string')
        || normalizePrompt(plan.segments.map(s => s.text)) !== prompt))) return fail('unsupported-input')
    if (deps.getFlowAgentOn?.()) return fail('agent-mode')
    const capture = deps.getPassiveCapture?.() || deps.passiveCapture
    if (!capture || !deps.typeFlowText || !deps.downloadPassiveImage || !deps.startResponseCapture) return fail('capture-unavailable')
    const view = deps.getFlowView()
    const wc = view?.webContents
    const url = wc?.getURL?.()
    const project = /^https:\/\/flow\.google\.com\/project\/([0-9a-f-]{36})\/?$/.exec(url || '')?.[1]
    if (!project || (payload.projectId && payload.projectId !== project)) return fail('project-not-open')
    const pre = hasRefs ? referencePreflight?.(view, payload, { registered: !!deps.flowAccessibility }) : null
    if (hasRefs && (!pre?.ok || !plan || (!plan.segments.some(s => s.t === 'mention') && videoKind !== 'i2v' && normalizePrompt(plan.segments.map(s => s.text)) !== prompt) || new Set([...plan.attach, ...plan.segments.filter(s => s.t === 'mention').map(s => s.ref)]).size !== pre.refs.length)) return fail('unsupported-input')
    const want = videoKind ? { model: payload.model, duration: Number(payload.duration), resolution: payload.resolution,
      ratio: payload.aspectRatio, kind: videoKind } : null
    const expected = { webContentsId: wc.id, projectId: project, prompt, count, responseProof: true,
      rpcid: ({ t2v: 'YhhmEf', r2v: 'MZZa6b', i2v: 'eb1hJf' })[videoKind] || 'ogiZ0b', refs: [], mentions: [], want }
    const journal = videoKind && deps.videoJournal
    let scope, intent, reserved, epoch
    const row = payload.row
    if (journal) {
      const folder = deps.getActiveWorkFolder?.()
      epoch = Number(row?.epoch || 0)
      if (typeof folder !== 'string' || !folder || !row || typeof row.projectName !== 'string' || !row.projectName
        || typeof row.id !== 'string' || !row.id || !Number.isSafeInteger(epoch) || epoch < 0) return fail('video-row-unavailable')
      scope = JSON.stringify([folder, row.projectName, project, videoKind === 'i2v' ? 'frames' : 'video', row.id])
      intent = JSON.stringify([prompt, want, plan ?? null, pre?.refs.map(ref => ref.sha) || []])
      try {
        const prior = journal.inspect(scope, intent, row.previousId, epoch)
        if (prior?.generationId) return { success: true, generationId: prior.generationId }
        if (prior?.blocked) { flowSubmission = prior.flowSubmission; return fail('previous-submit-unresolved', true) }
      } catch { return fail('video-journal-unavailable') }
    }
    let lease
    try { lease = capture.begin(expected) }
    catch (e) { return fail(e.message) }
    let dispatched = false, success = false, timer, cancellationTimer, inputWatch = false
    const makeRecord = () => ({ id: `flow-submit-${randomUUID()}`, submittedAt: Date.now(),
      promptHash: createHash('sha256').update(prompt).digest('hex'),
      postClick: true, retryBlocked: true, reason: 'awaiting-result' })
    const recordSubmission = () => {
      if (flowSubmission) return
      dispatched = true
      flowSubmission = reserved || makeRecord()
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
    const ax = deps.flowAccessibility
    let composed
    const composerMatches = async () => {
      if (ax) return composed.matches()
      const st = await read(composerStateJs(composed?.tokens || {}))
      if (composed) {
        const ids = st?.chips?.map(c => !c.busy && c.mediaId)
        const segments = st?.segments
        if (st?.pickerOpen || !Array.isArray(ids) || !Array.isArray(segments) || ids.length !== expected.refs.length
          || !expected.refs.every(id => ids.includes(id))
          || JSON.stringify(segments.filter(s => s.t === 'mention').map(s => s.mediaId)) !== JSON.stringify(expected.mentions)
          || normalizePrompt(segments.filter(s => s.t === 'text').map(s => s.text)) !== expected.prompt) return false
        if (videoKind === 'i2v') {
          const frames = await read(frameSlotsJs(composed.tokens))
          if (!frames?.framesMode || frames.slots?.length !== 2 || frames.slots[0].busy
            || frames.slots[0].mediaId !== ids[0] || !frames.slots[1].empty) return false
        }
        return await read(AGENT_OFF)
      }
      return !!st && !st.pickerOpen && Array.isArray(st.chips) && st.chips.length === 0
        && normalizePrompt(st.editorText) === prompt && await read(AGENT_OFF)
    }
    try {
      // Bounds all work, including downloads and a renderer that stops answering.
      timer = setTimeout(() => lease.abort('capture-timeout'), (pre?.timeoutMs || 120000) + 60000)
      // Cancellation must also abort an isolated read or network download that
      // is awaiting I/O, not only the next gallery polling iteration.
      cancellationTimer = setInterval(() => {
        if (deps.isFlowSafetyBlocked?.()) lease.abort('capture-aborted')
      }, 100)
      const result = await withViewport(view, '[Flow Image] [Passive]', async ctl => {
        const aborted = () => ctl.aborted || lease.signal.aborted || !!deps.isFlowSafetyBlocked?.()
        guard()
        const targets = { mode: videoKind ? 'video' : 'image', model: payload.model, ratio: payload.aspectRatio, count,
          ...(want ? { duration: want.duration, resolution: want.resolution } : {}) }
        if (ax) {
          const refGuard = () => { guard(); if (ctl.aborted) throw new Error('capture-aborted') }
          composed = await composeAccessible({ view, ax, guard:refGuard, pre, plan, targets, lease, deps, payload, project, videoKind })
          Object.assign(expected, { refs:composed.refs, mentions:composed.mentions, prompt:videoKind === 'i2v' ? prompt : composed.text })
        } else {
          if (!await read(READY) || !await read(AGENT_OFF)) return fail('composer-unavailable')
          const st = await read(composerStateJs({}))
          if (!st || st.pickerOpen || !Array.isArray(st.chips) || (!hasRefs && st.chips.length)) return fail('composer-not-clear')
          const controls = { trustedClickOnFlowView: deps.trustedClickOnFlowView, isAborted: aborted }
          const settings = await applyNativeSettings(view, targets, controls)
          guard()
          if (!settings.ok || ctl.aborted) return fail(settings.reason || 'settings-not-applied')
          if (hasRefs) {
            const refGuard = () => { guard(); if (ctl.aborted) throw new Error('capture-aborted') }
            composed = await prepareNativeReferences({ wc, deps, read, guard: refGuard, aborted, lease, project }, pre, plan)
            Object.assign(expected, { refs: composed.refs, mentions: composed.mentions, prompt: videoKind === 'i2v' ? prompt : composed.text })
            if (videoKind === 'i2v') {
              const frames = await applyNativeSettings(view, { ...targets, input: 'frames' }, controls)
              if (!frames.ok) return fail(frames.reason || 'frame-settings')
            }
          }
          if (!composed?.mentions.length || videoKind === 'i2v') {
            wc.focus()
            const focused = await deps.trustedClickOnFlowView(EDITOR, { required: true, step: 'compose-editor', beforeDispatch: async () => !aborted() })
            guard()
            if (!focused?.success) return fail('editor-not-focused')
            const typed = await deps.typeFlowText(wc, payload.prompt, { isAborted: aborted })
            guard()
            if (!typed?.ok) return fail(hasRefs ? 'reference-input-' + (typed?.reason || 'failed') : 'text-mismatch')
          }
        }
        if (ctl.aborted || !await composerMatches()) return fail(hasRefs ? 'reference-composer-changed' : 'text-mismatch')
        responseCapture = await deps.startResponseCapture(wc.session, { signal: lease.signal, projectId:project })
        guard()
        responseCapture.assertReady()
        deps.setShieldFocusTarget?.('main')
        deps.getMainWindow()?.webContents?.focus()
        await pause(500)
        // The native collector must be ready at the last dispatch gate, after
        // all asynchronous composer and current-scene checks.
        const submit = opts => ax ? ax.click(view, generationNode, { ...opts, validateSnapshot:composed.matchesRoot, dispatchGuard:() => { guard(); responseCapture.assertReady() } }) : deps.trustedClickOnFlowView(FIND_GENERATE_BUTTON_JS, opts)
        const click = await submit({ required: true, step: 'compose-submit', onDispatched: recordSubmission, beforeDispatch: async () => {
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
          if (journal) {
            const record = makeRecord()
            journal.reserve(scope, intent, record, row.previousId, epoch)
            reserved = record
          }
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
        if (videoKind && selected?.mediaId) {
          if (journal) journal.confirm(scope, reserved.id, selected.mediaId)
          return { success: true, generationId: selected.mediaId, creditsLeft: selected.creditsLeft }
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
      }, { shieldFlow: true, timeoutMs: pre?.timeoutMs })
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
      if (reserved && !dispatched && !lease.state().request) {
        try { journal.cancel(scope, reserved.id) } catch { /* keep uncertain until explicit reset */ }
      }
      clearTimeout(timer)
      clearInterval(cancellationTimer)
      for (const event of events) wc.removeListener(event, invalid)
      if (inputWatch) wc.removeListener('before-input-event', invalid)
      try { await responseCapture?.cancel() } catch { /* collector remains fail-closed until its drain ends */ }
      lease.release(success)
    }
  }
}
