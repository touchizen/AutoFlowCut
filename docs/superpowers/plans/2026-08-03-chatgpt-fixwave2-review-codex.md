# ChatGPT fix-wave 2 final review — `c1625718`

Status: complete

## Scope

- Review-only inspection of `.superpowers/sdd/2026-07-31-chatgpt-target-p2-adapter/review-e7ffe0a0..c1625718.diff` against the four requested verdicts and the prior Codex review.
- The supplied full-suite and mutation measurements are accepted without rerun; contradictions will be flagged.
- No Git operations will be run. This review document is the only requested write.

## Verdict checklist

1. **NOT ADDRESSED (Critical) — C1 real scene/reference call shape.** The aspect/provider/model plumbing is now dropped centrally at `src/engine/engineChatgpt.js:55-63`, but the real first-run default still supplies a seed: `src/hooks/useAppSettings.js:13,49-50` creates a finite random `seedNo` with `seedLocked: true`; `src/App.jsx:1775-1792` therefore sends that number to `useAutomation`; `src/hooks/useAutomation.js:332` forwards it; and `src/engine/engineChatgpt.js:52-54` refuses before IPC. The same default numeric seed reaches single-scene generation at `src/hooks/useSceneGeneration.js:98-133` and reference generation at `src/hooks/useReferenceGeneration.js:432-450,1099-1109`. The new “real call shape” test is still narrow: `tests/integration/chatgptRealCallShape.test.jsx:113-134` calls its fixture exact-default while hard-coding `seed: null`, contradicting production defaults. Its explicit-seed negative at lines 171-190 proves the actual default would be rejected. This also contradicts the premise that seed refusal fires only on explicit opt-in.
2. **ADDRESSED (Important) — Estuary content ID in IPC payload.** `electron/webtargets/chatgpt/generationAdapter.js:570-583` uses the signed source only for the authenticated main-process fetch and returns only the saved-image payload; `generated.id` is no longer copied into `images`. `tests/electron/webtargets/chatgptGenerationAdapter.test.js:487-516` and the real-chain assertion at `tests/integration/chatgptRealCallShape.test.jsx:157-168` pin both usable image data and absence of the estuary ID/provider/model/aspect plumbing.
3. **ADDRESSED (Important) — Thumbnail Stop cancellation.** Production `App` supplies the stage-routed engine at `src/App.jsx:470-475,1042-1043`; the ChatGPT image member advertises/carries cancellation through `src/engine/useGenerationEngine.js:33-38` and `src/engine/engineChatgpt.js:117-121`; `src/hooks/useStyleThumbnails.js:287-299` now calls that port on Stop. The hook test at `tests/hooks/useStyleThumbnails.stop.test.jsx:47-83` pins active cancellation and leaves Flow/API behavior unchanged. See item 4 for the remaining lifecycle leak after that cancellation.
4. **NOT ADDRESSED (Minor) — Cancelled-job reaping is still incomplete on the newly fixed thumbnail path.** `electron/webtargets/chatgpt/generationAdapter.js:617-629` retains the job but returns a cancellation refusal without its generation ID; `src/engine/engineChatgpt.js:76-78` therefore returns directly without `collect`; and `src/hooks/useStyleThumbnails.js:167,233,273-284` never calls `clearGenerations`. The new tests prove deletion only when a caller that already knows the hidden ID explicitly calls `collect()` or `clear()` (`tests/electron/webtargets/chatgptGenerationAdapter.test.js:637-693`), so each real thumbnail Stop still leaves one cancelled adapter entry until an unrelated later clear.

## Cross-cutting checks

