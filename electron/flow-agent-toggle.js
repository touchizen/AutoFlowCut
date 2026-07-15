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

/**
 * Locate the compose Agent toggle from its untranslated state attributes.
 *
 * Live English/Korean dumps contain exactly one button[aria-pressed] in the
 * composer. Scope from the Slate editor instead of searching the page so an
 * unrelated pressed button elsewhere cannot be trusted-clicked. Translated
 * Agent text is only a second-line disambiguator when the scope has >1 state
 * control; ambiguity fails closed.
 */
export function findAgentToggle(doc) {
  const editor = doc.querySelector("[data-slate-editor='true']")
  if (!editor) return null
  const STATE_SELECTOR = 'button[aria-pressed], [role="switch"][aria-checked], [role="checkbox"][aria-checked]'
  let candidates = []
  for (let scope = editor.parentElement; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
    candidates = Array.from(scope.querySelectorAll(STATE_SELECTOR))
    if (candidates.length > 0) break
  }
  if (candidates.length === 1) return candidates[0]
  if (candidates.length === 0) return null
  const named = candidates.filter((el) => {
    const text = (el.textContent || '').trim()
    const ariaLabel = el.getAttribute('aria-label') || ''
    return /agent|에이전트/i.test(text) || /agent|에이전트/i.test(ariaLabel)
  })
  return named.length === 1 ? named[0] : null
}

/** Page expression returning the agent toggle ELEMENT (for trustedClickOnFlowView). */
export const AGENT_TOGGLE_SELECTOR = `(function() {
  const find = ${findAgentToggle.toString()};
  return find(document);
})()`

/**
 * Snapshot every "agent-ish" control plus the page context — for when findAgentToggle
 * returns null and fails generation closed.
 *
 * findAgentToggle scopes state-bearing controls from the Slate composer and fails
 * closed when more than one remains after its second-line text disambiguation.
 * When it rejects everything we lose the reason, and a user report becomes
 * unfalsifiable — markup change, ambiguity, and collapsed viewport otherwise look
 * identical. Keep every scoped state candidate plus the surrounding page context.
 */
