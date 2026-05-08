# W7: Image production (ref + scene + QA)

This document is the W7 (image production) stage guide for the story-engine skill — dark-history genre.

W7 covers **image generation** and **image QA only**. Audio import / CapCut export / video generation are now W8 (Assembly) — these used to live in W7 but were split out for responsibility clarity.

W7 is the expensive wave (Google Flow credits × 150–250 scenes). A mandatory user-signoff gate sits at the end of W7, so the user decides whether to advance to assembly after reviewing images.

---

## Image production

**Run only after W6 (storyboard CSV) is complete.**

### 7-0. Project setup (AutoFlowCut)

**Pre-check (MANDATORY — run BEFORE loading CSV or generating any images):**

1. `app_open_project({ name })` — switch the app to the target project
2. Verify: call `GET /api/current-project` (or read the `app_open_project` response) and confirm the current project name matches the target
3. If mismatch or 404 → STOP. Do NOT load CSV or start any batch. Report to user.

> **Why:** `load_csv` and all generation calls operate on whatever project is currently active in the app UI. Without this pre-check, artifacts land in the wrong project (e.g., `Untitled`).

**Project creation (if needed):**

1. Check existing projects
2. Propose a project name to the user and get confirmation:
   - Suggested format: `{channel}_ep{number}` (e.g., `darkhistory_ep10`)
   - If an existing project exists, ask whether to reuse it
3. On user confirmation, create or open the project

```
AutoFlowCut MCP: app_list_projects → check existing projects
Ask user: "Shall I create the AutoFlowCut project as '{channel}_ep{number}'?"
AutoFlowCut MCP: app_create_project({ name: "confirmed_name" }) → create (auto-switches)
  — OR —
AutoFlowCut MCP: app_open_project({ name: "existing_name" }) → switch to existing project
```

Project management tools:
- `app_list_projects` — list projects
- `app_create_project` — create project (auto-generates directory + project.json + switches to it)
- `app_open_project` — switch to an existing project (MANDATORY before CSV load)
- `app_rename_project` — rename project
- `app_delete_project` — delete project (irreversible)

**Review (substep 7-0)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 7-1. 5 rounds exceeded → escalate to user.

### 7-1. Reference image generation (AutoFlowCut)

**Explain the current situation to the user:**
- Currently loaded reference count (character / place / style)
- Note that pre-image-generation state
- Walk through the next steps (style pick → ref image generation → scene image generation)

**Style selection (two paths):**

> **When asking about style, you MUST first call `list_styles` and show the actual preset options.**
> Do NOT simply list "painterly medieval, gothic illustration..." as text. Show a table of actual presets from the MCP.
> Also tell the user they can check in-app: **AutoFlowCut app → Ref tab → Batch generate → Style picker (browse categories & previews)**

**Path A — AI drives it:** Ask the user for a style; when they answer, use the `styleId` to auto-generate
```
AutoFlowCut MCP: list_styles → fetch styles → show table to user
Ask user: "Which style? e.g., gothic illustration, medieval painterly, oil-painting realism, etched engraving..."
Also tell them: "Or open the AutoFlowCut app → Ref → Batch generate to preview styles."
User answer → map to preset id (e.g., "gothic illustration" → "gothic-illustration")
AutoFlowCut MCP: app_start_ref_batch({ styleId: "gothic-illustration" }) → auto style + ref batch
```
- Both `app_start_ref_batch` and `app_start_scene_batch` accept `styleId`
- Passing `styleId` also auto-selects it in the app's style picker UI
- If called without `styleId`, uses the currently selected style in the app

**After styleId is locked (REQUIRED): write the `type: style` row in `references.csv`**

W6 only writes character/scene rows. The `type: style` row is the exclusive responsibility of W7 (see W6 doc 6-1). Right after the user confirms a styleId, write a matching English prompt to a type:style row.

