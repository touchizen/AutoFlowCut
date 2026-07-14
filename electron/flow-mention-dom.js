// electron/flow-mention-dom.js
//
// Flow 멘션 피커의 DOM 규칙 — 페이지에 주입되는 소스 "문자열" 하나가 프로덕션과 테스트에서
// 똑같이 실행된다. (tests/electron/flow-mention-dom.test.js 가 이 문자열을 jsdom 에서 평가한다.)
//
// 왜 함수를 export 해서 toString() 으로 넘기지 않는가:
//   패키징 빌드의 minify 가 함수 이름을 뭉개서, 주입된 소스 안의 상호 참조(a() 가 b() 호출)가
//   런타임에 깨진다. 문자열 리터럴은 minifier 가 건드리지 않는다.
//
// 왜 클래스명을 앵커로 쓰지 않는가:
//   Flow 는 styled-components 해시 클래스(sc-b0e5-14 bBwYtB…)를 쓴다 — 재배포마다 바뀐다.
//
// 왜 textContent 통짜 비교를 쓰지 않는가 (이 파일이 생긴 이유):
//   옵션의 textContent 는 "이름 + 타입라벨" 이라 로케일에 묶인다.
//     ko: "Zed2캐릭터"   en: "Zed2Character"
//   이름은 자기 leaf 엘리먼트에 따로 들어 있으므로(아래 구조), leaf 를 읽으면 언어와 무관하다.
//   (2026-07-14 영어 Flow 사용자 리포트 → 한글 '캐릭터' 하드코딩이 원인. 실제 DOM 덤프로 확인.)
//
//   [role=option]
//     └ div > div > img alt="Zed2"
//     └ div
//         ├ div "Zed2"     ← 이름 (leaf)
//         └ div "캐릭터"    ← 타입 라벨 (leaf)

/** 주입 소스 공통 헬퍼. 모든 표현식 앞에 붙인다. */
const HELPERS = `
  const __strip = (s) => (s || '').replace(/\\s+/g, '');
  const __dialog = () => document.querySelector("div[role='dialog']");

  // 옵션/칩의 "이름": 자식 없는 leaf 중 텍스트가 있는 첫 번째. 없으면 통짜 textContent 로 폴백.
  const __leafName = (el) => {
    if (!el) return '';
    const leaves = Array.from(el.querySelectorAll('*'))
      .filter((e) => e.children.length === 0 && (e.textContent || '').trim());
    return ((leaves[0] || el).textContent || '').trim();
  };

  // 이름 정확 일치. prefix 매칭은 하지 않는다 — "회사원" 이 "회사원3" 을 잘못 고르는 것 차단.
  const __findOption = (dlg, name) => {
    const target = __strip(name);
    if (!dlg || !target) return null;
    return Array.from(dlg.querySelectorAll("[role='option']"))
      .find((o) => __strip(__leafName(o)) === target) || null;
  };

  // 캐릭터 탭: 라벨(캐릭터/Characters)은 로케일마다 다르지만 Material 아이콘 리거처는 불변이다.
  // 탭 textContent 는 "accessibility_new캐릭터" 처럼 리거처가 앞에 붙어 온다.
  const __findCharTab = (dlg) => {
    if (!dlg) return null;
    const tabs = Array.from(dlg.querySelectorAll("[role='tab']"));
    return tabs.find((t) => (t.textContent || '').indexOf('accessibility_new') >= 0)
      || tabs.find((t) => /캐릭터|character/i.test(t.textContent || ''))
      || null;
  };

  // view: window 를 받아주지 않는 DOM 구현(jsdom)에서는 view 없이 재시도한다.
  const __mkEvent = (Ctor, type, init) => {
    try { return new Ctor(type, init); }
    catch { const i = Object.assign({}, init); delete i.view; return new Ctor(type, i); }
  };
`

/** 캐릭터 탭 클릭. (기본 "모두" 탭은 가상화 때문에 캐릭터 entity 가 렌더 안 될 수 있다.) */
export const CLICK_CHARACTER_TAB = `(function(){
  ${HELPERS}
  const t = __findCharTab(__dialog());
  if (!t) return false;
  t.click();
  return true;
})()`

