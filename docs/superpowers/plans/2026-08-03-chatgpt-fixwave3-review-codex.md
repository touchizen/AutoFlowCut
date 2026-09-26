# ChatGPT fix-wave 3 final confirmation review — `1e244d6d`

Status: complete

## Scope

- Review-only inspection of `.superpowers/sdd/2026-07-31-chatgpt-target-p2-adapter/review-c1625718..1e244d6d.diff` against the three prior findings, anti-recurrence work, and requested cross-cutting checks.
- The supplied 762-file/7,992-test run and six mutation results are accepted without rerun; only contradictions will be flagged.
- No Git operations will be run. This review document is the only requested write.

## Verdict checklist

1. **ADDRESSED (Critical) — default seed/aspect submission blocker.** `buildImageStartOptions` now preserves the real default shape (finite locked seed, `'16:9'`, batch 1), while `createChatgptEngine` drops seed/aspect before IPC and refuses only `batchCount !== 1` (`src/services/startOptions.js:10-32`, `src/engine/engineChatgpt.js:45-62`). The integration positive drives real `useAppSettings` defaults through real option derivation, `useAutomation`, engine, and adapter, and asserts page evaluation/save plus absence of seed/aspect/provider/model from the adapter request (`tests/integration/chatgptRealCallShape.test.jsx:122-181`).
2. **ADDRESSED (Important) — reference Stop cancellation.** `stopGenerateAllRefs` now invokes `setStopRequested(true)` only when the selected image engine advertises `cancelsActiveOnStop`; the production stage router carries both properties from the ChatGPT image member, whose port invokes `chatgpt:cancel-generations` (`src/hooks/useReferenceGeneration.js:113-127`, `src/engine/useGenerationEngine.js:25-39`, `src/engine/engineChatgpt.js:116-121`). The hook regression distinguishes ChatGPT from Flow/API and catches rejected IPC without an unhandled rejection (`tests/hooks/useReferenceGeneration.stopCancelsChatgpt.test.jsx:45-114`).
3. **ADDRESSED (Minor) — thumbnail cancelled-job reaping.** A failed/cancelled adapter submit never exposes its generation ID, so `submit()` now deletes that terminal job before returning it (`electron/webtargets/chatgpt/generationAdapter.js:602-635`). The regression proves the active job survives `clear()`, cancellation resolves through submit, and both subsequent observe/collect are not-found; the same terminal path is covered for failure (`tests/electron/webtargets/chatgptGenerationAdapter.test.js:637-696`).

## Anti-recurrence

- **Current guard sweep: no missed live blocker found.** Independent traversal covered App busy/auth/route/project/folder/style/tag/subscription/reference gates; `useAutomation` running/Flow-project/target/subscription/folder/auth/ref-upload/stop exits; engine reference/batch/port/observe/collect exits; preload generation ports; main sender/dev-route/route-owner/reference/adapter gates and registered handlers; adapter reference/batch/aspect/seed/prompt/session/view exits; and the state machine cancellation/deadline/evaluation/baseline/injection/submission-ack/poll/D3/two-sighting/save validations. The settled ChatGPT App path receives `flowProjectReady=true` because `useProjectData` keys that state to canonical `flow+flow`, not merely `mode==='flow'` (`src/hooks/useProjectData.js:515,912-940`); the intentional dev flag, login, folder, subscription, nonempty-prompt, and live-page checks remain runtime prerequisites.
- **NOT ADDRESSED (Important) — the real-default fence is narrower than its stated guarantee.** It genuinely kills a new refusal against any settings-derived field that `useAutomation` forwards to the engine (the seed/aspect failure class), but it is not a real App/preload/main chain: it hand-supplies `projectName: 'real-chain-project'` instead of the real `'Untitled'` default, hard-codes `effectiveStyleId`/`force`, injects `flowProjectReady=true`, nulls subscription/queue concerns, and replaces preload plus every main admission/ownership handler with direct adapter calls (`tests/integration/chatgptRealCallShape.test.jsx:95-103,122-132,153-155`). A new App/preload/main guard—or an App-default guard on one of those hand-shaped values—can still make the real app dead while this test stays green. `App.jsx` currently calls the shared builder, but no test pins that call, so reverting App to an independent derivation also leaves this integration test green.

## Cross-cutting checks

- **Notice: addressed.** The engine emits one combined event when either/both default seed and aspect are dropped; the App-lifetime ref suppresses all later events, including across locale-effect reinstallation (`src/engine/engineChatgpt.js:31-34,53-54`, `src/App.jsx:606-618`). English and Korean say exactly that ChatGPT cannot control aspect or seed, output is square, and seed reproducibility is unavailable; no aspect/seed support is claimed. Engine and App regressions pin a single combined callback/event and a single session notice.
- **Leakage: addressed.** The signed estuary URL and its content ID remain inside the main-process state machine/fetch. Logs reduce page URLs and candidate URLs to origins and errors to stable name/detail; the collected result contains only the saved image fields and `mediaId:null` (`electron/webtargets/chatgpt/generationAdapter.js:245-248,301,386-403,556-598`). The adapter and real-default integration regressions assert that neither the signature nor estuary ID reaches logs/renderer payload. This wave adds only a cancellation-IPC failure warning; it carries no cookie/token/page text/content ID.
- **Reference upload: addressed/fail-closed.** App blocks matching/ref-style requests before dispatch; the renderer engine, main handler, and adapter each independently reject nonempty or malformed reference envelopes, and `uploadReference` is a refusal (`src/App.jsx:620-636,1824-1830`, `src/engine/engineChatgpt.js:45-47,106`, `electron/ipc/mode.js:409-421`, `electron/webtargets/chatgpt/generationAdapter.js:602-604`).
- **Absent dev flag: unchanged/fail-closed.** Target UI exposure, route adoption, and every generation IPC admission still require the exact macOS/dev/`AUTOFLOWCUT_CHATGPT_P2=1` gate; a missing flag keeps the combo absent, downgrades/refuses the route, and returns `chatgpt-target-disabled` before adapter submission (`electron/main.js:730-737`, `electron/ipc/mode.js:29-41,198-205,361-386`).
- **Wave-local behavior:** no new Critical/Important implementation breakage found. One **Minor** remains on the newly cancellable reference path: a Stop that lands while `submitGeneration` is awaited returns cancellation without a generation ID, so the batch's submit-failure branch marks that active card `status:'error'` instead of the later pending-queue cleanup restoring it to retryable `pending` (`src/hooks/useReferenceGeneration.js:1119-1167,1213-1257`). The work is cancelled and the batch outcome is stopped, so this does not reopen prior finding 2.
- **Supplied evidence:** no contradiction found with the reported 762 files / 7,992 tests or six killed mutations. They were not rerun. Fresh focused verification passed 11 files / 94 tests total: the six changed-path suites passed 79/79, and five preload/main/session-target ownership suites passed 15/15.

## Tally

- Prior findings: **ADDRESSED 3 / NOT ADDRESSED 0**.
- Including anti-recurrence judgments: **ADDRESSED 4 / NOT ADDRESSED 1**.

## Outcome

- Prior findings: **ADDRESSED 3 / NOT ADDRESSED 0**.
- Requested findings plus anti-recurrence: **ADDRESSED 4 / NOT ADDRESSED 1**.
- New findings: **Important 1** (fence scope/overclaim), **Minor 1** (cancelled reference card ends in error).
- **Findings-0: No.**
