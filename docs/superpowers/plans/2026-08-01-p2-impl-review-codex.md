# P2 implementation review — Codex — 2026-08-01

Scope: supplied `review-c3972357..10e8eb92.diff` only, checked against the P2 plan, design spec, P1 handoff, and current source solely to resolve real-app providers/call sites and stable line numbers. Review only; no source changes.

## Confirmed findings

### Important — native relayouts can put the session view back over the target strip

- **Location:** `electron/ipc/layout.js:23`; callers including `electron/ipc/shared.js:124,327`, `electron/ipc/dom.js:560`, `electron/ipc/flow-api.js:743`, `electron/ipc/video.js:378,497,691,793`, and `electron/ipc/character.js:482,638,878`.
- **Verified by reading:** `updateBounds` insets the native `WebContentsView` below the 44 px DOM strip only when `sessionTargetStripEnabled` is explicitly true. The main controller/resize/layout path supplies the wrapped updater, but the eleven direct Flow automation restore calls above use the default `false`. `WebContentsView` paints and receives input above renderer DOM.
- **Concrete scenario:** with the dev combo enabled, narrow the Flow pane until `trustedClickLocked` temporarily enlarges it (`shared.js:239-242`), then run any operation needing that trusted click. Its `finally` restores through the bare call at `shared.js:327`, resetting the view to `y:0`. The Flow view then covers the whole strip: the combo is both invisible and unclickable until a wrapped relayout (for example resize/layout change) happens. The same wrong restore follows a trusted-click timeout, and the other listed calls can trigger after a hidden-view prompt/character/video operation.
- **Minimal fix:** make strip awareness part of the single production bounds owner (for example inject the already wrapped `updateSessionViewBounds` into every IPC helper) rather than an optional call-site argument; add a real-call-site regression test that exercises an automation restore with the flag enabled.

### Important — a persisted ChatGPT route bypasses the dev flag and strands login mode on a blank view

- **Location:** `electron/ipc/mode.js:188-189,221-257` (especially the load-only gate at `86-90`); `src/hooks/useAppMode.js:14-20`; `src/App.jsx:280-295,2172-2181`.
- **Verified by reading:** the dev gate controls only `loadURL`, not route acceptance, view creation, attachment, or persistence. `useAppMode` preserves `sessionTarget:'chatgpt'`; App automatically submits that stored route at mount; `performRouteTransition` accepts and attaches the ChatGPT view even when `AUTOFLOWCUT_CHATGPT_P2` is absent, then merely skips its initial URL load. The combo is independently absent because its flag is closed.
- **Concrete scenario:** enable the flag once, select ChatGPT (which persists the route), quit, then relaunch without the flag. App adopts `flow+chatgpt`, attaches an unloaded/blank native view, and hides the only target selector. Flow IPC remains correctly gated off, while mode toggling to API and back preserves `chatgpt`, so ordinary login-mode operation does not return to Google Flow. This contradicts the requirement that nothing, including layout/behavior, differ when the flag is absent.
- **Minimal fix:** make ChatGPT route adoption itself contingent on the exact dev gate and normalize a stored disabled target to `flow` before attaching/rendering (while continuing to reject explicit disabled target switches without side effects); cover flag-on persistence followed by flag-off restart.

### Critical — the real R1 registration exposes no way to run or record the measurement matrix

- **Location:** `electron/main.js:1657-1665`; `electron/spikes/chatgptR1Upload.js:184-259,295-309`.
- **Verified by reading:** the only production-reachable control is `CommandOrControl+Shift+R`, wired solely to `harness.open()`. The returned `captureEvidence` and `resetConversation` functions are discarded by `main.js`; there is no IPC, menu, shortcut, global, or internal case runner that can call them. More fundamentally, the harness has no file-input/clipboard/drop attempt, fixture-byte input, size-ladder runner, or `sendInputEvent` call at all—those mechanisms exist only as case names/checklist text and test fakes. The shortcut also adds a second, full-window native view (`addChildView` + full content bounds) without detaching the routed session view or providing a close path, contrary to the max-one/split-layout invariant.
- **Concrete scenario:** an operator starts the exact spike command and presses the advertised shortcut. After login, the code can only print the checklist and display a full-window ChatGPT view; no real-app action can invoke any `ATTACH-*`, MIME/count/size case, reset a repetition, or write its evidence triple. The full-window native view covers the renderer UI until process restart. Thus human login does not unblock R1—the green tests call returned methods that the real registration makes unreachable, and the required R1 result cannot be produced.
- **Minimal fix:** give the dev-only spike a real operator control surface/command loop retained by `main` that drives each case and calls capture/reset, including observed-surface injection points for the three candidate mechanisms and deterministic fixture/ladder inputs; attach it through the single routed/split view owner with an explicit close/restore path. Keep selectors/mechanisms unfilled until observed.

