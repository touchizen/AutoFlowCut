# M2 review round 1 — reviewer B (Opus, test & wiring axis) — 9aeeefdc

1. [MAJOR] src/hooks/useVideoAutomation.js:832-842. The `statusInfo.status === 'failed'` branch was not changed in M2, even though plan M2-5 lists `:762-765`, which is this branch. It writes only `{error, ...meta}` and drops the `errorKind:'flow-video-fetch-failed'` and `mediaId` that main returns (flow-angular.js ~L533) and that engineFlow passes through. Earlier in the run the 'generating' patch set `mediaId:null`, so the item ends up `status:'error'`, `generationId` set, `mediaId:null`.
   - Failure scenario: as29s fails 4 times, so the video is charged and complete on the server. The item is not download-only (useVideoAutomation.js:407 and App.jsx:1395 both need `mediaId`) and not in-flight or recoverable (videoRecovery.js:124 only takes 'generating'/'pending'). Retry or Start re-submits for another 10 credits. The item also shows the raw `error` text or a stale `errorKind`.
   - Verified with a scratch run: the final patch was exactly `{"error":"flow-video-fetch-failed","model":"Omni Flash"}`.
   - The test that claims to cover this (tests/hooks/useVideoAutomation.flowRejected.test.jsx:155) builds `{mediaId:'media-4', errorKind:'flow-video-fetch-failed'}` by hand. That is a state the hook cannot produce.
   - Fix: in the failed branch, spread `errorKind`/`errorParams`, plus `mediaId: statusInfo.mediaId` and `generationId: submission.generationId` when present. Replace the hand-built fixture with a test that drives `{status:'failed', errorKind, mediaId}` through the poll loop, then feeds the resulting patches into the second `start()`.

2. [MINOR] electron/ipc/video.js:126 and tests/electron/ipc/flowVideoT2VAngular.test.js:387-395. Main-side M2-3 resolution plumbing is not covered by any test.
   - Verified: removing `resolution` from the `angular.generateVideoT2V({...})` call still passes all 222 electron test files.
   - The "1080p → flow-resolution-not-offered" test stubs the settings-driver result no matter what targets it receives, so it proves nothing about resolution. flow-angular.js:378 defaults a missing resolution to `'720p'`, so this regression would be silent: a 1080p request becomes a charged 720p video that also passes `modelKeyMatches`.
   - Fix: assert `h.targets().resolution === '1080p'` in that test, or run the real `planSettingsClicks` on the fixture. Make the handler refuse a missing resolution instead of defaulting to 720p.

3. [MINOR] electron/ipc/flow-angular.js:481-483 (checkVideoStatus `sessionGate`). A transient `wiz-missing`/`not-on-flow` becomes a top-level `authFailed`.
   - Failure scenario: during a multi-minute video batch, the Flow view reloads or the user navigates the visible split view. The WIZ probe rejects once. The hook's auth branch (useVideoAutomation.js:708-724) marks every pending, already-charged video `errorKind:'auth'` with `mediaId:null`. None of them are recoverable, and the next Start re-charges them.
   - This contradicts the handler's own rule ("auth 는 401/16 만 최상위"). It also contradicts callFlowRpc, where `wiz-missing` is a non-auth network error mapped to a per-item pollError.
   - Fix: in the status handler, map a failed gate to per-item `{status:'pending', pollError:'flow-session-missing'}`, which uses up the poll budget. Keep `authFailed` for 401/16 only, or only after N consecutive gate failures.

4. [MINOR] electron/ipc/flow-angular.js:402-408. Two problems in the pre-click credit read (both verified with the real harness):
   - (a) nzlxg code 8 returns `{error:'RESOURCE_EXHAUSTED', rpcCode:8}` unchanged. The hook's `_maybeTriggerQuotaStop` then shows the quota modal and halts the batch, although plan D5 says a code 8 on a read RPC is transient.
   - (b) If the payload shape drifts (`payload[0]` is not a number), the handler continues with `creditsBefore=null`. It logs `credits before=null` and clicks, which silently disables the not-sent → lost upgrade. This contradicts §12 #53's "fail-closed".
   - Fix: map the pre-click read failure to neutral `flow-rpc-error` (drop `RESOURCE_EXHAUSTED`). Treat `creditsBefore === null` as a pre-click refusal.

5. [MINOR] electron/ipc/flow-angular.js:453-457. A compose-submit click failure returns `generate-button-click-failed` with no `postClick`, and the gen is deleted. But `trustedClickLocked` returns `success:false` after mouseDown/mouseUp were already sent ("View collapsed mid-click", shared.js:320-328), and on the 30 s timeout when a stale click can still fire.
   - Failure scenario: the user opens a detail modal during the click, and the layout collapses the view. The page still sends YhhmEf (10 credits). The send is unbound because the gen was deleted. The hook does not halt and submits the next item, and the charged video is never tracked.
   - Fix: have the trusted click report `dispatched:true` once mouseDown has been sent. In that case keep the gen armed and go through the waiter/deadline and credit re-read path, returning `postClick:true`.

6. [MINOR] electron/flow-composer-settings.js:222-237 with tests/helpers/fakeFlowAngular.js:94. The new multi-Escape `closePanel` loop is not covered by any test. The fake removes the whole `.cdk-overlay-container` on a single Escape, while the live overlay is a stack (panel, model menu, submenu).
   - Verified: reverting to a single Escape still passes composer-settings, minified, T2V and image tests. The `model-submenu-unknown` test logs only one keydown.
   - Fix: make the fake's Escape remove only the topmost `.cdk-overlay-pane`, and assert 3 keydowns in the submenu case.

7. [MINOR] electron/flow-rpc-protocol.js:258-262. Gaps in the modelKeyMatches truth table. Verified that both mutations below still pass protocol and T2V tests:
   - (a) `hasPortraitSibling` ignoring the tier, so Lite 8s is treated as having a portrait sibling. A Lite 8s 9:16 request answered with `veo_3_1_t2v_lite` would be rejected after the charge.
   - (b) Dropping `low`/`priority` from the queue tokens, so `veo_3_1_t2v_fast_low_priority` would be rejected.
   - Fix: add true rows for `('veo_3_1_t2v_lite', Lite, 8, '9:16')`, `('veo_3_1_t2v_fast_low_priority', Fast, 8, '16:9')` and a Quality 6s 9:16 case.

8. [MINOR] src/hooks/useReferenceGeneration.js:1165. The new batch auth toast also fires in API mode, where `flow-login-expired` already opens the API-key modal (useFlowEvents.js:19-27). That gives a double notification in API mode. Fix: only show the toast when `genAPI?.mode === 'flow'`.

9. [MINOR] src/hooks/useVideoAutomation.js:749. A latent regression. In Flow mode, `_maybeTriggerQuotaStop` no longer sets `stopRequestedRef`, so this `break` now lands in the tail's "Polling timeout" branch (L911-915). Pending items lose the 'stopped' + generationId/recovery message they had before M2, instead of draining. Main cannot currently return a top-level quota from check-status, but this contradicts "pending polled to the end". Fix: in Flow mode, don't break here; let the per-item poll budget handle it.
