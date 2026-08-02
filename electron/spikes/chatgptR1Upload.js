import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildImageSizeLadder,
  padPngToExactSize,
} from './lib/imageSizeLadder.js'

export const CHATGPT_R1_SHORTCUT = 'CommandOrControl+Shift+R'
export const CHATGPT_R1_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+S'
export const CHATGPT_R1_RESET_SHORTCUT = 'CommandOrControl+Shift+B'
export const CHATGPT_R1_NEXT_SHORTCUT = 'CommandOrControl+Shift+Right'
export const CHATGPT_R1_CLOSE_SHORTCUT = 'CommandOrControl+Shift+X'
export const CHATGPT_R1_URL = 'https://chatgpt.com/'
export const BLOCKED_LOGIN_SIGNAL = 'BLOCKED: human ChatGPT login required'
export const R1_MEASUREMENT_RUNTIME_REQUIRED_SIGNAL = 'BLOCKED: runtime-observed R1 measurement adapter required'

const R1_FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'chatgpt-r1')
const R1_RESULT_PATH = path.join(
  process.cwd(),
  'docs',
  'superpowers',
  'spikes',
  '2026-07-31-chatgpt-r1-reference-upload.md',
)
const REQUIRED_MEASUREMENT_RUNTIME_METHODS = Object.freeze([
  'getSafetyCeilingBytes',
  'observeSurface',
  'executeCase',
  'reviewCase',
  'finalize',
])

export const R1_CASE_MATRIX = Object.freeze([
  Object.freeze({ id: 'AUTH-FRESH', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'ATTACH-FILE-INPUT-SINGLE', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'ATTACH-CLIPBOARD-SINGLE', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'ATTACH-OBSERVED-DROP-SINGLE', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'ATTACH-MULTI-COUNT', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'MIME-PNG', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'MIME-JPEG', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'MIME-INVALID', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'DUPLICATE-FILE', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'SUBMIT-DURING-UPLOAD', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'REMOVE-AFTER-ATTACH', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'SIZE-LADDER', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'SIZE-BOUNDARY-LOW', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'SIZE-BOUNDARY-HIGH', repetitions: 3, operatorReview: true }),
  Object.freeze({ id: 'AUTH-RELOAD-RESTART', repetitions: 3, operatorReview: true }),
])

export const R1_PRE_EXECUTION_CHECKLIST = `
[ChatGPTR1] R1 PRE-EXECUTION CHECKLIST
- Confirm the authenticated composer exposes both previously confirmed scalar surfaces.
- Set AUTOFLOWCUT_R1_RUNTIME_MODULE to a local adapter that supplies runtime-observed mechanism, surface, and outcomes; without it measurement fails closed.
- Record an operator-approved image-byte safety ceiling before building the 256 KiB doubling ladder.
- Use a new blank conversation for every repetition; stable claims require at least 3 repetitions.
- Observe a surface before attempting file-input, clipboard, or drop attachment; do not invent selectors.
- Capture sanitized DOM, capturePage screenshot, and timestamped event trace for every case.
- Do not count an attachment chip as support; a human must verify the submitted assistant turn used the reference.
- Record only origins for redirects/blocked navigation. Never record cookies, tokens, signed URLs, or page text.
- Keep largestVerifiedBytes separate from firstRejectedBytes; unstable/missing boundaries cannot claim a vendor maximum.
`.trim()

const AUTH_PROBE = `(() => ({
  composerReady: Boolean(
    document.querySelector('#prompt-textarea') &&
    document.querySelector('#composer-submit-button')
  )
}))()`

// Captures structure and a narrow safe attribute allowlist only. It deliberately
// excludes text, HTML, href/src/action/value, styles, and arbitrary data fields.
const SANITIZED_COMPOSER_SNAPSHOT = `(() => {
  const prompt = document.querySelector('#prompt-textarea');
  if (!prompt) return { observed: false, nodes: [] };
  const root = prompt.closest('form') || prompt.parentElement;
  if (!root) return { observed: false, nodes: [] };
  const safeAttributes = new Set([
    'id', 'role', 'type', 'name', 'accept', 'multiple', 'disabled',
    'aria-label', 'aria-describedby', 'aria-controls', 'data-testid'
  ]);
  const nodes = [root, ...root.querySelectorAll('*')].map((node) => {
    const attributes = {};
    for (const attribute of node.attributes || []) {
      if (safeAttributes.has(attribute.name)) attributes[attribute.name] = attribute.value;
    }
    return { tag: node.tagName.toLowerCase(), attributes };
  });
  return { observed: true, nodes };
})()`

