# Flow Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop unsafe repeat submissions and remove default main-world network wrappers while preserving Flow mode.

**Architecture:** A main-process safety gate serializes and spaces generation submissions and latches on explicit detection or repeated RPC failures. Default automation uses fixed isolated DOM probes and native input; capabilities requiring request/response hooks remain behind an explicit compatibility flag and fail before submission when disabled.

**Tech Stack:** Electron 36, React 18, Vitest, jsdom, existing Flow UI settings and session downloads.

---

### Task 1: Detection safety gate
Files: create electron/flow-safety.js, electron/flow-safety-ipc.js; tests/electron/flow-safety.test.js, tests/integration/flowSafety.test.js; wire main.js, renderer engine/automation and notices as needed.
1. Write unit tests for explicit Korean/English detection, quota-vs-detection, consecutive RPC count reset, persistent retry latch, bounded settings, serialized cancellable interval waits.
2. Run targeted Vitest and confirm expected failures.
3. Implement minimal policy and IPC/renderer integration. Count generation failures from async collect, not successful submit ACKs; read/status errors must not count as generation attempts.
4. Pass unit+integration tests and relevant automation tests. Commit: fix(flow): stop batches on detection and repeated RPC errors.

### Task 2: Remove default wrappers and body mutation
Files: electron/main.js, electron/flow-preload.js, electron/flow-automation-policy.js; tests/electron/flowAutomationPolicy.test.js; integration wiring tests.
1. Write failing tests for default-off wrappers and explicit opt-in, unsupported fields refusing before submit.
2. Run and verify failure, then introduce shared policy flag AUTOFLOWCUT_FLOW_PAGE_MUTATION=1, protect bootstrap, dumper, inject setters, legacy mutating routes.
3. Retain AUTOFLOWCUT_ENABLE_CDP path unchanged. New DOM path uses UI model/ratio/count with readback; never builds generation requests.
4. Run focused unit/integration tests. Commit: fix(flow): disable page mutation by default.

### Task 3: Fetch-free capture and native input
Files: create electron/flow-dom-automation.js and supporting modules; tests/electron/flowDomAutomation.test.js; tests/integration/flowDomGeneration.test.js; route flow-api.js.
1. Write failing fixture tests for isolated world probes, before/after gallery snapshots, ambiguity rejection, navigation cancellation, download listener cleanup, native input and readback.
2. Run and verify failures. Reuse pure UI selectors/planner but do not call scripts containing synthetic clicks. Use sendInputEvent without debugger. Fail before submission when DOM cannot prove capability/ownership.
3. Download only page-created result through normal session will-download scoped to view; no response fetch patch, direct generation RPC, speculative selectors/IDs, or real Flow calls.
4. Run focused tests and compatibility tests. Commit: feat(flow): add isolated DOM capture and native input.

### Task 4: Review and verify
1. Independent spec review then code quality review; resolve critical/important findings with regression tests.
2. Run entire suite with staged ffmpeg; record exact pre/post counts. Check syntax/build without launching app.
3. Update investigation report with flags/defaults, supported features and limitations, TDD evidence, commit IDs and manual test plan.
4. Archive completed plan/spec under docs/plans-archive. Keep unfinished scope clearly marked. No merge, push or running app changes.
