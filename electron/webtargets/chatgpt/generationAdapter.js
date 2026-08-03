import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SELECTORS = Object.freeze({
  composer: '#prompt-textarea',
  submit: '#composer-submit-button',
})

export const CDN_RE = /^https:\/\/chatgpt\.com\/backend-api\/estuary\/content\b/

export function norm(value) {
  return String(value == null ? '' : value)
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim()
}

export function buildImagePrompt(prompt) {
  const scene = norm(prompt).replace(/\s*[\r\n]\s*/g, ' ')
  return `Generate an image based on the following prompt: ${scene}`
}

export function idOf(src) {
  try {
    return new URL(String(src)).searchParams.get('id') || null
  } catch {
    return null
  }
}

export function baselineIdsOf(images) {
  const ids = []
  for (const image of Array.isArray(images) ? images : []) {
    const src = typeof image?.src === 'string' ? image.src : ''
    if (!CDN_RE.test(src)) continue
    const id = idOf(src)
    if (id) ids.push(id)
  }
  return ids
}

export function pickNewCdnImage(baselineIds, images) {
  const excluded = new Set(Array.isArray(baselineIds) ? baselineIds : [])
  const list = Array.isArray(images) ? images : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const image = list[index]
    const src = typeof image?.src === 'string' ? image.src : ''
    if (!CDN_RE.test(src)) continue
    const id = idOf(src)
    if (!id || excluded.has(id)) continue
    if (image.complete !== true || !(Number(image.w) > 0)) continue
    return { src, id, w: image.w, h: image.h }
  }
  return null
}

export const PAGE_FNS = /* js */ `
(() => {
  if (!window.__cg_v1) {
    const SEL = ${JSON.stringify(SELECTORS)};
    const norm = ${norm.toString()};
    const composerEl = () => document.querySelector(SEL.composer);
    const submitEl = () => document.querySelector(SEL.submit);
    const text = () => { const composer = composerEl(); return composer ? norm(composer.textContent) : null; };
    const state = (prompt) => {
      const current = text();
      return { textMatches: current !== null && current === norm(prompt), submitPresent: !!submitEl() };
    };
    const collect = () => Array.from(document.images || []).map((image) => ({
      src: String(image.currentSrc || image.src || ''),
      complete: image.complete === true,
      w: image.naturalWidth || 0,
      h: image.naturalHeight || 0,
    }));
    const snapshot = () => {
      const images = collect();
      const mainImages = document.querySelectorAll('main img');
      const last = mainImages.length
        ? mainImages[mainImages.length - 1]
        : (document.images && document.images.length ? document.images[document.images.length - 1] : null);
      try { if (last && last.scrollIntoView) last.scrollIntoView({ block: 'end' }); } catch {}
      return {
        imgs: images,
        href: location.href,
        alerts: document.querySelectorAll('[role="alert"]').length,
      };
    };

    window.__cg_baseline__ = function () { return snapshot(); };
    window.__cg_inject__ = function (prompt) {
      const composer = composerEl();
      if (!composer) return { textMatches: false, submitPresent: !!submitEl() };
      try { composer.focus(); } catch {}
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, String(prompt));
      } catch {}
      try {
        composer.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: String(prompt),
          inputType: 'insertText',
        }));
      } catch {}
      return state(prompt);
    };
    window.__cg_verify__ = function (prompt) { return state(prompt); };
    window.__cg_clickSubmit__ = function () {
      const button = submitEl();
      if (button) { try { button.click(); } catch {} }
      return { clicked: !!button };
    };
    window.__cg_submitAck__ = function (prompt) {
      const current = text();
      return {
        composerCleared: current === '',
        submitPresent: !!submitEl(),
        stillHasPrompt: current !== null && current === norm(prompt),
      };
    };
    window.__cg_poll__ = function () { return snapshot(); };
    window.__cg_v1 = true;
  }
})()`

export function callPage(fnName, ...args) {
  const serialized = args.map((arg) => JSON.stringify(arg)).join(', ')
  return `${PAGE_FNS};\nwindow.${fnName}(${serialized})`
}

export function clearComposerAndType(view, text) {
  const webContents = view.webContents
  webContents.focus()
  webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers: ['cmd'] })
  webContents.sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers: ['cmd'] })
  webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' })
  webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' })
  for (const character of Array.from(String(text))) {
    webContents.sendInputEvent({ type: 'char', keyCode: character })
  }
}

export function pressEnter(view) {
  const webContents = view.webContents
  webContents.focus()
  webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
  webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
  webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
}