export function scanAgentToggleCandidates(doc) {
  const win = doc.defaultView
  const STATE_SELECTOR = 'button[aria-pressed], [role="switch"][aria-checked], [role="checkbox"][aria-checked]'
  const editor = doc.querySelector("[data-slate-editor='true']")
  let scoped = []
  if (editor) {
    for (let scope = editor.parentElement; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
      scoped = Array.from(scope.querySelectorAll(STATE_SELECTOR))
      if (scoped.length > 0) break
    }
  }
  const diagnosticCandidates = scoped.length > 0
    ? scoped
    : Array.from(doc.querySelectorAll('button, [role="switch"], [role="checkbox"], [role="button"], input[type="checkbox"]'))
  const cands = diagnosticCandidates
    .map((el) => ({
      el,
      icons: Array.from(el.querySelectorAll('i, [class*="symbols"], [class*="google-symbols"]')).map((i) => (i.textContent || '').trim()),
    }))
    .filter(({ el, icons }) => {
      if (scoped.length > 0) return true
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
      scopedToggleCount: scoped.length,
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
 * Locate the settings content from untranslated roles/states and Material icons.
 * The live panel contains one radio group, two aspect tablists, two count
 * tablists, two model-menu triggers, and one plain save action.
 */
export function findAgentSettingsPanel(doc) {
  const iconTexts = (el) => Array.from(el.querySelectorAll('i, [class*="symbols"], [class*="google-symbols"]'))
    .map((i) => (i.textContent || '').trim())
  const groups = Array.from(doc.querySelectorAll('[role="radiogroup"]'))
  for (const group of groups) {
    if (group.querySelectorAll('[role="radio"]').length < 2) continue
    for (let panel = group.parentElement; panel && panel !== doc.body && panel !== doc.documentElement; panel = panel.parentElement) {
      const tablists = Array.from(panel.querySelectorAll('[role="tablist"]'))
      const aspectLists = tablists.filter((list) => iconTexts(list).includes('crop_16_9'))
      const menuTriggers = panel.querySelectorAll('button[aria-haspopup="menu"]')
      const plainActions = Array.from(panel.querySelectorAll('button')).filter((button) => (
        !button.hasAttribute('role')
        && !button.hasAttribute('aria-haspopup')
        && iconTexts(button).length === 0
      ))
      if (tablists.length >= 4 && aspectLists.length === 2 && menuTriggers.length >= 2 && plainActions.length === 1) {
        return panel
      }
    }
  }
  return null
}

/** Return the image/video settings sections within a located settings panel. */
export function findAgentSettingsSections(panel) {
  if (!panel) return { image: null, video: null }
  const iconTexts = (el) => Array.from(el.querySelectorAll('i, [class*="symbols"], [class*="google-symbols"]'))
    .map((i) => (i.textContent || '').trim())
  const aspectLists = Array.from(panel.querySelectorAll('[role="tablist"]'))
    .filter((list) => iconTexts(list).includes('crop_16_9'))
  const imageLists = aspectLists.filter((list) => (
    iconTexts(list).includes('crop_landscape')
    || Array.from(list.querySelectorAll('[role="tab"]')).some((tab) => (tab.id || '').endsWith('-trigger-LANDSCAPE_4_3'))
  ))
  const videoLists = aspectLists.filter((list) => !imageLists.includes(list))
  const sectionFor = (list) => {
    if (!list) return null
    for (let section = list.parentElement; section && section !== panel; section = section.parentElement) {
      if (section.querySelectorAll('[role="tablist"]').length >= 2
        && section.querySelectorAll('button[aria-haspopup="menu"]').length === 1) return section
    }
    return null
  }
  return {
    image: imageLists.length === 1 ? sectionFor(imageLists[0]) : null,
    video: videoLists.length === 1 ? sectionFor(videoLists[0]) : null,
  }
}

/** Locate the one plain action button (Save) in the settings content. */
export function findAgentSettingsSaveButton(panel) {
  if (!panel) return null
  const iconTexts = (el) => Array.from(el.querySelectorAll('i, [class*="symbols"], [class*="google-symbols"]'))
    .map((i) => (i.textContent || '').trim())
  const actions = Array.from(panel.querySelectorAll('button')).filter((button) => (
    !button.hasAttribute('role')
    && !button.hasAttribute('aria-haspopup')
    && iconTexts(button).length === 0
  ))
  return actions.length === 1 ? actions[0] : null
}

function findAgentSettingsCloseButtonInPanel(doc, panel) {
  if (!panel) return null
  const win = doc.defaultView
  const isVisible = (el) => {
    if (!el) return false
    const rect = el.getBoundingClientRect()
    const style = win && win.getComputedStyle ? win.getComputedStyle(el) : null
    return rect.width > 0 && rect.height > 0
      && (!style || (style.visibility !== 'hidden' && style.display !== 'none'))
  }
  const BACK_ICONS = ['arrow_back', 'arrow_back_ios', 'arrow_back_ios_new', 'chevron_left', 'keyboard_backspace', 'west', 'keyboard_arrow_left']
  const isBack = (button) => Array.from(button.querySelectorAll('i, [class*="symbols"], [class*="google-symbols"]'))
    .some((icon) => BACK_ICONS.includes((icon.textContent || '').trim()))
  for (let scope = panel; scope && scope !== doc.body && scope !== doc.documentElement; scope = scope.parentElement) {
    const matches = Array.from(scope.querySelectorAll('button')).filter((button) => isVisible(button) && isBack(button))
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) return null
  }
  return null
}

/** Locate the settings panel's locale-invariant arrow-back close control. */
export function findAgentSettingsCloseButton(doc) {
  return findAgentSettingsCloseButtonInPanel(doc, findAgentSettingsPanel(doc))
}

/** Page expression returning the agent-settings panel close button ELEMENT. */
export const AGENT_SETTINGS_CLOSE_SELECTOR = `(function() {
  const findPanel = ${findAgentSettingsPanel.toString()};
  const findClose = ${findAgentSettingsCloseButtonInPanel.toString()};
  return findClose(document, findPanel(document));
})()`

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
