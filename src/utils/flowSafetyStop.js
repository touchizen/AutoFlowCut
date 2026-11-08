// Renderer mirror of the main-process latch. Alert dismiss, project changes and Stop do not reset it.
let stopped = null
const listeners = new Set()
export const getFlowSafetyStop = () => stopped
// A restart clears the process latch, not the persisted fact that this image
// was paid for but not collected. Only explicit recovery may clear that fact.
export function getPreservedFlowSubmissionStop(scene, mode) {
  const local = scene?.flowSubmission
  if (mode !== 'flow' || !(scene?.generationId && scene.retryBlocked)
    && !(local?.id && local.postClick && local.retryBlocked)) return null
  const errorKind = scene.errorKind || 'flow-image-ownership-unproven'
  return { success: false, retryBlocked: true, generationId: scene.generationId,
    errorKind, error: scene.error || errorKind, errorParams: scene.errorParams,
    ...(local ? { flowSubmission: local, postClick: true } : {}),
    reason: local?.reason || scene.errorParams?.reason || scene.reason || errorKind }
}

/** Persist the click independently of a downloadable generation ID. */
export function flowSubmissionPatch(result, collected = false) {
  const record = result?.flowSubmission
  if (!record?.id || !record.postClick) return {}
  const reason = collected ? 'collected' : (result.reason || record.reason || 'awaiting-result')
  return { flowSubmission: { ...record, retryBlocked: !collected, reason },
    postClick: true, retryBlocked: !collected, safetyStop: collected ? false : !!result.safetyStop, reason }
}

/** Every failed scene update keeps the previously recorded click, including
 * exceptions and Stop paths that only supply status/error and no engine result. */
export function preserveFlowSubmission(scene, updates) {
  const record = updates.flowSubmission || scene.flowSubmission
  if (!record?.id || !record.postClick || !record.retryBlocked || !['error', 'pending'].includes(updates.status)) return updates
  const recordedFailure = record.reason && record.reason !== 'awaiting-result' ? record.reason : null
  return { ...updates, status: 'error', ...flowSubmissionPatch({ ...updates, flowSubmission: record,
    reason: updates.reason || updates.errorParams?.reason || recordedFailure || updates.error || 'collection-interrupted',
    safetyStop: updates.safetyStop ?? scene.safetyStop }) }
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
export function flowSafetyQueueError(alreadySurfaced = false) {
  return Object.assign(new Error('Flow generation paused; check the Flow window before restarting the application'), stopped || {}, { alreadySurfaced })
}
export function __resetFlowSafetyForTests() { stopped = null; listeners.clear() }
