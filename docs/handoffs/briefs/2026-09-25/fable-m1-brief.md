# Brief — IMPLEMENT M1 (image) of the Flow batchexecute rework

You are the author. Implement **M1 only** (tasks M1-1 … M1-14a; M1-15 is my live gate) of the reviewed plan `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md` (revision R4 — four review rounds, 78 findings dispositioned in §7–§9; the plan is the source of truth, this brief only adds rules). Do **not** start any M2 task.

## Where and how
- Worktree `/Users/tuxxon/workspace/AutoFlowCut-bugfix`, branch `fix/flow-batchexecute`. Work in place. The plan file is committed; do not edit it except to append a short `## 10. 구현 메모 (M1)` section recording any deviation and why.
- Tests: `env -u ELECTRON_RUN_AS_NODE npx vitest run <file>` per task (the shell exports `ELECTRON_RUN_AS_NODE=1`; without `env -u` Electron-related modules break). The **full suite** `env -u ELECTRON_RUN_AS_NODE npx vitest run` must be green at the end of every task before you start the next (it takes ~80 s).
- Strict TDD per task: write the failing test first and **run it to see it fail for the right reason** (quote the failure line in your report), then the minimal implementation, then green. The repo's `CLAUDE.md` requires unit **and** integration tests — the plan's M1-5 and M1-13 are the integration layer; say which test covers which seam.
- Fixtures: the masked evidence files under `docs/handoffs/evidence/` are the fixtures (read them with `fs`; re-encode request bodies as the plan says — the JSONL `reqBody` is already URL-decoded). The live composer markup is `2026-09-24-flow-composer-markup.html`; icons are `<mat-icon class="… google-symbols …">ligature</mat-icon>`.
- Do **not** start the Electron app, do not generate anything, do not commit, do not push, do not use `git stash`. If you mutation-test your own tests, revert every mutation and confirm with `git diff` before reporting.
- Constraints (non-negotiable, from the user): no CDP for Flow; submits only via the existing trusted click (the app never builds a submit RPC or calls grecaptcha); no request-body tampering; no secrets/prompts/signed URLs/tokens in main-process `console.*`; injected page functions are self-contained (compose at the call site, never call another serialized helper by name); surgical changes, Korean comments are house style.
- Report honestly what you ran and the exact counts. **Your green is not the final verdict** — I rerun the suite in my environment and run the live gate myself.

## Report back (final message)
Per task: test file(s), the red line you saw, the implementation files, the green count. Then: full-suite result; `git status --short`; any deviation from the plan and why (also recorded in §10); the exact live-gate checks for M1 (log lines and return values, per plan §4) and anything you could not verify without the app.
