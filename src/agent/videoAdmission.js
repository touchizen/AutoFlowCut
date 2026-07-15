/** Renderer-owned adapter for agent T2V admission. Identity always comes from Tool Core's resolver. */
export function resolveAgentVideoScenes(items = [], scenes = []) {
  if (!Array.isArray(items) || !Array.isArray(scenes)) return []
  return items.flatMap(({ ordinal, rendererSceneId } = {}) => {
    const scene = scenes.find((candidate) => candidate?.id === rendererSceneId)
    if (!scene) return []
    return [{
      id: rendererSceneId,
      rendererSceneId,
      ordinal,
      prompt: scene.videoT2VPrompt || scene.prompt || '',
      status: scene.videoT2VStatus,
      generationId: scene.videoT2VGenerationId,
      mediaId: scene.videoT2VMediaId,
      videoPath: scene.videoT2VPath,
      videoSaveId: scene.videoT2VSaveId,
      seed: scene.videoT2VSeed,
      model: scene.videoT2VModel,
      targetDuration: scene.duration ?? null,
      referenceImages: [],
    }]
  })
}

export function agentVideoScenePatch(status, result = {}) {
  const patch = {
    videoT2VStatus: status,
    ...(status === 'generating'
      ? { videoT2VGeneratingStartedAt: result.generatingStartedAt || Date.now(), videoT2VGeneratingEndedAt: null }
      : {}),
    ...(status === 'complete' || status === 'error'
      ? { videoT2VGeneratingEndedAt: result.generatingEndedAt || Date.now() }
      : {}),
  }
  if ('base64' in result) patch.videoT2V = result.base64
  if ('videoPath' in result) patch.videoT2VPath = result.videoPath
  if ('mediaId' in result) patch.videoT2VMediaId = result.mediaId
  if ('generationId' in result) patch.videoT2VGenerationId = result.generationId
  if ('videoSaveId' in result) patch.videoT2VSaveId = result.videoSaveId
  if ('duration' in result) patch.videoT2VDuration = result.duration
  if ('seed' in result) patch.videoT2VSeed = result.seed
  if ('generatedAt' in result) patch.videoT2VGeneratedAt = result.generatedAt
  if ('model' in result) patch.videoT2VModel = result.model
  if ('error' in result) patch.videoT2VError = result.error
  if ('errorKind' in result) patch.videoT2VErrorKind = result.errorKind
  if (status === 'complete' && (result.base64 || result.videoPath)) patch.videoT2VDisabled = null
  return patch
}
