# P2 Adapter Plan Review — Codex

- Reviewed plan: `2026-07-31-chatgpt-target-p2-adapter.md` (final on-disk revision reviewed: 1,786 lines, SHA-256 `66de4e1d59072c86ee38ce3e8c22ca8769b44877f2764fcabe768ce466369af2`)
- Branch: `feature/chatgpt-target-p1`
- Scope: plan review only; no source changes
- Status: complete

## Confirmed findings

Findings below were appended as they were confirmed.

### Important — Task 3: the `will-frame-navigate` test fakes the wrong Electron 36 API

- **Categories:** hard ordering / testability
- **What is wrong:** Lines 243–267 model `will-frame-navigate` as positional `(event, url, isInPlace, isMainFrame)`, and lines 303–308 reuse the `(event, url)` handler used by `will-navigate`/`will-redirect`. In the installed Electron 36.9.5 typings, `will-frame-navigate` invokes one `Event<WebContentsWillFrameNavigateEventParams>` object whose `url` and `isMainFrame` are properties. The proposed fake therefore cannot validate production wiring.
- **Concrete consequence:** implemented literally, the real listener receives `url === undefined`; `isExactAllowedOrigin(undefined, ...)` fails closed and calls `preventDefault()` even for `https://chatgpt.com` subframes. The hard-order security task can be green while the real ChatGPT document is broken as soon as P2 loads it.
- **Minimal correction:** give `will-frame-navigate` a wrapper such as `(event) => guardNavigation(event, event.url)` and make the test emit a single Electron-shaped event/details object (including `url` and `isMainFrame`). Retain positive allowlisted and negative off-origin controls against that real shape.

### Important — Task 6: canonical mention handling deletes the reference name

- **Categories:** spec fidelity / testability
- **What is wrong:** Lines 550–569 expect `@hero walking` to normalize to `walking`, and line 602 says to remove the exact mention token. Spec §4.6 requires consuming `referenceCatalog` so the app syntax does not reach ChatGPT, but its pinned API behavior is `@hero → hero`; the existing `stripMentionPrefixes` deliberately removes only `@` and preserves the name.
- **Concrete consequence:** implementing the test as written strips the subject identity out of the vendor prompt. The reference bytes may be attached, but ChatGPT receives “walking” instead of “hero walking,” degrading prompt meaning and diverging from the established API path while the new test reports success.
- **Minimal correction:** reuse or exactly match `stripMentionPrefixes` semantics and change the positive expectation to `hero walking --ar 3:2`; add an unresolved-mention control proving unknown `@name` text is preserved.

### Critical — Task 2 / Tasks 7, 10, 16: R2-C assumes an unmeasured input-isolation mechanism

- **Categories:** contingency-label honesty / R2 discrimination / gate reachability
- **What is wrong:** R2 measures whether human turn B breaks association, but its procedure and evidence schema never attempt, identify, or validate a composer isolation mechanism. Nevertheless R2-C (line 184) sends Tasks 7/10/16 directly to a mandatory “overlay/lock,” Task 7 calls it “measured” (line 713), and Task 10 assumes lock acquisition can gate dequeue. A renderer overlay is especially not self-evidently effective over a native `WebContentsView`, and mouse coverage alone does not prevent keyboard input into an already-focused composer.
- **Concrete consequence:** the R2-C implementation can invent a lock that does not actually stop human input, then submit/observe under a correlation rule already proven to break on interleave. The app can accept B’s image as A’s scene result even though the plan reports the R2 contingency as resolved.
- **Minimal correction:** extend R2 with a concrete allowed-API isolation experiment and evidence (mouse, keyboard, focus, remount, cancel/route release), and split the branch into “isolation empirically effective” versus “isolation unavailable/ineffective.” The latter must block submit/observe like R2-D/E; production tasks may port only the measured isolation operation.

### Important — Tasks 7–8: the download path drops the empirically proven asset-source guard

