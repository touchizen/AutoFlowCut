// Renderer mirror of the main-process latch. Alert dismiss, project changes and Stop do not reset it.
let stopped = null
const listeners = new Set()
export const getFlowSafetyStop = () => stopped
export function subscribeFlowSafetyStop(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function receiveFlowSafetyStop(result) {
  if (!result?.safetyStop || !result.retryBlocked || stopped) return false
  stopped = { ...result }
  for (const listener of listeners) {
    try { listener(stopped) } catch { /* Stop all other subscribers even if one fails. */ }
  }
  return true
}
export function flowSafetyQueueError() {
  return Object.assign(new Error('Flow generation paused; check the Flow window before restarting the application'), stopped || {}, { alreadySurfaced: true })
}
export function __resetFlowSafetyForTests() { stopped = null; listeners.clear() }
