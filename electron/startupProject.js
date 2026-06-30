/**
 * 시작 시 Flow 프로젝트 진입 결정 (순수 함수). (touchizen 포팅 — §3.3.1)
 *
 * 문제: 앱 시작 시 main 의 did-finish-load 자동생성(Enter tool 클릭)이, 렌더러가
 * 저장된 flowProjectId 로 프로젝트를 열기 전에 먼저 새 프로젝트를 만들어버린다(렌더러
 * 복원은 권한→존재확인→loadProjectWithResources 여러 async 라 느림).
 * 해결: 렌더러가 "저장 프로젝트 유무"를 main 에 선언(flow:set-startup-project)하고,
 * main 은 자동생성 직전 이 함수로 분기한다. (자동생성 자체는 M4에서 did-finish-load와 함께.)
 *
 * @param {string|null|undefined} hint
 *   - string(비어있지 않음): 저장된 flowProjectId → 그 프로젝트를 연다(새로 만들지 않음).
 *   - null: 저장 프로젝트 없음 → 새로 만든다.
 *   - undefined: 렌더러가 아직 선언 안 함 → 더 기다린다.
 * @returns {{action:'open-saved', flowProjectId:string}|{action:'create-new'}|{action:'wait'}}
 */
export function resolveStartupProjectDecision(hint) {
  if (typeof hint === 'string' && hint) return { action: 'open-saved', flowProjectId: hint }
  if (hint === undefined) return { action: 'wait' }
  return { action: 'create-new' }
}
