# Brief — M1 review round 1: fix the findings (code)

Two independent code reviews of commit 82ef3de1 (+ my follow-ups d468f8e8, 4345f9f7) are in — both Opus (Codex is out of quota until 04:39). Fix **all** of them in the worktree `/Users/tuxxon/workspace/AutoFlowCut-bugfix` (branch `fix/flow-batchexecute`, HEAD 4345f9f7 — pull the tree state first with `git log -3`; do not touch the `docs/handoffs/evidence` files). Same rules as the M1 brief: TDD (red first, quote the red line), full suite green at the end, no app launch, no commits, no git stash, revert mutations.

Findings:
- Reviewer 1 (general): `/private/tmp/claude-501/-Users-tuxxon-workspace/97bf2874-bc98-45a4-b837-445245094350/scratchpad/review/m1-r1-opus1.findings.md` (3 MAJOR + 12 MINOR)
- Reviewer 2 (test/wiring): `/private/tmp/claude-501/-Users-tuxxon-workspace/97bf2874-bc98-45a4-b837-445245094350/scratchpad/review/m1-r1-opus2.findings.md` (3 MAJOR + 8 MINOR)

## Live-gate facts (2026-09-24 23:55, `docs/handoffs/evidence/2026-09-24-m1-live-gate.md`) — reconcile with the findings
- The image path **works end to end** with the Flow view **visible** (957×1022): session ready → agent off → settings (video→image, crop_9_16) → submit captured (doc/seq) → 768×1376 → download → file. So R2#1 (focus + bounds) is a hidden-view risk, not a dead path: implement the legacy preamble (focus + enlarge if 0×0, restore in finally) **without changing the visible-view behaviour**, and assert it in the harness.
- R1#3 (Escape close) is confirmed: the log shows two trusted clicks on the settings trigger — the Escape did nothing and the re-click closed it. Fix as R1 says (body, keyCode 27) and keep the re-click fallback.
- Before `ensureAgentOff` there are two `[TrustedClick] Button not found` lines from `closeAgentPanels` (legacy chat/settings close selectors, absent on the new DOM). Harmless; not in scope unless trivial to skip on the new host.
- Earlier, a scene with tag-matched references was refused before submit with `flow-references-unsupported` — intended.

## Dispositions
- Accept every finding as written. Where the two reviewers overlap (App.jsx reason sites = R1#1/R2#3; useAutomation errorParams = R1#2/R2#2; ReferenceDetailModal = R1#4/R2#6; flowAngularDispatch test = R1#13/R2#10; locale kinds = R1#10/R2#11; auth display = R1#6/R2#5) do it once and list both ids.
- R1#12: tolerance 0.03 and a numeric-only warn on count mismatch; record in §11.
- R1#15 / R2#7: delete the dead code; un-skip the two live rows (register/rename character coded failures) into a live describe.
- R2#8: fix the template-literal stripping in `noUserContentInLogs` so `${…}` expressions are kept, then make sure the guard is still green (fix any real leak it finds).
- Do not widen scope: no M2 tasks.

## Report back
Per finding: id → test file + red line → files changed → green. Full-suite numbers, `git status --short`, §11 additions, anything you disagreed with (argue with anchors).
