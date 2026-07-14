/**
 * renderer 쪽 toolBridge handler (스펙 D14).
 *
 *   main:  webContents.send('agent:bridge-request', {requestId, name, args})
 *     ↓
 *   여기:  allowlist 된 handler 실행 → respondToolBridge({requestId, result|error})
 *          detached 파이프라인 진행상황 → emitToolBridgeEvent({operationId, status, progress})
 *
 * 🔴 **allowlist 를 여기에도 둔다.** main 이 보냈다는 이유만으로 renderer 가 아무 함수나 실행하면,
 *    main 쪽 allowlist 가 뚫리는 순간 방어가 0 이 된다. 중복이 아니라 **계층 방어**다.
 *
 * 🔴 **모든 실패 출구에서 응답한다.** 이름이 없든 handler 가 throw 하든, 응답을 안 보내면
 *    main 의 pending 은 timeout 까지 매달린다 — 조용한 실패가 30초짜리 행이 된다.
 */
const ALLOWED = new Set(['video.admit', 'video.status', 'batch.status'])

export function registerToolBridgeHandlers({ api, handlers }) {
  const dispose = api.onToolBridgeRequest(async ({ requestId, name, args } = {}) => {
    // 누구에게 답할지 모르는 요청은 실행하지도, 응답하지도 않는다.
    if (!requestId) return

    if (!ALLOWED.has(name) || typeof handlers[name] !== 'function') {
      api.respondToolBridge({ requestId, error: `tool bridge name not allowed: ${name}` })
      return
    }

    try {
      const result = await handlers[name](args ?? {})
      api.respondToolBridge({ requestId, result })
    } catch (err) {
      // main 은 `result` 와 `error` 중 **정확히 하나**를 기대한다 (둘 다/둘 다 없음 = malformed).
      api.respondToolBridge({ requestId, error: err?.message ?? String(err) })
    }
  })

  return {
    /** detached 파이프라인이 진행상황을 main snapshot 으로 올린다 (slice 13b). */
    emitEvent(event) {
      if (!event?.operationId) throw new Error('tool bridge event operationId is required')
      api.emitToolBridgeEvent(event)
    },
    dispose,
  }
}