function abortError() {
  const error = new Error('operation-aborted')
  error.name = 'AbortError'
  return error
}

function withAbortSignal(operation, signal) {
  if (!signal) return Promise.resolve(operation)
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(operation).then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export function withEvalTimeout(operation, timeoutMs, { signal, onTimeout } = {}) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.() } catch {}
      reject(new Error(`operation-timeout:${timeoutMs}`))
    }, timeoutMs)
  })
  Promise.resolve(operation).catch(() => {})
  return Promise.race([withAbortSignal(operation, signal), timeout]).finally(() => clearTimeout(timer))
}

function originOf(value) {
  try {
    return new URL(String(value)).origin
  } catch {
    return 'unknown-origin'
  }
}

function errorNameOf(error) {
  return typeof error?.name === 'string' && error.name ? error.name : 'Error'
}

export async function runGenerateStateMachine(view, prompt, deps = {}) {
  const {
    executeInView = (target, script) => target.webContents.executeJavaScript(script),
    reprobe = async () => true,
    log = console,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    typeText = clearComposerAndType,
    enter = pressEnter,
    deadlineMs = 120_000,
    cadenceMs = 1_500,
    maxRejectStreak = 3,
    maxContextResets = 2,
    evalTimeoutMs = 15_000,
    reprobeTimeoutMs = 5_000,
    signal,
  } = deps
  const prefix = '[ChatGPT Generation]'
  const cancelled = () => signal?.aborted === true
  const cancellationFailure = () => ({ ok: false, stage: 'cancel', detail: 'cancelled' })
  if (cancelled()) return cancellationFailure()
  const startedAt = now()
  const remaining = () => deadlineMs - (now() - startedAt)
  const expired = () => remaining() <= 0
  const streaks = new Map()
  const worstStreak = () => Math.max(0, ...streaks.values())
  let contextResets = 0

  const evalFn = async (fn, ...args) => {
    if (cancelled()) return { ok: false, cancelled: true }
    const budget = Math.max(1, Math.min(evalTimeoutMs, remaining()))
    try {
      const value = await withEvalTimeout(
        executeInView(view, callPage(fn, ...args)),
        budget,
        { signal },
      )
      if (cancelled()) return { ok: false, cancelled: true }
      streaks.set(fn, 0)
      return { ok: true, value }
    } catch (error) {
      if (cancelled() || error?.name === 'AbortError') return { ok: false, cancelled: true }
      streaks.set(fn, (streaks.get(fn) || 0) + 1)
      log.error?.(prefix, 'page evaluation rejected', {
        origin: originOf(view?.webContents?.getURL?.()),
        errorName: errorNameOf(error),
      })
      return { ok: false }
    }
  }

  const evalWithRetry = async (fn, ...args) => {
    for (let attempt = 0; attempt < maxRejectStreak; attempt += 1) {
      if (cancelled()) return { ok: false, cancelled: true }
      if (expired()) break
      const result = await evalFn(fn, ...args)
      if (result.cancelled) return result
      if (result.ok) return result
      if (expired() || attempt === maxRejectStreak - 1) break
      try {
        await withAbortSignal(sleep(Math.min(cadenceMs, Math.max(remaining(), 0))), signal)
      } catch (error) {
        if (cancelled() || error?.name === 'AbortError') return { ok: false, cancelled: true }
        throw error
      }
    }
    return { ok: false }
  }

  const safeReprobe = async () => {
    if (expired() || cancelled()) return false
    try {
      return await withEvalTimeout(
        Promise.resolve().then(() => reprobe()),
        Math.max(1, Math.min(reprobeTimeoutMs, remaining())),
        { signal },
      )
    } catch {
      return false
    }
  }
  const contextFailure = async (detail) => ({
    ok: false,
    stage: 'context',
    detail: `${detail}:${await safeReprobe() ? 'page-alive' : 'probe-failed'}`,
  })
  const contextCheck = async () => {
    if (worstStreak() < maxRejectStreak || expired()) return null
    if (!await safeReprobe()) return 'page-probe-failed'
    streaks.clear()
    contextResets += 1
    return contextResets > maxContextResets ? 'page-evaluations-repeatedly-failed' : null
  }

  const baseline = await evalWithRetry('__cg_baseline__')
  if (baseline.cancelled || cancelled()) return cancellationFailure()
  if (!baseline.ok) return contextFailure('baseline-rejected')
  if (!Array.isArray(baseline.value?.imgs)) return contextFailure('baseline-malformed')
  const excluded = new Set(baselineIdsOf(baseline.value.imgs))
  log.info?.(prefix, 'baseline ready', { origin: originOf(baseline.value?.href) })

  let injectMethod = 'execCommand'
  const injectedA = await evalWithRetry('__cg_inject__', prompt)
  if (injectedA.cancelled || cancelled()) return cancellationFailure()
  if (!injectedA.ok) return contextFailure('inject-rejected')
  if (typeof injectedA.value?.textMatches !== 'boolean') return contextFailure('inject-malformed')
  let injected = injectedA.value.textMatches === true
  if (!injected) {
    // The spike measured trusted char events only with ASCII. Keep non-ASCII fail-closed.
    // eslint-disable-next-line no-control-regex
    if (!/^[\x20-\x7E\r\n\t]*$/.test(prompt)) {
      return { ok: false, stage: 'inject', detail: 'non-ascii-fallback-unmeasured' }
    }
    injectMethod = 'sendInputEvent'
    try {
      typeText(view, prompt)
    } catch (error) {
      return { ok: false, stage: 'inject', detail: `trusted-input-${errorNameOf(error)}` }
    }
    const verified = await evalWithRetry('__cg_verify__', prompt)
    if (verified.cancelled || cancelled()) return cancellationFailure()
    if (!verified.ok) return contextFailure('verify-rejected')
    if (typeof verified.value?.textMatches !== 'boolean') return contextFailure('verify-malformed')
    injected = verified.value.textMatches === true
  }
  if (!injected) return { ok: false, stage: 'inject', detail: 'composer-text-mismatch' }

  let submitMethod = 'click'
  const clicked = await evalFn('__cg_clickSubmit__')
  if (clicked.cancelled || cancelled()) return cancellationFailure()
  let notSubmittedStreak = 0
  let submittedAck = false
  let enterTried = false
  let lastPollId = null
  let alertsLogged = false

  for (;;) {
    try {
      await withAbortSignal(sleep(Math.min(cadenceMs, Math.max(remaining(), 0))), signal)
    } catch (error) {
      if (cancelled() || error?.name === 'AbortError') return cancellationFailure()
      throw error
    }
    if (cancelled()) return cancellationFailure()
    if (expired()) break

    const acknowledgement = await evalFn('__cg_submitAck__', prompt)
    if (acknowledgement.cancelled || cancelled()) return cancellationFailure()
    if (!acknowledgement.ok) {
      notSubmittedStreak = 0
      const lost = await contextCheck()
      if (lost) return { ok: false, stage: 'context', detail: lost }
    } else {
      const ack = acknowledgement.value || {}
      const isSubmitted = ack.composerCleared === true
      const isNotSubmitted = ack.stillHasPrompt === true
      if (isSubmitted) submittedAck = true
      notSubmittedStreak = isNotSubmitted ? notSubmittedStreak + 1 : 0

      if (notSubmittedStreak >= 2 && submitMethod === 'click' && !enterTried && !submittedAck) {
        const recheck = await evalFn('__cg_submitAck__', prompt)
        if (recheck.cancelled || cancelled()) return cancellationFailure()
        if (!recheck.ok) {
          const lost = await contextCheck()
          if (lost) return { ok: false, stage: 'context', detail: lost }
        } else if (recheck.value?.stillHasPrompt === true) {
          try { enter(view) } catch {}
          enterTried = true
          submitMethod = 'enter'
        } else if (recheck.value?.composerCleared === true) {
          enterTried = true
          submittedAck = true
        }
      }
    }

    const poll = await evalFn('__cg_poll__')
    if (poll.cancelled || cancelled()) return cancellationFailure()
    if (!poll.ok) {
      const lost = await contextCheck()
      if (lost) return { ok: false, stage: 'context', detail: lost }
      continue
    }
    if (!Array.isArray(poll.value?.imgs)) return contextFailure('poll-malformed')
    if (!alertsLogged && Number(poll.value?.alerts) > 0) {
      alertsLogged = true
      log.info?.(prefix, 'page alert observed', { origin: originOf(poll.value?.href) })
    }

    // D3: anything observed before composer-clear acknowledgement belongs to the baseline.
    if (!submittedAck) {
      for (const id of baselineIdsOf(poll.value.imgs)) excluded.add(id)
      lastPollId = null
      continue
    }

    const candidate = pickNewCdnImage([...excluded], poll.value.imgs)
    // Measured stability rule: accept only the same estuary id on two consecutive polls.
    if (candidate && lastPollId === candidate.id) {
      log.info?.(prefix, 'image accepted', {
        origin: originOf(candidate.src),
      })
      return {
        ok: true,
        src: candidate.src,
        id: candidate.id,
        injectMethod,
        submitMethod,
      }
    }
    lastPollId = candidate?.id || null
  }

  return { ok: false, stage: submittedAck ? 'poll' : 'submit', detail: 'deadline' }
}

