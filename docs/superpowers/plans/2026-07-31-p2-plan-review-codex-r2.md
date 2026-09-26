# P2 Adapter Plan Re-review — Codex Round 2

- Reviewed plan: `2026-07-31-chatgpt-target-p2-adapter.md` (revised, 16 tasks)
- Baseline: `2026-07-31-p2-plan-review-codex.md` (6 Critical, 18 Important)
- Scope: verdict the 24 round-1 findings and inspect revision-only regressions; touched production consumers inspected only for reachability/selectability evidence; no source changes
- Status: complete

## Round-1 finding verdicts

### ADDRESSED — R1 Important: Task 3 `will-frame-navigate` used the wrong Electron event shape

- **Evidence:** Task 3 now declares the one-object Electron 36 shape (lines 238, 243), invokes the listener with one `details` object in every test including a main-frame login positive control (lines 268–310), and installs a distinct `guardFrameNavigation(details)` rather than sharing the positional handler (lines 340–361). A literal implementation no longer blocks every real navigation behind a mismatched fake.

### ADDRESSED — R1 Important: Task 6 mention handling deleted the reference name

- **Evidence:** The canonical test now expects `@hero` to become `hero`, not disappear (lines 637–659), includes an unresolved-mention preservation control (lines 669–673), and the implementation text pins existing `stripMentionPrefixes` semantics (line 709).

### ADDRESSED — R1 Critical: R2-C assumed an unmeasured input-isolation mechanism

- **Evidence:** R2 now records the isolation operation/evidence in `R2Result` (line 173), measures mouse, keyboard, paste, focus, remount/reload, cancel and route release with allowed APIs (line 184), forbids R2-C unless the whole evidence matrix is effective (lines 193, 199, 218–219), and routes ineffective/incomplete isolation to R2-E.

### ADDRESSED — R1 Important: Task 1 could not produce the required byte-limit contract

- **Evidence:** R1 now creates a deterministic size ladder and bounded search, repeats both sides of the bracket at least three times, separates `largestVerifiedBytes` from `firstRejectedBytes`, and forces non-reproducible/no-boundary outcomes to R1-E with a conservative supported cap (lines 101, 108, 118, 127, 139, 157–158).

### ADDRESSED — R1 Important: Task 4 invalid-target fixture could pass by resetting defaults

- **Evidence:** The revised test first sets both target entries to a non-default `true` state, then sends `unknown`, `toString`, and `__proto__`, and checks the complete map remains unchanged (lines 418–425). The implementation also requires own-property validation (lines 464–477).

### ADDRESSED — R1 Important: Tasks 1/5 omitted the real `VITE_DEV_SERVER_URL` fallback

- **Evidence:** Task 1 uses and tests `Boolean(VITE_DEV_SERVER_URL) || !app.isPackaged`, including the packaged-misreport positive control (lines 114, 139–146). Task 5 repeats the real gate in its interface, truth table, controller wiring, and pass criteria (lines 501, 529–549, 599, 603–606).

### ADDRESSED — R1 Important: Task 4 did not independently pin image/T2V/I2V badges and prices

- **Evidence:** The revised test has distinct test IDs and label/price assertions for image, T2V, and I2V plus an existing Flow-route regression control (lines 428–444); the implementation resolves all three stages separately (line 477).

### ADDRESSED — R1 Important: Tasks 7–8 dropped the proven asset-source guard

- **Evidence:** Task 7 consumes and ports the proven estuary `CDN_RE`/fail-closed `idOf` (lines 728–734, 832–834). Task 8 uses the measured `chatgpt.com/backend-api/estuary/content` positive URL and rejects lookalike origins, wrong paths, and ID-less URLs before fetch (lines 873–915), with the same exact-origin/path rule required in implementation (line 952).

### ADDRESSED — R1 Important: Task 15 verified aspect ratio without requesting it

