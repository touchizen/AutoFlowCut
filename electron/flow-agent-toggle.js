/**
 * electron/flow-agent-toggle.js
 *
 * Find Flow's compose "Agent" toggle and force it OFF before generating.
 *
 * With Agent ON, prompts go through the agent (flowCreationAgent:streamChat) and
 * results render as DOM <img>/<video> (no interceptable request). With Agent OFF,
 * generation uses the direct APIs (batchGenerateImages / batchAsyncGenerateVideoText)
 * which the app's existing response-interception collection already handles — the
 * robust, original path. So we force Agent OFF.
 *
 * isToggleOn / findAgentToggle are pure (jsdom-tested). AGENT_TOGGLE_PROBE and
 * AGENT_OFF_SCRIPT inject the same logic into the page (Function.toString) and
 * log every candidate so the exact markup is confirmed from real runs.
 */

/** Is a toggle element currently ON? (aria-pressed/checked, data-state on/checked/active) */
export function isToggleOn(el) {
  if (!el) return false
  if (el.getAttribute('aria-pressed') === 'true') return true
  if (el.getAttribute('aria-checked') === 'true') return true
  const ds = el.getAttribute('data-state')
  if (ds === 'on' || ds === 'checked' || ds === 'active') return true
  return false
}

/** Locate the compose Agent toggle by role/label/text heuristics. */
export function findAgentToggle(doc) {
  const cands = Array.from(doc.querySelectorAll('button, [role="switch"], [role="checkbox"], [role="button"], input[type="checkbox"]'))
  const hasToggleAttr = (el) => el.getAttribute('role') === 'switch' || el.getAttribute('role') === 'checkbox'
    || el.hasAttribute('aria-pressed') || el.hasAttribute('aria-checked')
  // 1) Strongest signal: a real toggle (aria-pressed/checked or role=switch) labelled Agent.
  //    The confirmed markup is <button aria-pressed><span class="content">에이전트</span>.
  //    This also rejects the adjacent aria-haspopup="dialog" "에이전트 요청" button (no toggle attr).
  for (const el of cands) {
    if (!hasToggleAttr(el)) continue
    const t = (el.textContent || '').trim()
    const al = el.getAttribute('aria-label') || ''
    if (/agent|에이전트/i.test(t) || /agent|에이전트/i.test(al)) return el
  }
  // 2) Fallback: a button whose text is exactly Agent / 에이전트.
  for (const el of cands) {
    if (/^(agent|에이전트)$/i.test((el.textContent || '').trim())) return el
  }
  return null
}

/** Page expression returning the agent toggle ELEMENT (for trustedClickOnFlowView). */
export const AGENT_TOGGLE_SELECTOR = `(${findAgentToggle.toString()})(document)`

/**
 * Snapshot every "agent-ish" control plus the page context — for when findAgentToggle
 * returns null and fails generation closed.
 *
 * findAgentToggle only accepts a candidate that carries a toggle attribute
 * (aria-pressed/aria-checked/role=switch) AND is labelled agent/에이전트. When it
 * rejects everything we lose the reason, and a user report becomes unfalsifiable —
 * markup change, locale, and collapsed-viewport all look identical from the log.
 * This keeps the rejected candidates and the context that separates those causes.
 */
export function scanAgentToggleCandidates(doc) {
  const win = doc.defaultView
  const cands = Array.from(doc.querySelectorAll('button, [role="switch"], [role="checkbox"], [role="button"], input[type="checkbox"]'))
    .map((el) => ({
      el,
      icons: Array.from(el.querySelectorAll('i, [class*="symbols"], [class*="google-symbols"]')).map((i) => (i.textContent || '').trim()),
    }))
    .filter(({ el, icons }) => {
      const al = el.getAttribute('aria-label') || ''
      const t = (el.textContent || '').trim()
      return /agent|에이전트/i.test(al) || /agent|에이전트/i.test(t) || icons.some((i) => /spark/.test(i))
    })
    .slice(0, 12)
    .map(({ el, icons }) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      text: (el.textContent || '').trim().slice(0, 40),
      ariaLabel: el.getAttribute('aria-label'),
      ariaPressed: el.getAttribute('aria-pressed'),
      ariaChecked: el.getAttribute('aria-checked'),
      dataState: el.getAttribute('data-state'),
      icons,
    }))

  return {
    candidates: cands,
    context: {
      innerWidth: (win && win.innerWidth) || 0,
      innerHeight: (win && win.innerHeight) || 0,
      lang: doc.documentElement.lang || null,
      url: (doc.location && doc.location.href) || null,
      readyState: doc.readyState || null,
      // 컴포즈 에디터가 떠 있는지 — 없으면 페이지가 아직 안 그려진 것(하이드레이션/뷰포트 문제)이고,
      // 있는데도 토글이 없으면 Flow 마크업이 바뀐 것이다. 이 한 줄이 두 원인을 가른다.
      hasComposeEditor: !!(doc.querySelector("[data-slate-editor='true']")
        || doc.querySelector("div[role='textbox'][contenteditable='true']")),
    },
  }
}

