export function sharedVideoStartOptions(settings = {}) {
  return {
    saveMode: settings.saveMode,
    videoResolution: settings.videoResolution || '720p',
    generationSettings: settings,
    videoBatchCount: settings.videoBatchCount || 1,
    concurrency: settings.videoConcurrency || 4,
    flowPacingMinMs: settings.flowPacingMinMs,
    flowPacingMaxMs: settings.flowPacingMaxMs,
    // 화면비(설정>씬)는 T2V·I2V 공용 — 안 실으면 useVideoAutomation 이 하드코딩 landscape 기본값으로
    //   떨어져 9:16/16:9 선택이 무시된다. 값('9:16'/'16:9')은 Flow(aspectSuffix)·API(Veo) 양쪽에서 소비.
    aspectRatio: settings.aspectRatio,
  }
}
