# P2 fix-wave scoped re-review — Codex — 2026-08-02

Scope: supplied `review-10e8eb92..b5040959.diff` only. Current source and focused tests are read/run solely to resolve real-app providers, ordering, and call paths. Review only; no source changes.

## Verdict matrix

A finding is `ADDRESSED` only when the real path prevents the defect, not merely when a comment or isolated mock test describes it.

1. **NOT ADDRESSED** — Codex Critical: real R1 registration discarded measurement controls. Main now retains returned controls and shortcuts can select/reset/capture matrix labels, but no control executes any measured attachment mechanism or consumes fixture/ladder bytes; details below.
2. **ADDRESSED** — Codex Important: native relayouts covered the combo. All production `updateBounds` callers now default to the same module-owned strip flag set once by main; no production caller overrides it.
3. **ADDRESSED** — Codex Important: persisted ChatGPT route bypassed the dev flag. Real main always supplies `chatgptDevGate`; an explicit disabled route is rejected before view creation and a boot envelope is normalized to Flow.
4. **ADDRESSED** — Codex Important: transient ChatGPT load failure poisoned the preserved view. Both synchronous throws and async `loadURL` rejection reach the `catch`, delete the WeakSet marker, and route re-entry or reconnect retries the same view.
5. **ADDRESSED** — Codex Important: target switching reset split layout. The App default push is limited to a mode entry and a target-only change emits no App-owned layout push.
6. **ADDRESSED** — Codex Important: ChatGPT reconnect IPC had no real UI consumer. Both the unauthenticated action and authenticated badge call the real App-owned route transaction and preload `reconnectSession('chatgpt')`. A new stale-result race in this consumer is reported separately.
7. **NOT ADDRESSED** — Codex Important: stored-route boot failure split renderer/main routes. Main-returned failures reconcile, but transport rejection/API absence fabricates `result.route` from the renderer's stored route and re-commits it; details below.
8. **ADDRESSED** — Codex Important: overlapping session probes published stale readiness. Invocation sequence is captured before the await and only the latest invocation can publish; both completion inversions are covered.
9. **ADDRESSED** — Fable Critical: saved split layout destroyed on launch/mode toggle. The delayed `.then()` default push is gone. The synchronous child default is followed by Shell's saved-state ownership/push, and the main echo converges on the saved layout. Tests assert state and `localStorage` survival for all four orientations, not merely calls; API→Flow also preserves the saved value.
10. **ADDRESSED** — Fable Minor (escalated): hidden concatenated legacy `setMode` call. The fallback is removed; production `src/` has no Electron `setMode` invocation.
11. **ADDRESSED** — Fable: retry paths bypassed `startTracked`. `retryScene` and `retryErrors` now await `startTracked`, so their underlying queued promises are present in `activeRunsRef` until settlement.
12. **ADDRESSED** — Fable: `.model-provider-price` had no CSS. The class is defined and empty prices no longer create empty spans.
13. **NOT ADDRESSED** — Fable: R1 full-window view had no detach path. The normal success path now has suspend/close/restore, but partial shortcut registration can leave the open shortcut live without the close shortcut; this new Important is detailed below.

## Review notes (incremental)

- The fix diff changes 20 files (594 insertions, 84 deletions). Production areas touched: global layout state, route transaction/controller, main wiring, R1 harness ownership/controls, ChatGPT probe sequencing, App boot/layout ordering, Header reconnect UI, SceneTab price rendering, and automation retry tracking.
- The supplied prior full-suite and mutation measurements are treated as evidence and are not rerun. Focused checks below will target the requested ordering and real-app wiring risks.

## Requested priority checks

### Layout ordering and persistence

- `App.jsx:2166-2188` moves the fallback `setLayout(split-left/0.5)` into the synchronous part of the child effect and gates it with `previousLayoutModeRef`. It no longer runs in the route promise continuation.
- On initial/returning Flow entry, App's child effect can push the fallback, after which Shell's `useSplitLayout` parent effects load/push the saved layout; main's synchronous `layout-changed` echo converges renderer state and persistence on that saved value. On a target-only route change, `route.mode` stays `flow`, `enteringFlow` is false, and `useSplitLayout` dependencies also remain unchanged, so no layout IPC is emitted by either owner.
- The new regression test asserts the rendered mode/ratio and parsed `localStorage.layoutSettings` remain exactly equal to the saved object for left/right/top/bottom and after API→Flow. It also proves no default push on target-only change. Its event assertion is narrower than ideal (`not.toContain(default)` rather than an empty event list), but production-source tracing confirms no alternate saved-layout push on that transition.

