# Task 8 Review Fix Report

Status: DONE_WITH_CONCERNS

## Changes

- Added and exported `reclampAgentPanelPosition` in `agentPanelLayout.js`, reusing the existing module-level `clamp`.
- Updated `useFloatingDrag` to accept `appMode` as a re-clamp signal.
- Added an `appMode`-keyed effect that re-measures the panel and its `.app` container and re-clamps an existing drag position.
- Added a container `ResizeObserver` that re-clamps on container resize and disconnects on unmount.
- Preserved the existing drag coordinate math, `dragEnabled` gating, effective mode logic, and CSS.
- Broadened the pointerdown exclusion from `button` to `button, .agent-model-selector`.
- Added regression coverage for shrunken-container re-clamping, model-selector option drag exclusion, and header-button drag exclusion.

## RED Evidence

### `agentPanelLayout.test.js`

Command:

`npx vitest run tests/components/agent/agentPanelLayout.test.js`

Before implementation:

- 1 failed, 4 passed.
- Expected failure: `TypeError: reclampAgentPanelPosition is not a function`.

### `ChatPanel.test.jsx`

Command:

`npx vitest run tests/components/agent/ChatPanel.test.jsx`

Before the ChatPanel fixes:

- 2 failed, 33 passed.
- FIX 1 failed because the stale position remained `left: 48px`; assertion reported `expected 48 to be less than or equal to 20`.
- FIX 2 failed because dragging from the `GPT A` option set `left: 0px`; assertion expected an empty inline `left`.
- FIX 3's header-button guard test passed against the existing `closest('button')` behavior.

## GREEN Verification

- `npx vitest run tests/components/agent/ChatPanel.test.jsx`
  - 1 file passed, 35 tests passed.
- `npx vitest run tests/components/agent/agentPanelLayout.test.js`
  - 1 file passed, 5 tests passed.
- `npx vitest run tests/components/agent/ChatPanel.test.jsx tests/components/agent/agentPanelLayout.test.js`
  - 2 files passed, 40 tests passed.
- `git diff --check`
  - Passed with no whitespace errors before commit.

## ResizeObserver Test-Environment Handling

The observer effect begins with `if (typeof ResizeObserver === 'undefined') return undefined`. jsdom does not provide `ResizeObserver`, so the observer is not constructed there and the tests do not require a polyfill. The `appMode` effect independently performs the Flow entry/exit re-clamp and is what the shrink regression test exercises. In environments with `ResizeObserver`, the `.app` container is observed and the observer is disconnected during cleanup.

## Commit

- Commit: `2d8f427`
- Message: `fix(agent): re-clamp floating panel on container resize and guard selector drag`
- Commit contains only:
  - `src/components/agent/agentPanelLayout.js`
  - `src/components/agent/ChatPanel.jsx`
  - `tests/components/agent/agentPanelLayout.test.js`
  - `tests/components/agent/ChatPanel.test.jsx`

## Concerns

- The full `npm run test:run` suite could not be fully green in this sandbox: 658/661 test files and 7249/7264 tests passed. All 15 failures were in existing private RPC/orchestrator/session-manager tests and shared `Error: listen EPERM: operation not permitted 127.0.0.1`, indicating the sandbox blocks loopback listener creation. The requested Task 8 test files pass together 40/40.
- This report is intentionally outside the commit because the requested commit was limited to the four implementation/test files.
