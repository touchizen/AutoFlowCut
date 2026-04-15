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
│   - Runs review loop (max 5 rounds, exit on 0 issues)
│   - Writes W{N}_SUMMARY.md
│   - Returns completion signal
│
├─ Orchestrator verifies:
│   - W{N}_SUMMARY.md exists
│   - No unresolved issues
│
├─ Update STATE.md:
│   - Wave N → "done"
│   - Current Wave → N+1
│
├─ Update W_progress.json:
│   - Wave N status, completed_at, review_rounds, issues_found
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
- Character count targets (8,000~12,000자)
- Review loop: self-review + subagent review (max 5 rounds, target 9.5)
- Output: {title}_기.md, {title}_승.md, {title}_전.md, {title}_결.md, 07_검토.md

**W4 subagent prompt includes:**
- Narration/dialogue/SFX extraction rules
- Review loop: subagent cross-checks extraction vs script (max 5)
- Output: narration_{part}.txt, dialogs_{part}.json, 08_sfx_목록.md

**W5 subagent prompt includes:**
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
- AutoFlowCut project creation
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
