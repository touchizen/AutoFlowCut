# Main-Process Error Localization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Localize every discovered Korean user-facing Flow/Electron error through the existing `errorKind` display-time translation contract without changing mention stale-entity semantics.

**Architecture:** Electron returns a stable kebab-case `errorKind` and an English content-free `error` fallback. Renderer adapters and hooks preserve the kind into project/story state, while `resolveDisplayError` translates at display time. A static guardrail prevents new Korean `error:` results and EN/KO catalog parity is enforced by tests.

**Tech Stack:** Electron IPC, React hooks/components, JavaScript, Vitest, existing `useI18n` catalogs and `resolveDisplayError` utility.

---

### Task 1: Add the main-process Korean-error guardrail

**Files:**
- Create: `tests/electron/noKoreanIpcErrors.test.js`
- Modify: `electron/ipc/dom.js`

**Step 1: Write the failing guardrail test**

Scan JavaScript files under `electron/` for a Korean string literal assigned to an `error:` property. Report file and line with a message directing contributors to return an `errorKind` and English content-free fallback. Recognize an adjacent `locale-error-ok: <reason>` marker and reject a bare marker.

**Step 2: Run the test and verify RED**

Run: `npx vitest run tests/electron/noKoreanIpcErrors.test.js`

Expected: FAIL listing every current Korean Electron error result.

**Step 3: Add only the two approved diagnostic escapes**

Add reason-bearing inline escape comments to the two developer-only `flow:dump-settings` results. Do not add a baseline or escapes to user-facing paths.

**Step 4: Leave the test red**

Run the test again and confirm only user-facing failures remain.

### Task 2: Pin the catalog contract and messages

**Files:**
- Modify: `tests/utils/errorDisplay.test.js`
- Modify: `src/locales/en.js`
- Modify: `src/locales/ko.js`

**Step 1: Write failing catalog tests**

Import both real catalogs. Assert sorted `errorSection.kind` keys are identical. Iterate every introduced kind and assert `resolveDisplayError` returns the real English and Korean message rather than the raw key or fallback.

**Step 2: Run and verify RED**

Run: `npx vitest run tests/utils/errorDisplay.test.js`

Expected: FAIL because the new kinds are absent.

**Step 3: Add English-primary and Korean-translated messages**

Add all approved kinds. Keep actionable guidance for Flow All media, Agent toggle visibility, sign-in, composer reopening, retries, and Ref-tab synchronization.

**Step 4: Run and verify GREEN**

Run the same test and expect PASS.

### Task 3: Codify shared, mention, and Agent helper failures

**Files:**
- Modify: `tests/electron/flow-compose-mention.test.js`
- Modify: `tests/electron/flow-agent-collect.test.js`
- Modify: `tests/electron/ipc/mentionFailureRouting.test.js`
- Modify: `tests/electron/ipc/generateSceneAspect.test.js`
- Modify: `tests/electron/ipc/ensureOnProjectComposer.test.js`
- Modify: `electron/flow-compose-mention.js`
- Modify: `electron/flow-agent-collect.js`
- Modify: `electron/ipc/shared.js`
- Modify: `electron/ipc/flow-api.js`
- Modify: `electron/ipc/video.js`

**Step 1: Write failing helper and IPC assertions**

Assert each of the eight mention reasons is returned verbatim as `errorKind`; only `option-not-found` has `staleMention`. Assert text injection, Agent toggle failures, Agent image/video collection timeouts, and project guard failures return the expected kind and an English fallback.

**Step 2: Run targeted tests and verify RED**

Run: `npx vitest run tests/electron/flow-compose-mention.test.js tests/electron/flow-agent-collect.test.js tests/electron/ipc/mentionFailureRouting.test.js tests/electron/ipc/generateSceneAspect.test.js tests/electron/ipc/ensureOnProjectComposer.test.js`

Expected: FAIL on missing kinds and Korean fallbacks.

**Step 3: Implement source kinds and wrapper propagation**

Return `{ errorKind: mentionResult.reason, error: 'Mention selection failed' }` without a name. Copy helper kinds in scene/video wrappers. Add content-free Agent/project fallbacks and kinds. Keep `staleMention` exactly unchanged.

**Step 4: Run and verify GREEN**

Run the same targeted test command and expect PASS.

### Task 4: Codify character and scene IPC failures

