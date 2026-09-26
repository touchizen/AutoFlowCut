# Brief — IMPLEMENT M2 (text-to-video) of the Flow batchexecute rework

You are the author. Implement **M2** (tasks M2-1 … M2-6; M2-7 is my live gate) of `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md` (revision R5 + §11 implementation notes). The "구현자 공통 규칙" block at the top of §3 applies to every task; §8–§10 dispositions on the video path are binding (submissions-only halt via `submitHalt`, `rejectedMediaId(s)` never `mediaId`, table-driven `modelKeyMatches` from the real catalog keys, count forced to 1, `resolution` plumbed to IPC and refused outside {360p,720p} before the click, Omni 9:16 gated by the panel, echo warn-only, `as29s` bounded pending, quota (code 8) through the halt without `stopRequestedRef`, per-document `{doc, seq}` binding shared with M1).

## State of the tree (read first)
- Branch `fix/flow-batchexecute`; M1 is complete and live-verified: 82ef3de1 (M1), d468f8e8 (open-project settle polling), 8aebbc03 (review round 1: 26 findings), 7670858b (automation viewport for hidden/narrow views — the generate handler now wraps the whole DOM phase; reuse that wrapper for T2V), plus evidence commits. Read `git log --oneline -8` and `docs/handoffs/evidence/2026-09-24-m1-live-gate.md` (three live runs; what worked and what failed).
- Live facts to design against: the Flow view can be 0×0 (modal) or narrow (597 px) — the composer hides controls below ~600 px; the settings panel closes with a body `keyCode 27` Escape; `ensureAgentOff` says "already OFF" on the new site; `ogiZ0b` XHR takes ~35 s synchronously; credits stay 1050 for images. For video the observed submit `YhhmEf` returned in ~6 s with `[1]=1040` and the status poll `jwpduf` moved 6 → 2 → 3 in ~35 s; `as29s` returns the mp4 signed URL.
- M1's t2v/check-video-status handlers are fail-closed stubs (`flow-feature-unsupported:*`) in `electron/ipc/flow-angular.js` — replace them.

## Rules (same as M1)
- Strict TDD per task: failing test first (quote the red line), minimal implementation, green; the **full suite** `env -u ELECTRON_RUN_AS_NODE npx vitest run` green after every task (the shell exports `ELECTRON_RUN_AS_NODE=1`).
- Fixtures: `docs/handoffs/evidence/2026-09-24-flow-batchexecute-samples.masked.jsonl` (re-encode request bodies), `…-rpcids.md` §3 for the first-poll payload, the DOM dumps for the video panel and model menu, `…-flow-composer-markup.html`.
- No app launch, no generation (video costs credits), no commits, no push, no git stash; revert mutations and confirm with `git diff`.
- Constraints: no CDP; submits only via the trusted click; no request-body tampering; no secrets/prompts/signed URLs in `console.*`; injected page functions self-contained; surgical changes; Korean comments.
- Record deviations in `## 12. 구현 메모 (M2)` of the plan.

## Report back
Per task: test file(s), the red line, implementation files, green count. Full-suite numbers, `git status --short`, deviations, and the exact M2 live-gate checks for me (log lines, return values, where the mp4 lands). I run the live gate myself and it costs the user 10 credits, so state precisely what one run will prove.
