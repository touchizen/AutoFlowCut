/**
 * 배치당 1회 consume 보장. 첫 호출만 서버 consume, 이후 결과 캐시. denied 면 이후도 차단.
 *
 * @param {string} batchId
 * @param {string} batchType
 * @param {function} consume - ({ batchId, batchType }) => Promise<{ charged?, denied? }>
 * @param {function} [onConsumed] - charged 성공 시 1회 호출 (subscription refresh 용). denied 시 미호출.
 */
export function makeBatchConsumeGate(batchId, batchType, consume, onConsumed) {
  let settled = null // { ok }
  let inflight = null
  return {
    async ensure() {
      if (settled) return settled
      if (!inflight) inflight = consume({ batchId, batchType }).then((r) => {
        const ok = !r?.denied
        settled = { ok }
        inflight = null
        // charged 성공 시 subscription refresh (stale 방지). 1회만 호출.
        if (ok && onConsumed) {
          try { onConsumed() } catch (e) { /* non-critical; don't let refresh kill the batch */ }
        }
        return settled
      })
      return inflight
    },
  }
}
