/**
 * src/utils/csvPreservedSceneFields.js
 *
 * CSV 를 다시 적용할 때 — 앱의 새 형식 parseFromCSV(useScenes)와 MCP load_csv 가 보내는 update-scenes(useMcpServer) —
 * CSV 에 실리지 않는 씬 런타임 필드: 생성 결과 포인터, 진행·선택 상태, 생성 메타. 두 경로가 **같은 목록**을 쓴다.
 * 따로 두면 어긋난다 — 2026-09-26 실기: MCP 경로만 영상 결과·선택을 버렸고, 둘 다 model·seed·생성 시각을 버려 이미지 탭 모델명이 사라졌다.
 *
 * CSV 가 쓰는 필드(프롬프트·자막·태그·시간)와 옛 형식 별칭(start_time/end_time — normalizeScene 이 camelCase 보다 먼저 읽는다)은
 * 넣지 않는다: 실으면 새 CSV 값을 가린다(리뷰 R1 — 기존 씬을 통째로 깔았더니 옛 시간이 이기고, prompt 없는 행이 옛 프롬프트로 재생성 대상이 됐다).
 * status 는 경로마다 규칙이 달라(MCP 는 Issue #2 프롬프트 변경 리셋) 호출부가 정한다.
 * tests/utils/csvPreservedSceneFields.test.js
 */
export const CSV_PRESERVED_SCENE_FIELDS = Object.freeze([
  // 이미지 결과
  'image', 'imagePath', 'mediaId', 'generatingStartedAt', 'image_size', 'donePrompt',
  // 이미지 생성 메타 — 이미지 탭의 모델명·시드·생성 시각
  'model', 'seed', 'generatedAt', 'generatingEndedAt',
  // 영상 결과·클립별 export 토글
  'videoT2V', 'videoT2VPath', 'videoI2V', 'videoI2VPath', 'videoT2VDuration', 'videoI2VDuration',
  'videoT2VDisabled', 'videoI2VDisabled',
  // T2V·I2V 런타임 상태 — 진행 중 타이머·in-flight 복구·선택
  'videoT2VStatus', 'videoT2VMediaId', 'videoT2VGenerationId', 'videoT2VSelected',
  'videoT2VGeneratingStartedAt', 'videoT2VGeneratingEndedAt',
  'videoI2VStatus', 'videoI2VGeneratingStartedAt', 'videoI2VGeneratingEndedAt',
  // 영상 생성 메타 — 영상 탭의 모델명·시드·생성 시각·저장 id
  'videoT2VModel', 'videoT2VSeed', 'videoT2VGeneratedAt', 'videoT2VSaveId',
])

/** 기존 씬에서 목록의 키만 옮긴다(값이 없으면 undefined — CSV 쪽 값을 덮어 기존 상태를 그대로 드러낸다). */
export function pickPreservedSceneFields(existing) {
  const out = {}
  for (const k of CSV_PRESERVED_SCENE_FIELDS) out[k] = existing ? existing[k] : undefined
  return out
}
