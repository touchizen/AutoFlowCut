# Agent Panel Docking — Slice A: API-mode dock that pushes app content

Goal: replace the "slide" OVERLAY mode with a "docked" mode that PUSHES the app content aside (reflow), so the app and the agent are visible side-by-side. Two modes remain: **Floating** (the floating card, unchanged) ↔ **Docking** (new dock behavior). This slice covers API mode only; Flow-mode docking is a later slice (Flow still forces floating for now).

## Structural facts (verified — build on these)
- Nesting: `Shell(shell-root) > app-content-full|split > .app-root > .app > [app content (flex column) + ChatPanel (absolute overlay sibling) + ApprovalDialog + overlays]`.
- `.app` (App.jsx:2672, `<div className={computeAppClass(mode)}>`) is `display:flex; flex-direction:column; height:100vh; overflow:hidden; position:relative` (App.css:119).
- The app's main UI are flex-column children of `.app`; ChatPanel is `position:absolute` inside `.app`.
- App.jsx owns: `mode` (from useMode, 'api'|'flow'|null), `agentPanelOpen` (bool), `settings.agentPanelMode`, and passes appMode/agentPanelMode/onAgentPanelModeChange to ChatPanel.
- Current non-floating mode: value `'slide'`, class `mode-slide` = a translateX overlay drawer (does NOT push content). `effectiveAgentPanelMode(appMode, stored)` = `appMode==='flow' ? 'floating' : normalize(stored)`.

## Target mechanism (recommended — refine if you find cleaner)
1. Rename the non-floating mode `'slide'` → `'docked'` everywhere it's a value/class/label:
   - agentPanelLayout.js: AGENT_PANEL_MODES = ['floating','docked']; normalizeAgentPanelMode maps unknown→'floating'; ALSO migrate legacy 'slide'→'docked' (so persisted 'slide' becomes 'docked').
   - useAppSettings.js: default stays 'floating'; the loadSettings normalizer must accept 'floating'|'docked' AND map a stored 'slide' → 'docked' (migration).
   - ChatPanel class `mode-slide`→`mode-docked`; toggle aria-pressed = effectiveMode==='docked'; onClick toggles floating↔docked.
   - Locale (en.js/ko.js): repurpose the strings — e.g. slideMode→ "Docked"/"도킹", switchToSlide→ "Switch to docked panel"/"도킹으로 전환", switchToFloating unchanged, modeToggle stays "Dock panel mode"/"도킹 패널 모드". Keep ko/en parity; update the agentI18n parity test key list if you rename keys (prefer REUSING existing keys with new values to avoid touching many tests — rename the VALUE strings, keep the KEY names slideMode/switchToSlide etc., just so tests keep passing; add a comment they now mean "docked").
2. Dock reserves space via `.app` padding + a CSS var:
   - In App.jsx, compute `isAgentDocked = agentPanelOpen && effectiveAgentPanelMode(mode, settings.agentPanelMode) === 'docked'` (import effectiveAgentPanelMode from agentPanelLayout). Add class `agent-docked` to the `.app` div when true (append to computeAppClass(mode) output), and set the dock width via a CSS var on that div, e.g. `style={{ '--agent-dock-w': '400px' }}` (only needs to exist; the class gates it).
   - App.css: `.app.agent-docked { padding-right: var(--agent-dock-w, 400px); }` → the flex-column app content shrinks left. (Absolute overlays with inset:0 still cover full box — fine.)
3. ChatPanel docked positioning (ChatPanel.css): `.agent-chat-panel.mode-docked { top:0; right:0; bottom:0; width: var(--agent-dock-w, 400px); height:100%; max-height:100%; border-radius:0; transform:none; }` and its is-open/is-dismissed handle visibility (dismissed can slide out with translateX(100%) or just hidden — keep the existing is-dismissed visibility:hidden). It sits in the reserved right strip. Remove the old translateX overlay slide rules (mode-slide.*). Keep floating (mode-floating) unchanged.
4. Dragging: dock mode is not draggable (dragEnabled = open && effectiveMode==='floating' — already correct since docked≠floating). Good.
5. When docked and the panel is DISMISSED (open=false), `.app` must NOT keep the padding (content returns to full width) — because isAgentDocked requires agentPanelOpen. Confirm: dismiss → agentPanelOpen false → isAgentDocked false → no padding → FAB shows. Good.

## Tests (update + add)
- agentPanelLayout.test.js: update AGENT_PANEL_MODES/normalize/effective tests for 'docked' (and add: normalizeAgentPanelMode('slide') === 'docked' migration; effectiveAgentPanelMode('api','docked')==='docked'; ('flow','docked')==='floating').
- useAppSettings.test.js: update the agentPanelMode tests — default 'floating'; stored 'docked' preserved; stored 'slide' migrates to 'docked'; unknown→'floating'.
- ChatPanel.test.jsx: the effective-mode + toggle tests — update class assertions mode-slide→mode-docked, toggle behavior floating↔docked, aria-pressed. Keep them green.
- ChatPanel.appMount.test.js: if App wiring strings change (new agent-docked class / effectiveAgentPanelMode import), update the source-string assertions accordingly.
- AppFlowSplitLayout.test.jsx / AppFlowSplitLayout: the CSS-grep invariant referenced `.agent-chat-panel` viewport units — ensure still holds; if it referenced mode-slide, update.
- Add an App-level test (or extend appMount) asserting: when agentPanelOpen && docked, the `.app` container gets the `agent-docked` class (content-reserve) and when floating/dismissed it does not. (This is the real "push" contract — the round-trip test modeToggle.roundtrip.test.jsx can be extended to assert the app container reserves space, if a real `.app` wrapper is present in that harness.)

## TDD + verification
- Update tests RED → implement → GREEN. Run (all `cd /Users/tuxxon/workspace/AutoFlowCut &&`): agentPanelLayout.test.js, useAppSettings.test.js, ChatPanel.test.jsx, ChatPanel.appMount.test.js, agentI18n.test.jsx, AppFlowSplitLayout.test.jsx, modeToggle.roundtrip.test.jsx. Then full suite must be green.
- Commit: `git commit -m "feat(agent): dock mode pushes app content (replaces slide overlay), API mode"`

## Out of scope (Slice B)
- Flow-mode docking (effectiveMode still forces floating in Flow; Flow bounds / layout.js untouched THIS slice).
- Do NOT touch electron/ layout.js this slice.
