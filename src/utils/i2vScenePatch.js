/**
 * Frame→Video (I2V) — generation status/result 를 owner 씬으로 동기화할 scene patch 생성.
 *
 * T2V 는 videoT2VGeneratingStartedAt/EndedAt 를 채워 ResultsTable·타임라인 경과 타이머가
 * 동작하지만, I2V 는 예전엔 status 만 내려 generating 클립의 경과 타이머가 00:00 에 고정됐다.
 * (useAudioTimeline buildVideoClips 가 videoI2VGeneratingStartedAt/EndedAt 를 읽는데 아무도
 *  쓰지 않았음.) T2V 와 동일하게 generating 시 StartedAt, complete/error 시 EndedAt 을 채운다.
 *
 * @param {string} newStatus  'generating' | 'complete' | 'error' | ...
 * @param {object} result     generation 결과 (base64/videoPath/duration/generatedAt 등)
 * @returns {object} scenesHook.updateScene(ownerSceneId, patch) 에 넣을 패치
 */
export function buildI2VScenePatch(newStatus, result = {}) {
  const patch = { videoI2VStatus: newStatus }
  // 경과 타이머용 타임스탬프 — T2V(videoT2VGeneratingStartedAt/EndedAt)와 동일 규칙.
  if (newStatus === 'generating') {
    patch.videoI2VGeneratingStartedAt = Date.now()
    patch.videoI2VGeneratingEndedAt = null
  } else if (newStatus === 'complete' || newStatus === 'error') {
    patch.videoI2VGeneratingEndedAt = Date.now()
  }
  if (newStatus === 'complete' && result?.base64) {
    patch.videoI2V = result.base64
    patch.videoI2VPath = result.videoPath || null
    patch.videoI2VDisabled = null
    if (result?.duration) patch.videoI2VDuration = result.duration
    // 비디오 캐시버스터용 — 이미지 generatedAt 과 분리(I2V 재생성 갱신).
    if (result?.generatedAt) patch.videoI2VGeneratedAt = result.generatedAt
  }
  return patch
}