### Important — one transient initial ChatGPT load failure permanently poisons the preserved view

- **Location:** `electron/ipc/mode.js:86-102`.
- **Verified by reading:** `startInitialSessionLoad` adds the view to `startedSessionViews` before calling `loadURL`, and neither the synchronous nor asynchronous failure path removes it. Views are intentionally preserved across target switches, and the exposed reconnect port only probes session state—it does not reload.
- **Concrete scenario:** with the dev flag enabled, the first switch to ChatGPT occurs during a transient network/DNS/load failure. The route still succeeds and the blank view remains attached. Switching Flow → ChatGPT again reuses the same view, but the WeakSet suppresses every later `loadURL`; there is no live UI reload path, so ChatGPT remains blank until the app restarts.
- **Minimal fix:** mark a view started only after a successful load, or delete it from the WeakSet on both failure paths, and make the existing reconnect action able to retry an unstarted/failed view; test reject-then-round-trip-then-success.

### Important — every target switch resets the user's split layout to 50/50 left

- **Location:** `src/App.jsx:2172-2181`; `src/utils/appLayout.js:21-25`.
- **Verified by reading:** the mount/adoption effect depends on the full `{mode, sessionTarget}` route. After the combo transaction commits a target change, it runs again and unconditionally calls `setLayout(flowLayoutForMode('flow'))`, which is hard-coded to `{mode:'split-left', ratio:0.5}`. `useSplitLayout`'s parent effect does not re-run because `isFlow` did not change; instead the main `layout-changed` echo overwrites Shell state and persisted `layoutSettings` with the default.
- **Concrete scenario:** a user has Flow on the right (or top/bottom) at a custom ratio, then selects ChatGPT or switches back to Flow. The target transition succeeds, but the panes jump to left/50:50 and that new layout is persisted, even though target selection should not mutate layout.
- **Minimal fix:** keep split mode/ratio under `Shell/useSplitLayout` as its documented single owner; do not call the default-layout fallback for a target-only route adoption (or pass the current persisted layout), and test all four layouts plus a non-default ratio across Flow ↔ ChatGPT.

### Important — the target-scoped reconnect port has no real renderer owner, leaving ChatGPT auth actions dead/wrong

- **Location:** `src/components/Header.jsx:280-288,353-374`; `electron/preload.js:175-181`.
- **Verified by reading:** preload exposes `reconnectSession`, and main implements it, but no production `src/` call site invokes it. In the ChatGPT unauthenticated state, the visible “ChatGPT login” button reaches `handleUnauthenticated` and explicitly returns `undefined`. In the authenticated state, clicking the green badge enters `checkAuth`, which immediately returns for ChatGPT (`Header.jsx:163`). Tests call `reconnectSession` directly through a fake bridge, so they do not integrate either real UI action.
- **Concrete scenario:** select ChatGPT and reach `login-required`/`session-blocked`; clicking the advertised login action does nothing. After a login/session change that does not produce a usable `did-finish-load` probe, there is no explicit UI re-probe, so target readiness and the image Start gate can remain false. Once a measured probe can return ready, its green badge remains a second dead auth action rather than a target-specific recheck.
- **Minimal fix:** give Header/the target strip a target-specific auth action: attach/focus the ChatGPT view as needed and invoke `reconnectSession('chatgpt')`; never route ChatGPT badge checks through `getAccessToken`. Add a real Header/target integration test, not a preload-only invocation.

### Minor — blocked top-level navigations and redirects are not logged

- **Location:** `electron/sessionViewSecurity.js:36-47`.
- **Verified by reading:** the new frame guard prevents and origin-only logs an off-origin `will-frame-navigate`, but the `will-navigate`/`will-redirect` handler only calls `preventDefault`; it emits no structured blocked-origin record. The supplied mutation covers full-URL leakage only on the frame path. Blocking itself remains correct.
- **Concrete scenario:** ChatGPT or its auth flow attempts an off-allowlist main-frame navigation/redirect. The navigation is denied, but there is no origin-only audit breadcrumb to distinguish policy blocking from a stalled login, contradicting the plan's all-blocked-navigation logging requirement.
- **Minimal fix:** share only an origin-sanitizing log helper (not the event-signature handler) across top/redirect/frame guards, and test that each blocked event logs origin while excluding path/query/fragment.

### Important — stored-route boot failure leaves renderer and main on different routes

