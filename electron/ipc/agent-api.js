/**
 * ChatPanel 전용 IPC (D14).
 *
 * session command/event를 Story token/delta stream과 분리한다. 승인 request/response 한 쌍은
 * app-scoped approvalPrompt가 이미 소유하므로 여기서 다시 등록하지 않는다. 세션마다 permission
 * listener를 만들면 listener가 누적되고, prompt 수명을 세션 수명으로 잘못 닫을 길이 생긴다.
 */

function isWindowAlive(window) {
  if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) return false
  if (!window.webContents || typeof window.webContents.send !== 'function') return false
  return typeof window.webContents.isDestroyed !== 'function' || !window.webContents.isDestroyed()
}

function messageOf(value, fallback) {
  if (value instanceof Error && value.message) return value.message
  if (value && typeof value.message === 'string' && value.message) return value.message
  if (typeof value === 'string' && value) return value
  return fallback
}

function createEmitter(getWindow) {
  return (channel, payload) => {
    const window = getWindow?.()
    if (!isWindowAlive(window)) return false
    window.webContents.send(channel, payload)
    return true
  }
}

/** sessionManager 생성 시 그대로 넘길 callback 묶음. */
export function createAgentEventForwarder({ getWindow } = {}) {
  if (typeof getWindow !== 'function') throw new TypeError('getWindow must be a function')
  const emit = createEmitter(getWindow)

  return {
    onDelta(delta) {
      emit('agent:delta', { delta })
    },

    onEvent(event = {}) {
      const { method, params = {} } = event
      const item = params.item

      if (method === 'item/completed' && item?.type === 'agentMessage') {
        // delta 합과 completed text는 실제로 다를 수 있고 빈 문자열도 확정값이다. renderer가 fallback
        // 조각을 최종 답으로 오인하지 않게 wire item 전체를 별도 authoritative event로 보낸다.
        emit('agent:message', {
          turnId: params.turnId ?? null,
          item,
        })
        return
      }

      if ((method === 'item/started' || method === 'item/completed')
        && item?.type === 'mcpToolCall') {
        emit('agent:tool-call', {
          turnId: params.turnId ?? null,
          phase: method === 'item/started' ? 'started' : 'completed',
          item,
        })
        return
      }

      if (method !== 'turn/completed' || !params.turn) return
      const turn = params.turn
      if (turn.status === 'failed') {
        emit('agent:error', {
          error: 'agent-turn-failed',
          message: messageOf(turn.error, '에이전트 작업에 실패했습니다.'),
          turnId: turn.id ?? null,
          turn,
        })
        return
      }

      emit('agent:done', {
        turnId: turn.id ?? null,
        status: turn.status ?? 'completed',
        turn,
      })
    },

    onUsage(usage) {
      emit('agent:usage', usage)
    },

    onError(error) {
      if (error && typeof error === 'object' && !(error instanceof Error)) {
        emit('agent:error', error)
        return
      }
      emit('agent:error', {
        error: 'agent-error',
        message: messageOf(error, '에이전트 오류가 발생했습니다.'),
      })
    },

    onExit(details = {}) {
      emit('agent:error', {
        error: 'agent-exit',
        message: messageOf(details.error, '에이전트 프로세스가 종료됐습니다.'),
        code: details.code ?? null,
        signal: details.signal ?? null,
      })
    },
  }
}

/**
 * session command 5개만 등록한다. `agent:permission-response`는 main의 app-scoped listener가
 * 여섯 번째 command로 이미 한 번 등록돼 있다.
 */
export function registerAgentIPC(ipcMain, { sessionManager, getWindow } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required')
  if (!sessionManager) throw new TypeError('sessionManager is required')
  if (typeof getWindow !== 'function') throw new TypeError('getWindow must be a function')

  const emit = createEmitter(getWindow)
  const registrations = [
    ['agent:session-open', 'open', () => []],
    ['agent:send', 'send', (payload) => [payload?.text]],
    ['agent:steer', 'steer', (payload) => [payload?.text]],
    ['agent:abort', 'abort', () => []],
    ['agent:session-close', 'close', () => []],
  ]

  for (const [channel, method, argsFor] of registrations) {
    if (typeof sessionManager[method] !== 'function') {
      throw new TypeError(`sessionManager.${method} is required`)
    }
    ipcMain.handle(channel, async (_event, payload = {}) => {
      try {
        return await sessionManager[method](...argsFor(payload))
      } catch (error) {
        // IPC rejection은 renderer에서 놓치기 쉽다. 실패를 값과 agent:error 양쪽에 남긴다.
        const failure = {
          error: 'agent-command-failed',
          command: channel,
          message: messageOf(error, '에이전트 명령에 실패했습니다.'),
        }
        emit('agent:error', failure)
        return failure
      }
    })
  }

  return () => {
    if (typeof ipcMain.removeHandler !== 'function') return
    for (const [channel] of registrations) ipcMain.removeHandler(channel)
  }
}

export default { createAgentEventForwarder, registerAgentIPC }
