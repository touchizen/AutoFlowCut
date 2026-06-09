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

export function buildVideoTextStartPayload({
  videoScenes = [],
  references = [],
  effectiveStyleId = null,
  srtTrack = [],
  settings = {},
  projectName = '',
  styleLabel = null,
  warn = console.warn,
  onReferenceLimitWarning = null,
} = {}) {
  const { scenes } = prepareVideoTextStartScenes({
    videoScenes,
    references,
    effectiveStyleId,
    srtTrack,
    warn,
    onReferenceLimitWarning,
  })
  const seed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
    ? settings.seedNo
    : null

  return {
    runningStyle: { styleId: effectiveStyleId, label: styleLabel, applies: true },
    startOptions: {
      mode: 't2v',
      scenes,
      seed,
      projectName,
      saveMode: settings.saveMode,
      videoResolution: settings.videoResolution || '720p',
      videoModel: settings.videoModelT2V,
      videoBatchCount: settings.videoBatchCount || 1,
      concurrency: settings.videoConcurrency || 4,
    },
  }
}
