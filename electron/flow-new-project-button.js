/**
 * electron/flow-new-project-button.js
 *
 * Flow 홈의 "새 프로젝트" 버튼 파인더. flow:new-project 가 trusted-click 으로 누른다.
 *
 * 2026-09-23 flow.google.com 이전으로 버튼이 <button><i>add_2</i></button> 에서
 * <button mat-fab extended class="… new-project-button …"><span class="material-symbols-outlined">add</span>새 프로젝트</button>
 * 로 바뀌어 옛 셀렉터가 not-found 로 실패했다. 앵커는 번역되지 않는 것만:
 *   1. 아이콘 리거처 add / add_2 (Material) — 홈에서 이 리거처는 새 프로젝트 버튼에만 있다
 *      (2026-09-23 덤프: edit×21, delete×21, tv, help, more_vert, close, add×1).
 *   2. 아이콘 컨테이너는 <i> 만이 아니라 google-symbols / material-symbols / material-icons /
 *      mat-icon 도 본다 — 옛 폴백이 <i> 만 봐서 새 마크업을 놓쳤다.
 * 라벨("새 프로젝트"/"New project")은 계정 언어를 따라 번역되므로 보지 않는다
 * (tests/electron/noLocaleBoundDomAnchors.test.js).
 *
 * findNewProjectButton(doc) 는 순수 함수(jsdom 테스트)이며, FIND_NEW_PROJECT_BUTTON_JS 로
 * 페이지에 그대로 주입된다(Function.prototype.toString — 단일 소스, flow-dom-dump 와 같은 방식).
 */
export function findNewProjectButton(doc) {
  const ICON_SEL = 'i, mat-icon, [class*="google-symbols"], [class*="material-symbols"], [class*="material-icons"]'
  const isAdd = (t) => t === 'add' || t === 'add_2'
  for (const b of doc.querySelectorAll('button, [role="button"]')) {
    const ligatures = Array.from(b.querySelectorAll(ICON_SEL)).map((i) => (i.textContent || '').trim())
    if (ligatures.some(isAdd)) return b
  }
  return null
}

/** trusted-click 의 `const el = ${jsSelector}` 자리에 들어가는 단일 표현식. */
export const FIND_NEW_PROJECT_BUTTON_JS = `(${findNewProjectButton.toString()})(document)`
