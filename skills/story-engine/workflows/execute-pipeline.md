<purpose>
Orchestrate the 8-wave story pipeline. Each wave runs as a subagent with fresh context.
The orchestrator stays lean: read STATE.md, determine next wave, spawn subagent, collect result, update state.
</purpose>

<process>
**Step 1: Load state**

Read `STATE.md` from the episode directory.
Determine current wave from STATE.md status table.

Parse $ARGUMENTS for:
- `--from W{N}` -- override start wave
- `--to W{N}` -- override end wave (default: W8)

**Step 2: Wave execution loop**

For each wave from current to target:

```
┌─ Read STATE.md → determine wave N
│
├─ Load wave reference doc: docs/{lang}/W{N}-*.md (lang=ko for yadam, lang=en for dark-history)
│
├─ Spawn subagent for W{N}:
│   - Type: general-purpose
│   - Prompt: wave-specific instructions + reference doc content
│   - Fresh context (no prior wave baggage)
│
├─ Subagent executes:
│   - Performs wave work
│   - Runs review loop (max 5 rounds per substep, exit on 0 issues,
│     escalate on round 5) — see "Mandatory completion checklist" below
│   - Writes W{N}_SUMMARY.md with required sections
│   - Writes/updates W_progress.json waves.W{N} with required fields
│   - Writes/updates STATE.md wave status row
│   - Returns completion signal including numeric review_rounds_used
│
├─ Orchestrator verifies (FAIL = retry subagent once; still FAIL = escalate):
│   - W{N}_SUMMARY.md exists AND contains non-empty "Review rounds" section
│   - W_progress.json waves.W{N}.status === 'done'
│   - W_progress.json waves.W{N}.review_rounds_used is a number (≥1)
│   - W_progress.json waves.W{N}.issues_found is a number (≥0)
│   - W_progress.json waves.W{N}.completed_at is an ISO timestamp
│   - W_progress.json waves.W{N}.deliverables is a non-empty array
│   - No unresolved issues flagged in the summary
│
├─ Orchestrator sanity-checks STATE.md + W_progress.json consistency:
│   - STATE.md wave row "done" ↔ W_progress.json status 'done'
│   - If mismatched → fix and warn
│
├─ Special gate check:
│   - After W3: 🛑 AskUserQuestion "대본을 확정하시겠습니까?"
│   - User must confirm before W4
│
└─ Next wave
```

**Step 3: Wave-specific subagent prompts**