### Strip inset call-site audit

- `main.js:733` unconditionally initializes the module flag once from the exact dev gate. `layout.js:24-45` reads that state whenever no explicit option is present.
- The eleven bare automation callers remain in `shared.js` (including the trusted-click restore), `dom.js`, `flow-api.js`, `video.js`, and `character.js`. Window resize and the new R1 product-view restore also call the same imported function. Layout IPC and mode-controller bounds calls use the same function by reference. No production caller passes an override, so none can re-expand over the strip while the flag is on.
- With the flag off, the module state is false and `belowSessionStrip` returns the original bounds unchanged. This agrees with the supplied `layout.js:11,27-29,181` measurement; no contradiction found.

### Real-app owner/port/listener audit

- **Layout flag/bounds:** main supplies the process-wide flag before route/layout IPC registration. Every production bounds producer is present in the same Electron main module graph; no per-call provider is absent.
- **Route quiesce:** mounted App installs the listener before registering ownership and unregisters before removing it. ModeGate is intentionally ownerless before App mounts and has no runnable automation; renderer disappearance without cleanup is the bounded fail-closed timeout case.
- **Boot route authority:** main supplies canonical `{route,revision}` on controller-returned failures. That provider is absent on preload/API absence or rejected IPC, and App currently substitutes renderer state (remaining Important).
- **Reconnect/status:** preload supplies both reconnect and query/event ports; Header is now the UI consumer; main focuses/reloads/probes; `did-finish-load` is an independent real producer. Header lacks a post-await target owner check (new Important).
- **R1 ownership:** main supplies suspend/restore only under the spike gate, and normal close restores the exact same route/view. The control owner is incomplete when global-shortcut registration only partially succeeds (new Important).
- **Retry idle barrier:** App's route owner calls `automation.awaitIdle`; both retry entry points now add their queued promise to the same active-run set.
- **Probe implementation:** production still injects no measured ChatGPT DOM fact. `unmeasuredSessionProbe` remains the marked fail-closed `session-blocked` injection point and `createAdapter` remains null.
- **Dev flag absent:** ChatGPT explicit adoption is rejected, stored boot state normalizes to Flow, combo/strip remain absent, and bounds are byte-for-byte old calculations. No flag-off layout regression was found in this wave.

## Remaining prior findings

### Critical — R1 still cannot execute the measurement matrix

- **Location:** `electron/spikes/chatgptR1Upload.js:12-27,238-257,326-364`; `electron/main.js:1654-1682`.
- Main now retains the harness and five real global shortcuts expose open, label cursor, reset/advance, evidence capture, and close. That fixes the discarded-return portion only.
- The harness still never imports or calls `buildImageSizeLadder`, `padPngToExactSize`, or either local fixture; never accepts image bytes/MIME/name; and contains no page-realm `File`/`DataTransfer`, clipboard, observed-drop attempt, or `sendInputEvent`. The only attachment-mechanism occurrence is checklist prose. `captureCurrentEvidence` records one synthetic `OPERATOR_CAPTURE` event and a screenshot/DOM snapshot, regardless of the selected ATTACH/MIME/COUNT/SIZE case.
- Therefore a logged-in operator can advance labels and take pictures, but cannot use this code to perform the plan's programmatic attach experiments or generate the required mechanism/ready/error event trace. R1 remains unrun and no ChatGPT capability fact may be inferred.

### Important — boot reconciliation still trusts the renderer when main is unreachable