- **Categories:** contingency-label honesty / spec fidelity / security testability
- **What is wrong:** Spec §4.5 requires porting the proven `CDN_RE` and fail-closed `idOf`, and the earlier spike proved `https://chatgpt.com/backend-api/estuary/content?...`. The plan scopes observation by content ID but never requires validating the ephemeral `src` origin/path before `session.fetch`; its positive test instead uses the unmeasured `files.oaiusercontent.com` host (lines 755–760).
- **Concrete consequence:** an implementation following the test either blesses a speculative host or accepts any URL surfaced in the page/fixture and fetches it with the persistent ChatGPT session. That loses the proven fail-closed boundary and can fetch the wrong or attacker-controlled resource while all Task 8 tests pass.
- **Minimal correction:** make the measured source pattern part of the approved surface, validate exact origin/path plus fail-closed content ID before fetch, use the empirically proven estuary URL in the positive control, and add lookalike-origin/wrong-path negative tests. Any alternate host must come from explicit new evidence, not this unconditional task.

### Critical — Task 16: the P1-landmine test cancels the wrong automation owner

- **Categories:** P1 landmine / gate reachability / testability
- **What is wrong:** The stated precondition is `flow+flow` with existing image automation running, but the proposed main test injects `sessionJobs` coordinator `cancelAll/awaitIdle`. That new coordinator owns ChatGPT jobs only; P1 Flow image automation remains renderer-local in `useAutomation`. Task 16 never specifies a renderer Flow-running veto/stop/idle handshake before `setRoute`, and its test never creates the real Flow-running state.
- **Concrete consequence:** `flow+flow → flow+chatgpt` can detach/commit while an actual Flow submission/poll/finalize loop is still running. The fake coordinator reports idle, so the exact production landmine survives a green “landmine” test; already-issued Flow work may continue and later calls/finalization race the ChatGPT route.
- **Minimal correction:** add an explicit renderer-owned automation quiesce/confirmation step before publishing the new route (covering current Flow scene/ref/video work as applicable), then let main quiesce ChatGPT coordinator work. Add an integration test that starts the real Flow renderer automation state, requests the target-only switch, and proves `setRoute`/detach cannot occur until that owner is stopped and idle.

### Critical — Tasks 5 and 14 precede the Task 16 switching safety barrier

- **Categories:** P1 landmine / hard task ordering
- **What is wrong:** Task 5 makes dev `route:set(flow+chatgpt)` create/load/attach the second target, and Task 14 enables a real renderer ChatGPT image path. The cancellation/detach/revision barrier does not land until the final build task, even though the handoff says it is required the moment in-run target switching exists.
- **Concrete consequence:** the implementation has an intermediate—and directly dev-reachable—state where target switching is live without quiescing the correct work or checking revisions. A worker following task order can reproduce the P1 stale Flow view/route window or switch during work before the purported fix exists.
- **Minimal correction:** move the route migration and cross-owner quiesce/detach/revision foundation ahead of Task 5’s first dev route/load (while keeping Task 3 first), or fold it into Task 5 and gate every later dev route/automation test on it. No earlier task may exercise a target-only `route:set` without this barrier.

### Important — Task 16: one early revision mutation does not test the promised irreversible-step checks

- **Categories:** testability
- **What is wrong:** Lines 1625–1632 bump the route revision before `drainOne()`. That can be caught by the first dequeue check alone, while Step 3 promises separate checks before reference attach, `submission-attempted` persistence, click, download, and finalization.
- **Concrete consequence:** removing every late check still leaves the test and the claimed mutation gate green. A target switch in a narrow post-injection or pre-finalization window can perform an irreversible effect against the stale route.
- **Minimal correction:** add controlled barriers/hooks at each irreversible boundary, change the revision after the preceding boundary, and assert the next effect is absent plus the state follows the authoritative table. At minimum cover pre-click and pre-finalization in addition to pre-dequeue.

### Important — Task 13: the plan pulls the P3 model catalog into P2

