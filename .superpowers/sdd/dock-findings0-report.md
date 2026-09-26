# Dock Findings 0 Review-Fix Report

## Status

DONE

- Branch: `feature/inapp-agent`
- Starting HEAD: `58f1b9970e3f99bb42930ed343dfc231f8a090d0`
- Commit: `102418771b5464009604d382d093d3e2b7603350`
- Commit message: `fix(agent): derive dock width from preference, pre-paint clamp, and harden resize/portal lifecycle`

No files under `electron/` were changed. `layout.js`, locale files, mode fallback ownership, Flow docking, merged Send/Stop, FAB/dismiss, model selection behavior, and the existing portal clamp formulas were not changed.

## Preference versus applied width contract

`settings.agentDockWidth` is now only the user's persisted preference.

- `App` passes `settings.agentDockWidth` directly to `ChatPanel`.
- `App` no longer keeps a second live-width state.
- `App` calls `updateSetting('agentDockWidth', width)` only through the explicit commit callback.
- `useAppSettings` still normalizes loaded values only to the absolute `280..720` range with an unbounded container. It does not apply the container ratio and therefore does not lose a stored preference such as `700`.

`useDockResize` owns the applied width:

- It derives `clampAgentDockWidth(preference, currentContainerWidth)`.
- The first derivation runs in `useLayoutEffect`, before browser paint.
- The same layout effect re-runs for preference, effective resize enablement, and `appMode` changes.
- A guarded `ResizeObserver` observes the `.app` container and derives from the preference again on container resize.
- During a pointer drag, the live desired value comes from the current pointer position and is clamped against the container rect on every move.
- When an uncommitted pointer/keyboard interaction is disabled by close or mode fallback, the transient value is discarded and the applied width returns to the preference-derived value.
- Pointer release/cancel and keyboard keyup/blur commit the current applied value as the new preference.

This means a stored `700` becomes `480` in an `800px` container without changing settings, then returns to `700` when the container grows.

## Single writer for `--agent-dock-w`

`ChatPanel` is the only JavaScript writer for `--agent-dock-w`.

- `useDockResize.applyWidth()` writes the applied value directly to the closest `.app`.
- `App` owns only the `agent-docked` class and no longer renders an inline CSS variable.
- Pointer moves update the DOM variable and ChatPanel's local ARIA state; they do not reconcile App's scene table/timeline tree.
- App re-renders have no style prop that can overwrite an in-progress drag.
- On commit, settings update once and the preference-derived layout effect becomes authoritative.

`rg` after the change found one production JavaScript writer: `ChatPanel.jsx`'s `container.style.setProperty('--agent-dock-w', ...)`.

## Findings and pinned tests

### I-1 — persisted width painted before container clamp

Fix:

- Moved container-aware width derivation to `useLayoutEffect`.
- The layout effect writes the CSS variable immediately and synchronously updates `aria-valuenow`/`aria-valuemax` state before paint.
- `appMode` is an explicit derivation dependency.

Test:

- `첫 layout commit에서 persisted preference를 container 폭으로 clamp하고 유효한 ARIA를 노출한다`
- A parent layout probe reads the `.app` CSS variable during the first committed layout.
- Persisted `700` in an `800px` container is already `480px`.
- The separator immediately satisfies `aria-valuenow <= aria-valuemax`.

RED mutation evidence:

- Replacing the dock derivation `useLayoutEffect` with `useEffect` failed with `layoutWidths[0] === ''`, expected `480px`.

### I-2 — re-clamped width did not return to the preference

Fix:

- Container resize derivation reads `preferenceRef.current`, never the already-shrunk applied value.
- Re-clamping never calls the commit path and never overwrites settings.

Test:

- `저장 preference를 건드리지 않고 좁은 container에 적용한 뒤 container가 커지면 preference 폭으로 복귀한다`
- Narrow container: applied `480px`, preference remains `700`.
- Wide container after driven ResizeObserver callback: applied returns to `700px`, preference remains `700`.

RED mutation evidence:

- Deriving from `latestWidthRef.current` reproduced the defect: growth remained at `480px`, expected `700px`.

### M-1 — pointer moves re-rendered App

Fix:

- Removed App's `agentDockWidth` live state and settings-to-live sync effect.
- Removed `onAgentDockWidthChange`.
- Live pointer movement writes the container CSS variable inside ChatPanel.
- App receives only one commit after the interaction finishes.

Tests:

- `docked+open에서 App state를 거치지 않고 live 폭을 바꾸며 pointerup에 한 번 commit한다`
  - Multiple pointer moves update `--agent-dock-w`.
  - The harness preference remains `400` during movement.
  - Commit count stays zero until pointerup, then becomes exactly one with `520`.
- `ChatPanel.appMount.test.js`
  - App has no inline `--agent-dock-w` writer.
  - App has no `[agentDockWidth, setAgentDockWidth]` live state.
  - App passes `settings.agentDockWidth` and has no live-change prop.

Initial RED evidence:

- App source guards failed because the inline writer, local state, and live-change prop still existed.
- The new single-writer harness received no live CSS variable from the old implementation.

### M-2 — pointercancel left drag state active

Fix:

- Dock resize now uses guarded pointer capture.
- `pointercancel` uses the same finish path as `pointerup`: it clears the drag, releases capture when held, and commits once.
- Added the symmetric `pointercancel` clear to floating drag.