```
# Example: styleId="gothic-illustration"
AutoFlowCut MCP: update_reference_prompt({
  name: "gothic-illustration",
  type: "style",
  prompt: "Gothic illustration style, heavy chiaroscuro, dramatic candlelight, period detail, no modern elements"
})
```

This row drives style consistency across all character/scene prompts. Without it, image style becomes arbitrary.

**Path B — User drives it in-app:** the user opens Ref → Batch → pick style → Start themselves
```
AutoFlowCut MCP: app_batch_status → check status
→ If already in progress: "Generation is already running; I'll wait."
→ If already done: "Done — moving to the next step."
```

**Common:**
```
AutoFlowCut MCP: load_csv → load references.csv
Explain to user: "Loaded {N} references (character {n1}, place {n2}, style {n3}). Pre-generation state."
AutoFlowCut MCP: app_wait_batch → wait for completion
```

**Image generation modes (critical):**

| Mode | Usage | Note |
|------|-------|------|
| **Batch (required)** | AI: `app_start_ref_batch` / `app_start_scene_batch`, App: "Start" button | App handles sequential processing + delays internally |
| **Individual** | `app_generate_reference(index)` / `app_generate_scene(sceneId)` | One at a time, **must wait 7–15 s between** |

- **Use batch commands** — batch handles sequential + automatic delays; safe and efficient
- Individual calls need 7–15 s waits → inefficient for bulk → use only for retrying failures after batch
- **Never call individual generations in parallel** — they all fail

**Reference batch flow:**
```
1. Confirm style selected (list_styles → ask user, or user picks in-app)
2. Start batch:
   - AI: AutoFlowCut MCP: app_start_ref_batch({ styleId }) → style + batch
   - User: App → "Ref" → "Batch" → pick style → "Start"
3. AutoFlowCut MCP: app_batch_status → check (if already running: "Already in progress")
4. AutoFlowCut MCP: app_wait_batch → wait for completion
```

**Review (substep 7-1)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 7-2. 5 rounds exceeded → escalate to user.

### 7-2. Per-scene image generation (AutoFlowCut)

```
AutoFlowCut MCP: load_csv({ csv_path, image_dir }) → load scenes CSV (auto-passed to app)
AutoFlowCut MCP: app_get_scenes → verify scenes are loaded in the app
AutoFlowCut MCP: app_start_scene_batch({ styleId }) → start batch
  (or user clicks "Start" in the app)
AutoFlowCut MCP: app_batch_status → check status
AutoFlowCut MCP: app_wait_batch → wait for completion
```

- `load_csv` auto-passes scene data to the app (`update-scenes` IPC)
- After loading, use `app_get_scenes` to confirm the app received the scenes
- After generation, use `list_problem_scenes` to find problematic scenes and fix prompts

**Review (substep 7-2)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 7-2a. 5 rounds exceeded → escalate to user.

### 7-2a. Fixing and regenerating error scenes

After batch completion, run this if there are errors.

```
1. app_batch_status → check error count
2. HTTP: check error scene prompts (curl http://localhost:3210/api/scenes | filter errors)
3. Analyze error cause (mostly Google policy violations)
   - Violence / confinement / threat → soften (struggling → standing firm, pushed → alone in)
   - Minors → swap for adult characters or indirect depiction
   - Explicit gore → suggestive (blood on the floor → dark stain spreading on the flagstones)
4. app_update_scene({ index, fields: { prompt: "softened prompt", status: "pending", error: "" } })
5. app_start_scene_batch({ styleId }) → regenerate only pending scenes
6. Loop until error count is 0
```

### AutoFlowCut HTTP API (localhost:3210)

The HTTP API is usable alongside MCP tools. Especially good for bulk data queries / filtering.