export function extFromContentType(contentType, src = '') {
  const normalized = String(contentType || '').toLowerCase().split(';')[0].trim()
  const known = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  }
  if (known[normalized]) return known[normalized]
  const match = String(src || '').match(/\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i)
  if (!match) return 'png'
  return match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
}

export async function saveImage(view, src, deps = {}) {
  const {
    fs = fsSync,
    outputDir = path.join(os.tmpdir(), 'autoflowcut-chatgpt'),
    now = () => Date.now(),
    timeoutMs = 60_000,
    signal,
  } = deps
  if (!CDN_RE.test(String(src))) throw new Error('chatgpt-image-source-unmeasured')
  const controller = new AbortController()
  const relayAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', relayAbort, { once: true })
  try {
    const response = await withEvalTimeout(
      view.webContents.session.fetch(src, { credentials: 'include', signal: controller.signal }),
      timeoutMs,
      { signal, onTimeout: () => controller.abort() },
    )
    if (!response?.ok) throw new Error(`chatgpt-image-fetch-status-${response?.status || 'missing'}`)
    const mimeType = String(response.headers?.get?.('content-type') || '').toLowerCase().split(';')[0].trim()
    if (!mimeType.startsWith('image/')) throw new Error('chatgpt-image-fetch-non-image')
    const bytes = Buffer.from(await withEvalTimeout(
      response.arrayBuffer(),
      timeoutMs,
      { signal, onTimeout: () => controller.abort() },
    ))
    const extension = extFromContentType(mimeType, src)
    fs.mkdirSync(outputDir, { recursive: true })
    const filePath = path.join(outputDir, `generated-${now()}.${extension}`)
    fs.writeFileSync(filePath, bytes)
    const base64 = bytes.toString('base64')
    return {
      filePath,
      mimeType,
      base64,
      dataUrl: `data:${mimeType};base64,${base64}`,
      mediaId: null,
    }
  } finally {
    signal?.removeEventListener('abort', relayAbort)
  }
}

