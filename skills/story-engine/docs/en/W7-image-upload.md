# W7: Image / Video + QA + CapCut

This document is the W7 (image/video generation + QA + CapCut export) stage guide for the story-engine skill — dark-history genre.

---

## Image / video generation

**Run only after W6 (storyboard CSV) is complete.**

### 7-0. Project creation (AutoFlowCut)

Create an AutoFlowCut project before loading the CSV.

1. Check existing projects
2. Propose a project name to the user and get confirmation:
   - Suggested format: `{channel}_ep{number}` (e.g., `darkhistory_ep10`)
   - If an existing project exists, ask whether to reuse it
3. On user confirmation, create the project

```
AutoFlowCut MCP: app_list_projects → check existing projects
Ask user: "Shall I create the AutoFlowCut project as '{channel}_ep{number}'?"
AutoFlowCut MCP: app_create_project({ name: "confirmed_name" }) → create
```

Project management tools:
- `app_list_projects` — list projects
- `app_create_project` — create project (auto-generates directory + project.json)
- `app_rename_project` — rename project
- `app_delete_project` — delete project (irreversible)

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

### 7-2b. Full image QA (references + scenes)

After all image generation completes, run quality review against script / scenes / prompts.

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

2. Inspection checklist (applied to every scene):
   - Missing image: no imagePath or file doesn't exist
   - Style mismatch: photorealistic image mixed in (should match chosen style)
   - Character clothing consistency: same character but different clothing
   - Character count mismatch: script says 2 but there are 3; should be solo but two
   - Emotion mismatch: sad scene but subject is smiling; tense scene but subject is calm
   - Background mismatch: interior/exterior, day/night differs from script
   - Props mismatch: key props (ledger, candle, letter, etc.) missing
   - Period mismatch: modern elements (glass windows, electric lights) leaked in

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

### 7-2c. Audio import (narration + SFX)

After image QA, import the W5-generated audio files into AutoFlowCut.
When you later export to CapCut, narration / SFX will auto-land on the timeline.

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

---

## Review loop
Up to 5 rounds. If 0 issues, proceed immediately to the next Wave. If 5 rounds are exceeded, escalate to the user.