**Query scene data:**
```bash
# All scenes (JSON array, 0-indexed)
curl -s http://localhost:3210/api/scenes

# Filter specific scenes (parse with python)
curl -s http://localhost:3210/api/scenes | python3 -c "
import json, sys
data = json.load(sys.stdin)
for i, s in enumerate(data):
    if s.get('status') == 'error':
        print(f'Scene {i+1}: {s[\"prompt\"][:100]}')
"

# Extract only error scenes
curl -s http://localhost:3210/api/scenes | python3 -c "
import json, sys
data = json.load(sys.stdin)
errors = [(i+1, s) for i, s in enumerate(data) if s.get('status') == 'error']
print(f'{len(errors)} error scenes')
for num, s in errors:
    print(f'  Scene {num}: {s[\"prompt\"][:80]}')
"
```

**Scene data fields:**
- `prompt` — English image-generation prompt
- `prompt_ko` — (unused for dark-history)
- `subtitle` — subtitle text
- `characters` — characters appearing
- `status` — `pending` | `generating` | `done` | `error`
- `imagePath` — path to generated image
- `id` — scene unique ID

**CSV export (app data → CSV file):**
```bash
curl -s http://localhost:3210/api/scenes | python3 -c "
import json, sys, csv, io
data = json.load(sys.stdin)
fields = ['prompt', 'prompt_ko', 'subtitle', 'characters', 'scene_tag', 'style_tag', 'shot_type', 'duration', 'start_time', 'end_time', 'parent_scene']
output = io.StringIO()
writer = csv.DictWriter(output, fieldnames=fields, extrasaction='ignore')
writer.writeheader()
for row in data:
    writer.writerow(row)
with open('EXPORT_PATH.csv', 'w', encoding='utf-8') as f:
    f.write(output.getvalue())
print(f'CSV saved: {len(data)} scenes')
"
```

**After modifying a prompt, ALSO update the CSV:**
1. Modify app data with MCP `app_update_scene`
2. Sync the CSV file with the export script above
3. CSV path: `{project directory}/ep{number}_scenes.csv`

**Review (substep 7-2a)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 7-2b. 5 rounds exceeded → escalate to user.

### 7-2b. Full image QA (references + scenes)

After all image generation completes, run quality review against script / scenes / prompts.

**Progress notification (required):** The subagent MUST ping the app during QA so the top-strip banner updates.
- At the start of each round: `mcp__autoflowcut__app_notify_qa({ kind, state: 'start', total, round })`
- Every 10 items checked: `mcp__autoflowcut__app_notify_qa({ kind, state: 'progress', current, total, round, issues })`
- When the round concludes: `mcp__autoflowcut__app_notify_qa({ kind, state: 'done', current: total, total, round, issues })`
- `kind` is `'ref'` for reference QA and `'scene'` for scene QA.

**Reference QA:**
```
1. app_get_references → list all references
2. Verify each reference image matches the script's character/place description
   - Character: age, gender, clothing, look (e.g., "14-year-old girl" drawn as adult?)
   - Place: period, mood (e.g., "thatched cottage" drawn as stone manor?)
3. On mismatch → modify prompt → app_generate_reference for individual regen
```

**Full scene inspection (max 5 rounds):**

ALL images must be eyeballed. No sampling — 100% coverage required.

