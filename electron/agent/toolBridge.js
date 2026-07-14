import { randomUUID } from 'node:crypto'

/** renderer 에 맡길 수 있는 작업은 D14가 확정한 두 경계로만 닫는다. */
const ALLOWED_TOOLS = new Set(['video.admit', 'video.status'])
const DEFAULT_TIMEOUT_MS = 30_000
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function rendererError(error) {
  if (error instanceof Error) return error
  if (typeof error === 'string') return new Error(error)
  if (error && typeof error.message === 'string') return new Error(error.message)

  try {
    return new Error(JSON.stringify(error))
  } catch {
    return new Error(String(error))
  }
}

function isWindowAlive(window) {
  if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) return false
  if (!window.webContents || typeof window.webContents.send !== 'function') return false
  return typeof window.webContents.isDestroyed !== 'function' || !window.webContents.isDestroyed()
}

/**
 * Tool Core 와 renderer 사이의 request/response 수명을 main 에 둔다 (스펙 D14).
 *
 * 🔴 correlation id 를 Map 에서 먼저 제거한 뒤 settle 한다. renderer 가 중복 응답하거나
 *    timeout 뒤 늦게 답해도 이미 호출자가 본 결과를 덮거나 다른 요청을 깨울 수 없어야 한다.
 */
export function createToolBridge({ getWindow }) {
  if (typeof getWindow !== 'function') throw new TypeError('getWindow must be a function')

  const pending = new Map()
  const operations = new Map()
  let closed = false
  let watchedWindow = null
  let detachWindowListeners = () => {}

  function settle(requestId, outcome, value) {
    const entry = pending.get(requestId)
    if (!entry) return false

    // 먼저 지워야 resolve/reject 중 재진입과 중복 renderer 응답도 정확히 한 번으로 닫힌다.
    pending.delete(requestId)
    clearTimeout(entry.timer)
    entry[outcome](value)
    return true
  }

  function rejectAll(error) {
    for (const requestId of [...pending.keys()]) settle(requestId, 'reject', error)
  }

  function watchWindow(window) {
    if (watchedWindow === window) return

    detachWindowListeners()
    watchedWindow = window

    const removers = []
    const onDestroyed = () => {
      // renderer 가 사라지면 응답 가능성도 사라진다. timeout까지 붙잡지 않고 즉시 끝낸다.
      rejectAll(new Error('tool bridge window destroyed'))
      detachWindowListeners()
      watchedWindow = null
    }
    const listenOnce = (target, event) => {
      if (!target || typeof target.once !== 'function') return
      target.once(event, onDestroyed)
      removers.push(() => {
        if (typeof target.removeListener === 'function') target.removeListener(event, onDestroyed)
        else if (typeof target.off === 'function') target.off(event, onDestroyed)
      })
    }

    listenOnce(window, 'closed')
    listenOnce(window.webContents, 'destroyed')
    detachWindowListeners = () => {
      for (const remove of removers.splice(0)) remove()
      detachWindowListeners = () => {}
    }
  }

  async function invoke(name, args = {}, options = {}) {
    if (!ALLOWED_TOOLS.has(name)) throw new Error(`tool bridge name not allowed: ${name}`)
    if (closed) throw new Error('tool bridge is closed')

    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new TypeError('timeoutMs must be a non-negative finite number')
    }

    const window = getWindow()
    if (!isWindowAlive(window)) throw new Error('tool bridge window is unavailable')

    watchWindow(window)
    // listener 등록과 send 사이에 파괴된 창으로 보내는 경계도 fail-closed 한다.
    if (!isWindowAlive(window)) throw new Error('tool bridge window was destroyed')

    return new Promise((resolve, reject) => {
      let requestId = randomUUID()
      while (pending.has(requestId)) requestId = randomUUID()

      const timer = setTimeout(() => {
        settle(requestId, 'reject', new Error(`tool bridge timeout: ${name}`))
      }, timeoutMs)

      pending.set(requestId, {
        resolve,
        reject,
        timer,
        name,
        operationId: name === 'video.status' ? args?.operationId : undefined,
      })

      try {
        window.webContents.send('agent:bridge-request', { requestId, name, args })
      } catch (error) {
        settle(requestId, 'reject', rendererError(error))
      }
    })
  }

  function handleResponse(payload) {
    const requestId = payload?.requestId
    const entry = pending.get(requestId)

    // 모르는 id 는 중복/timeout 뒤 지연 응답일 수 있다. 다른 pending 을 추측해 깨우지 않는다.
    if (!entry) return false

    const hasResult = hasOwn(payload, 'result')
    const hasError = hasOwn(payload, 'error')
    if (hasResult === hasError) {
      return settle(requestId, 'reject', new Error('malformed tool bridge response'))
    }

    if (hasError) return settle(requestId, 'reject', rendererError(payload.error))

    const actualOperationId = payload.result?.operationId
    if (entry.name === 'video.status'
      && entry.operationId
      && actualOperationId != null
      && actualOperationId !== entry.operationId) {
      return settle(requestId, 'reject', new Error('tool bridge operationId mismatch'))
    }

    return settle(requestId, 'resolve', payload.result)
  }

  function handleEvent(event) {
    const operationId = event?.operationId
    if (typeof operationId !== 'string' || operationId.length === 0) {
      throw new Error('tool bridge event operationId is required')
    }

    operations.set(operationId, { status: event.status, progress: event.progress })
  }

  function getOperation(operationId) {
    return operations.get(operationId) ?? null
  }

  function close() {
    if (closed) return
    closed = true
    detachWindowListeners()
    watchedWindow = null
    rejectAll(new Error('tool bridge closed'))
    operations.clear()
  }

  return {
    invoke,
    handleResponse,
    handleEvent,
    getOperation,
    pendingCount: () => pending.size,
    close,
  }
}
