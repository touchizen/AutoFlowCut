# Flow live diagnostics implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare the read-only evidence recorder already requested in `brief-live-test.md`, without submitting another generation after the recorded safety stop.

**Architecture:** Opt-in main-process recorder scoped to an explicit test-project UUID. An isolated-world MutationObserver and WeakMap preserve node identities without writing to the shared DOM. The existing webRequest listener forwards observational events; no new listener replaces it. Diagnostics never determine ownership or alter requests.

**Tech Stack:** Electron 36, JavaScript, Vitest/JSDOM.

## Authorized scope and current evidence

- Reuse worktree `AutoFlowCut-flow-detection`, branch `fix/flow-detection-no-page-mutation`.
- Previous run saw the unusual-activity warning, saved `afc-codex/live/initial-safety-stop.png`, quit the main app, and was interrupted before preparation completed.
- No live generation or retry in this continuation. No CDP, main-world hooks, API mode, user-project changes, merge, or push.
- The existing expected failure remains unresolved until actual request-to-result evidence is available. Synthetic diagnostic tests must not be described as live evidence.

## Task 1: Capture evidence without changing the page

Create `electron/flow-live-dom.js` and `tests/electron/flowLiveDiagnostics.test.js`.

1. Test stable WeakMap IDs across placeholder replacement and transient removal, DOM immutability, bounded output, and complete disconnect.
2. Luna runs the new tests and confirms RED before implementation.
3. Implement a self-contained serialized probe in an isolated world distinct from existing worlds. Preserve ancestor/card structure, direct text, data/aria attributes, safe media URLs, and mutation timing. Mark all truncation explicitly.

## Task 2: Attach opt-in recording

Create `electron/flow-live-diagnostics.js`; modify `electron/flow-passive-capture.js` and `electron/main.js`.

1. Test disabled mode has zero effects; explicit project/absolute directory are required; requests omit tokens/headers; events are view/project scoped; I/O failure and diagnostic exceptions never affect network or ownership; lifecycle cleanup and output limits work.
2. Luna confirms RED, then implement minimal recorder and existing-listener forwarding. Require `AUTOFLOWCUT_FLOW_LIVE_DIAGNOSTICS=1`, `AUTOFLOWCUT_FLOW_LIVE_PROJECT_ID`, and `AUTOFLOWCUT_FLOW_LIVE_DIR`.
3. Luna verifies new and related tests, then the full suite once excluding the known baseline `render.smoke.test.js` failures. Keep output under workspace.

## Task 3: Prepare app and handoff

1. Build and start this branch with diagnostics off and legacy mutation/RPC flags off. Confirm process, HTTP batch status, and app surface without generating or changing projects.
2. Review the diff and audit all added Electron lines for `debugger.`. Record exact tests, app state, and remaining blocker in `afc-codex/live-test-report.md` and update `HANDOFF.md`.
3. Leave main unmerged and do not push. Live ownership proof and original-download verification remain pending the safety stop.

## API references checked

- https://www.electronjs.org/docs/latest/api/web-contents#contentsexecutejavascriptinisolatedworldworldid-scripts-usergesture
- https://www.electronjs.org/docs/latest/api/web-request (one listener per event; compose observations into the existing listener)

## Recorder operation

Disabled by default. All three variables are required:

```sh
AUTOFLOWCUT_FLOW_LIVE_DIAGNOSTICS=1
AUTOFLOWCUT_FLOW_LIVE_PROJECT_ID=<UUID of the disposable test project>
AUTOFLOWCUT_FLOW_LIVE_DIR=/Users/tuxxon/workspace/afc-codex/live
```

These must be exported into the app process. No recorder is enabled in this continuation, and these settings do not authorize another generation after the existing safety stop.

- Produces `flow-live-<time>-<uuid>.jsonl` with local session, DOM, request, HTTP completion/error, and stop records. `imageRequest` contains validated prompt/count/project/seed facts. `payloadUuids` are UUID candidates from the request, not proven ownership IDs. Raw envelopes, reCAPTCHA/form tokens, cookies, headers, and signed URL query parameters are omitted.
- DOM records use `(observerId, node ID)` for identity. `timeOrigin` distinguishes documents; observer IDs also distinguish reinstalls in the same SPA document. Mutation times are observer processing times, not a server timestamp or a precise DOM mutation timestamp.
- Samples at most once per second, with one read in flight, a 5-second read deadline, a 10-minute lifetime, and a 20-MiB file budget. Mutation count, node count, text length and total text are bounded; `truncated`/`dropped` mean evidence is incomplete and must not be used to prove ownership.
- Leaves other projects unrecorded. Navigation invalidates in-flight samples; SPA exit disconnects the observer. View destruction, limits, write failure and explicit disposal clear timers/listeners and disconnect the isolated observer, including a late read.
- The new tests use synthetic DOM and mocked WebContents. They validate the recorder contract and are not a real Flow fixture. The existing ownership expected failure remains unchanged.
