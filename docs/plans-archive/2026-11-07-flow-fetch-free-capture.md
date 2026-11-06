# Flow fetch-free image capture implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make plain scene image generation work without installing any main-world network/global wrappers.

**Architecture:** Observe the page's batchexecute requests in the existing Electron session listener, correlate one strictly validated image request with an isolated-world gallery delta, and download through main-process net.request using that session. Keep ownership exclusive through download and final DOM verification; ambiguous or interrupted submissions quarantine the observer. Compatibility wrappers require AUTOFLOWCUT_FLOW_RPC_CAPTURE=1.

**Tech Stack:** Electron 36 webRequest/net, native input, isolated DOM probes, Vitest/jsdom.

## Design and evidence

The supplied brief authorizes investigating and choosing this architecture. DOM alone cannot associate a result with a request; a wrapper would defeat the goal. Passive requests + a stable gallery delta under exclusive execution is the selected conditional ownership proof. HTTP 200 alone does not prove RPC success. A complete, uniquely identified image delta is also required. Cross-device edits cannot be observed by this session: the live test requires an otherwise idle project/account, and this limitation must be reported.

Existing evidence uses both redirect URLs and opaque asb thumbnails. Accept explicit gallery media IDs and ID-bearing URLs; never use edit IDs as media IDs or infer IDs from opaque tokens. Unknown/virtualized/incomplete galleries fail closed. Reference uploads, video, agent mode and fixed seeds remain unsupported in the default path.

Electron documentation confirms one listener per webRequest event. Extend the existing onBeforeRequest callback; do not replace it from a second module. Use onCompleted/onErrorOccurred with the same request id. Never cancel or modify observed requests. net.request takes session/useSessionCookies and supports abort; test cleanup on every outcome.

Sources: https://www.electronjs.org/docs/latest/api/web-request and https://www.electronjs.org/docs/latest/api/client-request (checked 2026-11-07; installed Electron types remain authoritative for v36).

## Task 1 — Observer and gallery ownership

Files: electron/flow-passive-capture.js, electron/flow-gallery-snapshot.js; tests/electron/flowPassiveCapture.test.js, tests/electron/flowGallerySnapshot.test.js, tests/fixtures/flow-passive-image.js.

1. Add failing fixtures/tests for strict request shape, body bytes, project/prompt/count/seed, competing requests, transport errors, exclusive lease and quarantine.
2. Run focused tests with `--configLoader runner`, keeping TMPDIR/logs in `.work/flow-fetch-free` (shared node_modules is read-only).
3. Implement minimal observer and pure DOM snapshot/delta validation; test missing/opaque IDs, placeholders, changed baseline and excess/missing results.
4. Add integration coverage combining actual observer and DOM fixtures. Run all focused tests and commit in English.

## Task 2 — Download lifecycle

Files: electron/flow-image-download.js; tests/electron/flowImageDownload.test.js.

1. Fail tests for session cookies, allowed URLs, content type, byte limit, timeout/cancellation, error and listener cleanup.
2. Implement bounded net.request streaming in main; never page fetch, never an API generation request or temp output.
3. Run unit/integration tests and commit with the next integrated stage.

## Task 3 — Default image path and policy

Files: electron/ipc/flow-angular.js, electron/flow-passive-image.js, electron/ipc/flow-api.js, electron/main.js, electron/flow-page-policy.js; policy and integration tests.

1. Fail policy and full image handler tests: no main-world execution; native settings/text, passive request, isolated gallery, download, existing async collect contract.
2. Default image handler uses the new path; legacy image/video handlers remain opt-in. Session-status checks the DOM instead of page XHR by default.
3. Hold the lease through all work, keep existing safety pacing and input shield, reject unsupported features before editing/submitting, cancel on teardown/navigation/input/clear.
4. Test both sync and async caller contracts, overlapping calls, stale DOM, navigation and cancellation; verify no bootstrap hook installation by default.
5. Run focused tests and commit in English.

## Task 4 — Verification and handoff

1. Run the full suite excluding only tests/integration/render.smoke.test.js (three baseline ffmpeg failures identified in the brief).
2. Review diff, scan added debugger calls (must be zero), audit main-world entry points; no app launch, live generation, push or merge.
3. Record before/after test totals, limitations and live sequence (one image then three, 60–75s spacing). Archive this plan and commit.

## Implementation status (2026-11-07)

Offline implementation and TDD steps are finished; verification evidence and live-test restrictions are in `docs/flow-fetch-free-capture-2026-11.md`. The plan is archived under the repository documentation rule. Git staging/commits are externally blocked by index.lock EPERM; no new commit, push or merge occurred. Live generation is deliberately deferred under the supplied brief.
