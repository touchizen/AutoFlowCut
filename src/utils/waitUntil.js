/**
 * 술어가 참이 될 때까지 폴링한다. 타임아웃이면 throw 하지 않고 false — 진행할지 포기할지는
 * 호출측이 정한다(여기서 던지면 fire-and-forget 푸시 큐가 조용히 죽는다).
 */
export async function waitUntil(pred, { timeoutMs = 10000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (!pred()) {
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return true
}

export default waitUntil
