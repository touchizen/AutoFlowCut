# M2b-1 Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Close B1-B5 and F1 with reproducible regression tests while preserving the complete test suite and build.

**Architecture:** Electron main owns one workflow session coordinator shared by Story and Shopping and one canonical work-folder authority populated only from saved/default/picker-confirmed paths. The coordinator serializes opens, invalidates the active epoch before awaiting abort, opens a validated candidate privately, and publishes it only if the epoch is still current. Renderer behavior remains thin: it receives workflow-specific labels and enters the workflow view after a successful Shopping project switch.

**Tech Stack:** Electron IPC, Node.js filesystem/network APIs, React 18, Vitest, Testing Library.

---

### Task 1: Shared workflow session lifecycle and project context

**Files:**
- Create: `electron/ipc/workflowSessionCoordinator.js`
- Create: `electron/main/workFolderAuthority.js`
- Modify: `electron/ipc/story-api.js`
- Modify: `electron/ipc/shopping-api.js`
- Modify: `electron/ipc/filesystem.js`
- Modify: `electron/main.js`
- Test: `tests/electron/ipc/workflow-session.test.js`
- Test: `tests/electron/ipc/shopping-api.test.js`

1. Add failing bidirectional switch tests asserting old tokens return `stale-token` before side effects.
2. Add failing common-lock/state-emit race tests.
3. Add failing disk workflow marker, missing context, and realpath/symlink containment tests.
4. Run the focused tests and confirm the expected failures.
5. Implement the coordinator, canonical project validation, and main-owned authority.
6. Run the focused Story/Shopping IPC tests to GREEN.

### Task 2: Unsupported product retry

**Files:**
- Modify: `electron/shopping/planMachine.js`
- Test: `tests/electron/shopping/planMachine.test.js`

1. Add a failing test for unsupported → structured error + durable `empty` → valid retry → `fact_review`.
2. Run the focused test and confirm `fact_review` is incorrectly persisted.
3. Require `snapshot.status === 'ok'` before persistence.
4. Run the focused test to GREEN.

### Task 3: External HTTP cancellation

**Files:**
- Modify: `electron/api/net/safeHttpFetch.js`
- Test: `tests/electron/api/net/safeHttpFetch.test.js`
- Test: `tests/electron/ipc/shopping-api.test.js`

1. Add failing tests for pre-aborted signals, in-flight abort reason propagation, and listener cleanup.
2. Add a failing Shopping abort integration test that reaches the real `safeHttpFetch` with injected DNS/transport seams.
3. Compose the deadline controller with the external signal and clean listeners in `finally`.
4. Run both focused suites to GREEN.

### Task 4: Shopping entry point

**Files:**
- Modify: `src/components/Header.jsx`
- Modify: `src/App.jsx`
- Modify: `src/hooks/useProjectData.js`
- Test: `tests/components/Header/Header.workflowLabel.test.jsx`
- Test: `tests/components/App.shoppingWorkflowWiring.test.js`

1. Add failing component tests for the Shopping label and successful-switch view entry.
2. Pass `workflowType` to Header and return the resolved workflow from project switching.
3. Route successful Shopping switches through a callback that sets the workflow view.
4. Run focused component/hook tests to GREEN.

### Task 5: Verification

1. Run all changed focused suites.
2. Run `npm run test:run` and record the exact passing count.
3. Run `npm run build` and record the result.
4. Run `git diff --check` and inspect the final diff/status.

No commits are allowed for this task.
