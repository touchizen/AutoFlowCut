# M2b-1 R2 Remaining Findings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Implement the approved hybrid workflow safety design and close every remaining R2 finding with mutation-sensitive regression tests.

**Architecture:** Main-owned session identity is the correctness boundary; operation generation is the machine-local boundary. Workflow transitions eagerly make the old session non-current, perform bounded best-effort abort, revalidate filesystem identity, and only then create/publish the next machine.

**Tech Stack:** Electron IPC, Node.js filesystem APIs, React 18, Vitest, Testing Library.

---

### Task 1: Story preview isolation and bounded coordinator transitions

**Files:**
- Modify: `electron/story/stepMachine.js`
- Modify: `electron/ipc/story-api.js`
- Modify: `electron/ipc/workflowSessionCoordinator.js`
- Test: `tests/electron/story/stepMachine.preview.test.js`
- Test: `tests/electron/ipc/workflow-session.test.js`

1. Add a delayed TTS preview test that starts abort during synthesis and asserts zero binary/scenes saves and zero terminal Story state emits after resolution.
2. Add coordinator tests proving a switch waits for a promptly settling abort, but advances after the configured abort deadline when abort hangs.
3. Add an eager-invalidate/open-publication test so removing either epoch guard publishes or accepts a stale candidate.
4. Run `npm run test:run -- tests/electron/story/stepMachine.preview.test.js tests/electron/ipc/workflow-session.test.js` and verify the new assertions fail for the missing gates/deadline.
5. Give preview an `AbortController`, capture its generation, gate every post-await save/emit, and make abort invalidate it.
6. Gate Story IPC sends with `workflowSessions.current('story')` plus `isCurrent(session)` and matching payload token.
7. Add configurable bounded abort waiting in the coordinator and eager epoch invalidation.
8. Re-run the focused command to GREEN.

### Task 2: Separate user abort from session disposal

**Files:**
- Modify: `electron/ipc/story-api.js`
- Modify: `electron/ipc/shopping-api.js`
- Modify: `electron/ipc/workflowSessionCoordinator.js`
- Test: `tests/electron/ipc/workflow-session.test.js`

1. Replace the old abort-disposes-session expectations with separate tests: abort then same-token start/submit succeeds; opposite workflow open then old token is stale.
2. Run the focused workflow-session suite and verify same-token restart fails as `stale-token`.
3. Route both abort IPC handlers through their existing guarded command path to `machine.abort(...)`; remove session-abort API exposure.
4. Re-run the focused suite to GREEN.

### Task 3: Work-folder and project identity revalidation

**Files:**
- Modify: `electron/main/workFolderAuthority.js`
- Modify: `electron/ipc/workflowProjectContext.js`
- Modify: `electron/ipc/workflowSessionCoordinator.js`
- Modify: `electron/ipc/story-api.js`
- Modify: `electron/ipc/shopping-api.js`
- Modify: `electron/main.js`
- Test: `tests/electron/ipc/filesystem.workFolderAuthority.test.js`
- Test: `tests/electron/ipc/workflow-session.test.js`
- Test: `tests/electron/ipc/story-api.test.js`

1. Add tests that replace a confirmed work folder and a validated project with a different inode at the same path; assert authority/open failure and no candidate machine/store creation.
2. Run the focused IPC tests and verify identity replacement is currently accepted.
3. Store `{dev, ino}`, verify via non-symlink `lstat` plus `stat`, return an authority context, snapshot project identity, and revalidate it after previous abort but before `create`.
4. Re-run the focused suites to GREEN.

### Task 4: Fable minors and UX

**Files:**
- Modify: `electron/ipc/filesystem.js`
- Modify: `src/hooks/useProjectData.js`
- Modify: `src/components/settings/StorageTab.jsx`
- Modify: `src/components/SettingsModal.jsx`
- Modify: `src/components/Header.jsx`
- Modify: `src/locales/en.js`
- Modify: `src/locales/ko.js`
- Test: `tests/electron/ipc/filesystem.workFolderAuthority.test.js`
- Test: `tests/hooks/useProjectData.workflowType.test.js`
- Test: `tests/components/settings/StorageTab.test.jsx`
- Test: `tests/components/Header/Header.authAction.test.jsx`

1. Add failing tests for a confirmed authority rejecting a different renderer path, a superseded fresh save not publishing state, successful Shopping creation closing Settings, and the Header using a non-hardcoded translated label.
2. Run the four focused suites and verify each new assertion fails for its intended reason.
3. Add the final supersession check, pass/call `onClose`, and introduce/use `header.shoppingShorts` locale strings.
4. Re-run the focused suites to GREEN.

### Task 5: Verification

1. Run all changed focused suites and inspect output.
2. Run `npm run test:run`; record the exact passed test and file counts.
3. Run `npm run build`; require exit code 0.
4. Run `git diff --check`, inspect `git diff` and `git status --short`, and do not commit.

