/**
 * Flow 레퍼런스 영상(r2v) 레퍼런스 상한(M3 D13) — 렌더러 계획(flowReferencePlan.js)과 main 핸들러(electron/ipc/flow-angular.js)가 함께 쓴다.
 * import 가 없는 모듈로 둔다: main 이 렌더러 계획 모듈을 끌어오면 가드 → 캐릭터 동기화 → React 훅까지 main 번들로 들어온다.
 * API 모드 상한(VIDEO_REFERENCE_IMAGE_LIMIT, src/config/genModels.js)과는 무관하다.
 */
export const FLOW_R2V_REFERENCE_LIMIT = 3
