import { buildVideoPromptScenes, VIDEO_REFERENCE_LIMIT } from '../utils/videoPromptReferences'

export function prepareVideoTextStartScenes({
  videoScenes = [],
  references = [],
  effectiveStyleId = null,
  srtTrack = [],
  appMode = 'api',
  warn = console.warn,
  onReferenceLimitWarning = null,
} = {}) {
  let didWarnReferenceLimit = false
  const allMissing = []  // #R36-fix(Codex R2[1]): 미해결 @멘션 집계 — Flow 모드는 이걸로 start 를 막는다.
  const preparedVideoScenes = buildVideoPromptScenes(videoScenes, references, effectiveStyleId, srtTrack, appMode)
  const scenes = preparedVideoScenes.map(({ scene, missing, truncated }) => {
    if (missing.length > 0) { warn?.('[VideoText]', scene.id, 'unknown @mentions:', missing.join(', ')); allMissing.push(...missing) }
    if (truncated > 0) {
      warn?.('[VideoText]', scene.id, `Veo supports up to ${VIDEO_REFERENCE_LIMIT} reference images; using the first ${VIDEO_REFERENCE_LIMIT}.`)
      if (!didWarnReferenceLimit) {
        onReferenceLimitWarning?.(VIDEO_REFERENCE_LIMIT)
        didWarnReferenceLimit = true
      }
    }
    return scene
  })

  return { scenes, didWarnReferenceLimit, missing: [...new Set(allMissing)] }
}

export function buildVideoTextStartPayload({
  videoScenes = [],
  references = [],
  effectiveStyleId = null,
  srtTrack = [],
  settings = {},
  projectName = '',
  styleLabel = null,
  appMode = 'api',
  warn = console.warn,
  onReferenceLimitWarning = null,
} = {}) {
  const { scenes, missing } = prepareVideoTextStartScenes({
    videoScenes,
    references,
    effectiveStyleId,
    srtTrack,
    appMode,
    warn,
    onReferenceLimitWarning,
  })
  const seed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
    ? settings.seedNo
    : null

  return {
    runningStyle: { styleId: effectiveStyleId, label: styleLabel, applies: true },
    missing,  // #R36-fix(Codex R2[1]): Flow 모드 미해결 @멘션 — 호출측(App)이 start 를 막는다.
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
      flowPacingMinMs: settings.flowPacingMinMs,
      flowPacingMaxMs: settings.flowPacingMaxMs,
    },
  }
}