**Files:**
- Modify: `tests/electron/ipc/generateCharacterAspect.test.js`
- Modify: `tests/electron/ipc/generateSceneAspect.test.js`
- Modify: `tests/electron/ipc/characterUploadTimeout.test.js`
- Modify or create focused tests under: `tests/electron/ipc/`
- Modify: `electron/ipc/character.js`

**Step 1: Write failing IPC regressions**

Exercise representative composer unavailable, Generate unavailable/click failure, response timeout/invalid response, access-token unavailable, file-input/injection failure, upload timeout/invalid response, and scene HTTP failure paths. Assert stable kinds and English fallbacks without response bodies, names, prompts, paths, or selectors.

**Step 2: Run and verify RED**

Run the focused IPC tests and confirm failures are caused by missing kinds/Korean fallbacks.

**Step 3: Implement minimal IPC changes**

Replace every user-facing Korean fallback in `character.js`, attach the approved kind, and standardize dynamic/raw-body errors to content-free English. Preserve `retry`, `status`, `staleEntity`, `mentionFailure`, and `staleMention` fields.

**Step 4: Run and verify GREEN**

Run the focused IPC tests and expect PASS.

### Task 5: Preserve and display kinds in renderer state

**Files:**
- Modify: `tests/engine/engineFlow.test.jsx`
- Modify: `tests/services/imageFinalize.test.js`
- Modify: relevant hook tests under `tests/hooks/`
- Modify: `tests/utils/flowCharacterSync.repair.test.js`
- Modify: `src/engine/engineFlow.js`
- Modify: `src/services/imageFinalize.js`
- Modify: `src/hooks/useAutomation.js`
- Modify: `src/hooks/useVideoAutomation.js`
- Modify: `src/hooks/useReferenceGeneration.js`
- Modify: `src/utils/flowCharacterSync.js`
- Modify: `src/components/ReferenceDetailModal.jsx`

**Step 1: Write failing propagation tests**

Assert scene adapters preserve IPC `errorKind`, T2V reference rejection returns `flow-t2v-reference-images-unsupported`, image finalization persists non-auth kinds, video/image automation passes kinds into item updates, character sync preserves kind, and the immediate sync toast resolves the kind.

**Step 2: Run and verify RED**

Run the changed engine/service/hook tests and confirm kind loss.

**Step 3: Thread kinds without changing fallback semantics**

Copy `errorKind` through result objects and state patches. Resolve immediate toasts with `resolveDisplayError`. Auth keeps its existing special handling and overrides non-auth kinds only when the existing auth sentinel applies.

**Step 4: Run and verify GREEN**

Run the same targeted tests and expect PASS.

### Task 6: Codify and display the Story empty-script failure

**Files:**
- Modify: `tests/electron/story/stepMachine.scriptRedesign.test.js`
- Modify or create: `tests/components/story/StoryView.test.jsx`
- Modify: `electron/story/stepMachine.js`
- Modify: `src/components/story/StoryView.jsx`

**Step 1: Write failing Story tests**

Assert an empty `scriptOverride` stores `errorKind: 'story-empty-script'` with an English fallback, and StoryView resolves the localized kind rather than rendering the fallback directly.

**Step 2: Run and verify RED**

Run the focused Story tests and expect FAIL.

**Step 3: Add coded Story error propagation/display**

Attach the kind to the thrown error, preserve it in step state, and display through `resolveDisplayError`.

**Step 4: Run and verify GREEN**

Run the focused Story tests and expect PASS.

### Task 7: Close the guardrail and verify all touched behavior

**Files:**
- Modify as needed: all files above

**Step 1: Run the guardrail**

Run: `npx vitest run tests/electron/noKoreanIpcErrors.test.js`

Expected: PASS with only the two reason-bearing developer diagnostic escapes.

**Step 2: Run privacy and locale anchor guardrails**

Run: `npx vitest run tests/electron/noUserContentInLogs.test.js tests/electron/noLocaleBoundDomAnchors.test.js`

Expected: PASS; no user content appears in main-process logs.

**Step 3: Run all targeted tests**

Run all modified test files together and expect PASS.

**Step 4: Run the complete suite**

Run: `npm run test:run`

Expected: PASS with at least the previous 560 files / 5691 tests plus the new tests.

**Step 5: Review the diff**

Run: `git diff --check`, inspect `git diff`, and re-run Korean error inventory to verify only approved diagnostic escapes remain.

**Step 6: Commit in English**

```bash
git add electron src tests docs/plans/2026-07-14-main-process-error-localization.md
git commit -m "fix: localize main-process errors"
```
