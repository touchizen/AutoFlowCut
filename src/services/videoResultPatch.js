export function buildVideoRetryFramePairPatch(newStatus, result = {}, now = Date.now) {
  return {
    status: newStatus,
    ...(newStatus === 'generating' && result?.generatingStartedAt ? { generatingStartedAt: result.generatingStartedAt, generatingEndedAt: null } : {}),
    ...(newStatus === 'complete' || newStatus === 'error' ? { generatingEndedAt: result?.generatingEndedAt || now() } : {}),
    ...(result?.base64 ? { video: result.base64, base64: result.base64 } : {}),
    // M2-R3 H3(main): Regenerate 의 null 도 통과('X' in result) — 재시도 패치의 id 는 항상 truthy 라 의미 변화 없음
    ...(result && 'mediaId' in result ? { mediaId: result.mediaId } : {}),
    ...(result && 'generationId' in result ? { generationId: result.generationId } : {}),
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
    ...(result && 'downloadGated' in result ? { downloadGated: result.downloadGated } : {}),   // M2-R3 H6(main): Regenerate 가 null 로 지운다
  }
}

export function buildVideoRetryScenePatch(newStatus, result = {}, now = Date.now) {
  return {
    status: newStatus,
    ...(newStatus === 'generating' && result?.generatingStartedAt ? { generatingStartedAt: result.generatingStartedAt, generatingEndedAt: null } : {}),
    ...(newStatus === 'complete' || newStatus === 'error' ? { generatingEndedAt: result?.generatingEndedAt || now() } : {}),
    ...(result?.base64 ? { video: result.base64 } : {}),
    // M2-R3 H3(main): Regenerate 의 null 도 통과('X' in result) — 재시도 패치의 id 는 항상 truthy 라 의미 변화 없음
    ...(result && 'mediaId' in result ? { mediaId: result.mediaId } : {}),
    ...(result && 'generationId' in result ? { generationId: result.generationId } : {}),
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
    ...(result && 'downloadGated' in result ? { downloadGated: result.downloadGated } : {}),   // M2-R3 H6(main): Regenerate 가 null 로 지운다
  }
}

export function buildVideoTextResultPatch(newStatus, result, now = Date.now) {
  return {
    status: newStatus,
    ...(newStatus === 'generating' ? { generatingStartedAt: now(), generatingEndedAt: null } : {}),
    ...(newStatus === 'complete' || newStatus === 'error' ? { generatingEndedAt: now() } : {}),
    ...(result && 'base64' in result ? { video: result.base64 } : {}),
    ...(result && 'mediaId' in result ? { mediaId: result.mediaId } : {}),
    // M2-R6 K1(main): 명시적 null 도 통과(mediaId 와 같은 규칙) — 훅이 fresh 항목의 옛 Flow 모양 id 를 제출 전/미제출 종결 패치에서 null 로 지운다.
    ...(result && 'generationId' in result ? { generationId: result.generationId } : {}),
    ...(result && 'videoPath' in result ? { videoPath: result.videoPath } : {}),
    ...(result?.videoSaveId ? { videoSaveId: result.videoSaveId } : {}),
    ...(result?.duration ? { duration: result.duration } : {}),
    ...(result?.seed != null ? { seed: result.seed } : {}),
    ...(result && 'generatedAt' in result ? { generatedAt: result.generatedAt } : {}),
    ...(result?.model ? { model: result.model } : {}),
    ...(result?.generationProvider ? { generationProvider: result.generationProvider } : {}),
    ...(result && 'appliedInputs' in result ? { appliedInputs: result.appliedInputs } : {}),
    // null 값 보존 — success 시 stale error 메시지 clear.
    ...(result && 'error' in result ? { error: result.error } : {}),
    ...(result && 'errorKind' in result ? { errorKind: result.errorKind } : {}),
    // M2-5(T6)(main): kind 별 params 와 거부 미디어 id 도 통과 — 빠지면 ResultsTable 이 {expected} 플레이스홀더를 그대로 보이고,
    //   거부 id 가 mediaId 로 둔갑하지 않게 rejectedMediaId(s) 로만 남긴다.
    ...(result && 'errorParams' in result ? { errorParams: result.errorParams } : {}),
    ...(result && 'rejectedMediaId' in result ? { rejectedMediaId: result.rejectedMediaId } : {}),
    ...(result && 'rejectedMediaIds' in result ? { rejectedMediaIds: result.rejectedMediaIds } : {}),
    // M2-R3 H6(B2)(main): 배치 다운로드 권한 마커(true / 제출 패치의 null 둘 다) — Phase 0 재다운로드 게이트 판정
    ...(result && 'downloadGated' in result ? { downloadGated: result.downloadGated } : {}),
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
    // M2-R6 K1(main): 명시적 null 도 통과(mediaId 와 같은 규칙) — 훅이 fresh 항목의 옛 Flow 모양 id 를 제출 전/미제출 종결 패치에서 null 로 지운다.
    ...(result && 'generationId' in result ? { generationId: result.generationId } : {}),
    ...(result && 'videoPath' in result ? { videoPath: result.videoPath } : {}),
    ...(result?.videoSaveId ? { videoSaveId: result.videoSaveId } : {}),
    ...(result?.duration ? { duration: result.duration } : {}),
    ...(result?.seed != null ? { seed: result.seed } : {}),
    ...(result && 'generatedAt' in result ? { generatedAt: result.generatedAt } : {}),
    ...(result?.model ? { model: result.model } : {}),
    ...(result?.generationProvider ? { generationProvider: result.generationProvider } : {}),
    ...(result && 'appliedInputs' in result ? { appliedInputs: result.appliedInputs } : {}),
    // null 값 보존 — success 시 stale error 메시지 clear.
    ...(result && 'error' in result ? { error: result.error } : {}),
    ...(result && 'errorKind' in result ? { errorKind: result.errorKind } : {}),
    // M2-5(T6)(main): kind 별 params 와 거부 미디어 id 도 통과 — 빠지면 ResultsTable 이 {expected} 플레이스홀더를 그대로 보이고,
    //   거부 id 가 mediaId 로 둔갑하지 않게 rejectedMediaId(s) 로만 남긴다.
    ...(result && 'errorParams' in result ? { errorParams: result.errorParams } : {}),
    ...(result && 'rejectedMediaId' in result ? { rejectedMediaId: result.rejectedMediaId } : {}),
    ...(result && 'rejectedMediaIds' in result ? { rejectedMediaIds: result.rejectedMediaIds } : {}),
    // M2-R3 H6(B2)(main): 배치 다운로드 권한 마커(true / 제출 패치의 null 둘 다) — Phase 0 재다운로드 게이트 판정
    ...(result && 'downloadGated' in result ? { downloadGated: result.downloadGated } : {}),
  }
}
