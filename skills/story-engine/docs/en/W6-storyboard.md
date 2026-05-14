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

> **W6 invokes no external scripts.** `scenes.csv` is built directly via **AutoFlowCut MCP tools** (`get_schema`, `load_csv`, `update_field`, `save_csv`) using W5's `final_{part}.srt` + `timeline_{part}.json` as inputs.

---

## Storyboard CSV generation (SRT-based)

> **This stage can only run after W5 (TTS/SFX).**
> `scenes.csv`'s `start_time`/`end_time` are derived from SRT timecodes and timeline JSON.
> Without the SRT, precise scene boundaries are impossible.

**Input data:**
- `final_{part}.srt` — per-part subtitles (meaning units, with timecodes)
- `timeline_{part}.json` — per-segment start/end times
- Original script (setup/rising/crisis/resolution .md files)
- **`voices/result_{part}.json`** (when dialogue exists; one file per part = up to 4 total) — W5-1f output. Each entry has `{order, character, line, emotion, file, duration, start}`. The `start` field is the **TTS-resolved start, including consecutive-dialogue stacking** (computed by `generate_tts_typecast.cjs`'s `groupEnd` tracker — each subsequent dialog in the same `after_paragraph` group is pushed past the previous dialog's measured duration + 0.2 s gap). Note: `start` is **per-part** (each part starts from 0) — W6 converts to full-timeline by applying part offsets (see [Full-timeline part offset calculation] below). Primary speaker→timecode source when `options.splitOnSpeakerChange: true`.
- **`voices/*_{HHMMSS}.mp3`** (when dialogue exists) — the filename's `HHMMSS` token is the per-part resolved start (TC form). If `voices/result_{part}.json` is missing, speaker (`character` token) + per-part start can be recovered from filename alone (duration from ffprobe). **Caveat**: filenames carry no part prefix, so if the same character speaks at the same per-part timecode in two parts, file names collide — prefer `result_{part}.json` in that case.
- `dialogs_{part}.json` + `segments_{part}/index.json` (when present) — W4/W5 intermediate output. **Fallback only**: accurate for single-dialog-per-paragraph cases (match `after_paragraph` against `paragraph_idx` to get the base start), but **cannot account for consecutive-dialogue stacking within the same `after_paragraph`**. Prefer `voices/` when available.

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

**Speaker-change splitting (optional, options.splitOnSpeakerChange):**

Read `options.splitOnSpeakerChange` at the root of W_progress.json and branch:
- If `true`: every speaker-change boundary becomes a scene-split candidate **only when a timecoded speaker source exists** (see priority list below).
  - Example: if A→B→A speak within the same 5-second window, split into 3 scenes
  - Subject to the 15s cap; short greetings (1–2 seconds) merge into the adjacent speaker's scene (subagent's judgment)
  - **Narration-only intervals** (no dialogue entries, only `narration_{part}.txt`) have no speaker-change candidates → existing rules apply
- If `false` (default) or field missing → keep the existing rules (within the same time window / same scene, different speakers stay in one scene)

**Speaker source priority** (when `true`, apply top-down):
1. **`voices/result_{part}.json`** — **primary source**. One file per part. Each entry's `start` is W5-1f's TTS-resolved value (reflects consecutive-dialogue stacking). `character` is the speaker ID; `duration` gives the end time. The `start` is per-part — add the W6 part offset to convert to full-timeline. When this file exists, split without falling back to inference.
2. **`voices/*_{HHMMSS}.mp3` filename parse** — when `result_{part}.json` is absent but the mp3 files exist, recover speaker + per-part resolved start from filenames (`{order}_{character}_{HHMMSS}.mp3`); compute duration with ffprobe. Determine which part each mp3 belongs to from file mtime or by matching `{order, character}` against `dialogs_{part}.json`.
3. **`dialogs_{part}.json` + `segments_{part}/index.json`** (fallback) — match `dialogs.after_paragraph` against `paragraph_idx` to derive a base start. **Accurate only for single-dialog-per-paragraph cases; consecutive dialogues in the same paragraph cannot be stacked here**. Use only when both `voices/` outputs are absent AND the paragraph has exactly one dialog.
4. **Explicit speaker labels in the script (`{title}_*.md`)** — `"A:"`, `"Narrator:"`, `"{name}:"`. Only when 1–3 are unavailable. Re-map the label paragraph to a timeline timecode via `segments_index.paragraph_idx` (paragraph-granularity only).
5. **Contextual inference** — only when 1–4 are all unavailable. Conservative: if confidence is low, do not split. If 1 through 5 are ALL unavailable, `splitOnSpeakerChange: true` has no real effect — record `voices/result_*.json + dialogs_{part}.json absent — speaker-change splitting skipped` in the review notes.

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

**scenes.csv review — batch QA × 3 parallel** (10 items, 3-3-4 grouping)

A single subagent given 10 items will skim and check off rather than truly audit. Split into 3 focused groups and **spawn in parallel** (see SKILL.md "Batch QA discipline").

Each group writes to a unique review file: `_story_source/06_review_groupA.md`, `_groupB.md`, `_groupC.md`.

**[Group A — Completeness] (3 items, read-only: script / SRT / scenes.csv)**
1. Are ALL scenes in the script included? (no misses)
2. Does each `subtitle` match the SRT / script?
4. Do `characters` match the actual characters in that scene?

**[Group B — Reference integrity] (3 items, read-only: scenes.csv / references.csv / timeline JSON)**
3. Do `start_time`/`end_time` match the timeline JSON?
5. Does `scene_tag` exactly match a place name in references.csv?
7. Does the English prompt accurately describe the scene's mood and action?

**[Group C — Timing structure] (4 items, subagent reads scenes.csv directly)**

⚠ **Group C uses the same subagent + Read pattern as Groups A and B.** The Python pre-check scripts at the end of 6-2 (gap / coverage / duration) are a SEPARATE automated sanity check — NOT a substitute for this QA. "Script passed, so OK" is forbidden — the subagent must read the CSV directly and visually verify.

6. Does no scene exceed 15 seconds? (subagent inspects every row's duration column)
8. **Gap check**: Is scene N's `end_time` == scene N+1's `start_time`? > 0.5 s = error (subagent compares adjacent row pairs directly)
9. **Coverage check**: First scene `start_time`=0, last scene `end_time`=total audio duration. (Subagent may consult ffprobe output but makes the call itself)
10. **Duration sum check**: Sum of all scene durations == total audio duration (subagent computes the sum directly or cross-checks an aggregate against the CSV)

**Orchestrator spawns 3 subagents concurrently** (one message, 3 `Agent` calls):
- Each group writes ONLY its own review file (06_review_group{A,B,C}.md)
- Do NOT touch STATE.md / W_progress.json — orchestrator merges after all return
- All groups must pass 0 issues → 6-3 advances
- Any group exceeds 5 rounds → entire wave escalates

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