```
1. Check image paths:
   curl http://localhost:3210/api/scenes → imagePath list
   Open images directly with the Read tool (10 at a time)

2. **Inspection checklist — batch QA × 2 parallel** (8 items, 4-4 grouping)

   8 items in one subagent = sloppy coverage across hundreds of scenes. **Spawn 2 groups in parallel** (Visual / Content).

   Each group writes to: `_story_source/07_image_review_group1.md`, `_group2.md`.

   **[Group 1 — Visual accuracy] (4 items, visual realism)**
   - Missing image: no imagePath or file doesn't exist
   - Style mismatch: photorealistic image mixed in (should match chosen style)
   - Background mismatch: interior/exterior, day/night differs from script
   - Period mismatch: modern elements (glass windows, electric lights) leaked in

   **[Group 2 — Content fidelity] (4 items, script-content match)**
   - Character clothing consistency: same character but different clothing
   - Character count mismatch: script says 2 but there are 3; should be solo but two
   - Emotion mismatch: sad scene but subject is smiling; tense scene but subject is calm
   - Props mismatch: key props (ledger, candle, letter, etc.) missing

   **Orchestrator spawns 2 subagents concurrently** (one message, 2 `Agent` calls):
   - Each group writes ONLY its own review file
   - Do NOT touch STATE.md / W_progress.json — orchestrator merges
   - Both groups pass 0 issues → 7-2b advances → enter 7-3 user gate
   - **Image regeneration is sequential** — handled in 7-2a separately. Parallel QA is read-only inspection only.

3. Summarize problems as a table:
   | Scene | Type | Detail | Fix |
   |---|---|---|---|
   | 9 | missing | no image file | regenerate |
   | 10 | clothing | Agnes wearing elaborate courtly gown | change to plain wool dress |

4. Report problem list to user → after approval:
   - **Do NOT manually `rm` image files from disk** — setting status back to pending makes the app auto-move the old image to history/
   - app_update_scene({ index, fields: { prompt: "fixed prompt", status: "pending" } })
   - app_start_scene_batch({ styleId }) → regenerate only pending scenes
   - **Editing batch_update_prompts (CSV-in-memory) alone does NOT reach the app** — you MUST use app_update_scene to send the prompt to the app

5. After regen, re-inspect only those scenes (open images with Read again)
6. Loop rounds (max 5)
7. After 5 rounds, if issues remain → give the list to user, recommend manual handling
```

**Reference full inspection (same, max 5 rounds):**
```
1. app_get_references → reference image paths
2. Open every reference image with Read
3. Same checklist (character setup, place mood, etc.)
4. On mismatch, modify prompt → app_generate_reference for individual regen
```

QA requires eyeballing images (Read tool to open the file). Do NOT judge from metadata alone.
Character clothing baseline comes from the script's character setup (references.csv).

**Review (substep 7-2b)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 7-2c. 5 rounds exceeded → escalate to user.

### 7-3. 🛑 User sign-off gate (REQUIRED before W8 assembly)

After 7-0 through 7-2b pass, image production is complete. **Stop and get user confirmation here.**

```
🛑 AskUserQuestion: "Image QA complete. Proceed to assembly (W8)?"
   - "Yes — start W8 assembly" → advance to W8
   - "I want to redo some images" → return to 7-2a / 7-2b (regen + re-QA)
   - "Pause for me to review manually" → pause pipeline, resume via /story-next
```

**Why this gate exists:**
- Image generation is the expensive wave (Google Flow credits). W8 (assembly) is free. The cost gap maps to a wave boundary.
- If images are not satisfactory, fix them BEFORE assembly, not after.
- A natural break-point where the user inspects work and decides.

After the gate passes, hand off to W8 (`docs/{lang}/W8-assembly.md`).

**Review (substep 7-3)** — no separate review loop; the user sign-off IS the review.

---

## Wave review summary
Substeps 7-0 through 7-2b enforce max-5-round review (auto-advance on 0 issues). When the last substep (7-2b image QA, batch × 2 parallel) passes, control enters 7-3 (user gate). User approval completes Wave 7 and hands off to W8.

<!-- Old 7-2c (audio import), 7-2d (CapCut export), 7-3 (video) moved to W8-assembly.md.

ARCHIVED CONTENT (kept for reference; do not execute from W7):

### 7-2c. Audio import (narration + SFX)

After image QA, import the W5-generated audio files into AutoFlowCut.
When you later export to CapCut, narration / SFX will auto-land on the timeline.

**Pre-import SFX scene-match validation (REQUIRED — moved from W5):**

W5-4 cannot run validation that depends on `scenes.csv` (a W6 output). The scene-match check runs here, immediately before audio import.