- **Location:** `src/hooks/useAppMode.js:14`; `src/App.jsx:280-295,2172-2181`; `electron/ipc/mode.js:184-227`.
- **Verified by reading:** a stored route is adopted into renderer state before App mounts, while main always starts at `api+flow`. App's later boot effect requests the stored route, but `useAppRouteTransaction` deliberately commits nothing on `{ok:false}`. That rule is correct for an interactive transition only when renderer and main already share the old route; there is no initial main-route handshake establishing that premise. The route-failure test fakes both sides as initially `flow+flow`, masking the production mismatch.
- **Concrete scenario:** local storage says `flow+flow`, then the boot transition fails (for example renderer quiesce failure/timeout or session view creation/attach/bounds failure). Main remains `api+flow`, while renderer/storage/engine remain `flow+flow`; App only writes a console warning. The user sees Login Mode with no usable Flow view, and Flow operations are rejected by main's API-mode gate.
- **Minimal fix:** perform initial stored-route adoption before mounting the route-dependent App/engine, or explicitly reconcile renderer to the main-returned route when this boot-only request fails; retain “preserve old route” behavior for later interactive failures. Test with real production initial routes (`main=api+flow`, renderer stored `flow+flow`) and a rejecting owner/view.

### Important — overlapping session probes can let an older result overwrite the newer auth state

- **Location:** `electron/webtargets/chatgpt/index.js:48-67,80-84`.
- **Verified by reading:** every `ensureSession` invocation writes its result when it completes and assigns the next revision; there is no invocation/navigation epoch. Consequently the revision is monotonic completion order, not freshness order, and the renderer correctly accepts the stale completion because it has the larger revision. `did-finish-load` is already a real producer, with explicit reconnect/admission intended as additional producers.
- **Inferred concrete scenario (independent of any unmeasured selector):** probe A starts, the session/navigation state changes, then probe B starts and resolves `login-required` first. If A later resolves `ready`, it writes a higher revision and re-enables the ChatGPT admission gate from an older observation.
- **Minimal fix:** sequence probes and allow only the latest invocation/navigation epoch to publish; an obsolete completion should return/preserve the current snapshot. Add deferred-promise coverage for both ready→blocked and blocked→ready completion inversions.

## Real-app port/owner/listener audit

- **Bounds port:** `main.js` supplies the strip-aware updater to the mode and layout controllers; the eleven legacy direct callers bypass it (finding above).
- **Session-job barrier:** production supplies and awaits the explicitly temporary no-op `routeSessionJobs`; this is consistent with the Task 10 handoff because no session-job coordinator exists yet.
- **Renderer quiesce owner:** preload supplies listener/receipt IPC and mounted App supplies the real stop/idle owner. Mode-null intentionally has no owner and the picker cannot start work; native “show mode selector,” mode toggle, and target combo are busy-gated. No additional ownerless reachable work state was confirmed.
- **Registry/view/security ports:** main supplies `WebContentsView`, reserved preferences, security installer, registry, exact dev gate, and bounds owner. The production probe remains the marked fail-closed injection and adapter creation remains null, as required before R1/R2.
- **Session-status listeners:** target `did-finish-load` → controller relay → preload → `useTargetAuthReady` query/event is wired; missed events on App mount are recovered by the revisioned initial query. Explicit reconnect has no production UI consumer (finding above), and producer concurrency is unsafe (finding above).
- **Dev-flag/portal ports:** main → preload → `DevFlagsProvider` → Shell host/App portal is present in all selected-mode states. With a fresh non-ChatGPT stored route and flag absent, no strip is rendered and bounds retain their old values. Disabled-gate persisted ChatGPT state is not normalized (finding above).
- **R1 ports:** secure factory dependencies are supplied, but the operator control/measurement methods returned by the harness are discarded (Critical finding above).

## Category disposition

- **(a) Real-app reachability:** not clean—R1's test-only control owner, stored-route boot reconciliation, explicit reconnect, and probe ordering findings above. The renderer quiesce and temporary main session-job owners are otherwise correctly supplied in their current reachable UI states.
- **(b) Native layer vs DOM:** not clean—the direct relayout callers make the combo both invisible and unclickable; target switches also reset layout.
- **(c) Existing Flow/API operation:** no direct generation/quota regression confirmed by reading. Invalid/rejected routes preserve an already-synchronized route, busy controls block user transitions, renderer adoption requires `{ok:true}`, and all four reclassified Flow channels are now early-gated. Boot synchronization and layout/auth UI regressions are listed separately above.
- **(d) Security invariants:** clean for `persist:chatgpt`, `contextIsolation:true`, `sandbox:true`, no preload, `webSecurity:true`, exact-origin allowlist of only `chatgpt.com` + `auth.openai.com`, denied window-open, and denied permissions. Blocking is fail-closed. Only complete origin-only logging is not clean (Minor finding).
- **(e) Fabricated measurements:** clean by reading for production behavior: no ChatGPT DOM readiness/login selector or optional OAuth origin was added; `ensureSession` defaults to `session-blocked`; adapter creation is null; the R1 case matrix/checklist does not assert a result. R1 has not run and, due to the Critical reachability defect, cannot yet run as implemented.
- **(f) Dev-only selectability:** fresh flag-off UI/layout is clean, but flag-off restart after a persisted dev ChatGPT selection is not (finding above).

## Counts

- Critical: 1
- Important: 7
- Minor: 1
