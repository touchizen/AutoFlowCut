/**
 * flow:open-project 재시도/에러판정(순수).
 *
 * 배경: 저장된 Flow 프로젝트로 직접 deep-link(loadURL `/project/<id>`)하면 Flow SPA 가
 *   가끔 프로젝트를 못 띄우고 **랜딩 페이지**로 떨어진다(URL 은 `/project/<id>` 그대로지만
 *   본문은 쿠키배너 + "프로젝트로 돌아가기" 뿐). 갤러리에서 클릭(앱 셸 로드 후 client-side
 *   네비)하면 정상이라 home(base) 경유로 재네비하면 대체로 복구된다.
 *
 * ⚠️ 전세계 사용 — locale 의존 문자열(타이틀 태그라인/에러 텍스트)로 판정하지 않는다.
 *   순수 구조적(UI) 신호만 사용:
 *     - 컴포저 존재: 정상 프로젝트엔 프롬프트 컴포저(textarea/slate/textbox)가 있고 랜딩엔 없음.
 *       CSS/ARIA 셀렉터라 언어 무관.
 *     - 인터랙티브 요소 수: 랜딩 ~7개 vs 정상 ~63개(scanInteractiveElements 기준 동일 SEL).
 *       컴포저 셀렉터가 깨져도 요소가 많으면(rich) 에러로 안 봐 멀쩡한 프로젝트 mass-clear 방지.
 *
 * 실제 덤프 근거(2026-06-24):
 *   - 에러/랜딩(edce7e31): 인터랙티브 7개, 컴포저 없음.
 *   - 정상 로드(b266…): 인터랙티브 63개, 컴포저 있음.
 */

// "로드된 프로젝트"로 보는 최소 인터랙티브 요소 수(컴포저가 안 잡힐 때의 안전망). 7 « 20 « 63.
export const FLOW_LOADED_MIN_INTERACTIVE = 20

// scanInteractiveElements(flow-dom-dump.js)와 동일한 SEL — count 기준을 일치시킨다.
const INTERACTIVE_SEL = "a, button, select, input, textarea, [role='button'], [role='tab'], [role='menuitem'], [role='option'], [role='combobox'], [contenteditable='true'], [tabindex]"

// 페이지를 검사하는 in-page 스크립트(executeJavaScript 로 평가). 구조적 신호만 반환(문자열 판정 없음).
export const FLOW_PAGE_PROBE_JS = `(() => {
  const hasComposer = !!(document.querySelector("[data-slate-editor='true']") || document.querySelector("div[role='textbox'][contenteditable='true']") || document.querySelector('textarea'));
  const interactiveCount = document.querySelectorAll("${INTERACTIVE_SEL}").length;
  return { hasComposer, interactiveCount };
})()`

/**
 * 페이지가 "프로젝트 미로드(에러/랜딩)"인지 판정(순수, locale 무관).
 *   인터랙티브 요소 수가 신뢰 가능한 유일 신호 — 랜딩/에러 ~6–7개 vs 정상 프로젝트 ~63개.
 *   < FLOW_LOADED_MIN_INTERACTIVE 면 랜딩/에러.
 *
 *   ⚠️ 컴포저(textarea/slate/textbox) 신호는 쓰지 않는다 — Flow 는 항상 invisible reCAPTCHA 의
 *   hidden <textarea name="g-recaptcha-response"> 를 갖고 있어 랜딩/에러 페이지에서도 textarea 가
 *   잡혀 hasComposer 가 false positive(실측: 랜딩인데 hasComposer=true, interactiveCount=6).
 *   요소 수만이 랜딩(6–7)과 정상(63)을 가른다.
 * @param {{ interactiveCount?: number }} page
 */
export function isFlowErrorPage(page = {}) {
  const { interactiveCount = 0 } = page
  return interactiveCount < FLOW_LOADED_MIN_INTERACTIVE
}

/**
 * 한 번의 관찰을 받아 다음 행동을 정한다.
 *   - 'success': 대상 URL 이고 에러 페이지 아님 → 진짜 프로젝트 진입.
 *   - 'retry':   에러/이탈인데 시도 남음 → home 경유 재네비.
 *   - 'fail':    에러/이탈이고 시도 소진 → 실패(errorPage:true 로 반환 → caller 가 죽은 매핑 제거).
 * @param {{ onTargetUrl: boolean, isErrorPage: boolean, attempt: number, maxAttempts: number }} o
 * @returns {'success'|'retry'|'fail'}
 */
export function decideFlowOpenAction({ onTargetUrl, isErrorPage, attempt, maxAttempts }) {
  if (onTargetUrl && !isErrorPage) return 'success'
  if (attempt < maxAttempts - 1) return 'retry'
  return 'fail'
}

/**
 * 최종 실패가 "죽은 매핑"(flowProjectId 제거 대상)인지 "transient"(매핑 보존)인지 판정(순수).
 *   - 대상 URL(`/project/<id>`)에 머물렀는데 에러/랜딩 페이지 → 죽은 프로젝트로 본다(제거).
 *   - URL 이탈(로그인 리다이렉트/느린 네비/홈으로 튕김 등)은 transient — 매핑을 지우면 멀쩡한
 *     프로젝트를 잃을 수 있으므로 보존하고 생성만 막는다.
 *   - probeOk=false(페이지 검사 자체 실패 — executeJavaScript 예외/느린 hydration)는 "검사 불능"
 *     이므로 dead 로 보지 않는다(transient — valid 매핑 삭제 방지).
 * @param {{ onTargetUrl: boolean, isErrorPage: boolean, probeOk?: boolean }} o
 */
export function isDeadMappingFailure({ onTargetUrl, isErrorPage, probeOk = true }) {
  return !!(onTargetUrl && isErrorPage && probeOk)
}
