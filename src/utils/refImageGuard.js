import { isRefSynced } from './flowCharacterSync'

export function sourceAvailable(ref) {
  return !!(ref?.data || ref?.filePath || ref?.imagePath)
}

export function flowImageInjectable(ref) {
  return !!ref?.mediaId
}

export function flowMentionEligible(ref) {
  return isRefSynced(ref)
}

export function flowRegistrationRepairable(ref) {
  return !!(ref?.entityId && ref?.workflowId)
}

export function flowSyncable(ref) {
  return flowRegistrationRepairable(ref) ||
    (!flowImageInjectable(ref) && sourceAvailable(ref))
}

export function flowTagCharacterNeedsSync(ref) {
  return !flowImageInjectable(ref) && sourceAvailable(ref)
}