- **Categories:** scope fidelity
- **What is wrong:** Task 13 changes `useAvailableModels` and replaces the P1 unavailable pin with a new “ChatGPT image + API video” composite catalog (lines 1261–1263, 1361), even though spec §10 assigns the model catalog/product mixed-routing work to P3 and the review scope explicitly excludes it.
- **Concrete consequence:** P2 changes product-facing model availability/healing assumptions before opt-in, selectability, mixed video routing, and Grok policy are ready, expanding regression surface and creating a partially live P3 state.
- **Minimal correction:** keep P2’s exact 19-method facade and member-routing contract, but defer the new catalog contents and `useAvailableModels` behavior change to P3. Use a conservative fixed/unavailable image identity or injected test member sufficient for backend contract tests without publishing the composite catalog to the existing consumer.

### Important — Task 15: it verifies aspect ratio but never asks ChatGPT for it

- **Categories:** spec fidelity / gate reachability
- **What is wrong:** Spec §4.6(b) requires both prompt-level aspect request and measured verification. Task 15’s files/tests/implementation only compare decoded dimensions and persist a warning; no task maps canonical `aspectRatio` into the prompt actually injected by the ChatGPT adapter. Task 6’s example happens to contain user text `--ar 3:2`, which is not a production mapping.
- **Concrete consequence:** every generated image can default to square, be saved as warning-success, and still pass the entire planned aspect suite. The requested ratio never reaches ChatGPT.
- **Minimal correction:** add adapter-side vendor prompt construction from canonical `aspectRatio` (without mutating the renderer request) and a behavioral test that inspects the exact prompt handed to the measured composer port; retain Task 15’s independent dimension/warning tests.

### Critical — Tasks 4–5 / 13–14: ChatGPT `authReady` has no production producer

- **Categories:** contingency-label honesty / gate reachability / P1 dead-gate lesson
- **What is wrong:** Task 4’s hook test calls `setTargetReady('chatgpt', true)` directly, while Task 5 promises a `{target:'chatgpt',ready}` event but explicitly rejects URL guessing and defines no `ensureSession`/auth probe or wiring that emits it. Tasks 7–8 cover generation/observe errors, not initial readiness. The earlier spike already proved an `AUTH_PROBE`/`ensureLoggedIn` path, but the plan never ports or tests it.
- **Concrete consequence:** the real app can load a logged-in `persist:chatgpt` view yet never reach ChatGPT-ready state, so the image admission gate remains false and P2’s manual end-to-end path is dead. Alternatively, an implementer must invent an unmeasured readiness selector inside a task labelled unconditional; all planned tests still pass because they inject readiness directly.
- **Minimal correction:** assign the empirically proven auth probe to the target definition’s `ensureSession`, define the exact target-tagged main→renderer event/initial-query contract, and add an integration test from an Electron-shaped view/probe result through App admission. Unknown/login/challenge states must remain false/fail closed; no new DOM fact may be guessed.

### Important — Task 1: R1 cannot produce the `maxBytes` contract it requires

- **Categories:** R1 discrimination / contingency-label honesty
- **What is wrong:** R1 increments attachment count to the first rejection, but the size procedure only says to try an “observed upper-limit-exceeding” file even though no upper limit has yet been established. The listed fixtures are one PNG and one JPEG, and the result/downstream validator require a numeric `maxBytes` as if a rejection boundary had been measured.
- **Concrete consequence:** `maxBytes` can become the largest arbitrary fixture tried, be mistaken for a real vendor maximum, and then either reject supported user references unnecessarily or permit sizes whose ready/failure behavior was never established.
- **Minimal correction:** define a reproducible size ladder/bounded search with generated fixture sizes and repeated ready/error observations. Record `largestVerifiedBytes` and `firstRejectedBytes` separately; derive the conservative supported cap only when the boundary is reproducible, otherwise route size support through R1-E rather than claiming an exact maximum.

### Important — Task 4: the invalid-target test repeats P1’s default-fixture false positive

- **Categories:** testability
- **What is wrong:** Lines 378–382 send an invalid readiness event while the map is still the default `{flow:false,chatgpt:false}` and assert that same default. A buggy handler that resets the whole map to defaults on every invalid event passes, exactly like the P1 invalid-route fixture that could not distinguish “unchanged” from “reset.”
- **Concrete consequence:** an invalid/stale event can erase a valid Flow or ChatGPT readiness state, causing false logout/admission failures, while the mutation suite stays green.
- **Minimal correction:** first set a non-default state (ideally both targets independently), then send each invalid/prototype-key event and assert the complete map is unchanged.

