# Dock Resize Implementation Report

## Status

DONE

## Handle implementation

- `ChatPanel` renders `.agent-chat-resizer` only when the panel is open and its effective mode is `docked`.
- The handle is positioned on the docked panel's left edge and uses window-level `pointermove`/`pointerup` listeners.
- Drag math is `startWidth + startX - currentX`, so dragging left grows the dock and dragging right shrinks it.
- The handle path is separate from `useFloatingDrag`; floating mode rendering and header dragging are unchanged.
- A `ResizeObserver` reclamps the live width if the current `.app` container becomes narrower.

## Clamp helper and formula

- Pure exported helper: `clampAgentDockWidth(desiredPx, containerWidthPx)`.
- Constants:
  - default: `400px`
  - minimum: `280px`
  - absolute maximum: `720px`
  - container ratio: `60%`
- Effective maximum:

  `max(280, min(720, containerWidth * 0.6))`

- Result:

  `min(effectiveMax, max(280, normalizedDesired))`

- A non-number or non-finite desired value is normalized to `400`.
- The `max(280, ...)` narrow-container fallback keeps the required minimum invariant and prevents an invalid ARIA range where `aria-valuemax` would be below `aria-valuemin`.

## Persistence approach

- `App` owns a local `agentDockWidth` state and applies it to `--agent-dock-w`, so both the reserved padding and docked panel width reflow live.
- Pointer movement updates only the local live state.
- Pointer release calls `updateSetting('agentDockWidth', px)` once through `commitAgentDockWidth`.
- `useAppSettings` persists the committed setting through its existing settings effect; pointer moves do not write localStorage.
- Load-time settings normalization uses the same pure helper with an unbounded container, producing the persisted static range `280..720`.

## Accessibility

- Implemented keyboard-operable `role="separator"`.
- Includes `aria-label`, `aria-orientation="vertical"`, `aria-valuenow`, `aria-valuemin`, and current container-derived `aria-valuemax`.
- `ArrowLeft` grows the dock by `16px`; `ArrowRight` shrinks it by `16px`, with immediate commit.
- Added matching `agent.resizeDock` strings to English and Korean locales.

## Files changed

- `src/App.jsx`
- `src/components/agent/ChatPanel.jsx`
- `src/components/agent/ChatPanel.css`
- `src/components/agent/agentPanelLayout.js`
- `src/hooks/useAppSettings.js`
- `src/locales/en.js`
- `src/locales/ko.js`
- `tests/components/agent/agentPanelLayout.test.js`
- `tests/hooks/useAppSettings.test.js`
- `tests/components/agent/ChatPanel.test.jsx`
- `tests/components/agent/ChatPanel.appMount.test.js`

No changes were made to `electron/`, `layout.js`, or Flow's effective floating-mode rule.

## RED evidence

1. `tests/components/agent/agentPanelLayout.test.js`
   - Initial run: 4 new tests failed because `clampAgentDockWidth` did not exist.
2. `tests/hooks/useAppSettings.test.js`
   - Initial run: 5 new tests failed because `agentDockWidth` was missing and stored invalid/out-of-range values were not normalized.
3. `tests/components/agent/ChatPanel.test.jsx`
   - Initial run: 2 new tests failed because no accessible dock resize separator existed.
4. `tests/components/agent/ChatPanel.appMount.test.js`
   - Initial run: 2 tests failed because App still used the hard-coded `400px` CSS variable and passed no live/commit resize props.
5. Narrow-container review regression
   - Reproduced `clampAgentDockWidth(400, 400) === 240`.
   - Added helper and ChatPanel ARIA tests; both failed with received `240` vs expected `280` before the fix.

## GREEN summaries

- `tests/components/agent/agentPanelLayout.test.js`: 11 passed
- `tests/hooks/useAppSettings.test.js`: 22 passed
- `tests/components/agent/ChatPanel.test.jsx`: 46 passed
- `tests/components/agent/ChatPanel.appMount.test.js`: 4 passed
- `tests/components/AppFlowSplitLayout.test.jsx`: 27 passed
- `tests/components/agent/agentI18n.test.jsx`: 6 passed
- `tests/components/agent/modeToggle.roundtrip.test.jsx`: 2 passed
- Required regression group: 7 files, 118 passed
- `npm run build`: passed (`vite build` and both preload bundles)

## Full suite

Command: `npm run test:run`

- Test files: 660 passed, 3 failed, 663 total
- Tests: 7284 passed, 15 failed, 7299 total
- All 15 failures are the documented sandbox-only private RPC failures:
  - `tests/electron/agent/privateRpc.test.js`: 13
  - `tests/electron/agent/codexOrchestrator.test.js`: 1
  - `tests/electron/agent/sessionManager.test.js`: 1
- Shared failure: `listen EPERM: operation not permitted 127.0.0.1`

## Review

- Independent code review initially found the narrow-container minimum/ARIA inversion.
- The regression was fixed with RED/GREEN tests.
- Re-review result: no remaining Critical or Important issues; Ready.

## Commit

`88f84d87a7d33a0dd99bb2084cbaca5d93d1a761`

Message: `feat(agent): resizable dock width with drag handle`

## Concerns

- The full suite remains non-zero only because this sandbox blocks loopback listeners; 15 private RPC tests fail with `127.0.0.1 EPERM`.
