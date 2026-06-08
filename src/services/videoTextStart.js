import { buildVideoPromptScenes, VIDEO_REFERENCE_LIMIT } from '../utils/videoPromptReferences'

export function prepareVideoTextStartScenes({
  videoScenes = [],
  references = [],
  effectiveStyleId = null,
  srtTrack = [],
  warn = console.warn,
  onReferenceLimitWarning = null,
} = {}) {
  let didWarnReferenceLimit = false
  const preparedVideoScenes = buildVideoPromptScenes(videoScenes, references, effectiveStyleId, srtTrack)
  const scenes = preparedVideoScenes.map(({ scene, missing, truncated }) => {
    if (missing.length > 0) warn?.('[VideoText]', scene.id, 'unknown @mentions:', missing.join(', '))
    if (truncated > 0) {
      warn?.('[VideoText]', scene.id, `Veo supports up to ${VIDEO_REFERENCE_LIMIT} reference images; using the first ${VIDEO_REFERENCE_LIMIT}.`)
      if (!didWarnReferenceLimit) {
        onReferenceLimitWarning?.(VIDEO_REFERENCE_LIMIT)
        didWarnReferenceLimit = true
      }
    }
    return scene
  })

  return { scenes, didWarnReferenceLimit }
}
