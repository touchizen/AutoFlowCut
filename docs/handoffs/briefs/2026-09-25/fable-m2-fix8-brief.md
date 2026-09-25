# Brief — FIX M2 review round 8 (narrow round on 6b9b5859 — MINOR only; the review loop is closed after this)

You are the author (Fable 5.1). Raw findings: `docs/handoffs/briefs/2026-09-25/findings/m2-r8-opusA.findings.md` (5 MINOR) and `m2-r8-opusB.findings.md` (3 MINOR). Read both in full. Disposition M1–M6, all **accepted**. Same rules as the earlier fix briefs (`fable-m2-fix-brief.md` … `fable-m2-fix7-brief.md`): strict TDD with the red line quoted, full suite green after every item, one mutation per new test restored byte-for-byte, no commits/push/stash/app launch/generation/CDP, Korean comments tagged `// M2-R8 M<n>`, nothing under `docs/handoffs/`, rows in a new plan subsection `### 12.10 리뷰 8라운드 반영` starting at #113. Baseline: see the commit message of HEAD (full suite count).

| M | Sev | Source | Disposition |
|---|---|---|---|
| M1 | MINOR | A1 = B1 | Pin the `gen.doc != null` guard of `onSendDeadline`: credits `[1050, <deferred>]`, late send binds at ~15.2 s while the re-read is in flight, the read resolves 1040 → still `{success:true, generationId, creditsLeft:1040}`; mutant (guard → `gen.completed` only) → red. |
| M2 | MINOR | A2 = B3 | `tests/electron/flow-rpc-capture-wiring.test.js` report-response block: `expect(block).toMatch(/reportDomFailure:\s*helpers\.reportDomFailure\b/)`. |
| M3 | MINOR | A3 | Router test (d): a `payloadWithModelKey('Bad Key')` body (UUID valid, model key invalid) logs `media=00000011` and reports; a two-record `video-count` body produces no media line. Mutant (`catch → null`) → red. |
| M4 | MINOR | B2 + A4 | Unbound-loadend reporting must not fire on manual submissions: the router keeps a short-TTL record (≤ 120 s) of YhhmEf gens it closed **without a bound loadend** (`flow-submit-not-sent`, `flow-submit-lost`, `flow-generation-cleared`, `flow-rpc-multi-batch`); an unbound YhhmEf 200 with a UUID is **reported** (`submit:unbound-loadend`) only when such a record exists, otherwise **logged only** (`[Flow RPC] YhhmEf unbound loadend media=<8> (no recent app close — not reported)`). Document in §3/§12.10 that the diag sink reports the first occurrence per session only and the console line is the per-media record. Pins: manual submit (no closed gen) → log, no report; closed-unbound gen then late loadend → report; record expires after the TTL. |
| M5 | MINOR | A5 | `onSendDeadline`: when the re-read returns null, log `credits unreadable — waiting for a late send` (no numbers), not `credits unchanged`. Pin. |
| M6 | MINOR | — | (reserved) |

## Report back
Per M: test file(s), red line, implementation files, green count, mutation. Full-suite numbers. `git status --short`. §12.10 rows.
