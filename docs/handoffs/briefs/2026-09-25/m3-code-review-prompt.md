# Adversarial CODE review — AutoFlowCut M3 (Flow references) implementation

You are an independent reviewer. The repository copy you were given is **yours alone** (a detached git worktree with `node_modules` symlinked). Do not modify tracked files permanently — you may apply a temporary mutation to prove a test is vacuous, but restore it (`git checkout -- <file>`) before you finish. The code under review is the diff **`004961ff..HEAD`** (`git diff 004961ff..HEAD -- electron src tests`). It was written by a different model (Opus 5.5); the orchestrator decides what to act on.

Your axis: **{AXIS}**

## Spec and evidence (read before judging)
- Plan (spec, review-closed R3): `docs/plans/2026-09-25-flow-M3-references-plan.md` — §2 D1–D16 and §4 M3-1..M3-15.
- Live facts: `docs/handoffs/evidence/2026-09-25-m3-references-capture.md`, `docs/handoffs/evidence/2026-09-25-m3-probes.md` (P1–P9, §4), samples `docs/handoffs/evidence/2026-09-25-m3-samples.masked.jsonl`.
- Rules carried from M1/M2: `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md` §3 common rules; money rule and live pitfalls in `docs/handoffs/2026-09-25-flow-batchexecute-M2-live-passed-HANDOFF.md` §2, §5.
- Implementer brief: `docs/handoffs/briefs/2026-09-25/m3-impl-brief.md`.

## Non-negotiable constraints (any violation = BLOCKER)
1. No CDP of any kind; no file-chooser interception.
2. The app never builds `maseQ`/`ogiZ0b`/`YhhmEf`/`MZZa6b` or calls reCAPTCHA; submit only by trusted mouse click; **no key `sendInputEvent` to the Flow view** (`@` via `execCommand('insertText','@')`).
3. No request-body tampering.
4. Money rule: an item with `generationId` and no `videoPath` is never resubmitted; `MZZa6b` 200 = charged; post-click mismatch → `postClick:true` + `rejectedMediaId`, no `generationId`/`mediaId` keys.
5. Fail-closed before the click for any unknown shape or mismatch.
6. No user content in main-process logs / Sentry (prompts, paths, file names incl. `image.png`, URLs, bodies, tokens, base64, clipboard contents, mention labels).
7. The user's clipboard: restored only when it still holds what the app wrote; a Finder file copy (`text/uri-list`) stops the upload.

## How to review
- Read the actual code paths end to end (renderer engine → IPC → handler → drivers → capture → router → protocol), not only the tests. Trace at least: an image scene with one tagged ref + one @mention (first use in the session, then reuse), a batch (`submitGeneration`) run, an r2v video with a duplicate mention, a reference-less video with a leftover chip, and failure exits (upload timeout, picker won't open, gate mismatch, post-click mismatch, document navigation during upload, watchdog abort).
- You may run tests: `env -u ELECTRON_RUN_AS_NODE npx vitest run <files>` inside your copy.
{AXIS_CHECKLIST}

## Output format (your final message)
A numbered list of findings, most severe first. Each finding:
`[BLOCKER|MAJOR|MINOR] <file:line> — <what is wrong> — <concrete failure scenario (inputs/state → wrong outcome)> — <suggested fix>`
Only report real defects (wrong behaviour, money/fail-closed/privacy hole, a test that a named wrong implementation passes on a path that matters, a missed call site). No style nits, no speculative refactors. If you find nothing, output exactly `NO FINDINGS` and one line on what you traced and ran.

---

### Axis A — correctness and spec adherence
- Does each D1–D16 decision hold in the code? Deviations the implementers reported (see commit messages `git log 004961ff..HEAD`) — are they safe?
- Money and fail-closed on every video path (arm with `altRpcs`, late send grace, unbound close, echo/request verification, submitHalt, retry/regenerate), and on image post-click mismatch (no download).
- Upload driver: clipboard snapshot/restore ordering and ownership check, paste target check, `maseQ` binding under concurrency and document navigation, chip id wait, cache keyed by document nonce.
- Compose driver: picker open/close (Escape only for the @-picker; clear doesn't work while open), mention insertion via insertText, text insertion must not reopen the picker, gate compares chip set + mention sequence (duplicates) + text + settings summary, `beforeDispatch` re-check.
- Renderer: plan composition (duplicates, particles, unresolved rule, source-missing), per-ref byte reads, `generateImage`/`submitGeneration`/`generateVideoT2V` all rewired, guards/sync retirement.

### Axis B — tests, wiring, hygiene
- For the money/fail-closed/privacy paths, name a concrete wrong implementation that passes the current tests; prove it by applying it temporarily and running the relevant files (then restore).
- Wiring: every call site from renderer to main carries `refs`/`plan`; no path still rejects references or skips the new pre-click gate; MCP/HTTP and retry paths.
- Fake page fidelity (`tests/helpers/fakeFlowComposer.js`, `tests/helpers/flowRefHandlerHarness.js`): does it reproduce the probe facts, or could a driver pass against the fake and fail live?
- Log hygiene of the new modules; injection strings self-contained and idempotent; key-event and rpc allowlist pins.