- **Evidence:** Task 15 now owns a deterministic prompt builder and adapter handoff (lines 1875–1891), tests the exact `3:2` instruction and input immutability in both the pure builder and measured composer port (lines 1919–1937), and retains independent decoded-dimension verification (lines 1939–1978).

### ADDRESSED — R1 Important: Tasks 10–12 ordering assertions did not prove durable barriers

- **Evidence:** The revision removes the unavailable ordering matchers and uses deferred promises. Submission persistence is held unresolved while click is asserted absent (lines 1191–1210); entitlement/artifact intents are held while consume/save are absent and effect completion is held while evidence is absent (lines 1382–1443); project save and read-back are separately held while read/completion are absent (lines 1518–1547). These preserve the promised `submission-attempted` persist → click and intent → consume/save → evidence guarantees.

### ADDRESSED — R1 Important: `authFailed` was not retained through the batch stop path

- **Evidence:** Task 8 now requires `authFailed:true` in the normalized public error (lines 900–905, 950–952). Task 14 supplies a three-scene test where the first failed check/collect retains the sentinel, only one submission occurs, and remaining scenes never enter submission (lines 1827–1838), backed by explicit implementation text (line 1857).

### ADDRESSED — R1 Important: Task 13 tested the wrong `generateImage` signature

- **Evidence:** The direct composite case and a dedicated three-form table preserve `(prompt, referenceImages, options)` for normal, reference, and style-thumbnail calls and inspect the normalized canonical request (lines 1643–1676). The implementation explicitly retains the positional public API (line 1752).

### ADDRESSED — R1 Critical: persistent spool descriptors had no owning implementation

- **Evidence:** Task 9 now creates main-owned `spool.js` with atomic write/read/remove/prune APIs (lines 963–979), deferred write-before-ledger tests, descriptor ownership/hash/size/path checks, restart reads for reference/result, and reference-aware retention (lines 1097–1140). The implementation fixes its userData location, opaque IDs, fsync/rename ordering, bounded validation, symlink/path fail-close, restart, quarantine, and cleanup rules (lines 1152–1154).

### NOT ADDRESSED — R1 Important: the main↔renderer finalization protocol was unspecified

- **Evidence:** Task 10 now specifies correlation, sender validation, disconnect handling, and replay, but its only main→renderer payload is generic `payloadDescriptor` (line 1345). The result spool is explicitly main-only (line 1154), while the renderer effect requires a Flow-like base64/data payload for `processAsyncSceneResult` (lines 952, 1857). No per-step payload union or IPC exists for a freshly reloaded renderer to obtain verified bytes from `resultSpool`. The happy path may rely on an earlier in-memory `collectGeneration` result, but the promised renderer-ready replay after restart is not implementable literally.

### ADDRESSED — R1 Important: MIME/size/timeout mutation gates lacked tests

- **Evidence:** Task 6 adds unsupported MIME, just-over-size, and exact byte/count/MIME boundary controls tied to its approved capability fixture (lines 675–685). Task 8 adds an actually fired deferred timeout, cumulative streaming overflow despite misleading `Content-Length`, and exact `maxBytes` success (lines 917–941).

### ADDRESSED — R1 Important: Task 7's wrong-turn negative could fail only for insufficient samples

- **Evidence:** The negative now provides two identical stable wrong-turn samples and two stable global samples while asking for turn A (lines 785–796), and a second positive supplies simultaneous stable A/B candidates and requires only A (lines 798–807).

### ADDRESSED — R1 Important: Task 9 omitted authoritative `finalizing` cancel/deadline rows

- **Evidence:** The state-machine tests now cover cancel/deadline before any effect, both after evidence has begun, and delayed cancelled/failed terminal application only after complete reconciliation evidence (lines 1037–1059). The implementation restates the pre/post-effect rule (line 1150).

### ADDRESSED — R1 Important (adjudicated): Task 13 treated the composite `listModels` member itself as P3 scope