function safeErrorIdentity(error) {
  return {
    name: typeof error?.name === 'string' ? error.name : 'Error',
    code: typeof error?.code === 'string' ? error.code : undefined,
  }
}

function waitFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function sanitizeEvidenceEvent(entry) {
  const result = {
    at: typeof entry?.at === 'string' && !Number.isNaN(Date.parse(entry.at))
      ? new Date(entry.at).toISOString()
      : new Date().toISOString(),
    event: typeof entry?.event === 'string' && /^[A-Z][A-Z0-9_-]{0,63}$/.test(entry.event)
      ? entry.event
      : 'REDACTED',
  }
  if (typeof entry?.url === 'string') {
    try { result.origin = new URL(entry.url).origin } catch { /* Never retain the unparsed URL. */ }
  }
  return result
}

export function isChatgptR1HarnessEnabled({
  platform,
  isPackaged,
  viteDevServerUrl,
  spikeFlag,
}) {
  const isDevRuntime = Boolean(viteDevServerUrl) || !isPackaged
  return platform === 'darwin' && isDevRuntime && spikeFlag === '1'
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

export async function loadR1MeasurementRuntime(
  { modulePath } = {},
  { cwd = process.cwd(), importModule = (specifier) => import(specifier) } = {},
) {
  const configuredPath = typeof modulePath === 'string' ? modulePath.trim() : ''
  if (!configuredPath) return null
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(configuredPath)) {
    throw new TypeError('AUTOFLOWCUT_R1_RUNTIME_MODULE must be a local filesystem path')
  }
  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(cwd, configuredPath)
  const runtimeModule = await importModule(pathToFileURL(absolutePath).href)
  return runtimeModule?.default ?? runtimeModule?.measurementRuntime ?? null
}

async function writeEvidenceFiles({
  caseId,
  repetition,
  phase = 'capture',
  snapshot,
  screenshot,
  events,
  evidenceRoot = path.join(process.cwd(), 'docs', 'superpowers', 'spikes', 'evidence', 'chatgpt-r1'),
}) {
  const baseName = `${caseId}-r${repetition}-${phase}-${timestampSlug()}`
  await fs.mkdir(evidenceRoot, { recursive: true })
  const domPath = path.join(evidenceRoot, `${baseName}-dom.json`)
  const screenshotPath = path.join(evidenceRoot, `${baseName}.png`)
  const tracePath = path.join(evidenceRoot, `${baseName}-events.json`)
  await Promise.all([
    fs.writeFile(domPath, JSON.stringify(snapshot, null, 2)),
    fs.writeFile(screenshotPath, screenshot),
    fs.writeFile(tracePath, JSON.stringify(events, null, 2)),
  ])
  return { domPath, screenshotPath, tracePath }
}

function reportValue(value) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'none observed'
  if (value && typeof value === 'object') return JSON.stringify(value)
  if (value === null || value === undefined || value === '') return 'not observed'
  return String(value)
}

function sanitizeRedirectOrigins(origins) {
  if (!Array.isArray(origins)) return []
  return origins.flatMap((candidate) => {
    try { return [new URL(candidate).origin] } catch { return [] }
  })
}

export async function writeR1ResultFile(
  { result, journal },
  { resultPath = R1_RESULT_PATH, fileSystem = fs } = {},
) {
  const redirectOrigins = sanitizeRedirectOrigins(result?.observedRedirectOrigins)
  const evidencePaths = (Array.isArray(journal) ? journal : []).flatMap((entry) => [
    ...Object.values(entry?.evidence?.pre || {}),
    ...Object.values(entry?.evidence?.post || {}),
  ]).filter((entry) => typeof entry === 'string')
  const report = [
    '# ChatGPT R1 reference upload measurement',
    '',
    `Outcome: ${reportValue(result?.outcome)}`,
    `Supported: ${reportValue(result?.supported)}`,
    `Mechanism: ${reportValue(result?.mechanism)}`,
    `Observed DOM surface: ${reportValue(result?.observedDomSurface)}`,
    `Accepted MIME: ${reportValue(result?.acceptedMimeTypes)}`,
    `Largest verified bytes: ${reportValue(result?.largestVerifiedBytes)}`,
    `First rejected bytes: ${reportValue(result?.firstRejectedBytes)}`,
    `Supported max bytes: ${reportValue(result?.supportedMaxBytes)}`,
    `Boundary reproducible: ${reportValue(result?.boundaryReproducible)}`,
    `Measured max count: ${reportValue(result?.maxCount)}`,
    `Minimum repetitions: ${reportValue(result?.minRepetitions)}`,
    `Upload-ready predicate: ${reportValue(result?.uploadReadySignal)}`,
    `Login signal surface: ${reportValue(result?.loginSignalSurface)}`,
    `Session state signals: ${reportValue(result?.sessionStateSignals)}`,
    `Observed redirect origins: ${reportValue(redirectOrigins)}`,
    `Failure modes: ${reportValue(result?.failureModes)}`,
    `Evidence: ${reportValue(evidencePaths)}`,
    '',
  ].join('\n')
  await fileSystem.mkdir(path.dirname(resultPath), { recursive: true })
  await fileSystem.writeFile(resultPath, report, 'utf8')
  return resultPath
}

