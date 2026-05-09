<purpose>
Run the next single wave only, then exit.

Manual mode for users who want to inspect each wave's deliverables before
deciding to continue. Unlike `/story-execute` (full pipeline) and `/story-next`
(full resume), `/story-step` runs exactly ONE wave per invocation:

- No `AskUserQuestion` calls inside the wave (every decision is auto-resolved
  using deterministic defaults — see Step 4 below).
- No W3/W7 hard gates (the wave terminates after its work; user confirms by
  choosing to re-invoke `/story-step` for the next wave).
- No loop to W{N+1} — the orchestrator exits after one wave, prints a
  deliverables list, and waits for the next user invocation.

The user expresses approval/disapproval by re-invoking (or not). If unsatisfied,
the user can edit deliverables directly, re-run the same wave (`/story-step`
will see status ≠ 'done' for that wave if reset), or pivot to `/story-rewrite`.
</purpose>

<process>
**Step 1: Find episode**

Look for `STATE.md` in the most recent episode directory:
```bash
ls -d {PROJECT_DIR}/story/ep*/STATE.md | sort -V | tail -1
```

If no `STATE.md` is found, tell the user to run `/story-new` first and exit.

**Step 2: Determine next wave**

Read `STATE.md` status table and read `_story_source/W_progress.json`. Find
the first W{N} (N ∈ 1..9) where `waves.W{N}.status` is missing or not `'done'`.
Call this the **target wave**.

- If all 9 waves are `'done'`, print
  `✓ Episode complete — all 9 waves done. Use /story-rewrite to improve.`
  and exit.
- If a wave is `'running'` (orchestrator pre-write but no subagent completion),
  treat that wave as the target (effectively a retry).

**Step 3: Pre-spawn protocol (delegate to execute-pipeline.md mechanics)**

Apply the same pre-spawn protocol that `/story-execute` uses for a single wave:

1. **Predecessor input contract** — for every M ∈ [1..N-1]:
   - `waves.W{M}.status === 'done'` (else escalate per execute-pipeline.md
     "Backfill protocol").
   - `W{M}_SUMMARY.md` exists.
2. **Resolve language** ({lang}) per execute-pipeline.md Step 2 box diagram
   (yadam → ko, dark-history → en, bespoke → auto-detect).
3. **Print WAVE-START banner** (same format as `/story-execute`; banner
   language follows {lang}).
4. **Record `wave_start_ts`** and pre-write `waves.W{N}` in `W_progress.json`
   with `{ "status": "running", "started_at": "<wave_start_ts>" }` per
   execute-pipeline.md "Orchestrator verification steps" #1.

**Step 4: Spawn subagent (NON-INTERACTIVE MODE)**

Spawn the wave subagent using the same brief that `/story-execute` would use
for W{N} (load `docs/{lang}/W{N}-*.md`, attach meta-prompts, attach
`_rewrite_scope.json` if present, etc.) — but **prepend the following
manual-mode instruction block verbatim** to the subagent prompt, AHEAD of any
wave-specific content:

> **MANUAL MODE — non-interactive.** This wave is being run via `/story-step`.
> You MUST NOT call `AskUserQuestion` for any reason. Every decision that the
> wave reference doc presents as a user choice must be resolved using a
> deterministic default. Specifically:
>
> - **W1 (story design / reference selection)**: use values already in
>   `STATE.md`. If a required field is absent, pick the first available option
>   silently and record it under `## Decisions (auto-resolved)` in
>   `W1_SUMMARY.md`.
> - **W5 (TTS/SFX, character → narrator mapping)**: assign characters to
>   narrators in first-appearance order using the available narrator slots
>   from `tts_settings.md`. If `tts_settings.md` defines a `default_narrator`,
>   use it for the primary narration. Log all mappings in `W5_SUMMARY.md`
>   under `## Decisions (auto-resolved)`.
> - **W8 (assembly, video generation)**: SKIP video generation by default.
>   Export the CapCut project without video clips. The user can re-run W8 via
>   `/story-execute --from W8 --to W8` (which keeps the W8 video gate) if
>   they want video. Log the skip in `W8_SUMMARY.md`.
> - **Any other binary choice** not covered above: pick the safest/first
>   option, log in summary under `## Decisions (auto-resolved)`, and proceed
>   without blocking.
>
> The user reviews `W{N}_SUMMARY.md` and the deliverables AFTER you exit. They
> confirm satisfaction by re-invoking `/story-step` for the next wave (or by
> editing files and re-running). Your job is to produce the best deliverable
> with the information at hand — not to ask.
>
> All other contracts apply unchanged: heartbeat protocol, audit obligations
> (`disk_changes` / `bash_commands` / `external_api_calls`), review loops (max
> 5 rounds — escalate on 5th round failure as usual; escalation surfaces to
> the user AFTER you exit, not during).

**Step 5: Verify return and finalize**

Run the orchestrator verification steps from execute-pipeline.md "Orchestrator
verification steps (run after every Agent return)" — items 2–6 unchanged:
- disk-change audit (declared vs actual)
- deliverables existence check
- API boundary check (W4 forbids audio gen, W6 forbids image gen, etc.)
- compute and write `duration_seconds` per the timing protocol
- on violation: pause, surface, do NOT auto-proceed (`/story-step` exits one
  way or another; violations exit with a warning, not a prompt)

**Step 6: Print WAVE-DONE banner**

Same banner format as `/story-execute` (banner language follows {lang}).

**Step 7: Print single-wave summary and EXIT**

Print the single-wave timing summary (per execute-pipeline.md Step 4):
```
 Wave timing
   W{N}  {duration}    (Total = Wall-clock for single-wave runs)
```

Then list deliverables for review:
```
 Deliverables (review before /story-step W{N+1})
   - {file1}
   - {file2}
   ...

 Auto-resolved decisions (if any)
   - {field}: {value chosen} (see W{N}_SUMMARY.md "Decisions (auto-resolved)")
   ...

 Next: /story-step    # to run W{N+1}
       /story-execute # to run W{N+1}..W9 in one go
```

**EXIT** — do not proceed to W{N+1}. The orchestrator's job ends here. The
user's next `/story-step` invocation will pick up at W{N+1} via Step 2.

---

**Hard rules**

- `/story-step` runs **exactly one** wave per invocation. No loop.
- The orchestrator MUST NOT call `AskUserQuestion` at any point. Subagent
  prompt explicitly forbids it. If a violation surfaces (subagent disobeys
  and emits an `AskUserQuestion`), treat it as a contract violation and
  escalate per execute-pipeline.md audit rules.
- All other protocols from `execute-pipeline.md` apply verbatim: predecessor
  contract, banners, heartbeat polling, disk audit, timing fields, backfill
  for missing predecessor records.
- If the target wave fails after retry (review > 5 rounds, contract
  violation, escalation), print the escalation and exit. Do NOT prompt the
  user mid-wave; the user will see the escalation in chat and decide their
  next move.
- `/story-rewrite` semantics: if `_story_source/_rewrite_scope.json` is
  present in the episode dir, the subagent honors it the same way it does
  under `/story-execute` (scope filtering per `affected.*`). `/story-step`
  does not need to know — the subagent handles it.

</process>
