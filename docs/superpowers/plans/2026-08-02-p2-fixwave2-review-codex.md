# P2 fix-wave 2 final confirmation — Codex — 2026-08-02

Scope: supplied `review-b5040959..602edcc9.diff`, prior Codex review, and current `602edcc9` source. Review only; no source or git mutation.

## Verdicts

1. **ADDRESSED — boot-failure reconciliation authority.** The two renderer-local failure paths now return no `route` (`src/App.jsx:158-163,284-289`), and failure reconciliation exits unless `result.route` parses (`src/App.jsx:165-175`). Thus only a route returned through main IPC can be committed; unavailable/rejected IPC cannot re-adopt the renderer echo. The regression covers both paths and asserts no route commit (`tests/components/App.routeTransaction.test.jsx:187-210`).

2. **ADDRESSED — delayed ChatGPT reconnect target race.** Header keeps a layout-effect-updated live route/version ref (`src/components/Header.jsx:63-77`), captures a request sequence, and checks mount, sequence, version, mode, and target after route adoption and again after reconnect before recovery (`src/components/Header.jsx:244-267`). Both await-boundary inversions are covered (`tests/components/Header/Header.sessionTarget.test.jsx:85-151`).

3. **ADDRESSED — partial shortcut registration.** Registration now attempts all five controls, records every accelerator acquired by this attempt, and unregisters all of them if any registration returns false or throws (`electron/spikes/chatgptR1Upload.js:646-668`). Intermediate and CLOSE conflicts both prove zero surviving callbacks and zero view loads (`tests/electron/spikes/chatgptR1Harness.test.js:168-186`).

4. **ADDRESSED — executable R1 without fabricated defaults.** Requiring an operator-supplied local runtime is the correct measurement boundary. The loader accepts only an explicit local path (`electron/spikes/chatgptR1Upload.js:133-147,591-593`); missing runtime methods fail closed before evidence or result output (`electron/spikes/chatgptR1Upload.js:256-272`). With a valid runtime, the harness supplies real fixtures, an operator-ceiling size ladder, page ports, fresh-conversation resets, every case/repetition, operator review, pre/post evidence, final validation, and result writing (`electron/spikes/chatgptR1Upload.js:274-350,379-408,468-504`). Main wires this real path under the spike gate (`electron/main.js:1650-1682`), and the runtime-backed test completes the whole matrix (`tests/electron/spikes/chatgptR1Harness.test.js:395-465`). **Yes: a human who sets `AUTOFLOWCUT_R1_RUNTIME_MODULE` to a valid observed-runtime adapter and logs in can now complete R1. Login alone, without that module, intentionally remains blocked.**

## Closing checks

- **New breakage from this wave:** none at Critical or Important severity.
- The entering-Flow-only synchronous layout push remains intact (`src/App.jsx:2167-2189`), including saved-layout ownership and no target-only default push (`tests/components/App.chatgptTargetGate.test.jsx:478-523`).
- The module-owned strip inset remains the default for every bare `updateBounds` call (`electron/ipc/layout.js:11,24-45,181`; initialized at `electron/main.js:726-733`). All production callers found use that default; flag-off bounds retain the old calculation (`tests/electron/ipc/layout.targetComboStrip.test.js:26-52`).
- Renderer quiesce still sends success only after its awaited idle barrier (`src/App.jsx:180-207,2149-2163`); main awaits that receipt, then awaits both `sessionJobOwner.cancelAll` and `sessionJobOwner.awaitIdle` before view transition (`electron/ipc/mode.js:133-188,217-235`). Retry entry points remain tracked by the same idle set (`src/hooks/useAutomation.js:941-955,960-989`).
- No new ChatGPT mechanism, upload selector, predicate, outcome, or capability limit is embedded in production. Product `ensureSession` still defaults to the marked unmeasured `session-blocked` probe and `createAdapter` still defaults to null (`electron/webtargets/chatgpt/index.js:18-34,49-72,93-102`). The pre-existing prompt/submit scalar selectors in the R1-only auth/sanitized-capture shell are the plan-approved confirmed surfaces, not an upload capability claim.
- With `AUTOFLOWCUT_CHATGPT_P2` absent, the exact main gate remains closed (`electron/ipc/mode.js:29-40,197-204,360-363`), renderer flags fail closed (`src/contexts/DevFlagsContext.jsx:3-32`), the strip is not rendered (`src/Shell.jsx:65-71`), and the native inset remains disabled. No normal-user or layout delta was found.

## Verification

- Fresh focused verification: **12 files / 125 tests passed** (the 11 changed/regression suites plus `App.chatgptTargetGate`).
- `git diff --check b5040959..602edcc9`: clean.
- Supplied full-suite result: **756 files / 7929 tests green**.

## Tally

- Requested items: **4 ADDRESSED / 0 NOT ADDRESSED**.
- New findings: **0 Critical / 0 Important**.
- Final judgement: **findings-0 — YES**.