- **Location:** `src/App.jsx:151-174,283-288,2181-2188`.
- For a normal main response such as `{ok:false, route:{mode:'api',sessionTarget:'flow'}, revision:0}`, `reconcileOnFailure` correctly adopts main's route. That closes quiesce/view-transition failures returned by the controller.
- If preload `setRoute` is absent or IPC rejects, however, `invokeMainRoute`/the catch manufacture `{ok:false, route: routeRef.current}`. On the boot-only reconciliation path that stored renderer route is parsed and committed again. Example: storage is `flow+flow`, main starts `api+flow`, and `route:set` rejects; renderer/storage/engine stay `flow+flow` while main remains `api+flow`.
- The new test supplies a canonical main route in a resolved failure and does not cover rejection/unavailability. A failed handshake with no authoritative route must fail closed (for example to the picker) rather than re-adopt the unverified stored route.

## New breakage in `b5040959`

### Important — partial R1 shortcut registration can recreate the undetachable full-window spike

- **Location:** `electron/spikes/chatgptR1Upload.js:357-368`.
- `controls.every(globalShortcut.register)` short-circuits at the first conflict and returns `{registered:false}`, but never unregisters shortcuts already registered by this attempt. If the close accelerator is the conflict, open/capture/reset/next remain live while close is absent. Pressing the still-live open shortcut attaches the full-window view with no registered detach action, reproducing the dead-app symptom the wave is intended to remove.
- Registration needs rollback of every accelerator acquired by this attempt, or close must be guaranteed before any open control becomes reachable. The test covers only five successful registrations.

### Important — a delayed ChatGPT reconnect can mark the wrong current route authenticated

- **Location:** `src/components/Header.jsx:233-245`; `src/App.jsx:270-280,454-457`.
- `reconnectChatgpt` does not re-check mount/route/target after either await. When its ChatGPT probe returns ready after the user has switched to Flow or API mode, it calls the mode-agnostic `onAuthRecovered()`.
- App's callback resolves the destination at completion time via `setAuthReady`: it marks `sessionTargetRef.current` ready in Flow mode or sets `apiAuthReady` in API mode. Thus a ChatGPT result can paint Flow or API as authenticated. The existing Header tests keep the route fixed and miss this inversion.
- Carry the probed target through recovery (for example `onAuthRecovered('chatgpt')`) and discard the result if the initiating route is no longer active; main reconnect/focus should likewise avoid acting on a now-inactive preserved view.

## Deliberate non-fixes

- **DEFENSIBLE — ownerless quiesce timeout.** The real App registers only after installing its listener and unregisters before removing it; explicit unregister rejects matching pending requests immediately. ModeGate is the legitimate ownerless state and cannot own running automation. If a renderer disappears without cleanup, retaining the bounded 30 s fail-closed timeout is preferable to committing a route while ownership is ambiguous.
- **ACCEPTED, with the reachability stated plainly — packaged + `VITE_DEV_SERVER_URL`.** On Darwin, a packaged binary launched by an end user with both `VITE_DEV_SERVER_URL` and exact `AUTOFLOWCUT_CHATGPT_P2=1` can select ChatGPT before the P3 product opt-in. I accept this as the deliberately supported dev-launch contract because predev can misreport `app.isPackaged`, the exact flag is still required, and the plan explicitly pins this positive control. It is not accurate to call the path unreachable to end users; it is accepted as an environment-level developer opt-in, not an ordinary packaged launch.

## Verification evidence

- Focused affected suites: `npx vitest run` over the nine changed-risk suites completed with **9 files / 84 tests passed**.
- Static call-site audit found all production `updateBounds` calls using the shared default and no renderer Electron `setMode` call.
- `git diff --check 10e8eb92..b5040959` completed with no whitespace errors.
- Direct partial-registration probe returned `{registered:false}` while leaving open/capture/reset/next accelerators live when close registration failed, confirming the new R1 finding.
- Supplied evidence accepted without rerun: full suite **756 files / 7919 tests green** and all listed mutations killed. Nothing observed contradicts those measurements; the remaining defects are uncovered states/absent real mechanisms rather than a claim that those tests failed.

## Tally

- Listed findings: **10 ADDRESSED / 3 NOT ADDRESSED**.
- New breakage: **0 Critical / 2 Important**.
- Deliberate non-fixes: **2 accepted as defensible**, with packaged+Vite end-user reachability explicitly acknowledged.
