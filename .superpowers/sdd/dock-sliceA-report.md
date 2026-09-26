# Agent Panel Docking — Slice A Report

Status: DONE_WITH_CONCERNS (implementation verified; commit blocked by sandbox `.git/index.lock`)

## Dock mechanism

- App computes `isAgentDocked` only when the panel is open and `effectiveAgentPanelMode(mode, settings.agentPanelMode)` is `docked`.
- The `.app` flex container receives `agent-docked` and defines `--agent-dock-w: 400px`.
- `.app.agent-docked` reserves the right strip with `padding-right: var(--agent-dock-w, 400px)`, shrinking the normal flex-column app content.
- `.agent-chat-panel.mode-docked` is absolutely positioned at `top/right/bottom: 0`, uses the same dock-width variable, has full height, square corners, and no translate overlay.
- Dismissal removes `agent-docked` because `isAgentDocked` is gated by `agentPanelOpen`.
- Flow mode still resolves every stored panel preference to `floating`; no Electron Flow layout code was changed.
- Floating positioning, dragging, FAB, dismiss, send/stop, model picker, and portal dropdown behavior were left unchanged.

## Rename and migration

- Supported values are now `floating` and `docked`.
- `normalizeAgentPanelMode('slide')` migrates the legacy stored value to `docked`.
- `useAppSettings` reuses the shared normalizer during load, preserving `docked`, migrating `slide`, and falling back to `floating` for unknown values.
- ChatPanel now emits/toggles `floating` ↔ `docked`, renders `mode-docked`, and uses `docked` for `aria-pressed`.
- Existing locale keys `slideMode` and `switchToSlide` were retained for parity/test stability, but their English and Korean values now describe docking.

## Files changed

Production:

- `src/components/agent/agentPanelLayout.js`
- `src/hooks/useAppSettings.js`
- `src/components/agent/ChatPanel.jsx`
- `src/components/agent/ChatPanel.css`
- `src/App.jsx`
- `src/App.css`
- `src/locales/en.js`
- `src/locales/ko.js`

Tests:

- `tests/components/agent/agentPanelLayout.test.js`
- `tests/hooks/useAppSettings.test.js`
- `tests/components/agent/ChatPanel.test.jsx`
- `tests/components/agent/ChatPanel.appMount.test.js`
- `tests/components/AppFlowSplitLayout.test.jsx`
- `tests/components/agent/modeToggle.roundtrip.test.jsx`

Report:

- `.superpowers/sdd/dock-sliceA-report.md` (gitignored controller handoff)

No files under `electron/` and no `layout.js` were changed.

## RED evidence

Tests were changed before production code.

- `agentPanelLayout.test.js`: 3 failed / 3 passed. Failures showed the old `['floating', 'slide']` list, missing `docked`, and missing `slide` → `docked` migration.
- `useAppSettings.test.js`: 2 failed / 14 passed. Stored `docked` fell back to `floating`, and stored `slide` remained `slide`.
- `ChatPanel.test.jsx`: 4 failed / 37 passed. The panel still normalized `docked` to floating, exposed the old accessible name, and allowed drag behavior associated with the missing docked mode.
- `ChatPanel.appMount.test.js`: 2 failed / 2 passed. App had no effective-mode import, dock gate, reserve class, or width variable.
- `AppFlowSplitLayout.test.jsx`: 1 failed / 26 passed. App/ChatPanel dock reservation CSS did not exist.
- `modeToggle.roundtrip.test.jsx`: 2 failed / 0 passed. The real settings round-trip did not produce `mode-docked` or the App reserve class.

## GREEN evidence

Each named file:

- `agentPanelLayout.test.js`: 1 file passed, 6/6 tests.
- `useAppSettings.test.js`: 1 file passed, 16/16 tests.
- `ChatPanel.test.jsx`: 1 file passed, 41/41 tests.
- `ChatPanel.appMount.test.js`: 1 file passed, 4/4 tests.
- `agentI18n.test.jsx`: 1 file passed, 6/6 tests.
- `AppFlowSplitLayout.test.jsx`: 1 file passed, 27/27 tests.
- `modeToggle.roundtrip.test.jsx`: 1 file passed, 2/2 tests.
- Final combined key-file rerun: 7/7 files, 102/102 tests.

Full suite:

- Raw `npm run test:run`: 660 passed / 3 failed files; 7268 passed / 15 failed tests.
- All 15 failures were the documented sandbox-only `listen EPERM: operation not permitted 127.0.0.1` failures in:
  - `tests/electron/agent/privateRpc.test.js`
  - `tests/electron/agent/codexOrchestrator.test.js`
  - `tests/electron/agent/sessionManager.test.js`
- Full regression run excluding only those three sandbox-blocked files: 660/660 files and 7215/7215 tests passed.

Independent code review found no Critical or Important issues and assessed the slice as merge-ready.

## Commit

Blocked. `git add` failed before staging with:

```text
fatal: Unable to create '/Users/tuxxon/workspace/AutoFlowCut/.git/index.lock': Operation not permitted
```

Requested commit message for the controller:

```text
feat(agent): dock mode pushes app content (replaces slide overlay), API mode
```

## Concerns

- The `.app` padding approach matches the verified DOM structure and keeps the dock width synchronized with the panel through one CSS variable. It is simpler and lower-risk than restructuring the large App tree into a new row wrapper.
- The fixed 400px dock can leave very little app content at extreme narrow window widths because the current BrowserWindow has no verified minimum width. This is non-blocking for the prescribed slice, but Electron smoke testing should include narrow resizing; a later slice can add a responsive cap or minimum window width if needed.
- Absolute overlays using the App box can still cover the full App area, including the reserved strip, as allowed by the brief.