/** 이름과 정확히 일치하는 옵션이 피커에 있는가. */
export const hasMentionOption = (name) => `(function(){
  ${HELPERS}
  return !!__findOption(__dialog(), ${JSON.stringify(name)});
})()`

/** 매칭 옵션에 pointer/mouse/click 시퀀스 디스패치(Radix onSelect). */
export const dispatchMentionOption = (name) => `(function(){
  ${HELPERS}
  const o = __findOption(__dialog(), ${JSON.stringify(name)});
  if (!o) return false;
  o.scrollIntoView({ block: 'center' });
  const r = o.getBoundingClientRect();
  const opt = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window, button: 0, pointerId: 1 };
  try { o.dispatchEvent(__mkEvent(PointerEvent, 'pointerover', opt)); o.dispatchEvent(__mkEvent(PointerEvent, 'pointerenter', opt)); } catch {}
  try { o.dispatchEvent(__mkEvent(PointerEvent, 'pointerdown', opt)); } catch {}
  o.dispatchEvent(__mkEvent(MouseEvent, 'mousedown', opt));
  try { o.dispatchEvent(__mkEvent(PointerEvent, 'pointerup', opt)); } catch {}
  o.dispatchEvent(__mkEvent(MouseEvent, 'mouseup', opt));
  o.dispatchEvent(__mkEvent(MouseEvent, 'click', opt));
  return true;
})()`

/**
 * 삽입 검증: 에디터 안의 멘션 칩이 이름과 일치하는가.
 * 칩 텍스트는 "@이름"(선행 @) 형태이고, 타입 라벨이 leaf 로 따로 붙어도 __leafName 이 이름만 뽑는다.
 */
export const chipCheck = (editorSelector, name) => `(function(){
  ${HELPERS}
  const e = ${editorSelector};
  const target = __strip(${JSON.stringify(name)});
  const chips = e ? Array.from(e.querySelectorAll("[data-slate-void='true']")) : [];
  const hit = chips.some((c) => __strip(__leafName(c)).replace(/^@/, '') === target);
  return {
    editorTextLen: ((e && (e.innerText || e.textContent)) || '').length,
    hasMentionChip: hit,
    stillHasDialog: !!__dialog(),
  };
})()`

/**
 * 실패 진단 — 피커가 무엇을 렌더하고 있었는지. **사용자 콘텐츠(캐릭터 이름·프롬프트)는 절대 담지
 * 않는다**: main 프로세스의 console 은 Sentry breadcrumb 이 되므로, 이름을 찍으면 사용자가 만든
 * 캐릭터 이름이 우리 서버로 간다. (tests/electron/noUserContentInLogs.test.js 가 이걸 강제한다.)
 * 그래서 이름은 "길이"만, 타입 라벨(캐릭터/Character)은 Flow 의 UI 문구라 그대로 담는다 —
 * 로케일 문제를 로그만 보고 판별하려면 그게 필요하다.
 */
export const MENTION_PROBE = `(function(){
  ${HELPERS}
  const dlg = __dialog();
  const scope = dlg || document;
  const opts = Array.from(scope.querySelectorAll("[role='option']"));
  const typeSuffix = (o) => {
    const leaves = Array.from(o.querySelectorAll('*'))
      .filter((e) => e.children.length === 0 && (e.textContent || '').trim());
    return leaves.length > 1 ? (leaves[leaves.length - 1].textContent || '').trim().slice(0, 20) : '';
  };
  return {
    hasDialog: !!dlg,
    tabCount: scope.querySelectorAll("[role='tab']").length,
    charTabFound: !!__findCharTab(dlg),
    optionCount: opts.length,
    // 이름은 길이만 — 내용은 사용자 것이다.
    optionNameLens: opts.slice(0, 20).map((o) => __leafName(o).length),
    // 타입 라벨은 Flow 의 UI 문구(사용자 콘텐츠 아님) — 로케일 판별용.
    optionTypes: Array.from(new Set(opts.map(typeSuffix).filter(Boolean))),
  };
})()`