async function loadR1Fixtures() {
  const [pngBytes, jpegBytes] = await Promise.all([
    fs.readFile(path.join(R1_FIXTURE_DIR, 'reference-a.png')),
    fs.readFile(path.join(R1_FIXTURE_DIR, 'reference-b.jpg')),
  ])
  return Object.freeze({
    png: Object.freeze({ name: 'reference-a.png', mime: 'image/png', bytes: pngBytes }),
    jpeg: Object.freeze({ name: 'reference-b.jpg', mime: 'image/jpeg', bytes: jpegBytes }),
    invalid: Object.freeze({
      name: 'reference-invalid.txt',
      mime: 'text/plain',
      bytes: Buffer.from('AutoFlowCut R1 invalid image fixture', 'utf8'),
    }),
  })
}

function assertRuntimeResult(result, journalLength) {
  const requiredFields = [
    'supported', 'mechanism', 'observedDomSurface', 'acceptedMimeTypes',
    'largestVerifiedBytes', 'firstRejectedBytes', 'supportedMaxBytes',
    'boundaryReproducible', 'maxCount', 'uploadReadySignal',
    'loginSignalSurface', 'sessionStateSignals', 'observedRedirectOrigins',
    'minRepetitions', 'failureModes',
  ]
  if (!result || !/^R1-[A-E]$/.test(result.outcome || '')) {
    throw new TypeError('runtime finalize must return an R1-A through R1-E outcome')
  }
  const missing = requiredFields.filter((field) => !Object.hasOwn(result, field))
  if (missing.length > 0) throw new TypeError(`runtime finalize missing fields: ${missing.join(', ')}`)
  if (!Number.isInteger(result.minRepetitions) || result.minRepetitions < 3) {
    throw new TypeError('runtime finalize minRepetitions must be at least 3')
  }
  if (journalLength === 0) throw new TypeError('runtime finalize requires measured cases')
}