### Important — Tasks 10–12: call-order assertions do not prove durable write-ahead barriers

- **Categories:** testability / crash safety
- **What is wrong:** The central safety tests use `toHaveBeenCalledBefore/After` or synchronous event order for `persistState → submit`, entitlement intent → consume, and project save → read-back. Those assertions pass when code starts a persistence promise without awaiting it and immediately performs the irreversible effect/read. They test invocation order, not durable completion order.
- **Concrete consequence:** a click, entitlement consume, artifact save, or read-back can race ahead of the ledger/project commit. A crash in that window recreates the duplicate-submit/evidence-gap/stale-project failures that the state machine is meant to eliminate, with all planned tests green.
- **Minimal correction:** use deferred promises at every write-ahead boundary: hold persistence/save unresolved, assert the downstream effect has not been invoked, resolve/commit it, then assert the effect occurs. Cover `submission-attempted`, entitlement/artifact intent, explicit project save before read-back, and evidence before terminal completion.

### Important — Task 8 / Task 14: `authFailed` is not pinned as a retained stop sentinel

- **Categories:** spec fidelity / testability
- **What is wrong:** The result test feeds `{authFailed:true}` but only expects `{errorKind:'auth',errorCode:'auth-failed'}`. No renderer/coordinator integration test asserts the output still has `authFailed:true` or that a queued batch stops immediately. Spec §4.4 says the sentinel—not `errorKind`—drives the existing batch stop.
- **Concrete consequence:** normalization may discard `authFailed`; a session expiry then lets every queued scene exhaust its timeout instead of stopping once, while the planned normalization and “session-blocked” tests pass.
- **Minimal correction:** assert the normalized public error retains `authFailed:true`, then run a multi-job bridge test proving the first auth failure prevents further submit/observe and reaches the existing immediate-stop path without per-job timers.

### Important — Task 13: the new ChatGPT member is tested with the wrong `generateImage` call contract

- **Categories:** spec fidelity / testability
- **What is wrong:** The positive composite test calls `facade.generateImage({prompt:'x'})`, but the existing 19-method facade’s real consumers call `generateImage(prompt, referenceImages, options)` (single-scene, reference generation, and style thumbnails). Those consumers are not migrated in P2, and `assertEngineContract` checks only method presence, not signature/argument forwarding.
- **Concrete consequence:** a ChatGPT member that only accepts the test’s object form can pass every new contract test while all required synchronous generation entry points hand it a string/positional arguments and fail or lose references/options.
- **Minimal correction:** preserve the positional public signature and normalize it internally to `CanonicalGenerationRequest`; test exact forwarding for single scene, `purpose:'reference'`/`ref`, and style-thumbnail forms. If an object overload is retained for coordinator internals, test both explicitly.

### Critical — Tasks 6, 8–12: persistent spool descriptors have no spool implementation

- **Categories:** spec fidelity / crash recovery / gate reachability
- **What is wrong:** The plan repeatedly refers to reference `{spoolId,...}` and `resultSpool` descriptors and forbids raw bytes in the ledger, but no file/module/task owns writing the bytes, fsync/rename, lookup, hash/size validation, restart recovery, retention, or cleanup. Task 6 merely says references “can” be materialized, and Task 8 says a result spool exists; the coordinator/finalizer later assumes both are readable.
- **Concrete consequence:** after renderer IPC returns or the app restarts, main has metadata but no specified durable bytes to attach or finalize. Reference jobs cannot honor the persistent canonical snapshot, and downloaded jobs can remain forever in `finalizing` or silently lose the image despite a green ledger/state suite.
- **Minimal correction:** add an explicit main-owned spool store contract/task with atomic write-before-ledger-reference, content-address/hash/byte verification, bounded read, job ownership/path traversal protection, restart tests for reference injection and result finalization, and cleanup tied to collect/ledger retention. R1-D may skip reference spooling, but result spooling is unconditional.

