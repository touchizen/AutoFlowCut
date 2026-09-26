# Image-first Import Transaction Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Add strict-PNG scene persistence plus staged, abortable, journaled, crash-recoverable image-first project import IPC.

**Architecture:** `electron/ipc/filesystem.js` owns the pure PNG predicate, transaction paths, journal recovery, and all three handlers. Every mutating transaction operation is serialized by the existing project-path lock. `electron/preload.js` provides pass-through wrappers; Vitest exercises handlers against real temporary directories.

**Tech Stack:** Electron main/preload ESM, Node `fs/promises`, Vitest, real temporary filesystem fixtures.

---

### Task 1: Strict PNG guard

**Files:**
- Modify: `electron/ipc/filesystem.js:126-165,441-492`
- Test: `tests/electron/ipc/filesystem.image-first-import.test.js`

1. Write separate failing tests for pure-helper valid PNG, invalid magic, unknown fallback, MIME/extension mismatch, and `fs:save-resource` scenes zero writes.
2. Run `npx vitest run tests/electron/ipc/filesystem.image-first-import.test.js` and confirm missing-helper/unguarded-write failures.
3. Export `isStrictPngPayload`, requiring both `iVBOR` and `{mimeType:'image/png',ext:'png'}`.
4. Call it in the scenes save branch before `mkdir`.
5. Re-run the test file and confirm green.

### Task 2: Stage and abort

**Files:**
- Modify: `electron/ipc/filesystem.js`
- Modify: `electron/preload.js:34-70`
- Test: `tests/electron/ipc/filesystem.image-first-import.test.js`
- Test: `tests/electron/preloadContract.test.js`

1. Write failing stage tests for valid PNG placement and all three rejection classes, including pre-existing staging-tree byte equality.
2. Write failing abort tests for exact-revision deletion, wrong/missing revision no-op, and canonical/project/history/journal preservation.
3. Run targeted tests and confirm handler-not-registered/wrapper-missing failures.
4. Implement stage validation before any path mutation; serialize the accepted write with the project lock.
5. Implement idempotent exact-revision abort with the same lock.
6. Add three pass-through preload wrappers and exact contract assertions.
7. Re-run targeted tests and confirm green.

### Task 3: Commit transaction

**Files:**
- Modify: `electron/ipc/filesystem.js`
- Test: `tests/electron/ipc/filesystem.image-first-import.test.js`

1. Write a failing happy-path test asserting ordinal order, absolute canonical paths, required scene fields, no `prompt` own-key, full payload preservation, and no history files.
2. Write a failing canonical-collision test asserting zero journal/project mutation and byte-for-byte preservation of the old canonical file.
3. Run targeted tests and confirm failures.
4. Add payload/fixed-state validation and deterministic transaction paths.
5. Under the lock, preflight all staged files and canonical collisions, atomically publish the journal, rename images, write the project temp file, atomically rename it, and clean transaction artifacts.
6. Re-run targeted tests and confirm green.

### Task 4: Crash recovery and orphan sweep

**Files:**
- Modify: `electron/ipc/filesystem.js:381-398`
- Test: `tests/electron/ipc/filesystem.image-first-import.test.js`

1. Write four failing real-disk crash tests: before/after image rename and before/after project temp rename.
2. Write a failing journal-less stage-crash reopen test.
3. Write absence tests: no journal, no project, missing staging/canonical during idempotent cleanup, plus fail-closed roll-forward when both source and destination are missing.
4. Run targeted tests and confirm recovery/sweep failures.
5. Put load and recovery under the project lock. Compare only durable `fixedSceneRevision` with the journal revision; roll forward on equality and roll back otherwise.
6. Sweep unclaimed staging revision directories after journal recovery and document the single-renderer/reopen assumption.
7. Re-run targeted tests and confirm green.

### Task 5: Mutation and regression verification

**Files:**
- Modify temporarily and restore: `electron/ipc/filesystem.js`

1. Mutate away magic-prefix checking; run the unknown-fallback test and require failure.
2. Move the strict guard after `mkdir`; run the untouched-tree test and require failure.
3. Skip journal publication; run a pre-project crash recovery test and require failure.
4. Force recovery to always roll forward; run the old-revision rollback test and require failure.
5. Make abort remove the staging root; run wrong-revision isolation and require failure.
6. Disable unclaimed staging sweep; run stage-crash reopen and require failure.
7. Allow canonical overwrite or delete it during rollback; run canonical-preservation and require failure.
8. Restore production code after every mutant and rerun targeted tests.
9. Grep and record every `project.json` producer, canonical scene reader, and prompt-presence consumer.
10. Run `npx vitest run tests/electron/ipc/filesystem.image-first-import.test.js tests/electron/preloadContract.test.js`, then `npm run test:run`.

No commits are created, per the task instruction.

### Task 6: Non-fatal portable journal recovery review fix

**Files:**
- Modify: `electron/ipc/filesystem.js:245-393,556-573,657-720`
- Test: `tests/electron/ipc/filesystem.image-first-import.test.js`

1. Write a failing real-disk test that moves a project containing the legacy absolute-path journal, then asserts load succeeds, the journal is quarantined, staging is swept, and `project.json` bytes do not change.
2. Write separate failing tests for truncated journal JSON and ambiguous staged+canonical state, including a second successful open after quarantine.
3. Run the focused recovery tests and confirm they fail because `load-project-data` returns `success:false`.
4. Change new journal schema to location-independent `{version, fixedSceneRevision, rendererSceneIds, previousRendererSceneIds}` and derive all paths from the current `workFolder`/`project` after validating every segment.
5. Contain every unprovable journal recovery failure: atomically rename the active journal to a unique `.image-first-import-journal.corrupt-<timestamp>.json`, best-effort sweep only transaction staging/temp artifacts, and continue reading durable `project.json`.
6. Add a portable-journal move regression proving a newly written journal contains no absolute path and performs normal precise recovery after relocation without quarantine.
7. Re-run the existing four crash-point tests and assert valid journals are never quarantined and still leave zero canonical/staging orphans.
8. Mutation-check recovery rethrow, recovery-after-project-read, and absolute-path journal persistence; restore each mutant and rerun focused tests.