export async function runR1CaseMatrix({
  measurementRuntime,
  webContents,
  resetConversation,
  captureEvidence,
  writeResult = writeR1ResultFile,
  loadFixtures = loadR1Fixtures,
  caseMatrix = R1_CASE_MATRIX,
  logger = console,
}) {
  const missing = REQUIRED_MEASUREMENT_RUNTIME_METHODS.filter(
    (method) => typeof measurementRuntime?.[method] !== 'function',
  )
  if (missing.length > 0) {
    logger.warn(R1_MEASUREMENT_RUNTIME_REQUIRED_SIGNAL)
    return { status: 'blocked', signal: R1_MEASUREMENT_RUNTIME_REQUIRED_SIGNAL, missing }
  }

  const fixtures = await loadFixtures()
  const safetyCeilingBytes = await measurementRuntime.getSafetyCeilingBytes({ webContents })
  const sizeLadder = buildImageSizeLadder({ safetyCeilingBytes }).map((targetBytes) => Object.freeze({
    name: `reference-a-${targetBytes}.png`,
    mime: 'image/png',
    bytes: padPngToExactSize(fixtures.png.bytes, targetBytes),
  }))
  const surface = await measurementRuntime.observeSurface({ webContents })
  if (!surface || typeof surface !== 'object') {
    throw new TypeError('runtime observeSurface must return observed DOM facts')
  }

  const page = Object.freeze({
    executeJavaScript: (...args) => webContents.executeJavaScript(...args),
    sendInputEvent: (...args) => webContents.sendInputEvent(...args),
    capturePage: (...args) => webContents.capturePage(...args),
  })
  const journal = []
  for (const definition of caseMatrix) {
    for (let repetition = 1; repetition <= definition.repetitions; repetition += 1) {
      const reset = await resetConversation()
      if (reset?.status !== 'ready') return reset
      const pre = await captureEvidence({
        caseId: definition.id,
        repetition,
        phase: 'pre',
        events: [{ at: new Date().toISOString(), event: 'CASE_STARTED' }],
      })
      const attempt = await measurementRuntime.executeCase({
        caseId: definition.id,
        repetition,
        definition,
        surface,
        fixtures,
        sizeLadder,
        priorResults: journal.slice(),
        page,
      })
      if (!attempt || typeof attempt.outcome !== 'string' || !Array.isArray(attempt.events)) {
        throw new TypeError('runtime executeCase must return an outcome and event trace')
      }
      const review = await measurementRuntime.reviewCase({
        caseId: definition.id,
        repetition,
        definition,
        surface,
        attempt,
        page,
      })
      if (!review || typeof review.verdict !== 'string') {
        throw new TypeError('runtime reviewCase must return an operator verdict')
      }
      const post = await captureEvidence({
        caseId: definition.id,
        repetition,
        phase: 'post',
        events: attempt.events,
      })
      journal.push(Object.freeze({
        caseId: definition.id,
        repetition,
        outcome: attempt.outcome,
        review,
        evidence: { pre: pre?.evidencePaths || pre, post: post?.evidencePaths || post },
      }))
    }
  }

  const result = await measurementRuntime.finalize({
    surface,
    fixtures,
    sizeLadder,
    journal: journal.slice(),
  })
  assertRuntimeResult(result, journal.length)
  const resultPath = await writeResult({ result, journal })
  return { status: 'completed', result, resultPath, journal }
}