- **Evidence:** Under the orchestrator's scope ruling, the revised plan explicitly distinguishes the §3.2 backend `listModels` member from P3's user-facing catalog/selection/healing surface (line 1605). The backend-member scope objection is therefore addressed. Whether the newly claimed internal compatibility actually stays out of the existing UI is a distinct revision defect recorded below.

### ADDRESSED — R1 Critical: Task 16 cancelled the wrong automation owner

- **Evidence:** Task 16 now requires a correlated renderer-owned Flow quiesce receipt before the main-side coordinator leg (lines 2004–2010). The hook test starts actual renderer-owned Flow work and holds the receipt until stop plus idle (lines 2081–2092), and the implementation covers current Flow scene/reference/video work before detach (line 2133).

### ADDRESSED — R1 Critical: Tasks 5/14 preceded the switching safety barrier

- **Evidence:** The global dependency and final hard order are now `3 → 1 → 2 → 16 → 5 ... → 14` (lines 12–13, 2148–2156). Task 5 forbids target-only route/attach/load before Task 16 Step 4 (line 506), and Task 14 separately forbids enabling or testing its ChatGPT branch before that barrier (line 1778).

### ADDRESSED — R1 Important: Task 16 revision mutation covered only dequeue

- **Evidence:** Task 10 now table-drives independent revision changes immediately before reference attach, submission persistence, submit click, download, and finalization, and asserts the next effect is absent plus the authoritative state (lines 1285–1301). Implementation text additionally requires checks at dequeue and result-spool link (line 1341).

### ADDRESSED — R1 Critical: ChatGPT `authReady` had no production producer

- **Evidence:** Task 5 now assigns the R1-measured login/session surface to target-owned `ensureSession` (lines 500–504, 589–596), calls it on `did-finish-load`, reconnect, and coordinator admission, and defines the initial query plus monotonic status event relay into App (lines 599–601). Task 4 consumes that target-scoped shape and gates admission fail-closed (lines 385–391, 446–454).

### ADDRESSED — R1 Critical: route failure left renderer/main split-brain

- **Evidence:** Task 16 now keeps the prior route until main adoption, commits only the latest successful revision, and preserves prior state/storage/engine on failure (lines 2131–2133). Tests cover quiesce and attach/bounds rollback in main (lines 2049–2078), all renderer/main/storage/view/engine surfaces on failure, and stale concurrent success responses (lines 2094–2121).

### NOT ADDRESSED — R1 Important: Task 13 did not pin the complete member-by-member routing table

- **Evidence:** The 12 direct methods now verify owner, args, return, and non-owner silence (lines 1643–1665), but the seven-method special test only checks returned values for `listModels`/`getAccessToken` and does not assert which member(s) were called (lines 1678–1693). In particular, `facade.listModels()` may return a hardcoded `compositeModelFixture()` without invoking the required API video backend list and still pass, contradicting the backend dispatch required at lines 1603 and 1746 and the mutation claim at line 2230.

## New defects introduced or exposed by the revision

### NEW Critical — The reordered Task 16 safety barrier never integrates its real production owners

- **Evidence:** Task 16's controller test injects a fake `rendererAutomation.requestQuiesce` and fake `sessionJobs` (lines 2025–2047), while the renderer test separately drives a `routeBridge` harness (lines 2081–2092). Task 16 now lands before the real coordinator exists; Task 10 later creates it, but no test constructs `createModeController` with the real main coordinator or sends a controller request through preload to the actual `useAutomation` owner. Because production `sessionJobs` is described as optional (line 2133), omitting the later main wiring lets a ChatGPT route switch skip adapter cancel/idle and detach during work while every listed barrier/coordinator test passes. Omitting the preload renderer seam instead makes the safety gate permanently unreachable while the split unit tests remain green. Add one integration test after Task 10 that starts the real owner, invokes controller `setRoute` through the actual IPC/preload bridge, and proves both Flow receipt and real coordinator idle precede detach.