### Critical — Task 16: renderer/main route split-brain is unhandled on `route:set` failure

- **Categories:** P1 landmine / route atomicity / testability
- **What is wrong:** App’s canonical route is already changed/persisted before its effect invokes main `setRoute`. Task 16 tests main rollback on quiesce failure but never specifies how renderer state/storage adopt the returned result or revert on `{ok:false}`. Its renderer test mocks only success.
- **Concrete consequence:** on quiesce/attach/bounds failure, renderer remains `flow+chatgpt` and selects the ChatGPT composite while main remains `flow+flow` with the Flow view and Flow gate enabled—the exact split-brain shape behind the P1 blocker.
- **Minimal correction:** make renderer route changes transactional with main adoption: retain the previous route, await `setRoute`, commit/persist only the adopted success route (or restore previous state/storage on failure), and handle stale concurrent responses. Add a non-default `flow+flow → flow+chatgpt` failure integration test asserting renderer context, storage, main route, view, and engine all remain Flow.

### Important — Tasks 1 and 5: the real dev gate omits the empirically required `VITE_DEV_SERVER_URL` fallback

- **Categories:** empirical fidelity / gate reachability
- **What is wrong:** The earlier spike proved this app’s predev binary rename can make `app.isPackaged` report the wrong value and fixed the gate to `!!VITE_DEV_SERVER_URL || !app.isPackaged`. P2 tests inject a ready-made `isDev` boolean and Step 3 never defines how main computes it.
- **Concrete consequence:** an implementation using the obvious `!app.isPackaged` wiring passes all truth-table tests yet never registers/loads the P2 view in the actual `npm run dev` path, leaving R1/R2 and the manual gate dead.
- **Minimal correction:** reuse the proven dev-runtime helper/exact formula in both spike and P2 gates and test main wiring with the misreported-packaged + `VITE_DEV_SERVER_URL` case, not only an injected boolean.

### Important — Tasks 10–14: the main↔renderer finalization protocol is unspecified and untested

- **Categories:** gate reachability / testability
- **What is wrong:** Main is supposed to persist intents/evidence and drive reconciliation, while Firebase consume, React `updateScene`, `scenesRef`, and project save live in renderer. The plan uses an injected `renderer bridge` in unit tests but defines no IPC channel/payload/correlation/readiness/retry protocol by which main can await those renderer effects or resume them after relaunch. `webContents.send` itself has no response promise.
- **Concrete consequence:** the real coordinator can reach `finalizing` with no implementable path equivalent to the test double, or the renderer can perform effects outside main’s durable intent barrier. Restart reconciliation can stall or duplicate work while unit tests over direct function calls stay green.
- **Minimal correction:** specify the actual bidirectional protocol (request IDs/job revision, begin-intent response, effect receipt, timeout/disconnect behavior, renderer-ready/replay handshake, sender validation) and add an IPC integration test that uses the preload/main handlers through consume → artifact → project verification, including renderer reload between intent and receipt.

### Important — Tasks 6 and 8: claimed MIME/size/timeout mutation gates have no tests

- **Categories:** testability
- **What is wrong:** Task 6’s shown suite covers count and unsupported references but never exercises `reference-mime` or `reference-size`; Task 8 covers content type but not timeout or streaming max-byte overflow. The orchestrator nevertheless claims mutations to all of those limits will be killed.
- **Concrete consequence:** implementations can ignore approved MIME/byte caps, buffer an oversized response, or omit abort-on-timeout while every listed test passes. R1’s measured support envelope then is not enforced.
- **Minimal correction:** add exact-boundary positive and just-over/unsupported negative cases for count, MIME, and reference bytes, plus deferred/streaming downloader tests for timeout and cumulative byte cap (including a misleading `Content-Length` case). Tie fixtures to the approved R1 contract.

### Important — Task 7: the wrong-turn negative can pass for the two-sample rule instead of turn isolation