function createHarness({
  WebContentsView,
  getMainWindow,
  reservedSessionWebPreferences,
  installReservedSessionSecurity,
  logger,
  writeEvidence,
  writeResult,
  wait,
  suspendProductSessionView,
  measurementRuntime,
  loadMeasurementRuntime,
}) {
  let view = null
  let status = 'idle'
  let blockedReported = false
  let readyReported = false
  let authenticationProbe = null
  let attached = false
  let restoreProductSessionView = null
  let measurementPromise = null
  let measurementState = { status: 'idle' }

  const getState = () => ({ status })
  const getMeasurementState = () => ({ ...measurementState })

  function startMeasurement() {
    if (measurementPromise) return measurementPromise
    if (status !== 'ready' || !view) {
      return Promise.resolve({ status: 'blocked', signal: BLOCKED_LOGIN_SIGNAL })
    }
    measurementState = { status: 'running' }
    measurementPromise = Promise.resolve()
      .then(() => measurementRuntime || loadMeasurementRuntime?.())
      .then((resolvedRuntime) => runR1CaseMatrix({
        measurementRuntime: resolvedRuntime,
        webContents: view.webContents,
        resetConversation,
        captureEvidence,
        writeResult,
        logger,
      }))
      .then((result) => {
        measurementState = result
        return result
      }).catch((error) => {
        const result = {
          status: 'blocked',
          signal: 'BLOCKED: R1 measurement execution failed',
          error: safeErrorIdentity(error),
        }
        measurementState = result
        logger.error('[ChatGPTR1] measurement execution failed', safeErrorIdentity(error))
        return result
      })
    return measurementPromise
  }

  async function runAuthenticationProbe() {
    if (!view) return { status: 'idle' }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      let probe
      try {
        probe = await view.webContents.executeJavaScript(AUTH_PROBE)
      } catch (error) {
        status = 'blocked'
        if (!blockedReported) {
          logger.warn(BLOCKED_LOGIN_SIGNAL)
          logger.warn('[ChatGPTR1] AUTH_PROBE unavailable', safeErrorIdentity(error))
          blockedReported = true
        }
        return { status: 'blocked', signal: BLOCKED_LOGIN_SIGNAL }
      }

      if (probe?.composerReady === true) {
        status = 'ready'
        blockedReported = false
        if (!readyReported) {
          logger.log(R1_PRE_EXECUTION_CHECKLIST)
          readyReported = true
        }
        return { status: 'ready' }
      }
      if (attempt < 19) await wait(500)
    }

    status = 'blocked'
    if (!blockedReported) logger.warn(BLOCKED_LOGIN_SIGNAL)
    blockedReported = true
    return { status: 'blocked', signal: BLOCKED_LOGIN_SIGNAL }
  }

  function probeAuthentication() {
    if (authenticationProbe) return authenticationProbe
    authenticationProbe = runAuthenticationProbe().finally(() => { authenticationProbe = null })
    return authenticationProbe
  }

  function attachViewToWindow(nextView) {
    if (attached) return
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('ChatGPT R1 requires an open main window')
    restoreProductSessionView = suspendProductSessionView?.() || null
    try {
      mainWindow.contentView.addChildView(nextView)
      const [width, height] = mainWindow.getContentSize()
      nextView.setBounds({ x: 0, y: 0, width, height })
      attached = true
    } catch (error) {
      restoreProductSessionView?.()
      restoreProductSessionView = null
      throw error
    }
  }

  async function open() {
    if (view) {
      attachViewToWindow(view)
      view.webContents.focus()
      const result = await probeAuthentication()
      if (result?.status === 'ready') void startMeasurement()
      return result
    }

    // Hard order: factory → view → real two-argument security install → attach → load.
    const webPreferences = reservedSessionWebPreferences()
    const nextView = new WebContentsView({ webPreferences })
    installReservedSessionSecurity(nextView, nextView.webContents.session)
    view = nextView
    view.webContents.on('did-finish-load', () => probeAuthentication()
      .then((result) => {
        if (result?.status === 'ready') return startMeasurement()
        return result
      })
      .catch((error) => {
        logger.error('[ChatGPTR1] AUTH_PROBE failed', safeErrorIdentity(error))
      }))
    attachViewToWindow(view)

    try {
      await view.webContents.loadURL(CHATGPT_R1_URL)
    } catch (error) {
      status = 'blocked'
      logger.error('[ChatGPTR1] ChatGPT load failed', safeErrorIdentity(error))
      if (!blockedReported) logger.warn(BLOCKED_LOGIN_SIGNAL)
      blockedReported = true
      return { status: 'blocked', signal: BLOCKED_LOGIN_SIGNAL }
    }
    view.webContents.focus()
    const result = await probeAuthentication()
    if (result?.status === 'ready') void startMeasurement()
    return result
  }

  async function captureEvidence({ caseId, repetition, phase = 'capture', events = [] }) {
    if (status !== 'ready' || !view) {
      logger.warn(BLOCKED_LOGIN_SIGNAL)
      return { status: 'blocked', signal: BLOCKED_LOGIN_SIGNAL }
    }
    if (!R1_CASE_MATRIX.some((entry) => entry.id === caseId)) throw new TypeError('unknown R1 caseId')
    if (!Number.isInteger(repetition) || repetition < 1) throw new TypeError('repetition must be a positive integer')

    const [snapshot, nativeImage] = await Promise.all([
      view.webContents.executeJavaScript(SANITIZED_COMPOSER_SNAPSHOT),
      view.webContents.capturePage(),
    ])
    const evidencePaths = await writeEvidence({
      caseId,
      repetition,
      phase,
      snapshot,
      screenshot: nativeImage.toPNG(),
      events: events.map(sanitizeEvidenceEvent),
    })
    return { status: 'captured', evidencePaths }
  }

  async function resetConversation() {
    if (status !== 'ready' || !view) {
      logger.warn(BLOCKED_LOGIN_SIGNAL)
      return { status: 'blocked', signal: BLOCKED_LOGIN_SIGNAL }
    }
    status = 'resetting'
    try {
      await view.webContents.loadURL(CHATGPT_R1_URL)
    } catch (error) {
      status = 'blocked'
      logger.error('[ChatGPTR1] conversation reset failed', safeErrorIdentity(error))
      return { status: 'blocked', signal: BLOCKED_LOGIN_SIGNAL }
    }
    return probeAuthentication()
  }

  function close() {
    if (!view || !attached) return { status: 'idle' }
    const mainWindow = getMainWindow()
    try { mainWindow?.contentView?.removeChildView?.(view) } catch { /* spike close still restores product view */ }
    attached = false
    const restore = restoreProductSessionView
    restoreProductSessionView = null
    restore?.()
    status = 'idle'
    return { status: 'idle' }
  }

  return {
    open,
    close,
    probeAuthentication,
    captureEvidence,
    resetConversation,
    startMeasurement,
    awaitMeasurement: startMeasurement,
    getMeasurementState,
    getState,
    getView: () => view,
  }
}

