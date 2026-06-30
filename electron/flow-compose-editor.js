/**
 * electron/flow-compose-editor.js
 *
 * 컴포저(프롬프트) 에디터 탐지 — 순수 함수 (jsdom 테스트). character.js / flow-api.js 가
 * "에디터가 마운트됐는지" readiness 판정과 포커스/주입 대상 선정에 쓴다.
 *
 * ⚠️ Flow 페이지엔 숨은 <textarea id="g-recaptcha-response"> 가 항상 존재한다. readiness 를
 *    textarea 폴백까지 포함해 판정하면 진짜 Slate 에디터 마운트 전에 통과해버려, 포커스
 *    클릭이 0px 숨은 textarea 를 잡고 프롬프트 주입이 실패한다(라이브 버그). 그래서 여기선
 *    Slate / 보이는 contenteditable 만 인정한다.
 */

/** 진짜 컴포저 에디터 element 반환 (Slate 우선, 그다음 보이는 contenteditable). 없으면 null. */
export function findComposeEditor(doc) {
  return doc.querySelector("[data-slate-editor='true']")
    || doc.querySelector("div[role='textbox'][contenteditable='true']:not([aria-hidden='true'])")
    // Agent ON 컴포저 에디터는 role='textbox' 없이 contenteditable 만 있는 경우가 있다 →
    //   generate-image 의 주입 셀렉터와 동일하게 넓힌다. recaptcha 는 <textarea>(contenteditable
    //   아님)라 안 걸리고, aria-hidden 은 제외하므로 0px 숨은 요소도 안 잡는다.
    || doc.querySelector("[contenteditable='true']:not([aria-hidden='true'])")
    || null
}

/** 컴포저 에디터가 마운트됐는지 (readiness 신호). */
export function isComposeEditorReady(doc) {
  return !!findComposeEditor(doc)
}

/**
 * 페이지 컨텍스트 주입용 expression — readiness 폴링에 쓴다(Function.toString).
 * ⚠️ self-contained 여야 한다 — findComposeEditor 만 직렬화한다. isComposeEditorReady 는
 *    findComposeEditor 를 호출하는데, 그걸 직렬화하면 페이지에 findComposeEditor 정의가
 *    없어 ReferenceError 로 throw → readiness 가 영원히 false (라이브 버그). findComposeEditor
 *    는 doc.querySelector 만 쓰는 self-contained 함수라 그대로 주입 가능하다.
 */
export const COMPOSE_EDITOR_READY = `!!(${findComposeEditor.toString()})(document)`
