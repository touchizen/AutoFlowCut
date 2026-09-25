/**
 * src/utils/flowReferencePlan.js
 *
 * Flow(flow.google.com) 레퍼런스 계획 — 계획서 docs/plans/2026-09-25-flow-M3-references-plan.md D3 · D13.
 * 렌더러 계획 함수(planFlowReferenceComposition)는 M3-11 이 이 파일에 둔다. 지금은 main(flow-angular.js)과 렌더러가 같이 쓰는 상한만.
 */

/**
 * D13: Flow 레퍼런스 영상(r2v, MZZa6b)의 유일 레퍼런스 상한 — CAT `[9]` 이 veo r2v 3·abra r2v 7 이고 영상 다중 레퍼런스는 미관측이라 낮은 쪽.
 *   API 모드 상수(genModels.js VIDEO_REFERENCE_IMAGE_LIMIT)와 묶지 않는다. 렌더러 계획(D3-7)과 main(D1)이 둘 다 막는다.
 */
export const FLOW_R2V_REFERENCE_LIMIT = 3