const referenceRefusal = () => ({
  success: false,
  errorKind: 'chatgpt-reference-images-unmeasured',
  error: 'ChatGPT reference image upload is not measured and remains unavailable.',
})

const sessionRefusal = (status) => ({
  success: false,
  errorKind: 'chatgpt-session-not-ready',
  error: 'ChatGPT session is not ready. Log in and reconnect before generating.',
  sessionStatus: status || 'session-blocked',
})

const optionRefusal = (errorKind, option) => ({
  success: false,
  errorKind,
  error: `ChatGPT ${option} control is not measured, so this request was not submitted.`,
})

const cancellationRefusal = () => ({
  success: false,
  errorKind: 'chatgpt-generation-cancelled',
  error: 'ChatGPT image generation was cancelled.',
})

export function createChatgptGenerationAdapter({
  getView,
  ensureSession,
  executeInView,
  logger = console,
  fs = fsSync,
  getOutputDir = () => path.join(os.tmpdir(), 'autoflowcut-chatgpt'),
  now = () => Date.now(),
  createId = () => `chatgpt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  generateOptions = {},
  saveTimeoutMs = 60_000,
} = {}) {
  const jobs = new Map()
  let tail = Promise.resolve()

  const run = async (job) => {
    if (job.controller.signal.aborted) {
      Object.assign(job, { state: 'cancelled', result: cancellationRefusal() })
      return
    }
    job.state = 'running'
    let freshSession
    try {
      freshSession = await withAbortSignal(Promise.resolve().then(() => ensureSession?.()), job.controller.signal)
    } catch (error) {
      if (error?.name === 'AbortError') {
        Object.assign(job, { state: 'cancelled', result: cancellationRefusal() })
        return
      }
      throw error
    }
    if (!freshSession?.ready) {
      Object.assign(job, { state: 'failed', result: sessionRefusal(freshSession?.status) })
      return
    }
    const view = getView?.()
    if (!view?.webContents || typeof view.webContents.executeJavaScript !== 'function') {
      Object.assign(job, { state: 'failed', result: sessionRefusal('session-blocked') })
      return
    }
    try {
      const generated = await runGenerateStateMachine(view, buildImagePrompt(job.request.prompt), {
        executeInView,
        reprobe: async () => (await ensureSession?.())?.ready === true,
        log: logger,
        ...generateOptions,
        signal: job.controller.signal,
      })
      if (!generated.ok) {
        if (generated.stage === 'cancel' || job.controller.signal.aborted) {
          Object.assign(job, { state: 'cancelled', result: cancellationRefusal() })
          return
        }
        logger.error?.('[ChatGPT Generation]', 'job failed', {
          origin: originOf(view?.webContents?.getURL?.()),
          errorName: generated.detail || `stage-${generated.stage || 'failed'}`,
        })
        Object.assign(job, {
          state: 'failed',
          result: {
            success: false,
            errorKind: `chatgpt-generation-${generated.stage || 'failed'}`,
            error: `ChatGPT image generation failed during ${generated.stage || 'generation'}.`,
          },
        })
        return
      }
      const saved = await saveImage(view, generated.src, {
        fs,
        outputDir: getOutputDir(),
        now,
        timeoutMs: saveTimeoutMs,
        signal: job.controller.signal,
      })
      job.state = 'completed'
      // C2: the estuary content id stays main-process-only. Nothing in the renderer consumes
      // it (finalize reads base64/dataUrl/filePath/mediaId), so it must not cross IPC.
      job.result = {
        success: true,
        images: [saved],
      }
    } catch (error) {
      if (error?.name === 'AbortError' || job.controller.signal.aborted) {
        Object.assign(job, { state: 'cancelled', result: cancellationRefusal() })
        return
      }
      logger.error?.('[ChatGPT Generation]', 'job failed', {
        origin: originOf(view?.webContents?.getURL?.()),
        errorName: errorNameOf(error),
      })
      job.state = 'failed'
      job.result = {
        success: false,
        errorKind: 'chatgpt-generation-failed',
        error: `ChatGPT image generation failed (${errorNameOf(error)}).`,
      }
    }
  }

  const submit = async (request = {}) => {
    const referenceImages = request.referenceImages == null ? [] : request.referenceImages
    if (!Array.isArray(referenceImages) || referenceImages.length > 0) return referenceRefusal()
    if (request.batchCount != null && request.batchCount !== 1) {
      return optionRefusal('chatgpt-batch-count-unmeasured', 'batch count')
    }
    if (request.aspectRatio != null) {
      return optionRefusal('chatgpt-aspect-ratio-unmeasured', 'aspect ratio')
    }
    if (request.seed != null) {
      return optionRefusal('chatgpt-seed-unmeasured', 'seed')
    }
    if (!norm(request.prompt)) {
      return { success: false, errorKind: 'chatgpt-prompt-required', error: 'A text prompt is required.' }
    }
    const generationId = createId()
    const job = {
      generationId,
      state: 'queued',
      request: { ...request, referenceImages },
      result: null,
      controller: new AbortController(),
    }
    jobs.set(generationId, job)
    tail = tail.then(() => run(job), () => run(job))
    await tail
    if (job.state === 'failed' || job.state === 'cancelled') return job.result
    return { success: true, generationId }
  }

  const observe = async (generationId) => {
    const job = jobs.get(generationId)
    if (!job) return { success: false, completed: true, errorKind: 'chatgpt-generation-not-found', error: 'ChatGPT generation was not found.' }
    if (job.state === 'failed' || job.state === 'cancelled') return { ...job.result, completed: true, state: job.state }
    return { success: true, completed: job.state === 'completed', state: job.state }
  }

  const collect = async (generationId) => {
    const job = jobs.get(generationId)
    if (!job) return { success: false, errorKind: 'chatgpt-generation-not-found', error: 'ChatGPT generation was not found.' }
    // C4: every terminal collect (completed/failed/cancelled) deletes the entry — otherwise
    // cancelled jobs and their route-orphaned owner-map entries accumulate for the session.
    if (job.state === 'failed' || job.state === 'cancelled') {
      jobs.delete(generationId)
      return job.result
    }
    if (job.state !== 'completed') {
      return { success: false, errorKind: 'chatgpt-generation-pending', error: 'ChatGPT generation is still pending.' }
    }
    jobs.delete(generationId)
    return job.result
  }

  const clear = async () => {
    for (const [generationId, job] of jobs) {
      if (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') {
        jobs.delete(generationId)
      }
    }
    return { success: true }
  }

  const cancelAll = async () => {
    for (const job of jobs.values()) {
      if (job.state === 'queued' || job.state === 'running') job.controller.abort()
    }
    return { success: true }
  }

  return Object.freeze({
    submit,
    observe,
    collect,
    clear,
    cancelAll,
    awaitIdle: () => tail,
  })
}
