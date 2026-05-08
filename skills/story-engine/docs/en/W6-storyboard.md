# W6: Storyboard CSV + Review

This document is the W6 (storyboard CSV creation + review) stage guide for the story-engine skill — dark-history genre.

> ## 🚫 W6 scope — HARD RULES
>
> W6 produces **CSV files only**. It writes prompt text; it does **NOT** generate images.
>
> **FORBIDDEN in W6** — do not call any of these MCP tools or HTTP endpoints during W6:
> - `mcp__autoflowcut__app_start_ref_batch` / `POST /api/start-ref-batch`
> - `mcp__autoflowcut__app_start_scene_batch` / `POST /api/start-scene-batch`
> - `mcp__autoflowcut__app_generate_reference` / `POST /api/generate-reference`
> - `mcp__autoflowcut__app_generate_scene` / `POST /api/generate-scene`
>
> Actual image generation is the exclusive responsibility of **W7**. If W6 kicks off image batches it burns Flow API credits against an unreviewed CSV and corrupts the "CSV review → image generation" boundary.
>
> **Allowed in W6**: `get_schema`, `load_csv`, `list_scenes`, `list_references`, `save_csv`, `update_prompt`, `update_reference_prompt`, `update_field`, and file I/O.
>
> If W6 completes CSV generation + review and there are no remaining issues, **STOP and hand off to W7**. Do not proactively start image generation "since it's ready".

**Reference scripts** (`~/workspace/AutoFlowCut/scripts/`):

| Script | Purpose |
|--------|---------|
| `generate_scenes_csv.py` | Parse SRT → define scene boundaries → generate scenes.csv (auto-validates 15-second rule) |
| `merge_scenes.py` | Merge per-part scenes CSVs into one |

---

## Storyboard CSV generation (SRT-based)

> **This stage can only run after W5 (TTS/SFX).**
> `scenes.csv`'s `start_time`/`end_time` are derived from SRT timecodes and timeline JSON.
> Without the SRT, precise scene boundaries are impossible.

**Input data:**
- `final_{part}.srt` — per-part subtitles (meaning units, with timecodes)
- `timeline_{part}.json` — per-segment start/end times
- Original script (setup/rising/crisis/resolution .md files)

Using the script and SRT/timeline, generate a **references CSV** and a **scenes CSV**.
Use AutoFlowCut MCP's `get_schema` tool to look up the CSV schema and follow it exactly.

```
AutoFlowCut MCP: get_schema({ type: "scenes" })       → scene CSV columns
AutoFlowCut MCP: get_schema({ type: "references" })   → reference CSV columns
AutoFlowCut MCP: get_schema({ type: "prompt-image" }) → prompt-writing guide
```

### 6-1. Reference CSV (`references.csv`)

**Only characters (`character`) and places (`scene`) are written here. The `type: style` row is NOT created in W6 — it is the exclusive responsibility of W7.**

> **Style ownership split:** Asking the user "which art style?", calling `list_styles`, picking a `styleId`, and writing the `type: style` row all happen in **W7 7-1**. Do NOT ask the user about style in W6 — repeating the same question across two waves is confusing.

**`type` values written in W6:**
- `character` — characters
- `scene` — places
- ~~`style`~~ — **added in W7 7-1** (after user picks a `styleId`, W7 inserts the type:style row via `update_reference_prompt` MCP)

| Column | Description |
|--------|-------------|
| `name` | Reference name (character name, place name) |
| `type` | `character` / `scene` (W6 scope) |
| `prompt` | English image-generation prompt |

**Character writing rules:**
- Start with `solo, single person`
- Include age, gender, appearance, hair, clothing, expression
- Include period-specific terms (e.g., `doublet and hose`, `Elizabethan ruff collar`, `tricorn hat`, `bonnet`, `homespun wool cloak`, `plague doctor mask`)
- End with `historical Western costume, no modern clothing`

**Place (scene) writing rules:**
- Include period, architectural style, lighting, mood
- Time-of-day variants: `churchyard`, `churchyard_fog`, `churchyard_night`
- End with `no modern elements`

**Review (substep 6-1)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 6-2. 5 rounds exceeded → escalate to user.

### 6-2. Scene CSV (`{title}_scenes.csv`)

| Column | Required | Description |
|--------|----------|-------------|
| `prompt` | O | English image/video prompt |
| `prompt_ko` | | (Unused for dark-history) |
| `subtitle` | | Narration / dialogue subtitle |
| `characters` | | Characters appearing (comma-separated) |
| `scene_tag` | | Place tag (matches scene name in references.csv) |
| `style_tag` | | Mood tag |
| `shot_type` | | `scene` / `reaction` / `narration` / `dialogue` |
| `duration` | | Scene length (seconds) |
| `start_time` | | Start time (seconds) |
| `end_time` | | End time (seconds) |
| `parent_scene` | | Scene group ID (S001, S002, ...) |

### Scene splitting rules