Tests:

- `pointercancel 뒤 hover pointermove가 resize를 재개하지 않는다`
- `floating drag도 pointercancel 뒤 hover pointermove를 무시한다`

RED mutation evidence:

- Removing the dock `pointercancel` listener let the later hover move change `450px` to `600px`.
- Before the floating addition, the later hover move changed `60px` to `140px`.

### M-3 — open portals ignored `.app` resize

Fix:

- `PortalTooltip` and `AgentModelSelector` now observe the anchor's closest `.app`.
- Their existing position update functions run from the container ResizeObserver callback.
- Each observer is guarded for environments without `ResizeObserver` and disconnected on close/unmount.
- Window resize and capture-scroll listeners remain intact.

Tests:

- `open tooltip은 App container ResizeObserver 알림으로 위치를 다시 계산한다`
  - Confirms the observer registered on `.app`.
  - Directly drives the observer callback because jsdom's default ResizeObserver is inert.
  - Tooltip left changes from `992px` to `792px`.
- `open listbox는 App container ResizeObserver 알림으로 위치를 다시 계산한다`
  - Confirms the observer registered on `.app`.
  - Directly drives the callback.
  - Listbox left changes from `972px` to `772px`.

Initial RED evidence:

- Both tests failed because no observer instance had registered the `.app` target.

### M-4 — keyboard auto-repeat committed settings per keydown

Fix:

- Arrow keydown only updates the live applied width.
- The first relevant keyup commits once.
- Blur commits once if focus leaves before keyup.
- The pending keyboard interaction is cleared if resize becomes disabled.

Tests:

- `separator keyboard auto-repeat은 live만 바꾸고 keyup에 한 번 commit한다`
  - Three ArrowLeft keydowns produce live `448px`.
  - Commit count is zero during keydown and exactly one on keyup.
- `commit 전 resize 중 panel이 비활성화되면 transient 폭을 버리고 preference 폭으로 복귀한다`
  - An uncommitted `416px` returns to the `400px` preference without a commit.

RED mutation evidence:

- Restoring per-keydown commit produced three commits: `416`, `432`, and `448`.
- Before disable handling, the transient width stayed at `416px`, expected `400px`.

## TDD RED summary

Initial pre-implementation command:

```text
npm run test:run -- tests/components/agent/ChatPanel.test.jsx tests/components/agent/ChatPanel.appMount.test.js tests/components/agent/AgentIconButton.test.jsx tests/components/agent/AgentModelSelector.test.jsx
```

Result:

- 4 test files failed.
- 10 tests failed, 61 passed.
- Failures covered the missing ChatPanel CSS writer, App's competing writer/live state, first-layout clamp, preference restoration, pointer cancel, keyboard commit batching, and missing portal observers.

Additional focused RED runs:

- Floating pointercancel: later hover move produced `140px`, expected `60px`.
- Disabled transient resize: stayed `416px`, expected `400px`.
- I-1 mutation: first layout probe saw an empty CSS variable.
- I-2 mutation: growth stayed at `480px`, expected `700px`.
- M-2 mutation: post-cancel move produced `600px`, expected `450px`.
- M-4 mutation: three keydowns produced three commits instead of zero before keyup.

## GREEN verification

Required targeted suite:

```text
npm run test:run -- tests/components/agent/agentPanelLayout.test.js tests/components/agent/ChatPanel.test.jsx tests/components/agent/ChatPanel.appMount.test.js tests/components/agent/AgentIconButton.test.jsx tests/components/agent/AgentModelSelector.test.jsx tests/hooks/useAppSettings.test.js tests/components/agent/agentI18n.test.jsx tests/components/AppFlowSplitLayout.test.jsx tests/components/agent/modeToggle.roundtrip.test.jsx
```

Fresh final result:

- Test files: 9 passed, 9 total.
- Tests: 143 passed, 143 total.
- Failures: 0.

`git diff --check` passed before commit.

## Full suite

Command:

```text
npm run test:run
```

Fresh final result:

- Test files: 661 passed, 3 failed, 664 total.
- Tests: 7298 passed, 15 failed, 7313 total.
- All 15 failures are the known sandbox-only private-RPC loopback bind failures.
- Shared error: `listen EPERM: operation not permitted 127.0.0.1`.
- Distribution:
  - `tests/electron/agent/privateRpc.test.js`: 13
  - `tests/electron/agent/codexOrchestrator.test.js`: 1
  - `tests/electron/agent/sessionManager.test.js`: 1

## Review

Self-review checked every requested finding, the preference/applied-width data flow, the single JavaScript writer invariant, pointer/keyboard interruption paths, observer cleanup, effective-mode ownership, forbidden paths, and locale parity.

The `requesting-code-review` workflow normally dispatches an independent reviewer, but the session's higher-level instruction prohibited spawning subagents. No Critical, Important, or Minor issue remained in the direct review; the additional transient-disable regression was found and fixed before final verification.

## Concerns

- The full suite cannot be zero-failure in this sandbox because binding a private RPC listener to `127.0.0.1` is denied. The 15 failures exactly match the pre-existing sandbox-only set and do not touch changed files.
- No implementation concern remains for I-1, I-2, or M-1 through M-4.
