import { randomUUID } from 'node:crypto'

/**
 * renderer 에 맡길 수 있는 작업은 **여기 적힌 것뿐**이다. D14 가 확정한 `video.*` 둘에
 * `batch.status` 를 더했다 — `wait_batch`(§2.3)가 renderer 의 배치 진행을 읽는 유일한 경로이고,
 * main 엔 배치 상태가 없다 (기존엔 `executeJavaScript` 로 읽었고, D14 가 그 경로를 금지한다).
 */
const ALLOWED_TOOLS = new Set(['video.admit', 'video.status', 'batch.status', 'scene.snapshot', 'video.frames', 'export.capcut', 'export.premiere'])

/**
 * 🔴 **응답이 물어본 그것에 대한 답인지 확인한다.** correlation id 만으로는 부족하다 —
 *    renderer handler 버그로 **다른 대상**의 상태가 이 요청에 실려 오면, id 는 맞고 내용은 틀리다.
 *    그래서 요청 인자의 식별자를 응답이 **echo** 하게 하고, 다르거나 **없으면** 거부한다.
 *    (누락을 통과시키면 fail-open 이다: 아무 대상의 응답이나 통과한다.)
 */
// scene.snapshot / export.* 는 식별 인자가 없어 echo 없이 그대로 통과한다 (video.admit 과 같은 부류).
// video.frames 는 대상 씬을 물으므로 rendererSceneId 를 echo 로 요구한다 (다른 씬 프레임 오배송 방지).
const ECHO_KEY_BY_TOOL = { 'video.status': 'operationId', 'batch.status': 'type', 'video.frames': 'rendererSceneId' }
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

      const echoKey = ECHO_KEY_BY_TOOL[name]
      pending.set(requestId, {
        resolve,
        reject,
        timer,
        name,
        echoKey,
        echoValue: echoKey ? args?.[echoKey] : undefined,
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

    // 🔴 **누락도 불일치다.** "값이 있을 때만 비교" 하면 renderer 가 식별자를 빼먹은 응답이 **무조건
    //    통과**한다 (fail-open). 시나리오: op 두 개가 진행 중인데 renderer 버그로 op-B 용
    //    `{status:'complete'}`(id 없음)가 op-A 의 status 요청에 답한다 → 에이전트는 op-A 가 끝났다고 믿는다.
    //    `wait_batch` 도 같다: scene 을 물었는데 ref 상태가 오면 엉뚱한 배치를 완료로 믿는다.
    //    **물어본 대상의 식별자를 요구한다.**
    if (entry.echoKey && entry.echoValue !== undefined
      && payload.result?.[entry.echoKey] !== entry.echoValue) {
      return settle(requestId, 'reject', new Error(`tool bridge ${entry.echoKey} mismatch`))
    }

    return settle(requestId, 'resolve', payload.result)
  }

  function handleEvent(event) {
    const operationId = event?.operationId
    if (typeof operationId !== 'string' || operationId.length === 0) {
      throw new Error('tool bridge event operationId is required')
    }

    // 🔴 닫힌 bridge 를 다시 채우지 않는다. `close()` 가 `operations.clear()` 한 **직후** 늦게 도착한
    //    event 가 snapshot 을 되살리면, 세션이 끝났는데 그 세션의 진행상황이 남는다 (D14 "session close 때 cleanup").
    if (closed) return false

    operations.set(operationId, { status: event.status, progress: event.progress })
    return true
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
