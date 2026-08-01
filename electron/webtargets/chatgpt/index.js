import {
  RESERVED_ALLOWED_ORIGINS,
  RESERVED_SESSION_PARTITION,
} from '../../sessionViewSecurity.js'

export const CHATGPT_START_URL = 'https://chatgpt.com/'
export const CHATGPT_ALLOWED_ORIGINS = RESERVED_ALLOWED_ORIGINS

const BLOCKED_STATUS = 'session-blocked'
const RECOGNISED_SESSION_STATUSES = new Set([
  'ready',
  'login-required',
  'challenge',
  'rate-limited',
  BLOCKED_STATUS,
])

// R1 injection point: replace this only with an approved loginSignalSurface /
// sessionStateSignals probe. It deliberately does not inspect ChatGPT DOM or URL.
const unmeasuredSessionProbe = async () => BLOCKED_STATUS

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
  probeSession = unmeasuredSessionProbe,
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
