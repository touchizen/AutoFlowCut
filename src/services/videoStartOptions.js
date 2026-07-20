export function sharedVideoStartOptions(settings = {}) {
  return {
    saveMode: settings.saveMode,
    videoResolution: settings.videoResolution || '720p',
    generationSettings: settings,
    videoBatchCount: settings.videoBatchCount || 1,
    concurrency: settings.videoConcurrency || 4,
    flowPacingMinMs: settings.flowPacingMinMs,
    flowPacingMaxMs: settings.flowPacingMaxMs,
  }
}