/** Page expression returning the candidate/context snapshot (for the not_found path). */
export const AGENT_TOGGLE_DIAGNOSTIC = `(function() {
  const scan = ${scanAgentToggleCandidates.toString()};
  try { return scan(document); } catch (e) { return { error: String(e && e.message) }; }
})()`

/**
 * Locate the agent CHAT panel's header close button (icon 'close' / label '닫기').
 * A prior Agent-ON generation leaves this right-side panel open, covering the main
 * compose bar where the Agent toggle lives — so we close it before probing/toggling.
 * Disambiguated by the panel header's sibling '기록'(menu) / '새로운 세션'(edit_square).
 */
export function findAgentChatCloseButton(doc) {
  const win = doc.defaultView
  const isHidden = (e) => {
    if (!win || !win.getComputedStyle) return false
    const s = win.getComputedStyle(e)
    return !!s && (s.display === 'none' || s.visibility === 'hidden')
  }
  const iconTexts = (b) => Array.from(b.querySelectorAll('i, [class*="symbols"], [class*="google-symbols"]'))
    .map((i) => (i.textContent || '').trim())
  const isClose = (b) => iconTexts(b).includes('close')
    || /(^|\s)닫기(\s|$)/.test((b.textContent || '').trim())
    || /close|닫기/i.test(b.getAttribute('aria-label') || '')
  const candidates = Array.from(doc.querySelectorAll('button')).filter((b) => !isHidden(b) && isClose(b))
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  // Multiple close buttons: prefer the one whose nearby ancestor holds the agent
  //   chat header labels (so we don't click some unrelated modal's X). Stop before
  //   body/documentElement — their textContent is the whole page and would match
  //   every candidate.
  for (const b of candidates) {
    let p = b.parentElement
    for (let i = 0; i < 3 && p && p !== doc.body && p !== doc.documentElement; i++) {
      const t = p.textContent || ''
      if (t.includes('새로운 세션') || t.includes('기록')) return b
      p = p.parentElement
    }
  }
  return candidates[0]
}

/** Page expression returning the agent-chat close button ELEMENT. */
export const AGENT_CHAT_CLOSE_SELECTOR = `(${findAgentChatCloseButton.toString()})(document)`

/**
 * Locate the "에이전트 설정"(agent settings / defaults) panel's close/back button.
 * 이 패널은 '이미지 생성 기본값'·'동영상 생성 기본값' 라벨을 갖고 컴포즈 바의 Agent 토글을
 * 가릴 수 있다 → 토글 전에 헤더 X / 뒤로가기 버튼으로 닫는다. (ensureAgentOn 의 인라인
 * CLOSE_PANEL 셀렉터를 추출 — ensureAgentOff 와 공유.)
 */
export function findAgentSettingsCloseButton(doc) {
  const isVis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const CLOSE_ICONS = ['close', 'arrow_back', 'arrow_back_ios', 'arrow_back_ios_new', 'chevron_left', 'keyboard_backspace', 'west', 'keyboard_arrow_left']
  const isClose = (b) => {
    if (Array.from(b.querySelectorAll('i,[class*="symbols"]')).some(i => CLOSE_ICONS.includes((i.textContent || '').trim()))) return true
    return /close|닫기|back|뒤로/i.test(b.getAttribute('aria-label') || '')
  }
  const IMG = '이미지 생성 기본값', VID = '동영상 생성 기본값'
  let panel = null
  const labels = Array.from(doc.querySelectorAll('span,div')).filter(e => { const t = (e.textContent || '').trim(); return t === IMG || t === VID })
  for (const lab of labels) {
    let p = lab
    for (let i = 0; i < 16 && p.parentElement; i++) { p = p.parentElement; const t = p.textContent || ''; if (t.includes(IMG) && t.includes(VID)) { panel = p; break } }
    if (panel) break
  }
  if (!panel) return null
  let scope = panel
  for (let up = 0; up < 5 && scope; up++) {
    const btn = Array.from(scope.querySelectorAll('button')).filter(isVis).find(isClose)
    if (btn) return btn
    scope = scope.parentElement
  }
  return null
}

