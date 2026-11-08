import { useSyncExternalStore } from 'react'
import { getFlowSafetyStop, getPreservedFlowSubmissionStop, subscribeFlowSafetyStop } from '../utils/flowSafetyStop'

// Dismissing a toast does not clear a stop. Show its current reason at the
// action, including when the scene still displays a previously saved image.
export function useImageRegenerationNotice(appMode, scenes, t) {
  const sessionStop = useSyncExternalStore(subscribeFlowSafetyStop, getFlowSafetyStop)
  if (appMode !== 'flow') return null
  if (sessionStop) return t(`errorSection.kind.${sessionStop.errorKind}`)

  const blockedScene = scenes.find(scene => getPreservedFlowSubmissionStop(scene, appMode))
  return blockedScene ? t('results.imageRegenerationBlocked', { sceneId: blockedScene.id }) : null
}