- Once-per-session square-output notice: **implementation addressed in isolation.** `src/App.jsx:607-616` holds a mount/session-lifetime ref and suppresses every event after the first; `src/locales/en.js:1515` and `src/locales/ko.js:1514` explicitly say output is square regardless of project format. `src/engine/engineChatgpt.js:55` emits only when it drops a non-null project aspect ratio. The real first-run seed refusal happens earlier at line 52, so the default dead path neither submits nor reaches this notice; that remains part of verdict 1.
- Explicit-only seed and `batchCount > 1` refusals: **batch addressed; seed failed.** `src/hooks/useAppSettings.js:25` defaults batch to 1 and renderer/main refuse only non-null values other than 1 at `src/engine/engineChatgpt.js:49-50` and `electron/webtargets/chatgpt/generationAdapter.js:605-607`. Seed is not explicit-only because the first-run default is locked and finite as described in verdict 1.
- Production provider/absence behavior for every touched path: the real renderer supplies the stage-routed ChatGPT image member at `src/App.jsx:470-475` and `src/engine/useGenerationEngine.js:25-58`; preload supplies every generation/cancel port at `electron/preload.js:173-181`; main supplies the cached product adapter and route cancellation owner at `electron/main.js:720-755`. Missing renderer/adapter ports fail closed at `src/engine/engineChatgpt.js:56,66-73,118-121` and `electron/ipc/mode.js:423-426,443-455`. Tests would notice the image/cancel router and preload seam (`tests/engine/stageRoutedEngine.test.js:27-94`, `tests/electron/preloadRouteContract.test.js:6-11`), but the production-default seed shape and reference Stop owner are the uncovered absences identified above.
- Leakage: **addressed except for the cancelled-job retention in verdict 4.** Adapter logs expose only normalized origin and stable error name/detail (`electron/webtargets/chatgpt/generationAdapter.js:245-248,301,386-403,556-598`); the signed URL and estuary ID remain internal to the authenticated fetch and are absent from the saved IPC payload (`electron/webtargets/chatgpt/generationAdapter.js:434-475,570-583`). No cookie/token/signed URL/page text/content ID was found in a log or IPC result in this wave.
- Measured-surface fidelity: **addressed.** This diff adds no selector/upload/CDP/rate-limit/challenge behavior. Renderer omission does not fabricate aspect support; the adapter still rejects a bypassed aspect/seed/batch request at `electron/webtargets/chatgpt/generationAdapter.js:602-613`. Reference upload remains refused by App gating plus engine/IPC/adapter at `src/engine/engineChatgpt.js:44-46,107`, `electron/ipc/mode.js:413-420`, and `electron/webtargets/chatgpt/generationAdapter.js:602-604`.
- Absent dev flag: **addressed/unchanged.** Selection and generation remain gated by exact macOS/dev/`AUTOFLOWCUT_CHATGPT_P2=1` checks at `electron/ipc/mode.js:29-41,198-205,376-386`; main derives the UI gate from the same inputs at `electron/main.js:730-737`.
- Supplied measurements: no test-count or mutation-result contradiction was found. Re-refusing aspect does kill the new test, but that test's `seed: null` fixture does not prove the production default shape; the green suite therefore coexists with verdict 1 rather than disproving it.

## New Critical / Important

### Important — reference-batch Stop still cannot cancel the ChatGPT job newly reachable through C1

The visible Stop at `src/components/ReferencePanel.jsx:313-320` calls `src/hooks/useReferenceGeneration.js:113-117`, which only flips local refs and never uses the production ChatGPT cancellation port. The active submission is awaited at `src/hooks/useReferenceGeneration.js:1097-1109`. This is also on the route-quiesce path: `src/App.jsx:2223-2250` waits for `refBatchRunning` to become idle before main is allowed to call its adapter cancellation owner, so an active ChatGPT reference submission can hold the switch until completion or the 30-second renderer timeout. No reference-Stop test exercises `cancelsActiveOnStop`/`setStopRequested`.

## Fresh read-only verification

- Engine probe with the production-default option shape (`batchCount:1`, finite seed, `aspectRatio:'16:9'`, provider/model) exited 0 after observing `chatgpt-seed-unmeasured` and zero IPC for that call. The same probe confirmed seed-null submission reaches IPC with aspect/provider/model omitted, produces one notice callback, and explicit batch 2 remains refused.
- Adapter cancellation probe exited 0 after observing that a generationId-less cancelled submit is still `state:'cancelled'` in the job map before an explicit `clear()`, then becomes `chatgpt-generation-not-found` only after that clear.
- The supplied 761-file/7,987-test green run and mutation measurements were not rerun, per instruction.

## Outcome

- Requested verdict tally: **ADDRESSED 2 / NOT ADDRESSED 2**.
- New findings: **Critical 1** (production-default seed still kills real scene/reference generation) and **Important 1** (reference-batch Stop/quiesce does not cancel the newly reachable ChatGPT job).
- **Findings-0: No.**