### NEW Important — `ensureSession`'s new “integration” test begins after the producer boundary

- **Evidence:** Task 5's unit test directly calls `target.ensureSession()` with an injected measured result (lines 552–568), while Task 4's integration test manually feeds `{status:'ready'}` through `relay.emitFromView` (lines 446–454). Neither causes `did-finish-load`, reconnect, or coordinator admission to invoke the real target probe and emit/update status. Deleting those production trigger calls still passes both tests despite the mutation claim at line 2208 and leaves App admission dead. The integration must begin with an Electron-shaped view load/admission event and observe the probe result through production main/preload/App wiring.

### NEW Important — Task 14's “waits for verified completion” test cannot distinguish fire-and-forget

- **Evidence:** The test uses `finalize = vi.fn().mockResolvedValue(...)` and only checks the call plus final status (lines 1818–1825). An implementation that starts `finalize()` without awaiting its receipt and marks the item completed immediately passes. Use a deferred finalization receipt, assert the item remains non-completed while unresolved, then resolve and require completion; otherwise Task 14's pass criterion at lines 1863–1864 is not pinned.

### NEW Important — The claimed internal model compatibility feeds an existing user-facing selector

- **Evidence:** The plan changes `useAvailableModels` to return `chatgpt-web-image` plus API video entries (lines 1595–1605, 1746), yet the real hook is explicitly the source for model selection options (`src/hooks/useAvailableModels.js:1-7`) and App passes it through `SettingsModal` to `SceneTab` (`src/App.jsx:396,2994`; `src/components/SettingsModal.jsx:115-124`), whose `ModelSelector` renders every entry as `<option>` (`src/components/settings/SceneTab.jsx:287-320`; `src/components/settings/ModelSelector.jsx:18-40`). Unless the plan adds a non-UI facade/filter, the P2 backend list becomes the P3 user-facing model catalog in the dev route. The final `rg "chatgpt"` component gate (lines 2284–2285) can pass because the option is data-driven. This does not add a target selector, but it does pull the model catalog/selection surface from P3 and contradicts line 1605.

## Focused audit conclusions

- **Hard order:** The written order itself is consistent and closes the original Task 5/14-before-16 hole. The new Critical above is the later Task 10 real-owner integration hole created by completing Task 16 against fakes before that owner exists.
- **Ordering guarantees:** The deferred event-log replacements preserve all three reviewed barriers: durable `submission-attempted` before click, durable entitlement/artifact intent before renderer effect and evidence after receipt, and durable project save before read-back/verified completion.
- **Owner/contracts:** The main spool contract is concrete and implementable. `ensureSession` ownership is textually assigned but its production triggers are not tested. Finalization correlation is concrete, but the result-spool-to-reloaded-renderer payload path remains unspecified, so the round-1 finalization finding is not addressed.
- **Labels:** No revised `[무조건]` sub-scope depends on an unmeasured ChatGPT DOM fact; conditional DOM/login/reference/anchor/composer/isolation pieces are relabelled. No new Critical contingency mislabel found.
- **Gate reachability statements:** Every task that adds a gate now has a one-line `실앱 도달성` statement, and the aggregate audit covers each gate (lines 2174–2198). The statements for route quiesce and target auth are not backed by production-seam tests, as captured in the new Critical/Important findings.
- **P3 boundary:** No opt-in notice, kill switch, Grok provisional release, or target-selection control was added, so ChatGPT target selection remains dev/test injection only. However, the `useAvailableModels` wiring exposes the backend model list to the existing model selector, so the revision cannot claim that it pulled nothing from P3 or that no ChatGPT model is UI-selectable.

## Counts and disposition

- **Round-1 verdicts:** 22 ADDRESSED / 2 NOT ADDRESSED (all 6 prior Critical addressed; 16 of 18 prior Important addressed)
- **New findings:** 1 Critical / 3 Important
- **Disposition:** revise the two remaining round-1 issues and four new defects before implementation.
