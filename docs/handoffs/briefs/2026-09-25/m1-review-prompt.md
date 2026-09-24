# Adversarial code review — M1 (image) of the Flow batchexecute rework

You are an independent reviewer. This repository copy is **yours alone**; do not modify source files. You may run `env -u ELECTRON_RUN_AS_NODE npx vitest run <file>` (node_modules is a symlink; the shell exports ELECTRON_RUN_AS_NODE=1). The change under review is commit 82ef3de1 "feat(flow): M1 image generation…" (75 files, +5569/−864). Your copy has **no .git** (read-only snapshot at that commit); the full unified diff is at `/private/tmp/claude-501/-Users-tuxxon-workspace/97bf2874-bc98-45a4-b837-445245094350/scratchpad/m1.diff` — read it, and open the files in your copy for context. The design it implements is `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md` (§2 decisions, §3 M1 tasks with the "구현자 공통 규칙" block, §11 implementation notes). Evidence (live captures/DOM) is under `docs/handoffs/evidence/`.

Non-negotiable constraints — any violation is a BLOCKER:
1. No CDP for Flow automation (no `webContents.debugger`, `Network.*`, `Fetch.*`, `Page.addScriptToEvaluateOnNewDocument`).
2. Submits happen only through the existing trusted click; the app never constructs/sends a submit RPC (`ogiZ0b`/`YhhmEf`) and never calls grecaptcha.
3. No request-body tampering (the capture must be observe-only; `send` receives the original body).
4. No secrets/user content in main-process `console.*` or Sentry (no `at`, cookies, tokens, signed URLs, emails, prompts) — check every new log line and error message; `tests/electron/noUserContentInLogs.test.js` is a guard, not proof.
5. Injected page scripts are self-contained (serialized helpers never call each other by name; minified evaluation must work).

What to check (open the code; do not trust the plan's or the commit message's description):
- **Correctness vs plan**: protocol positions against the masked samples; `{doc, seq}` binding and expiry; the two-phase settings driver; session-status and reason routing; unsupported-input gates on every call path (batch `useAutomation`, single `useSceneGeneration`, references `useReferenceGeneration`); `errorParams`/`rejectedMediaId` plumbing to the display components; `collectCompleted` ordering; `flow:check-generation`/`clear-generations` behavior for rpc gens; download path and Sentry scrub.
- **Wiring holes**: things a unit test mocks that production does not provide (deps, preload keys, main.js injection points, IPC channel names, `buildReportCtx`).
- **Test adequacy**: for each new test file, name a realistic incorrect implementation that would still pass. Look for tautological assertions, fixtures that do not match the live markup (`docs/handoffs/evidence/2026-09-24-flow-composer-markup.html`), and skipped suites (`describe.skip`) that hide real regressions.
- **Regressions** in API mode and in the legacy Flow paths that are still compiled (behavior changes to shared helpers such as `reportResponseRouter`, `generationMatch`, `shared.js`, `engineFlow`, `useAutomation`).
- **Scope**: anything speculative or over-abstracted that should be cut.

Output format (final message): a numbered list, most severe first, each `[BLOCKER|MAJOR|MINOR] <file:line> — <what is wrong> — <concrete failure scenario> — <suggested fix>`. If nothing should change, output exactly `NO FINDINGS` and one line on what you checked. No praise, no restating.
