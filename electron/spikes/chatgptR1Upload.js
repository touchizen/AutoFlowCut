import fs from 'node:fs/promises'
import path from 'node:path'

export const CHATGPT_R1_SHORTCUT = 'CommandOrControl+Shift+R'
export const CHATGPT_R1_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+S'
export const CHATGPT_R1_RESET_SHORTCUT = 'CommandOrControl+Shift+B'
export const CHATGPT_R1_NEXT_SHORTCUT = 'CommandOrControl+Shift+Right'
export const CHATGPT_R1_CLOSE_SHORTCUT = 'CommandOrControl+Shift+X'
export const CHATGPT_R1_URL = 'https://chatgpt.com/'
export const BLOCKED_LOGIN_SIGNAL = 'BLOCKED: human ChatGPT login required'

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

async function writeEvidenceFiles({
  caseId,
  repetition,
  snapshot,
  screenshot,
  events,
  evidenceRoot = path.join(process.cwd(), 'docs', 'superpowers', 'spikes', 'evidence', 'chatgpt-r1'),
}) {
  const baseName = `${caseId}-r${repetition}-${timestampSlug()}`
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

function createHarness({
  WebContentsView,
  getMainWindow,
  reservedSessionWebPreferences,
  installReservedSessionSecurity,
  logger,
  writeEvidence,
  wait,
  suspendProductSessionView,
}) {
  let view = null
  let status = 'idle'
  let blockedReported = false
  let readyReported = false
  let authenticationProbe = null
  let attached = false
  let restoreProductSessionView = null

  const getState = () => ({ status })

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
      return probeAuthentication()
    }

    // Hard order: factory → view → real two-argument security install → attach → load.
    const webPreferences = reservedSessionWebPreferences()
    const nextView = new WebContentsView({ webPreferences })
    installReservedSessionSecurity(nextView, nextView.webContents.session)
    view = nextView
    view.webContents.on('did-finish-load', () => probeAuthentication().catch((error) => {
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
    return probeAuthentication()
  }

  async function captureEvidence({ caseId, repetition, events = [] }) {
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

  return { open, close, probeAuthentication, captureEvidence, resetConversation, getState, getView: () => view }
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
  wait = waitFor,
  suspendProductSessionView = () => null,
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
    wait,
    suspendProductSessionView,
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
  const registered = controls.every(([shortcut, callback]) => globalShortcut.register(shortcut, callback))
  if (!registered) {
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
    getMeasurementCursor,
  }
}