**SRT / timeline-based splitting:**
- Use segments in `timeline_{part}.json` as the base unit
- If a segment exceeds 15 seconds, split by content
- If short segments (dialogue, etc.) belong to the same scene, merge with adjacent segments
- `start_time`/`end_time` use the FULL timeline (part offset applied)
- **Zero-gap timeline rule**: scene N's `end_time` MUST equal scene N+1's `start_time`. If there's a gap, CapCut export drops the image and audio in that gap.
- **SRT full-coverage rule**: Every SRT subtitle interval MUST be covered by some scene. Do not drop any SRT entry. Silent gaps between SRT entries MUST be absorbed into adjacent scenes — no holes.

**General splitting rules:**
- **A scene MUST NOT exceed 15 seconds** (keep viewer attention)
- Split by content-level transitions (place, time, action, emotion change)
- Even the same place → split into separate scenes on emotion/action change
- Distinguish dialogue-centered scenes from description-centered scenes
- Average ~10 s per scene (for a 28-minute video, ~150–250 scenes)

**Full-timeline part offset calculation:**
```
setup: 0
rising: ffprobe(final_setup.mp3) cumulative
crisis: setup + rising
resolution: setup + rising + crisis
```

**Review (substep 6-2)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 6-3. 5 rounds exceeded → escalate to user.

### 6-3. Storyboard CSV review (subagent, max 5 rounds)

The subagent **reads the generated references.csv and scenes.csv directly with the Read tool** and cross-checks.

**No program / code cross-check**: use the Read tool and visual inspection only.

```
┌─ subagent: read CSV files + script + SRT directly → cross-check
│     ▼
│  Revisions needed? → YES → apply revisions → re-review (loop)
│                   → NO  → exit loop
│
│  ※ Max 5 rounds. If exceeded, escalate to user.
└─────────────────────────────────────
```

**references.csv review criteria:**
1. Are all characters from the script included? (no misses)
2. Are all places from the script included? (no misses)
3. Do English prompts match the script's descriptions of characters/places?
4. Is period detail accurate (clothing, architecture, props)?
5. Are required keywords (`solo, single person`, `no modern clothing`, `no modern elements`) included?

**scenes.csv review criteria:**
1. Are ALL scenes in the script included? (no misses)
2. Does each `subtitle` match the SRT / script?
3. Do `start_time`/`end_time` match the timeline JSON?
4. Do `characters` match the actual characters in that scene?
5. Does `scene_tag` exactly match a place name in references.csv?
6. Does no scene exceed 15 seconds?
7. Does the English prompt accurately describe the scene's mood and action?
8. **Gap check**: Is scene N's `end_time` == scene N+1's `start_time`? A gap > 0.5 s is an error.
9. **Coverage check**: First scene `start_time`=0, last scene `end_time`=total audio duration (`ffprobe`)?
10. **Duration sum check**: Sum of all scene durations == total audio duration? (if there are gaps, sum < audio length)

**Required validation immediately after scene CSV creation (auto-run):**

Immediately after creating the scene CSV, run the checks below. If any fail, revise the scene CSV.

```bash
# 1. Gap check
python3 -c "
import csv
with open('{title}_scenes.csv') as f:
    scenes = list(csv.DictReader(f))
gaps = []
for i in range(len(scenes)-1):
    gap = float(scenes[i+1].get('start_time',0)) - float(scenes[i].get('end_time',0))
    if gap > 0.5:
        gaps.append((i+1, i+2, round(gap,2)))
if gaps:
    print(f'{len(gaps)} gaps found!')
    for a,b,g in gaps: print(f'  scene{a}->{b}: {g}s')
else:
    print('No gaps')
"

# 2. Coverage check (first scene=0, last scene=audio length)
python3 -c "
import csv, subprocess
with open('{title}_scenes.csv') as f:
    scenes = list(csv.DictReader(f))
first_start = float(scenes[0]['start_time'])
last_end = float(scenes[-1]['end_time'])
audio_dur = float(subprocess.check_output(
    ['ffprobe','-v','quiet','-show_entries','format=duration','-of','csv=p=0','media/final_full.mp3']
).strip())
print(f'First start: {first_start}s (expected 0)')
print(f'Last end: {last_end:.1f}s')
print(f'Audio length: {audio_dur:.1f}s')
diff = abs(last_end - audio_dur)
print(f'Coverage OK (diff {diff:.1f}s)' if diff < 5 else f'Coverage mismatch! diff {diff:.1f}s')
"

# 3. Duration sum check
python3 -c "
import csv
with open('{title}_scenes.csv') as f:
    scenes = list(csv.DictReader(f))
total = sum(float(s.get('end_time',0)) - float(s.get('start_time',0)) for s in scenes)
print(f'Scene sum: {total:.1f}s ({total/60:.1f}min)')
"
```

**Output files**: `references.csv`, `{title}_scenes.csv`

**Review (substep 6-3)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to the next Wave. 5 rounds exceeded → escalate to user.

---

## Wave review summary
Each substep above enforces max-5-round review with auto-advance on 0 issues. Wave 6 completes when the last substep's review passes. Escalate to user if any substep exceeds 5 rounds.
