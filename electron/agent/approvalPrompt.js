import { randomUUID } from 'node:crypto'

/**
 * 승인 창을 **사람에게** 띄우고 답을 기다린다 (D14 `agent:permission-request` / `agent:permission-response`).
 *
 * 🔴 **toolBridge 와 실패 방향이 정반대다.**
 *    toolBridge 는 실패하면 **throw** 한다 — 호출자가 *"결과를 모른다"* 를 알아야 하니까.
 *    승인은 실패하면 **decline** 이다 — **창이 죽었다고 승인이 될 수는 없다.**
 *    reject 로 만들면 상위 어딘가에서 catch 를 빠뜨리는 순간 무슨 일이 벌어질지 아무도 모른다.
 *    **모든 실패 출구를 값(decline)으로 닫는다.**
 *
 * 창이 없다 / 창이 죽었다 / 사람이 안 누른다 / 세션이 닫혔다 / renderer 가 모르는 action 을 보냈다
 * → 전부 `decline`.
 */
const DECLINE = Object.freeze({ action: 'decline' })
const KNOWN_ACTIONS = new Set(['accept', 'decline', 'cancel'])

export function createApprovalPrompt({ getWindow, timeoutMs = 10 * 60 * 1000 }) {
  const pending = new Map()
  let closed = false
  let watched = null
  let detach = () => {}

  function settle(requestId, answer) {
    const entry = pending.get(requestId)
    if (!entry) return false
    // 먼저 지운다 — 늦게 온 응답이 이미 사람이 내린 결정을 뒤집으면 안 된다.
    pending.delete(requestId)
    clearTimeout(entry.timer)
    entry.resolve(answer)
    return true
  }

  function declineAll() {
    for (const id of [...pending.keys()]) settle(id, DECLINE)
  }

  function closeSession(sessionId) {
    // prompt와 IPC listener는 앱 수명이다. 여기서 `close()`로 영구 폐쇄하면 두 번째 agent session은
    // 승인할 수 없으므로, 세션 종료는 그 sessionId의 대기 건만 값(decline)으로 정리한다.
    for (const [id, entry] of [...pending]) {
      if (entry.sessionId === sessionId) settle(id, DECLINE)
    }
  }

  function watch(win) {
    if (watched === win) return
    detach()
    watched = win
    const onGone = () => { declineAll(); detach(); watched = null }
    const removers = []
    for (const [target, event] of [[win, 'closed'], [win.webContents, 'destroyed']]) {
      if (typeof target?.once !== 'function') continue
      target.once(event, onGone)
      removers.push(() => target.removeListener?.(event, onGone))
    }
    detach = () => { for (const r of removers.splice(0)) r(); detach = () => {} }
  }

  return {
    /** @returns {Promise<{action:'accept'|'decline'|'cancel'}>} — **절대 reject 하지 않는다.** */
    ask(params, ctx = {}) {
      if (closed) return Promise.resolve(DECLINE)

      const win = getWindow?.()
      // renderer 가 없으면 **묻지도 않고 거부한다.** 물어볼 사람이 없는데 승인이 있을 수 없다.
      if (!win || win.isDestroyed?.() || typeof win.webContents?.send !== 'function') {
        return Promise.resolve(DECLINE)
      }
      watch(win)

      return new Promise((resolve) => {
        const requestId = randomUUID()
        const timer = setTimeout(() => settle(requestId, DECLINE), timeoutMs)
        pending.set(requestId, { resolve, timer, sessionId: ctx.sessionId ?? null })

        win.webContents.send('agent:permission-request', {
          requestId,
          tool: ctx.tool ?? params?._meta?.tool ?? null,
          // 🔴 사람은 툴 **이름**이 아니라 **무엇을 하는지** 를 보고 승인해야 한다.
          message: params?.message ?? '',
          sessionId: ctx.sessionId ?? null,
        })
      })
    },

    /** renderer 의 응답. 모르는 id / 중복 / 모르는 action 은 전부 안전한 쪽으로 닫는다. */
    respond({ requestId, action } = {}) {
      const answer = KNOWN_ACTIONS.has(action) ? { action } : DECLINE
      return settle(requestId, answer)
    },

    pendingCount: () => pending.size,

    closeSession,

    close() {
      closed = true
      detach()
      watched = null
      declineAll()
    },
  }
}
