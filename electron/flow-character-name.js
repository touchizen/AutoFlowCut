/**
 * 캐릭터 상세 페이지의 이름 입력칸을 찾아 SPA 스토어를 갱신한다.
 *
 * 서버 진실은 PATCH /v1/flow/entities (entityInfo.displayName) 가 이미 쓴다. 문제는 SPA 가 페이지
 * 로드 시점의 값('제목 없는 캐릭터')을 캐시한 채라, 프로젝트를 나갔다 재진입(refresh)해야 새 이름이
 * 보인다는 것. 이 input 에 타이핑하면 SPA 스토어가 갱신돼 refresh 가 필요 없어진다.
 * 라이브 캡처(2026-07-10): 타이핑은 네트워크 요청을 내지 않는 순수 로컬 갱신이고, 상세페이지의
 * '완료' 는 저장이 아니라 뒤로가기 버튼이다. 그래서 서버 저장은 계속 우리 PATCH 가 책임진다.
 *
 * findCharacterNameInput 은 순수 함수(jsdom 테스트) — FLOW_APPLY_NAME_PROBE 로 직렬화해 페이지에서 실행한다.
 */

/**
 * 실측 마크업:
 *   <form novalidate>…<input placeholder="캐릭터 이름" class="sc-43d80680-5 dQKPMK">
 *                      <button type="button"><i class="google-symbols">edit</i></button>
 * class 는 styled-components 해시(배포마다 변경), placeholder 는 로케일 의존(/fx/ko/) — 둘 다 못 쓴다.
 * 언어·빌드 무관한 앵커는 "바로 뒤에 edit 아이콘 버튼을 단 form 안의 input" 뿐이다. 못 찾으면 null
 * 을 돌려 호출측이 refresh 로 폴백하게 한다 — 엉뚱한 칸(설명 textarea 등)에 타이핑하는 쪽이 훨씬 나쁘다.
 */
export function findCharacterNameInput(doc) {
  for (const input of doc.querySelectorAll('form input')) {
    if (input.type === 'file' || input.disabled || input.readOnly) continue
    const next = input.nextElementSibling
    if (!next || next.tagName !== 'BUTTON') continue
    if ((next.textContent || '').trim() !== 'edit') continue
    return input
  }
  return null
}

/**
 * React controlled input 이라 el.value 직접 대입은 무시된다 — native setter 로 값을 넣고
 * input 이벤트를 올려야 상태가 바뀐다. blur 로 편집을 마무리하고, 되읽어 성공을 확인한다.
 */
export const FLOW_APPLY_NAME_PROBE = (displayName) => `(function(){
  const find = ${findCharacterNameInput.toString()};
  try {
    const el = find(document);
    if (!el) return { ok: false, error: 'name input not found' };
    const name = ${JSON.stringify(displayName)};
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    el.focus();
    setter.call(el, name);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return { ok: el.value === name, value: el.value };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
})()`

/**
 * 상세 페이지 헤더의 back 버튼(<i>arrow_back</i>).
 *
 * 타이핑만 하고 상세 페이지에 남으면, 다음 동작의 ensureOnCharactersPage 가 loadURL(전체 로드)로
 * SPA 스토어를 다시 받아 우리가 갱신한 이름이 날아간다. back 은 SPA 클라이언트 라우팅이라
 * 스토어를 유지한 채 목록으로 돌아간다 — 이름이 살아서 멘션 피커까지 간다. 덤으로 다음 캐릭터
 * 생성이 시작할 /characters 에 이미 도착해 있다.
 *
 * '완료' 버튼도 back 이지만 텍스트가 로케일 의존이다. 아이콘 ligature 는 번역되지 않으므로 그쪽을 쓴다.
 */
export function findCharacterBackButton(doc) {
  for (const btn of doc.querySelectorAll('button')) {
    const icon = btn.querySelector('i')
    if (icon && (icon.textContent || '').trim() === 'arrow_back') return btn
  }
  return null
}

/** trustedClickOnFlowView 에 넘길 표현식 — back 버튼 엘리먼트를 돌려준다. */
export const FLOW_BACK_BTN_EXPR = `(function(){
  const find = ${findCharacterBackButton.toString()};
  return find(document);
})()`
