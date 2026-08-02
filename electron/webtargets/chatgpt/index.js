import {
  RESERVED_ALLOWED_ORIGINS,
  RESERVED_SESSION_PARTITION,
} from '../../sessionViewSecurity.js'

export const CHATGPT_START_URL = 'https://chatgpt.com/'
export const CHATGPT_ALLOWED_ORIGINS = RESERVED_ALLOWED_ORIGINS

const BLOCKED_STATUS = 'session-blocked'
const LOAD_WAIT_TIMEOUT_MS = 15_000
const PROBE_EVALUATION_TIMEOUT_MS = 10_000
const AUTH_PROBE_ATTEMPTS = 5
const AUTH_PROBE_INTERVAL_MS = 500
const RECOGNISED_SESSION_STATUSES = new Set([
  'ready',
  'login-required',
  'challenge',
  'rate-limited',
  BLOCKED_STATUS,
])

const AUTH_PROBE = /* js */ `(() => {
  const composer = !!document.querySelector('#prompt-textarea');
  const loginCta = !!(document.querySelector('[data-testid="login-button"]') || document.querySelector('a[href*="/auth/login"]'));
  return { composer: composer, loginCta: loginCta };
})()`

function isLoggedIn(probe) {
  return probe?.composer === true && probe?.loginCta !== true
}

function isUnmeasuredProbe(probe) {
  return probe?.composer === false && probe?.loginCta === false
}

function statusFromAuthProbe(probe) {
  if (typeof probe?.composer !== 'boolean' || typeof probe?.loginCta !== 'boolean') {
    return BLOCKED_STATUS
  }
  if (isLoggedIn(probe)) return 'ready'
  return probe.loginCta ? 'login-required' : BLOCKED_STATUS
}

function withTimeout(operation, timeoutMs) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('session-probe-timeout')), timeoutMs)
  })
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timeoutId))
}

function whenLoaded(view, { timeoutMs = LOAD_WAIT_TIMEOUT_MS } = {}) {
  const webContents = view?.webContents
  if (!webContents || typeof webContents.isLoading !== 'function') return Promise.resolve(false)

  try {
    if (!webContents.isLoading()) return Promise.resolve(true)
  } catch {
    return Promise.resolve(false)
  }
  if (typeof webContents.on !== 'function') return Promise.resolve(false)

  return new Promise((resolve) => {
    let settled = false
    let timer
    const finish = (loaded) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { webContents.removeListener?.('did-finish-load', onFinish) } catch {}
      try { webContents.removeListener?.('did-fail-load', onFail) } catch {}
      resolve(loaded)
    }
    const onFinish = () => finish(true)
    const onFail = () => finish(false)
    timer = setTimeout(() => finish(false), timeoutMs)

    try {
      webContents.on('did-finish-load', onFinish)
      webContents.on('did-fail-load', onFail)
      // The load can finish between the first isLoading check and listener registration.
      if (!webContents.isLoading()) finish(true)
    } catch {
      finish(false)
    }
  })
}

async function measuredSessionProbe(view) {
  try {
    const webContents = view?.webContents
    if (!webContents || typeof webContents.executeJavaScript !== 'function') return BLOCKED_STATUS
    if (!await whenLoaded(view)) return BLOCKED_STATUS

    for (let attempt = 0; attempt < AUTH_PROBE_ATTEMPTS; attempt += 1) {
      const evaluation = Promise.resolve().then(() => webContents.executeJavaScript(AUTH_PROBE))
      const probe = await withTimeout(evaluation, PROBE_EVALUATION_TIMEOUT_MS)
      if (!isUnmeasuredProbe(probe)) return statusFromAuthProbe(probe)
      if (attempt < AUTH_PROBE_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, AUTH_PROBE_INTERVAL_MS))
      }
    }
    return BLOCKED_STATUS
  } catch {
    return BLOCKED_STATUS
  }
}

function normaliseSessionStatus(probeResult) {
  const candidate = typeof probeResult === 'string'
    ? probeResult
    : probeResult?.status ?? probeResult?.state
  return RECOGNISED_SESSION_STATUSES.has(candidate) ? candidate : BLOCKED_STATUS
}

export function createChatgptTarget({
  WebContentsView,
  reservedSessionWebPreferences,
  installReservedSessionSecurity,
  probeSession = measuredSessionProbe,
  createAdapter = () => null,
  logger = console,
} = {}) {
  let view = null
  let sessionStatus = {
    target: 'chatgpt',
    status: BLOCKED_STATUS,
    ready: false,
    revision: 0,
  }
  const statusListeners = new Set()
  let latestProbeSequence = 0

  const getSessionStatus = () => ({ ...sessionStatus })

  async function ensureSession() {
    const probeSequence = ++latestProbeSequence
    let probeResult
    try {
      probeResult = await probeSession(view)
    } catch {
      probeResult = BLOCKED_STATUS
    }
    // Freshness is invocation order, not completion order. did-finish-load, admission, and
    // explicit reconnect can overlap; an older observation must never publish after a newer one.
    if (probeSequence !== latestProbeSequence) return getSessionStatus()
    const status = normaliseSessionStatus(probeResult)
    const ready = status === 'ready'
    if (status !== sessionStatus.status || ready !== sessionStatus.ready) {
      sessionStatus = {
        target: 'chatgpt',
        status,
        ready,
        revision: sessionStatus.revision + 1,
      }
      const snapshot = getSessionStatus()
      for (const listener of statusListeners) listener(snapshot)
    }
    return getSessionStatus()
  }

  function createView() {
    if (typeof WebContentsView !== 'function' ||
        typeof reservedSessionWebPreferences !== 'function' ||
        typeof installReservedSessionSecurity !== 'function') {
      throw new TypeError('ChatGPT secure view dependencies are required')
    }
    const webPreferences = reservedSessionWebPreferences()
    const nextView = new WebContentsView({ webPreferences })
    installReservedSessionSecurity(nextView, nextView.webContents.session)
    view = nextView
    view.webContents.on('did-finish-load', () => ensureSession().catch((error) => {
      logger.warn('[ChatGPT] session probe failed', {
        name: typeof error?.name === 'string' ? error.name : 'Error',
      })
    }))
    return view
  }

  return Object.freeze({
    id: 'chatgpt',
    kind: 'image',
    partition: RESERVED_SESSION_PARTITION,
    startUrl: CHATGPT_START_URL,
    allowedOrigins: CHATGPT_ALLOWED_ORIGINS,
    createView,
    createAdapter: (...args) => createAdapter(...args),
    ensureSession,
    getSessionStatus,
    onSessionStatusChanged(listener) {
      if (typeof listener !== 'function') throw new TypeError('status listener must be a function')
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
  })
}

export default createChatgptTarget
