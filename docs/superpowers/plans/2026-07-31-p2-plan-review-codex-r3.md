# P2 Adapter Plan Scoped Re-review — Codex Round 3

- Reviewed plan: `2026-07-31-chatgpt-target-p2-adapter.md`
- Baseline: `2026-07-31-p2-plan-review-codex-r2.md`
- Scope: adjudicated items A–G (numbered 1–8), revision-only breakage, `[무조건]` labels, and the P2/P3 UI boundary
- Review mode: plan/read-only review; no source changes
- Status: complete

## Scoped verdicts

1. **ADDRESSED** — Task 13 explicitly traces `useAvailableModels` through `SettingsModal`/`SceneTab` to all three existing `ModelSelector`s (plan lines 1712–1714, 2379). Its regression uses implementation-independent, test-local pre-P2 serialized literals captured before production edits and forbidden from regeneration, then independently compares both `imageModels` and `videoModels` for `flow+flow` and `api` (lines 1866–1882). This bites: changing either production list changes a runtime `JSON.stringify(...)` side while the literal side stays fixed; it is not self-comparison. The target-selectability gate remains at lines 2427 and 2472–2473.
2. **ADDRESSED** — Task 16 limits `Header.sessionTarget.test.jsx` to `setMode`→`setRoute` call/response expectations and preserves auth-reset expectations until Task 4 (lines 2163, 2319, 2324). Task 4 alone owns the target-scoped auth-reset replacement (line 382), and the existing-test-change summary preserves that split (line 2439).
3. **ADDRESSED** — Task 10 adds a shipped-path integration using production controller/coordinator/preload/route IPC assembly, asserts the controller holds the exact real coordinator instance, drives both renderer Flow work and a real coordinator job, and permits doubles only at the long-running leaf effects (lines 1403–1434, 1448). It proves both real owners idle before Flow detach.
4. **ADDRESSED** — Task 16's controller test now holds renderer quiesce and `sessionJobs.awaitIdle` on separate deferred gates, asserts zero detach while each is unresolved, and verifies the final total order after both resolve (lines 2187–2233). A mutant that calls but does not await `awaitIdle` detaches while `idleGate` is unresolved and fails line 2220.
5. **ADDRESSED** — Task 10 defines a closed per-step IPC payload union, re-reads and verifies main-only result-spool bytes for the initial artifact request and every replay, and has a reloaded renderer receive verified `Uint8Array` bytes without prior collect memory (lines 1351–1376, 1450). Replay gaps are keyed by `(jobId, jobRevision, step)` with new request IDs; no verified receipt within 24 hours closes as failed without completion/evidence and atomically releases/prunes the live spool (lines 1379–1400, 1452). Task 9 pins the matching retention/state transition.
6. **ADDRESSED** — Task 13 table-drives `listModels` and stage-aware `getAccessToken` across all four canonical routes with unique member returns, exact expected owner calls, and zero calls to non-owners (lines 1799–1827). A hardcoded result or skipped/swapped member invocation fails even if the returned shape looks plausible.
7. **ADDRESSED** — Task 4's integration starts at the Electron-shaped ChatGPT view `did-finish-load` producer and at the preload reconnect entrypoint, then observes the real target probe call and main/preload/App admission state; it does not hand-fire a status event (lines 447–466). Task 5 assigns `did-finish-load`, reconnect, and coordinator admission as production `ensureSession` triggers (lines 613–618).
8. **ADDRESSED** — Task 14 uses an unresolved deferred finalization promise, asserts item completion and completion effects remain at zero while it is pending, then resolves the verified receipt and requires exactly one completion (lines 1970–1986). Fire-and-forget completion fails before the gate is resolved.

## Revision-only checks

### NEW Important — the valid finalization receipt fixture omits its required `step`

- **Evidence:** The protocol's renderer→main receipt requires `{requestId, jobId, jobRevision, step, ...}` and main must validate the exact step (plan lines 1450, 1452). The valid receipt in the correlation test sends only `requestId`, `jobId`, `jobRevision`, and `ok` (line 1347), while the attacker fixture includes the full request (line 1345). A literal exact-step implementation rejects the valid fixture and leaves `pending` unresolved; making the test pass by accepting a missing step weakens the newly required correlation invariant. Include `step: 'consume'` (or spread the exact correlation fields) in the valid receipt fixture.

- **New Critical:** none.
- **`[무조건]` labels:** no lie introduced. The finalization protocol and its synthetic byte/receipt tests are provider-independent; the real-owner integration is ordered after Task 10 and uses only deferred leaf effects; producer wiring is unconditional while the R1-derived probe predicate/fixture remains explicitly conditional.
- **P2/P3 boundary:** preserved. P2 adds no opt-in, target combo/auth chip, mixed-video renderer start, Grok promotion, kill switch, or entitlement policy copy. The adjudicated composite catalog reaches existing model selectors only on the dev-flag/test-injected `flow+chatgpt` route; production UI still has no ChatGPT target-selection control, and the static/manual selectability gate remains.

## Tally and disposition

- Items 1–8: **8 ADDRESSED / 0 NOT ADDRESSED**
- Revision-only findings: **0 Critical / 1 Important**
- Disposition: fix the missing `step` in the valid finalization receipt fixture; no other revision is requested.