/**
 * Registers the R1 harness only behind the exact macOS development spike gate.
 * No view is created and no URL is loaded until the operator presses the shortcut.
 */
export function registerChatgptR1Harness({
  app,
  globalShortcut,
  WebContentsView,
  getMainWindow,
  platform = process.platform,
  env = process.env,
  reservedSessionWebPreferences,
  installReservedSessionSecurity,
  logger = console,
  writeEvidence = writeEvidenceFiles,
  writeResult = writeR1ResultFile,
  wait = waitFor,
  suspendProductSessionView = () => null,
  measurementRuntime = null,
  loadMeasurementRuntime = () => loadR1MeasurementRuntime({
    modulePath: env.AUTOFLOWCUT_R1_RUNTIME_MODULE,
  }),
}) {
  if (!isChatgptR1HarnessEnabled({
    platform,
    isPackaged: app.isPackaged,
    viteDevServerUrl: env.VITE_DEV_SERVER_URL,
    spikeFlag: env.AUTOFLOWCUT_SPIKE,
  })) return { registered: false }

  const harness = createHarness({
    WebContentsView,
    getMainWindow,
    reservedSessionWebPreferences,
    installReservedSessionSecurity,
    logger,
    writeEvidence,
    writeResult,
    wait,
    suspendProductSessionView,
    measurementRuntime,
    loadMeasurementRuntime,
  })
  let caseIndex = 0
  let repetition = 1
  const getMeasurementCursor = () => ({
    caseId: R1_CASE_MATRIX[caseIndex].id,
    repetition,
  })
  const announceCursor = () => {
    const cursor = getMeasurementCursor()
    logger.log(`[ChatGPTR1] selected ${cursor.caseId} repetition ${cursor.repetition}`)
    return cursor
  }
  const advanceMeasurement = () => {
    repetition += 1
    if (repetition > R1_CASE_MATRIX[caseIndex].repetitions) {
      repetition = 1
      caseIndex = (caseIndex + 1) % R1_CASE_MATRIX.length
    }
    return announceCursor()
  }
  const captureCurrentEvidence = () => {
    const cursor = getMeasurementCursor()
    return harness.captureEvidence({
      ...cursor,
      events: [{ at: new Date().toISOString(), event: 'OPERATOR_CAPTURE' }],
    })
  }
  const resetAndAdvance = async () => {
    const result = await harness.resetConversation()
    if (result?.status === 'ready') advanceMeasurement()
    return result
  }
  const controls = [
    [CHATGPT_R1_SHORTCUT, () => harness.open()],
    [CHATGPT_R1_CAPTURE_SHORTCUT, captureCurrentEvidence],
    [CHATGPT_R1_RESET_SHORTCUT, resetAndAdvance],
    [CHATGPT_R1_NEXT_SHORTCUT, resetAndAdvance],
    [CHATGPT_R1_CLOSE_SHORTCUT, () => harness.close()],
  ]
  const registeredShortcuts = []
  let registrationFailed = false
  for (const [shortcut, callback] of controls) {
    try {
      if (globalShortcut.register(shortcut, callback)) registeredShortcuts.push(shortcut)
      else registrationFailed = true
    } catch {
      registrationFailed = true
    }
  }
  if (registrationFailed) {
    for (const shortcut of registeredShortcuts) {
      try { globalShortcut.unregister(shortcut) } catch { /* best-effort rollback of this attempt */ }
    }
    logger.error('[ChatGPTR1] shortcut registration failed')
    return { registered: false }
  }

  logger.log(`[ChatGPTR1] harness armed; open ${CHATGPT_R1_SHORTCUT}; capture ${CHATGPT_R1_CAPTURE_SHORTCUT}; reset/advance ${CHATGPT_R1_RESET_SHORTCUT}; next ${CHATGPT_R1_NEXT_SHORTCUT}; close ${CHATGPT_R1_CLOSE_SHORTCUT}`)
  announceCursor()
  return {
    registered: true,
    shortcut: CHATGPT_R1_SHORTCUT,
    open: harness.open,
    captureEvidence: harness.captureEvidence,
    captureCurrentEvidence,
    resetConversation: harness.resetConversation,
    resetAndAdvance,
    advanceMeasurement,
    close: harness.close,
    getState: harness.getState,
    startMeasurement: harness.startMeasurement,
    awaitMeasurement: harness.awaitMeasurement,
    getMeasurementState: harness.getMeasurementState,
    getMeasurementCursor,
  }
}
