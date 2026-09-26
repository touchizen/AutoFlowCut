# Upscayl Residual Guards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining Upscayl mutual-exclusion and deterministic temp-filename findings.

**Architecture:** Use the live ref already owned by `useUpscayl` for dispatch-time generation guards. Refuse image writers at their renderer-owned write boundary, return acknowledged MCP busy responses, and hash only overlong render temp names.

**Tech Stack:** React 18 hooks, Electron main/renderer bridge, Node.js crypto, Vitest, Testing Library.

---

### Task 1: Batch reverse guard

**Files:**
- Modify: `tests/hooks/useAutomation.concurrency.test.jsx`
- Modify: `src/hooks/useUpscayl.js`
- Modify: `src/hooks/useAutomation.js`
- Modify: `src/App.jsx`

1. Add a hook test that starts a batch, flips a live Upscayl reader before scene dispatch, and asserts no scene is submitted or left generating.
2. Run the test and confirm it fails because `useAutomation` does not read Upscayl at dispatch.
3. Expose a stable live reader from `useUpscayl`, inject it from `App`, and stop the batch immediately before scene state/submit work.
4. Re-run the touched hook test and confirm it passes.

### Task 2: Manual writer guards

**Files:**
- Modify: `tests/components/SceneDetailModal.meta.test.jsx`
- Modify: `src/components/SceneDetailModal.jsx`
- Modify: `src/components/SceneList.jsx`
- Modify: `src/App.jsx`

1. Add tests proving active Upscayl refuses restore, save, and regenerate, while idle behavior is unchanged.
2. Run the tests and confirm active-Upscayl cases fail.
3. Pass `upscaylRunning` through both modal hosts and add one shared guard with the existing toast.
4. Re-run the modal tests and confirm they pass.

### Task 3: MCP acknowledged image-write guard

**Files:**
- Create: `electron/mcp/updateRoute.js`
- Create: `tests/electron/mcp/updateRoute.test.js`
- Modify: `electron/main.js`
- Modify: `src/hooks/useMcpServer.js`
- Modify: `src/App.jsx`
- Modify: `mcp-server/lib/toolResponses.js`
- Modify: `mcp-server/index.js`
- Modify: `tests/hooks/useMcpServer.test.js`
- Modify: `tests/mcp-server/toolResponses.test.js`

1. Add renderer-handler tests for active/idle image updates and an idle non-image update.
2. Add route/tool-response tests proving busy maps to HTTP 409 and MCP `isError`.
3. Run the tests and confirm the new APIs are absent.
4. Implement the live renderer guard, main route dispatch, and MCP failure propagation.
5. Re-run the touched MCP tests and confirm they pass.

### Task 4: Deterministic long temp names

**Files:**
- Modify: `tests/electron/render/resolveInputs.test.js`
- Modify: `electron/render/resolveInputs.js`

1. Add a test with selected same-scene `i2v` and `t2v` inputs whose source suffix lies beyond the 160-character cap.
2. Run it and confirm both inputs resolve to the same path before the fix.
3. Append a SHA-256 suffix derived from the full pre-cap name only when the name exceeds 160 characters.
4. Re-run the test and existing resolve-input tests.

### Task 5: Runtime App aggregate coverage

**Files:**
- Modify: `tests/components/App.promptBusyLines.test.jsx`
- Modify: `tests/components/App.upscaylWiring.test.js`

1. Add a runtime matrix for idle plus each of the five MCP running operands.
2. Run it and confirm any missing harness control fails the intended case.
3. Remove only the equivalent MCP aggregate regex assertion.
4. Re-run both App test files.

### Task 6: Final verification

1. Run all touched test files together, never the full suite.
2. Run `git diff --check`.
3. Inspect `git diff` and `git status --short` to confirm no commit and no unrelated changes.