/** Page expression returning the agent-settings panel close button ELEMENT. */
export const AGENT_SETTINGS_CLOSE_SELECTOR = `(${findAgentSettingsCloseButton.toString()})(document)`

/**
 * ⚠️ 주입한 함수는 절대 "이름으로" 호출하지 않는다 — 반드시 const 에 담아 그 변수로 호출한다.
 *    prod 빌드는 main 번들을 minify 하며 함수 이름을 뭉갠다(findAgentToggle → H$). 그러면
 *    `${fn.toString()}` 로 주입된 선언은 `function H$(...)` 가 되는데 호출부는 여전히
 *    `findAgentToggle(...)` 라 ReferenceError 가 난다 → executeJavaScript 거부 →
 *    "Script failed to execute" → ensureAgentOff catch → fail-closed → 모든 생성 실패.
 *    dev 는 minify 를 안 해서 멀쩡하므로 이 버그는 패키징된 앱에서만 나타난다.
 *    (실제 사용자 제보의 원인이었다. tests/electron/flow-agent-toggle-minified.test.js 가 지킨다.)
 */
/** Page expression: report the agent toggle's found/on/markup (for diagnostics). */
export const AGENT_TOGGLE_PROBE = `(function() {
  const isOn = ${isToggleOn.toString()};
  const find = ${findAgentToggle.toString()};
  const el = find(document);
  if (!el) return { found: false };
  return {
    found: true,
    on: isOn(el),
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    ariaPressed: el.getAttribute('aria-pressed'),
    ariaChecked: el.getAttribute('aria-checked'),
    dataState: el.getAttribute('data-state'),
    text: (el.textContent || '').trim().slice(0, 30),
  };
})()`

/**
 * Page script: force Agent OFF. Logs all "agent-ish" candidates (so the real
 * toggle is confirmed from logs), then clicks the toggle if it is ON.
 * Returns { found, wasOn, clicked, candidates }.
 */
export const AGENT_OFF_SCRIPT = `(function() {
  const isToggleOn = ${isToggleOn.toString()};
  const findAgentToggle = ${findAgentToggle.toString()};
  const P = '[autoflowcut Agent]';
  // 진단: 'agent/에이전트/spark' 관련 후보를 전부 로그 (실제 토글 마크업 확인용)
  try {
    const cands = Array.from(document.querySelectorAll('button, [role="switch"], [role="checkbox"], [role="button"], input[type="checkbox"]'))
      .filter(el => {
        const al = (el.getAttribute('aria-label') || '');
        const t = (el.textContent || '').trim();
        const icons = Array.from(el.querySelectorAll('i, [class*="symbols"], [class*="google-symbols"]')).map(i => (i.textContent || '').trim());
        return /agent|에이전트/i.test(al) || /agent|에이전트/i.test(t) || icons.some(i => /spark/.test(i));
      })
      .slice(0, 12)
      .map(el => ({
        tag: el.tagName.toLowerCase(), role: el.getAttribute('role'),
        text: (el.textContent || '').trim().slice(0, 24),
        ariaLabel: el.getAttribute('aria-label'),
        ariaPressed: el.getAttribute('aria-pressed'), ariaChecked: el.getAttribute('aria-checked'),
        dataState: el.getAttribute('data-state'),
      }));
    console.log(P, 'candidates:', JSON.stringify(cands));
  } catch {}

  const el = findAgentToggle(document);
  if (!el) { console.log(P, 'toggle NOT found'); return { found: false }; }
  const wasOn = isToggleOn(el);
  console.log(P, 'toggle found — wasOn:', wasOn, '| aria-pressed:', el.getAttribute('aria-pressed'), '| data-state:', el.getAttribute('data-state'));
  if (!wasOn) return { found: true, wasOn: false, clicked: false };
  try {
    const r = el.getBoundingClientRect();
    const c = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    try { el.dispatchEvent(new PointerEvent('pointerdown', c)); } catch {}
    el.dispatchEvent(new MouseEvent('mousedown', c));
    try { el.dispatchEvent(new PointerEvent('pointerup', c)); } catch {}
    el.dispatchEvent(new MouseEvent('mouseup', c));
    el.dispatchEvent(new MouseEvent('click', c));
  } catch { try { el.click(); } catch {} }
  return { found: true, wasOn: true, clicked: true, nowOn: isToggleOn(el) };
})()`
