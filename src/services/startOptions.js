/**
 * startOptions — App.jsx handleStart 가 settings 로부터 이미지 배치 시작 옵션을 만드는
 * 단일 소스. 통합 테스트(chatgptRealCallShape)가 이 함수를 그대로 사용해, 엔진/어댑터의
 * 가드가 "앱이 실제로 보내는 기본값"과 어긋나는 클래스(aspectRatio/seed 사건)를
 * 하드코딩 fixture 드리프트 없이 잡는다. 여기 필드를 바꾸면 그 테스트가 실제 경로를 다시 잰다.
 */

// seedLocked && seedNo 가 숫자일 때만 고정 seed 사용, 그 외엔 엔진 랜덤.
// 기본 settings 는 seedLocked:true + 랜덤 정수 seedNo → 기본값이 곧 "숫자 seed"다.
export function effectiveSeedFrom(settings) {
  return settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
    ? settings.seedNo
    : null
}

export function buildImageStartOptions(settings, { projectName, effectiveStyleId = null, force = false } = {}) {
  return {
    projectName,
    saveMode: settings.saveMode,
    concurrency: settings.concurrency || 5,
    flowPacingMinMs: settings.flowPacingMinMs,
    flowPacingMaxMs: settings.flowPacingMaxMs,
    imageBatchCount: settings.imageBatchCount || 1,
    imageUpscale: settings.imageUpscale || 'off',
    aspectRatio: settings.aspectRatio,
    imageModel: settings.imageModel,
    imageProvider: settings.generation?.image?.provider ?? 'google',
    generationSettings: settings,
    selectedStyleRefId: effectiveStyleId,
    seed: effectiveSeedFrom(settings),
    force,
  }
}
