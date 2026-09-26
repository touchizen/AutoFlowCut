# Adversarial review — AutoFlowCut M3 (Flow references) PLAN

You are an independent reviewer. This copy of the repository is **yours alone**; do not modify any file (read-only review). The plan under review is `docs/plans/2026-09-25-flow-M3-references-plan.md`. It was written by a different model (Opus 5.5); the orchestrator decides what to act on.

Your axis: **{AXIS}**

## Read before judging
- `docs/handoffs/2026-09-25-flow-M3-references-KICKOFF.md` (goal, current gates, pitfalls)
- `docs/handoffs/evidence/2026-09-25-m3-references-capture.md` (what was actually observed on flow.google.com on 2026-09-25: upload rpc `maseQ`, reference image `ogiZ0b`, reference-to-video `MZZa6b`, DOM of chips/asset picker/inline mention, what is still unobserved) plus `…-m3-samples.masked.jsonl` and `…-m3-dom-*.elements.json`
- `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md` §2, §3 "구현자 공통 규칙", §12 (rules the M1/M2 review loop settled)
- `docs/handoffs/2026-09-25-flow-batchexecute-M2-live-passed-HANDOFF.md` §2 (money rule) and §5 (live pitfalls)
- The brief the author worked from: `docs/handoffs/briefs/2026-09-25/m3-plan-brief.md`

## Fixed user decisions (do not argue against them; judge whether the plan implements them safely)
- @mentions are reproduced as Flow **inline mentions** (type `@` in the editor → asset picker → pick → "프롬프트에 추가").
- References are uploaded **once per Flow project** by clipboard paste into the editor; the mediaId is reused by picking the asset by thumbnail mediaId; re-upload when not found.
- Scope: reference images (`ogiZ0b`) and reference-to-video (`MZZa6b`). Character entities, i2v, upscale stay out (fail-closed).

## Non-negotiable constraints (flag any violation as BLOCKER)
1. No CDP of any kind (`webContents.debugger`, `Page.*`, `Fetch.*`, file-chooser interception).
2. Submit (`ogiZ0b`, `YhhmEf`, `MZZa6b`) and upload (`maseQ`) carry a reCAPTCHA token the page obtains → the app never builds these RPCs or calls grecaptcha; submit only by **trusted click** (`sendInputEvent`).
3. No request-body tampering (references and mentions must be attached through the UI so the page builds the request).
4. Money rule: an item that has `generationId` and no `videoPath` is never resubmitted, whatever its status. `MZZa6b` 200 = charged.
5. Fail-closed: unknown shapes or mismatches are rejected **before** the click (0 credits).
6. No user content in main-process logs / Sentry (prompts, file paths, file names, URLs, bodies, tokens, base64).
7. TDD for every change, unit **and** integration tests (repo `CLAUDE.md`).

## What to check — open every `file:line` the plan cites; do not trust its description of the code
{AXIS_CHECKLIST}

## Output format (your final message)
A numbered list of findings, most severe first. Each finding:
`[BLOCKER|MAJOR|MINOR] <plan section or file:line> — <what is wrong> — <concrete failure scenario> — <suggested fix>`
If nothing should change, output exactly `NO FINDINGS` and one line on what you checked. Do not pad with praise or restate the plan.

---

### Axis A — design vs evidence (general)
- Does every design decision match what the capture actually observed (rpcids, index paths, DOM selectors, chip/picker/inline-mention behaviour, composer clearing after generation, credits)? Anything the plan states as fact that the evidence marks unobserved?
- Clipboard upload: focus and target checks before `webContents.paste()`, hidden/offscreen view and unfocused window, restoring the user's clipboard, concurrent user copy, upload timeout/failure, binding the `maseQ` response to the right upload under concurrency, duplicate uploads.
- mediaId cache: key, storage, invalidation (Flow project change, media deleted, local image changed), validation before reuse, fallback re-upload — can a stale id ever reach a submit?
- Inline mention insertion: how text and `@` are entered (trusted input vs editor commands), Korean IME and the key lock, cursor position, verification of the editor content and chip set before the click.
- r2v: routing `MZZa6b` captures to the pending generation, model-key validation widened only as far as needed, echo verification, reference-count limits, credit expectations.
- Is the M3-0 probe list sufficient to catch the assumptions that would overturn the design, with a real branch for each outcome? Anything speculative that should be cut?

### Axis B — tests, wiring, money and fail-closed paths
- For each task: would the listed tests fail if the implementation were wrong in the ways that matter? Name concrete wrong implementations that pass them (vacuous gates, expectations derived from the subject, mocks that make the gate unfalsifiable).
- Wiring: every call site that must change (engine gates `flowInputGate` / `planMentionRouting` / `generateImage` / `submitGeneration` / `generateVideoT2V`, IPC handlers in `electron/ipc/flow-angular.js`, protocol parsers and model-key validation in `electron/flow-rpc-protocol.js`, capture routing, renderer batch paths, MCP/HTTP batch paths, retry/regenerate paths). Is any path left that still rejects references, or that skips the new pre-click gate?
- Money rule on every r2v path (retry, loader reattach, restart, stop, auth failure, timeouts, late send grace window) — does anything resubmit a charged item or mis-bind a `MZZa6b` response?
- Result contract and new error kinds: params table, ko/en strings, no digits or auth words in `error`.
- Log/Sentry hygiene for the new modules (clipboard, file paths, file names, mediaId prefixes only).
- Integration tests: do they exercise the real composition (engine → IPC → driver → capture) rather than mocks of each other?