Each subagent receives:
1. Episode context (genre, topic, decisions from STATE.md)
2. Wave reference doc (docs/{lang}/W{N}-*.md (lang=ko for yadam, lang=en for dark-history))
3. Meta-prompts (for W2, W3): meta-prompts/{genre}/*.md
4. Previous wave summaries (for context continuity)
5. File paths for all episode artifacts created so far

**W1 subagent prompt includes:**
- Branch detection: new vs rewrite
- Reference analysis instructions (if rewrite)
- Fact-check + research instructions (if new)
- Output: 01_분석.md, 02_팩트체크.md, 03_자료수집.md

**W2 subagent prompt includes:**
- Synopsis writing guidelines (meta-prompts/{genre}/synopsis_guidelines.md)
- Preflight checklist (meta-prompts/{genre}/preflight.md)
- 20-chapter framework
- Review loop: preflight fail → revise synopsis → re-check (max 5)
- Output: 04_시놉시스.md, 05_프리플라이트.md

**W3 subagent prompt includes:**
- Screenplay guidelines + narrative + suspense (meta-prompts/{genre}/*.md)
- Writing order: Hook → Act I → II → III → IV
- Length targets — depends on genre:
  - yadam (Korean): 8,000~12,000자
  - dark-history (English): 2,000~3,000 words
- Review loop: self-review + subagent review (max 5 rounds, target 9.5)
- Output: {title}_기.md, {title}_승.md, {title}_전.md, {title}_결.md, 07_검토.md

**W4 subagent prompt includes:**
- Narration/dialogue/SFX extraction rules
- Review loop: subagent cross-checks extraction vs script (max 5)
- Output: narration_{part}.txt, dialogs_{part}.json, 08_sfx_목록.md

**W5 subagent prompt includes:**
- **MANDATORY W5-0 character voice assignment** (BEFORE TTS): extract unique characters from `dialogs_*.json`, diff against `tts_settings.md`; if any unmapped characters or missing narrator → AskUserQuestion with 3–4 voice recommendations, then persist to `tts_settings.md`
- TTS generation (ElevenLabs with-timestamps)
- SRT generation (manual subtitle splitting)
- SFX generation + timecode assignment
- Audio merge (ffmpeg concat)
- Timecode validation
- Output: segments/, final_{part}.mp3, final_{part}.srt, media/

**W6 subagent prompt includes:**
- CSV schema (get_schema MCP tool)
- References CSV + scenes CSV creation
- SRT-based scene splitting (15sec rule)
- Review loop: CSV vs script vs SRT cross-check (max 5)
- Gap/coverage validation scripts
- Output: references.csv, {title}_scenes.csv
- **HARD RULE**: W6 must NOT generate images. Forbidden calls: `app_start_ref_batch`, `app_start_scene_batch`, `app_generate_reference`, `app_generate_scene`, and their HTTP equivalents. Image generation belongs exclusively to W7. If the subagent even considers kicking off a batch "since the CSV is ready", that is a spec violation — STOP and hand off to W7.

**W7 subagent prompt includes:**
- **MANDATORY pre-check**: `app_open_project({ name })` to switch to target project BEFORE loading CSV or generating. Verify current project matches. If mismatch → STOP.
- AutoFlowCut project creation (or open existing)
- Style selection (list_styles MCP)
- Reference image batch generation
- Scene image batch generation
- Full QA (all images, max 5 rounds)
- Error scene fix + regeneration loop
- Audio import + CapCut export
- Output: generated images, CapCut project

**W8 subagent prompt includes:**
- YouTube title/description/tags generation
- Thumbnail text suggestions
- Output: 11_업로드정보.json

---

**Mandatory completion checklist (applies to W1–W8, no exceptions)**

Every Wave subagent MUST, as its final action before returning:

1. **Write `W{N}_SUMMARY.md`** with at minimum these sections:
   - `## Deliverables` — full list of produced files (relative paths under `_story_source/`)
   - `## Review rounds` — numbered log, one row per round: round number, result (pass/fail), issues found, fixes applied. Even if only 1 round, log it.
   - `## Issues found` — final unresolved issues count. `0` if clean.
   - `## Open questions for W{N+1}` — handoff notes; empty section is allowed but the heading must exist.

2. **Update `W_progress.json`**. Merge (do NOT replace) the existing JSON; set `waves.W{N}` to:
   ```json
   {
     "status": "done",
     "completed_at": "<ISO-8601 timestamp>",
     "review_rounds_used": <number ≥ 1>,
     "issues_found": <number ≥ 0>,
     "deliverables": ["<path1>", "<path2>", ...],
     "...any wave-specific metadata..."
   }
   ```
   The numeric `review_rounds_used` and `issues_found` fields are REQUIRED. Do not omit; do not leave as `null`/`"?"`/string.

3. **Update `STATE.md`**: set the `W{N}` row's Status column to `done` and the Summary column to a one-liner (e.g., `Synopsis + preflight — 1 round, passed, 2026-04-16`).

4. **Return report** (the completion signal that closes the subagent) MUST include the numeric fields `review_rounds_used` and `issues_found` so the orchestrator can verify without re-reading the JSON.

If the subagent exits without satisfying items 1–4, the orchestrator treats the wave as incomplete and retries.

---

**Step 4: Completion**

After all waves complete:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 STORY ENGINE ► Episode {number} COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ All 8 waves completed
◆ CapCut project exported
◆ Upload info ready
```

Update STATE.md final status.
</process>
