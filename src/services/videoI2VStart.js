export function buildVideoI2VStartOptions({
  settings = {},
  framePairs,
  projectName,
  seed,
} = {}) {
  return {
    mode: 'i2v',
    framePairs,
    projectName,
    saveMode: settings.saveMode,
    videoResolution: settings.videoResolution || '720p',
    videoModel: settings.videoModelF2V,
    videoProvider: settings.generation?.video?.i2v?.provider ?? 'google',
    generationSettings: settings,
    videoBatchCount: settings.videoBatchCount || 1,
    concurrency: settings.videoConcurrency || 4,
    flowPacingMinMs: settings.flowPacingMinMs,
    flowPacingMaxMs: settings.flowPacingMaxMs,
    seed,
  }
}
