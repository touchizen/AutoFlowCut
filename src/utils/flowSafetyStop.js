// Renderer mirror of the main-process latch. Alert dismiss, project changes and Stop do not reset it.
let stopped = null
const listeners = new Set()
export const getFlowSafetyStop = () => stopped
// A restart clears the process latch, not the persisted fact that this image
// was paid for but not collected. Only explicit recovery may clear that fact.
export function getPreservedFlowSubmissionStop(scene, mode) {
  if (mode !== 'flow' || !scene?.generationId || !scene.retryBlocked) return null
  const errorKind = scene.errorKind || 'flow-image-ownership-unproven'
  return { success: false, retryBlocked: true, generationId: scene.generationId,
    errorKind, error: scene.error || errorKind, errorParams: scene.errorParams,
    reason: scene.errorParams?.reason || scene.reason || errorKind }
}
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
