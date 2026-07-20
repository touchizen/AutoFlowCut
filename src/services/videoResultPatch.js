export function buildVideoRetryFramePairPatch(newStatus, result = {}, now = Date.now) {
  return {
    status: newStatus,
    ...(newStatus === 'generating' && result?.generatingStartedAt ? { generatingStartedAt: result.generatingStartedAt, generatingEndedAt: null } : {}),
    ...(newStatus === 'complete' || newStatus === 'error' ? { generatingEndedAt: result?.generatingEndedAt || now() } : {}),
    ...(result?.base64 ? { video: result.base64, base64: result.base64 } : {}),
    ...(result?.mediaId ? { mediaId: result.mediaId } : {}),
    ...(result?.generationId ? { generationId: result.generationId } : {}),
    ...(result?.videoPath ? { videoPath: result.videoPath } : {}),
    ...(result?.videoSaveId ? { videoSaveId: result.videoSaveId } : {}),
    ...(result?.duration ? { duration: result.duration } : {}),
    ...(result?.seed != null ? { seed: result.seed } : {}),
    ...(result?.generatedAt ? { generatedAt: result.generatedAt } : {}),
    ...(result?.model ? { model: result.model } : {}),
    ...(result?.appliedInputs ? { appliedInputs: result.appliedInputs } : {}),
    // 'error'/'errorKind' in result 패턴 — null 값도 patch 에 포함시켜 stale error 메시지 clear.
    ...(result && 'error' in result ? { error: result.error } : {}),
    ...(result && 'errorKind' in result ? { errorKind: result.errorKind } : {}),
  }
}

export function buildVideoRetryScenePatch(newStatus, result = {}, now = Date.now) {
  return {
    status: newStatus,
    ...(newStatus === 'generating' && result?.generatingStartedAt ? { generatingStartedAt: result.generatingStartedAt, generatingEndedAt: null } : {}),
    ...(newStatus === 'complete' || newStatus === 'error' ? { generatingEndedAt: result?.generatingEndedAt || now() } : {}),
    ...(result?.base64 ? { video: result.base64 } : {}),
    ...(result?.mediaId ? { mediaId: result.mediaId } : {}),
    ...(result?.generationId ? { generationId: result.generationId } : {}),
    ...(result?.videoPath ? { videoPath: result.videoPath } : {}),
    ...(result?.videoSaveId ? { videoSaveId: result.videoSaveId } : {}),
    ...(result?.duration ? { duration: result.duration } : {}),
    ...(result?.seed != null ? { seed: result.seed } : {}),
    ...(result?.generatedAt ? { generatedAt: result.generatedAt } : {}),
    ...(result?.model ? { model: result.model } : {}),
    ...(result?.appliedInputs ? { appliedInputs: result.appliedInputs } : {}),
    // null 값도 적용해 stale error clear (success 분기 patch 가 작동하도록).
    ...(result && 'error' in result ? { error: result.error } : {}),
    ...(result && 'errorKind' in result ? { errorKind: result.errorKind } : {}),
  }
}

export function buildVideoTextResultPatch(newStatus, result, now = Date.now) {
  return {
    status: newStatus,
    ...(newStatus === 'generating' ? { generatingStartedAt: now(), generatingEndedAt: null } : {}),
    ...(newStatus === 'complete' || newStatus === 'error' ? { generatingEndedAt: now() } : {}),
    ...(result && 'base64' in result ? { video: result.base64 } : {}),
    ...(result && 'mediaId' in result ? { mediaId: result.mediaId } : {}),
    ...(result?.generationId ? { generationId: result.generationId } : {}),
    ...(result && 'videoPath' in result ? { videoPath: result.videoPath } : {}),
    ...(result?.videoSaveId ? { videoSaveId: result.videoSaveId } : {}),
    ...(result?.duration ? { duration: result.duration } : {}),
    ...(result?.seed != null ? { seed: result.seed } : {}),
    ...(result && 'generatedAt' in result ? { generatedAt: result.generatedAt } : {}),
    ...(result?.model ? { model: result.model } : {}),
    ...(result?.appliedInputs ? { appliedInputs: result.appliedInputs } : {}),
    // null 값 보존 — success 시 stale error 메시지 clear.
    ...(result && 'error' in result ? { error: result.error } : {}),
    ...(result && 'errorKind' in result ? { errorKind: result.errorKind } : {}),
  }
}

export function buildVideoI2VResultPatch(newStatus, result, now = Date.now) {
  return {
    status: newStatus,
    ...(newStatus === 'generating' ? { generatingStartedAt: now(), generatingEndedAt: null } : {}),
    ...(newStatus === 'complete' || newStatus === 'error' ? { generatingEndedAt: now() } : {}),
    // 'X' in result — useVideoAutomation 의 새 generation 제출 시 옛 complete 메타를
    // 의도적으로 null 로 지우는 흐름 지원 (regen 후 recovery 후보 포함되도록).
    ...(result && 'base64' in result ? { video: result.base64, base64: result.base64 } : {}),
    ...(result && 'mediaId' in result ? { mediaId: result.mediaId } : {}),
    ...(result?.generationId ? { generationId: result.generationId } : {}),
    ...(result && 'videoPath' in result ? { videoPath: result.videoPath } : {}),
    ...(result?.videoSaveId ? { videoSaveId: result.videoSaveId } : {}),
    ...(result?.duration ? { duration: result.duration } : {}),
    ...(result?.seed != null ? { seed: result.seed } : {}),
    ...(result && 'generatedAt' in result ? { generatedAt: result.generatedAt } : {}),
    ...(result?.model ? { model: result.model } : {}),
    ...(result?.appliedInputs ? { appliedInputs: result.appliedInputs } : {}),
    // null 값 보존 — success 시 stale error 메시지 clear.
    ...(result && 'error' in result ? { error: result.error } : {}),
    ...(result && 'errorKind' in result ? { errorKind: result.errorKind } : {}),
  }
}
