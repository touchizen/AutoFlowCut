/**
 * codex app-server 프로토콜 조각 — newline-delimited JSON-RPC over stdio.
 * 프로세스에 의존하지 않는 순수 함수만 둔다(테스트 용이). spawn 은 codexAppServer.js.
 */

/** 청크 스트림 → 완성된 JSON 메시지 배열. 부분 줄은 다음 청크까지 버퍼에 남는다. */
export function createNdjsonDecoder() {
  let buffer = ''
  return function decode(chunk) {
    buffer += String(chunk)
    const messages = []
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      try {
        messages.push(JSON.parse(line))
      } catch {
        // stdout 에 섞인 비-JSON 로그. 프로토콜을 죽이지 않는다.
      }
    }
    return messages
  }
}

/**
 * id 매칭 JSON-RPC 클라이언트. 전송(write)과 수신(handle)은 호출측이 배선한다.
 * app-server 응답에는 jsonrpc 필드가 없으므로 id + result/error 유무로 판별한다.
 */
export function createJsonRpcClient({ write, onNotification } = {}) {
  const pending = new Map()
  let nextId = 1

  return {
    get pendingCount() {
      return pending.size
    },

    request(method, params) {
      const id = nextId++
      // write 가 동기로 응답을 되돌릴 수 있다 — pending 을 먼저 등록한다.
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
      write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`)
      return promise
    },

    handle(message) {
      if (!message || typeof message !== 'object') return
      if (message.id != null && (message.error !== undefined || 'result' in message)) {
        const entry = pending.get(message.id)
        if (!entry) return // 모르는 id — 조용히 버린다
        pending.delete(message.id)
        if (message.error) entry.reject(new Error(message.error.message || 'Codex app-server JSON-RPC error'))
        else entry.resolve(message.result)
        return
      }
      if (message.method) onNotification?.(message)
    },

    /** 프로세스가 죽었을 때 — 대기 중인 요청이 영원히 매달리지 않게 한다. */
    rejectAll(error) {
      for (const entry of pending.values()) entry.reject(error)
      pending.clear()
    },
  }
}

export default { createNdjsonDecoder, createJsonRpcClient }
