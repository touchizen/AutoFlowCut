# Flow mode agent docking implementation report

## Status

DONE

- Commit: `5ab8cd0`
- Commit message: `feat(agent): allow docking in Flow mode with container-clamped portals and size fallback`
- Branch: `feature/inapp-agent`
- No files under `electron/` were changed.

## App/ChatPanel effective-mode synchronization

ChatPanel is the single source of truth for the mode that is actually rendered.

- `effectiveAgentPanelMode(appMode, storedMode)` now only normalizes the stored preference, so Flow no longer forces `floating`.
- ChatPanel's `useContainerAwarePanelMode` resolves one `nextMode` from:
  - the normalized stored preference;
  - the measured container rect from `panelRef.current.closest('.app') || parentElement`;
  - the dock size guard.
- That exact same `nextMode` is used both to update ChatPanel's rendered class and to call `onEffectiveModeChange(nextMode)`.
- App stores the reported value in `agentEffectivePanelMode` and computes `isAgentDocked` only from:
  - `agentPanelOpen`;
  - `agentEffectivePanelMode === 'docked'`.
- App no longer independently calls `effectiveAgentPanelMode`, so its `.agent-docked` padding cannot disagree with ChatPanel's derived size fallback.

The mode is measured in a layout effect on mount and whenever `appMode` or the stored preference changes. A guarded `ResizeObserver` re-evaluates the same container when it resizes. The stored setting is never overwritten by the size fallback, so a docked preference automatically resumes when the App grows back.

## Dock size guard

`canDockInContainer({ width, height })` is a pure exported helper.

- Minimum width: `600px`
- Minimum height: `420px`
- Both dimensions must be finite numbers.
- `600×420` is allowed.
- Falling below either threshold renders the panel as floating.
- Missing, `NaN`, or infinite dimensions return `false`.

When a stored docked preference falls back to floating:

- no settings update is emitted;
- the dock resize separator is not rendered;
- App removes the reserved dock padding through ChatPanel's effective-mode callback;
- a later qualifying resize restores docked rendering and padding.

## Flow mode UI changes

- Flow mode now supports docked rendering.
- The mode toggle remains enabled in Flow.
- The obsolete `agent.flowFloatingOnly` notice is no longer rendered.
- The en/ko locale key remains defined to preserve locale parity.

## Portal container clamping

The tooltip and model listbox remain `document.body` portals with `position: fixed`, but their position callers now use the closest `.app` rect. Standalone rendering falls back to a viewport rect at origin `(0, 0)`.

The pure position helpers still return viewport coordinates. For a container rect offset from the viewport, they clamp using:

- horizontal: `[rect.left + EDGE, rect.right - elementWidth - EDGE]`
- vertical: `[rect.top + EDGE, rect.bottom - elementHeight - EDGE]`

This keeps the fixed-position coordinates in viewport space while constraining them to the App's box. Tests cover an App at `left=600, top=0, width=600, height=900`, proving the portal clamps to the App's right edge instead of the browser window edge.

## Files changed

- `src/App.jsx`
- `src/components/agent/agentPanelLayout.js`
- `src/components/agent/ChatPanel.jsx`
- `src/components/agent/AgentIconButton.jsx`
- `src/components/agent/AgentModelSelector.jsx`
- `tests/components/agent/agentPanelLayout.test.js`
- `tests/components/agent/ChatPanel.test.jsx`
- `tests/components/agent/ChatPanel.appMount.test.js`
- `tests/components/agent/AgentIconButton.test.jsx`
- `tests/components/agent/AgentModelSelector.test.jsx`
- `tests/components/agent/modeToggle.roundtrip.test.jsx`

## TDD RED evidence

### Pure helpers and position math

Command:

```text
npm run test:run -- tests/components/agent/agentPanelLayout.test.js tests/components/agent/AgentIconButton.test.jsx tests/components/agent/AgentModelSelector.test.jsx
```

Initial result:

- 3 test files failed.
- 5 tests failed, 23 passed.
- Failures proved:
  - Flow still forced `floating`;
  - `canDockInContainer` did not exist;
  - tooltip/listbox clamping ignored the App rect origin.

After the minimal pure-helper implementation:

- 3 test files passed.
- 28 tests passed.

### React callers, size fallback, and App synchronization

Command:

```text
npm run test:run -- tests/components/agent/AgentIconButton.test.jsx tests/components/agent/AgentModelSelector.test.jsx tests/components/agent/ChatPanel.test.jsx tests/components/agent/ChatPanel.appMount.test.js tests/components/agent/modeToggle.roundtrip.test.jsx
```

Initial result:

- 5 test files failed.
- 8 tests failed, 60 passed.
- Failures proved:
  - portal callers still supplied viewport bounds;
  - the Flow toggle was still disabled and the obsolete notice remained;
  - a small App did not derive floating mode;
  - ChatPanel did not report its rendered mode to App;
  - App reserve padding did not follow ChatPanel's actual mode.

After implementation:

- 5 test files passed.
- 68 tests passed.

## GREEN verification

Requested targeted suite:

```text
npm run test:run -- tests/components/agent/agentPanelLayout.test.js tests/components/agent/AgentIconButton.test.jsx tests/components/agent/AgentModelSelector.test.jsx tests/components/agent/ChatPanel.test.jsx tests/components/agent/ChatPanel.appMount.test.js tests/components/agent/agentI18n.test.jsx tests/components/AppFlowSplitLayout.test.jsx tests/components/agent/modeToggle.roundtrip.test.jsx tests/hooks/useAppSettings.test.js
```

Fresh pre-commit result:

- 9 test files passed.
- 136 tests passed.
- 0 failures.

`git diff --check` also passed before commit.

## Full suite

Command:

```text
npm run test:run
```

Result:

- 663 test files total: 660 passed, 3 failed.
- 7304 tests total: 7289 passed, 15 failed.
- All 15 failures are private-RPC tests that attempt to bind `127.0.0.1`.
- Shared error: `listen EPERM: operation not permitted 127.0.0.1`.
- Failure distribution:
  - `tests/electron/agent/privateRpc.test.js`: 13
  - `tests/electron/agent/codexOrchestrator.test.js`: 1
  - `tests/electron/agent/sessionManager.test.js`: 1

A focused rerun of `privateRpc.test.js` reproduced 13/13 failures at `server.listen(0, '127.0.0.1')`, confirming the sandbox network-bind restriction. No related production or test files were changed by this task.

## Review and concerns

Self-review found no Critical or Important implementation issues against the supplied requirements.

Concern:

- The full suite cannot be completely green in this sandbox because loopback server binding is denied. The requested targeted suite is fully green, and the 15 full-suite failures match the expected sandbox-only private-RPC pattern.
