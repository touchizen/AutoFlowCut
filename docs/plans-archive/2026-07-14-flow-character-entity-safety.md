# Flow Character Entity Safety Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute each task red/green.

**Goal:** Prevent duplicate Flow character entities across every renderer entry path, reuse live entities during regeneration, and fail closed when prerequisite synchronization is incomplete or ambiguous.

**Architecture:** Add one renderer-side character-operation coordinator with project-scoped stable keys, same-operation joining, global DOM serialization, publication-before-release, and a bounded timeout. Route generated character replacement through the existing reroll IPC, allow create fallback only for the handler's explicit stale signal, and keep sync-gate/stale-response decisions in pure tested helpers.

**Tech Stack:** React hooks, Electron IPC/preload, JavaScript, Vitest.

---

### Task 1: Scoped serialized operation coordinator

**Files:**
- Create: `src/utils/flowCharacterCoordinator.js`
- Create: `tests/utils/flowCharacterCoordinator.test.js`
- Modify: `src/utils/flowCharacterSync.js`
- Modify: `tests/utils/flowCharacterSync.singleFlight.test.js`

1. Write failing tests for project-scoped keys, id-less identities, same-sync joining, cross-ref serialization, publish-before-release, and timeout release.
2. Run `npx vitest run tests/utils/flowCharacterCoordinator.test.js tests/utils/flowCharacterSync.singleFlight.test.js` and confirm the expected failures.
3. Implement the minimal coordinator and make `syncRefToFlow` use it.
4. Re-run the two test files and confirm they pass.

### Task 2: Cover direct upload and generation paths

**Files:**
- Modify: `src/components/ReferenceCard.jsx`
- Modify: `src/components/ReferenceDetailModal.jsx`
- Modify: `src/components/ReferencePanel.jsx`
- Modify: `src/hooks/useImageUpload.js`
- Modify: `src/hooks/useReferenceGeneration.js`
- Modify: corresponding tests under `tests/components/` and `tests/hooks/`

1. Add failing tests proving card/detail upload and single/batch character generation enter the shared coordinator with scope and id-less index identity.
2. Run the targeted tests and confirm failures are due to the missing wiring.
3. Wire the coordinator around each full mutation-through-publication lifetime; MCP inherits the batch generation path.
4. Re-run targeted tests and confirm they pass.

### Task 3: Reuse existing entity on generated replacement

**Files:**
- Modify: `electron/preload.js`
- Modify: `src/engine/engineFlow.js`
- Modify: `src/hooks/useReferenceGeneration.js`
- Modify: `tests/engine/engineFlow.test.jsx`
- Modify: `tests/electron/ipc/flowModeGate.test.js`

1. Add failing tests for reroll routing, explicit-stale-only create fallback, and entity metadata threading.
2. Confirm targeted failures.
3. Expose `flowRerollCharacter`, pass live entity metadata, and select reroll/create with a pure helper.
4. Re-run targeted tests and confirm they pass.

### Task 4: Fail-closed generation gate

**Files:**
- Modify: `src/utils/flowCharacterSync.js`
- Modify: `src/App.jsx`
- Modify: `tests/utils/flowCharacterSync.test.js`

1. Add failing pure tests for complete, partial, and total sync outcomes.
2. Confirm partial success currently chooses the wrong behavior.
3. Block whenever any required ref failed and use truthful error text.
4. Re-run targeted tests.

### Task 5: Bounded fetch and safe stale detection

**Files:**
- Modify: `electron/ipc/shared.js`
- Modify: `electron/flow-character-api.js`
- Create: `tests/electron/ipc/flowPageFetchTimeout.test.js`
- Modify: `tests/electron/isStaleRegistrationResponse.test.js`

1. Add failing tests for a never-settling page fetch and for a bare 404 not triggering entity creation fallback.
2. Confirm failures.
3. Add internal abort plus outer timeout to `flowPageFetch`; require structured `error.status: NOT_FOUND` for stale registration.
4. Re-run targeted tests.

### Task 6: Verification

1. Run all touched targeted test files.
2. Inspect `git diff --check` and review every entity-minting call site against the findings.
3. Run `npm run test:run`, preserve its verbatim summary, and report exact file/test counts.
