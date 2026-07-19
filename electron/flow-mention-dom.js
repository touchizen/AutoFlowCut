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
//   이름은 img alt / 이름 leaf 들에 따로 있으므로(아래 구조), 후보들을 정확 비교하면 언어와 무관하다.
//   (2026-07-14 영어 Flow 사용자 리포트 → 한글 '캐릭터' 하드코딩이 원인. 실제 DOM 덤프로 확인.)
//
//   [role=option]
//     └ div > div > img alt="Zed2"
//     └ div
//         ├ div "Zed2"     ← 이름 (leaf)
//         └ div "캐릭터"    ← 타입 라벨 (leaf)

/** 주입 소스 공통 헬퍼. 모든 표현식 앞에 붙인다. */
const HELPERS = `
  const __norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const __dialog = () => document.querySelector("div[role='dialog']");

  const __textLeaves = (el) => el ? Array.from(el.querySelectorAll('*'))
    .filter((e) => e.children.length === 0 && __norm(e.textContent)) : [];

  // 옵션 이름 후보: 실제 덤프의 img alt, 타입 라벨(마지막 leaf)을 뺀 leaf 연결문자열,
  // 그리고 element leaf 없이 bare text node 만 있는 단순 DOM. 모두 exact 비교만 한다.
  const __optionCandidates = (el) => {
    if (!el) return [];
    const candidates = Array.from(el.querySelectorAll('img[alt]'))
      .map((img) => img.getAttribute('alt'));
    const leaves = __textLeaves(el);
    if (leaves.length) {
      const nameLeaves = leaves.slice(0, -1);
      if (nameLeaves.length) candidates.push(nameLeaves.map((leaf) => leaf.textContent || '').join(''));
    } else {
      candidates.push(el.textContent);
    }
    return Array.from(new Set(candidates.map(__norm).filter(Boolean)));
  };

  // 이름 정확 일치. prefix 매칭은 하지 않는다 — "회사원" 이 "회사원3" 을 잘못 고르는 것 차단.
  const __findOption = (dlg, name) => {
    const target = __norm(name);
    if (!dlg || !target) return null;
    return Array.from(dlg.querySelectorAll("[role='option']"))
      .find((o) => __optionCandidates(o).includes(target)) || null;
  };

  // 캐릭터 탭: 모든 계정 언어에서 공통인 Material ligature 가 primary anchor 다.
  // 라벨은 ligature 가 바뀐 경우에만 한국어/영어를 위한 second-line fallback 으로 쓴다.
  const __findCharTab = (dlg) => {
    if (!dlg) return null;
    const tabs = Array.from(dlg.querySelectorAll("[role='tab']"));
    const byLigature = tabs.find((t) => (t.textContent || '').indexOf('accessibility_new') >= 0);
    if (byLigature) return byLigature;
    return tabs.find((t) => /캐릭터|characters?/i.test(t.textContent || '')) || null;
  };

  const __compact = (s) => String(s || '').replace(/\\s+/g, '');
  const __chipForms = (target) => [target, '@' + target, target + '캐릭터', '@' + target + '캐릭터'];

  // 칩 검증은 whole text 만 exact 비교한다. normalized 비교에 더해 기존 규칙처럼 모든 whitespace
  // (NBSP/FEFF 포함)를 제거한 비교도 유지한다. prefix/substring/leaf 단위 비교는 쓰지 않는다.
  const __matchesChip = (chip, name) => {
    const target = __norm(name);
    if (!chip || !target) return false;
    const whole = __norm(chip.textContent);
    if (__chipForms(target).includes(whole)) return true;
    return __chipForms(__compact(name)).includes(__compact(chip.textContent));
  };

  // view: window 를 받아주지 않는 DOM 구현(jsdom)에서는 view 없이 재시도한다.
  const __mkEvent = (Ctor, type, init) => {
    try { return new Ctor(type, init); }
    catch { const i = Object.assign({}, init); delete i.view; return new Ctor(type, i); }
  };
`

/** 캐릭터 탭 클릭. (기본 "모두" 탭은 가상화 때문에 캐릭터 entity 가 렌더 안 될 수 있다.) */
export const CLICK_CHARACTER_TAB = `(async function(){
  ${HELPERS}
  const t = __findCharTab(__dialog());
  if (!t) return false;
  const active = (el) => el.getAttribute('aria-selected') === 'true' || el.getAttribute('data-state') === 'active';
  if (active(t)) return true;
  t.click();
  // Radix/React 는 상태를 비동기로 갱신한다 — 클릭한 틱에 aria-selected 를 읽으면 아직 false 다.
  //   (2026-07-14: 동기 검증 때문에 탭을 찾아놓고도 하드 실패했다. 실앱 로그 charTabFound:true.)
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (active(t)) return true;
  }
  return false;
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
 * 실측 칩의 whole text 와 기존 한글 whole-text 형태만 exact 비교한다.
 */
export const chipCheck = (editorSelector, name) => `(function(){
  ${HELPERS}
  const e = ${editorSelector};
  const chips = e ? Array.from(e.querySelectorAll("[data-slate-void='true']")) : [];
  const hit = chips.some((c) => __matchesChip(c, ${JSON.stringify(name)}));
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
 * 그래서 옵션에서는 이름 길이만 담고, 로케일은 사용자 콘텐츠가 아닌 html lang 으로만 본다.
 */
export const MENTION_PROBE = `(function(){
  ${HELPERS}
  const dlg = __dialog();
  const scope = dlg || document;
  const opts = Array.from(scope.querySelectorAll("[role='option']"));
  // 좁은 화면에서 탭이 어디로(오버플로우 메뉴 등) 접혔는지 판별용 — 구조(tag/role/aria)만,
  //   내용(텍스트/이름)은 절대 반환하지 않는다. 'accessibility_new' 는 Flow 의 캐릭터 아이콘
  //   Material ligature(사용자 콘텐츠 아님).
  const ligatureHosts = Array.from(scope.querySelectorAll('*'))
    .filter((e) => e.children.length === 0 && (e.textContent || '').indexOf('accessibility_new') >= 0)
    .slice(0, 8)
    .map((e) => {
      const host = e.closest("[role='tab'], [role='menuitem'], [role='menuitemradio'], button, [role='button'], a") || e;
      return {
        tag: host.tagName,
        role: host.getAttribute('role') || '',
        hasPopup: host.getAttribute('aria-haspopup') || '',
        expanded: host.getAttribute('aria-expanded') || '',
      };
    });
  return {
    hasDialog: !!dlg,
    documentLang: String(document.documentElement.lang || ''),
    viewportWidth: Math.round((window.innerWidth) || 0),
    dialogWidth: dlg ? Math.round(dlg.getBoundingClientRect().width) : 0,
    tabCount: scope.querySelectorAll("[role='tab']").length,
    tablistCount: scope.querySelectorAll("[role='tablist']").length,
    buttonCount: scope.querySelectorAll("button, [role='button']").length,
    menuitemCount: scope.querySelectorAll("[role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox']").length,
    charTabFound: !!__findCharTab(dlg),
    ligatureHosts,
    optionCount: opts.length,
    // 이름 후보의 길이만 — 어떤 leaf 도 내용 자체는 반환하지 않는다.
    optionNameLens: opts.slice(0, 20).map((o) => (__optionCandidates(o)[0] || '').length),
  };
})()`
