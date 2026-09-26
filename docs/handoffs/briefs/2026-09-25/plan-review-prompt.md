# Adversarial review — AutoFlowCut Flow-mode rework PLAN (flow.google.com / batchexecute)

You are an independent reviewer. This copy of the repository is **yours alone**; do not modify source files (read-only review). The plan under review is `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md`. It was written by a different model; I (the orchestrator) will decide what to act on.

## Background you must read before judging
- `docs/handoffs/2026-09-24-flow-batchexecute-migration-HANDOFF.md` (why Flow mode broke)
- `docs/handoffs/evidence/2026-09-24-flow-batchexecute-rpcids.md` (live rpcid table, transport, DOM) and `docs/handoffs/evidence/2026-09-24-flow-batchexecute-samples.masked.jsonl` (raw masked samples)
- `docs/handoffs/evidence/2026-09-24-flow-composer-dom-*.elements.json` (DOM dumps)

## Non-negotiable constraints the plan must respect (flag any violation as BLOCKER)
1. No CDP for Flow automation (no `webContents.debugger`, `Network.*`, `Fetch.*`, `Page.addScriptToEvaluateOnNewDocument`).
2. Submit RPCs (`ogiZ0b` image, `YhhmEf` video) carry a reCAPTCHA Enterprise token the page obtains itself → the app must only type/set settings and **trusted-click** the real submit button; it must never build or send a submit RPC or call grecaptcha.
3. No video request-body tampering (aspect injection was tried and killed jobs with `state FAILED`). Settings go through the settings-panel DOM. No image body tampering either in this work.
4. No secrets/user content in main-process `console.*` (Sentry breadcrumbs): no `at`, cookies, tokens, signed URLs, emails, prompts.
5. TDD for every change; pure parsers with fixture tests; surgical changes. The repo's own `CLAUDE.md` also requires **unit and integration tests** for every change.

## What to check (open every `file:line` anchor the plan cites — do not trust the plan's description of the code)
- **Anchors**: is each archaeology claim true at that line? Are there other call sites that use the same broken pillar (Bearer/session, `window.fetch` capture by URL, aisandbox REST, old settings selectors) that the plan misses? Grep for them (e.g. `getAccessToken`, `flowExtractToken`, `token`, `Bearer`, `aisandbox`, `SESSION_URL`, `MEDIA_REDIRECT_URL`, `batchGenerateImages`, `fetchMediaAsBase64`, `check-video-status`, `configureFlowMode`, `applyAgentDefaults`).
- **Correctness of the design against the evidence**: rpcid semantics, payload positions, correlation of captured responses to the right pending generation under batch concurrency, stale responses, duplicate responses (page re-polls), what happens when the Flow view is offscreen (timer throttling), signed-URL expiry, response-shape drift (fail loudly?), fail-closed rules for settings (mode/ratio/model/duration) and for result verification.
- **Gaps**: anything needed for M1 (image) or M2 (T2V) to actually work end-to-end that is not in the task lists (renderer gates, retries, MCP paths, style thumbnails, batch/async submit path `submitGeneration`, collection/saving, error surfaces, i18n toasts).
- **Test plan quality**: would the listed tests fail if the implementation were wrong in the ways that matter? Name implementations that pass the listed tests but are wrong.
- **Scope**: anything that is speculative/unneeded for M1/M2 (should be cut), or over-abstracted.

## Output format (your final message)
A numbered list of findings, most severe first. Each finding:
`[BLOCKER|MAJOR|MINOR] <plan section or file:line> — <what is wrong> — <concrete failure scenario> — <suggested fix>`
If you find nothing that should change, output exactly `NO FINDINGS` and one line on what you checked. Do not pad with praise or restate the plan.