- **Categories:** R2 discrimination / testability
- **What is wrong:** Lines 676–683 provide only one `turn-b` sample and expect rejection. An implementation that ignores the anchor/global boundary but still requires two identical samples rejects for insufficient stability, so the test does not prove it refused the wrong turn.
- **Concrete consequence:** the mutation that falls back to B/global newest can survive, then accept B’s image once it appears in two polls—the exact R2 hazard.
- **Minimal correction:** provide two stable identical wrong-turn/global samples while A has no candidate and assert rejection, plus a mixed A/B positive case with both stable candidates that must return only A’s content ID.

### Important — Task 9: the authoritative `finalizing` cancel/deadline rows are not pinned

- **Categories:** spec fidelity / testability
- **What is wrong:** The state tests omit `finalizing` from cancel cases and test only deadline-after-effect. They do not cover cancel-before-first-effect, cancel-after-effect, deadline-before-effect, or application of delayed terminal intent after reconciliation.
- **Concrete consequence:** Stop/deadline can jump directly to a terminal state after an irreversible effect, bypassing entitlement/artifact/project reconciliation, or remain stuck after reconciliation, while the state suite passes.
- **Minimal correction:** add the four pre/post-effect transitions and end-to-end reconciliation assertions that terminal intent is applied only after all required evidence/project verification; use the spec table as the exact parameter matrix.

### Important — Task 13: the composite test does not pin the full member-by-member routing table

- **Categories:** spec fidelity / testability
- **What is wrong:** Presence is checked for 19 names, but behavioral routing is exercised for only `generateImage`, `submitGeneration`, one video call, `fetchMedia`, and `upscaleImage`. Image check/collect/clear, I2V/status/download, `uploadReference`, `getAccessToken`, list behavior, the other upscale, and archive functions are not all pinned to their specified owner/shape.
- **Concrete consequence:** a facade can satisfy `assertEngineContract` while sending a required member to Flow/API incorrectly, reviving Flow side effects or breaking poll/download paths. The claimed “dispatch swap” mutation gate is broader than the tests.
- **Minimal correction:** table-drive all 19 methods (including argument/return forwarding and fan-out/stub cases) plus metadata fields/capabilities for all four canonical routes. Instantiate/assert the real `chatgptEngine`, not only member harness objects.

### Important — Task 4: the badge/price test does not independently cover T2V and I2V

- **Categories:** P1 deferred-item coverage / testability
- **What is wrong:** The P1 handoff calls out three stage sections, but the proposed test asserts one image badge/price and one generic video badge/price. It does not prove both T2V and I2V retained their own API labels/prices; this is the same surface where P1 briefly lost both video badges under a green suite.
- **Concrete consequence:** one video section can remain falsely labelled ChatGPT, or a T2V/I2V badge can be deleted, while the generic video assertion still passes.
- **Minimal correction:** give image, T2V, and I2V distinct observable controls (or assert an exact two-element video collection) and pin label plus price for all three, with the existing Flow route as a positive regression control.

## Category conclusions

- **Fully clean:** the plan keeps CDP forbidden and uses only the allowed automation surfaces; it does not add target selectability, opt-in notice, kill switch, or Grok provisional release in P2.
- **Clean with the cited exception:** the URL-load order is explicitly Task 3 guard → R1/R2/Task 5, and no earlier task loads `chatgpt.com`; Task 3’s real Electron event-shape defect must still be corrected before that order is safe.
- **Clean with the cited exceptions:** R1/R2 otherwise have observable questions, real-app procedures, named DOM/screenshot/trace artifacts, reload/interleave cases, and explicit fail-closed R1-D/R2-D/E branches without CDP. The unresolved parts are R1 size-boundary measurement and R2-C isolation.
- **Structurally covered, not behaviorally clean:** all five P1 handoff deferrals are assigned to tasks. ChatGPT auth production reachability and independent T2V/I2V assertions remain defective as detailed above.
- **Not clean:** contingency-label honesty, the P1 landmine, gate reachability, spec/scope fidelity, and TDD bite all have Critical/Important findings above.

## Counts and disposition

- **Critical:** 6
- **Important:** 18
- **Minor:** 0
- **Disposition:** revise before implementation; the Critical findings prevent the plan from safely reaching its own P2 end-to-end gate.
