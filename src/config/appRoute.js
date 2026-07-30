export const MODE_STORAGE_KEY = 'autoflowcut_mode'
export const SESSION_TARGET_STORAGE_KEY = 'autoflowcut_session_target'
export const VALID_MODES = Object.freeze(['api', 'flow'])
export const VALID_SESSION_TARGETS = Object.freeze(['flow', 'chatgpt'])

const validMode = (value) => VALID_MODES.includes(value)
const validTarget = (value) => VALID_SESSION_TARGETS.includes(value)

export function parseRoute(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!validMode(value.mode) || !validTarget(value.sessionTarget)) return null
  return { mode: value.mode, sessionTarget: value.sessionTarget }
}

export function normalizeStoredRoute(mode, sessionTarget, log = console.warn) {
  if (mode == null) return null
  if (!validMode(mode)) return null
  if (sessionTarget == null) return { mode, sessionTarget: 'flow' }
  if (!validTarget(sessionTarget)) {
    log('[Route] invalid stored session target; recovered to flow')
    return { mode, sessionTarget: 'flow' }
  }
  return { mode, sessionTarget }
}

export function loadRoute(storage = globalThis.localStorage, log = console.warn) {
  return normalizeStoredRoute(
    storage.getItem(MODE_STORAGE_KEY),
    storage.getItem(SESSION_TARGET_STORAGE_KEY),
    log,
  )
}

export function serializeRoute(route) {
  const accepted = parseRoute(route)
  if (!accepted) throw new TypeError('invalid-route')
  return {
    [MODE_STORAGE_KEY]: accepted.mode,
    [SESSION_TARGET_STORAGE_KEY]: accepted.sessionTarget,
  }
}

export function saveRoute(storage, route) {
  const values = serializeRoute(route)
  storage.setItem(MODE_STORAGE_KEY, values[MODE_STORAGE_KEY])
  storage.setItem(SESSION_TARGET_STORAGE_KEY, values[SESSION_TARGET_STORAGE_KEY])
  return parseRoute(route)
}

export function clearRoute(storage) {
  storage.removeItem(MODE_STORAGE_KEY)
  storage.removeItem(SESSION_TARGET_STORAGE_KEY)
}

export const isSessionMode = (route) => parseRoute(route)?.mode === 'flow'
export const isFlowTarget = (route) => {
  const parsed = parseRoute(route)
  return parsed?.mode === 'flow' && parsed.sessionTarget === 'flow'
}
export const isChatgptTarget = (route) => {
  const parsed = parseRoute(route)
  return parsed?.mode === 'flow' && parsed.sessionTarget === 'chatgpt'
}

export function sourceForStage(route, stage) {
  const parsed = parseRoute(route)
  if (!parsed || !['image', 't2v', 'i2v'].includes(stage)) return null
  if (parsed.mode === 'api') return 'api'
  if (parsed.sessionTarget === 'flow') return 'flow'
  return stage === 'image' ? 'chatgpt' : 'api'
}