```python
# 1. Read per-scene start_time / end_time / parent_scene from scenes.csv
# 2. Map "position" in the W4 SFX list (08_sfx_list.md) → parent_scene
# 3. Parse timecodes (MMSS / HHMMSS) from media/sfx/ filenames
# 4. Verify each SFX timecode falls within [scene.start_time, scene.end_time]
# 5. On mismatch → fix_sfx_timecodes.py → re-validate → loop until pass
```

**Validation items:**
- SFX timecode ∈ [mapped scene's start_time, end_time] (±0.5s tolerance)
- No SFX falls outside any scene boundary
- Every `media/sfx/*.mp3` file is mapped to a scene (no orphan SFX)

**STATE.md update:**
- step: `W07_sfx_scene_match_qa`
- Record after scene-match validation passes

Only proceed to the import procedure below once this validation passes.

---

**Import targets (episode folder):**
```
ep{number}/
└── media/
    ├── final_full.mp3           ← full narration audio
    ├── final_full.srt           ← full subtitles
    ├── voices/                  ← per-character dialogue TTS (per-character subfolders required)
    │   ├── Reverend/
    │   │   ├── 003_Reverend_000109.mp3
    │   │   └── ...
    │   ├── Agnes/
    │   │   └── ...
    │   └── Baron/
    │       └── ...
    └── sfx/                     ← SFX (filename timecodes auto-placed)
        ├── 01_bell/
        │   ├── toll_01_0030.mp3
        │   └── ...
        └── ...
```

**Auto-create voices/ subfolders:**
After TTS, extract character name from filenames and auto-create subfolders.
```bash
cd ep{number}/media/voices && for f in *.mp3; do
  char=$(echo "$f" | sed 's/^[0-9]*_\([^_]*\)_.*/\1/')
  mkdir -p "$char"
  mv "$f" "$char/"
done
```

**Import via HTTP API:**
```bash
curl -s -X POST http://localhost:3210/api/audio-import \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "/path/to/project/story/ep{number}"}'
```

**After import:**
```bash
# Query review state
curl -s http://localhost:3210/api/audio-reviews

# Refresh audio reviews (rescan folder + auto-unflag)
curl -s -X POST http://localhost:3210/api/audio-refresh \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "/path/to/project/story/ep{number}"}'
```

**Audio review via MCP:**
- `list_audio_reviews({ folder_path })` — list flagged files
- `update_audio_review({ folder_path, relative_path, action: "flag"|"unflag", reason })` — add/remove flag

**Handling flagged audio:**
1. Play each file in the app's Audio tab
2. Flag problematic → regenerate → unflag
3. State tracked in `.audio_review.json`

**Review (substep 7-2c)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 7-2d. 5 rounds exceeded → escalate to user.

### 7-2d. CapCut export

After image QA + audio import complete, export to CapCut.
Scene images + narration + SRT subtitles + SFX auto-land on the timeline.

**Export via HTTP API:**
```bash
curl -s -X POST http://localhost:3210/api/export-capcut \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Or in-app:**
- F→V tab or Export button

**Verify export:**
- Open the project in CapCut and inspect the timeline
- Check image placement, audio sync, subtitle position
- If issues, fix in-app and re-export

**Review (substep 7-2d)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 7-3. 5 rounds exceeded → escalate to user.

### 7-3. Video generation (optional)

Add motion to scene images to produce video clips (Image-to-Video, Google Flow API).
**Optional — costs money; MUST get user confirmation before running.**
If editing directly in CapCut, this step can be skipped.

```
"Shall I start per-scene video generation? ~{N} scenes, expected cost: ..."
```

- If user approves → run AutoFlowCut's video mode
- If user wants to handle it themselves → skip
- Export similarly — run only after user confirmation

**Review (substep 7-3)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to the next Wave. 5 rounds exceeded → escalate to user.

---

END ARCHIVED — see W8-assembly.md for active versions of these substeps -->

