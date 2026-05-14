# W8: Assembly (audio import + CapCut + video)

This document is the W8 (Assembly) stage guide for the story-engine skill — dark-history genre.

**Run only after W7 (image production) completes with user sign-off.**

W7 was the expensive wave (Google Flow credits). W8 is the free / low-cost assembly wave — audio import, CapCut export, optional video generation. This split gives a natural break point right after image QA: if the user wants to redo images, no assembly work is wasted.

---

## 8-0. SFX scene-match validation (REQUIRED before audio import)

> **Skip this substep entirely when `production_scope.sfx: false` OR `media/sfx/` is absent.** With no SFX produced there is nothing to validate. Proceed directly to 8-1 (audio import). (Audio import only ingests audio that exists on disk, so the absence of SFX tracks is fine.)

W5-4 could not depend on `scenes.csv` (a W6 output), so it only ran mechanic validation (collision / range / per-part offset). This step performs the scenes.csv-based scene-match validation — the natural moment is right before audio import.

```python
# 1. Parse timecodes (MMSS / HHMMSS) from media/sfx/ filenames
# 2. Read per-scene start_time / end_time from scenes.csv
# 3. Verify each SFX timecode falls within some scene's [start_time, end_time]
#    → any SFX that doesn't land in any scene = orphan SFX (fail)
# 4. (Cross-check) Look up each anchor narration from 08_sfx_list.md in media/final_full.srt
#    → verify the scene containing that SRT span matches the scene found via the SFX timecode
# 5. On mismatch → fix anchor / placement / offset in 08_sfx_list.md → re-run W5-2
```

**Validation items:**
- Each SFX timecode ∈ some scene's [start_time, end_time] in scenes.csv (±0.5s tolerance)
- No orphan SFX (every `media/sfx/*.mp3` falls within a scene)
- (Cross-check) Scene found via anchor narration ↔ scene found via SFX timecode must match

**STATE.md update:**
- step: `W08_sfx_scene_match_qa`
- Record after scene-match validation passes

Only proceed to 8-1 import once this validation passes.

**Review (substep 8-0)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 8-1. 5 rounds exceeded → escalate to user.

---

## 8-1. Audio import (narration + SFX)

Import the W5-generated audio files into AutoFlowCut.
After import, narration / SFX will auto-land on the timeline when you export to CapCut.

> **AudioTab SFX prompts** — from W5-5 onward, the AudioTab in AutoFlowCut surfaces each SFX clip's anchor narration, placement, English prompt, and duration inline (parsed from `08_sfx_list.md`). Use this to QA SFX without cross-referencing the markdown by hand.

**Import targets (episode folder):**
```
ep{number}/
└── media/
    ├── final_full.mp3           ← full narration audio
    ├── final_full.srt           ← full subtitles
    ├── voices/                  ← per-character dialogue TTS (per-character subfolders required)
    │   ├── Reverend/
    │   │   ├── setup_003_Reverend_000109.mp3
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
After TTS, move flat mp3 files into character-named subfolders under `ep{number}/media/voices/<character>/`. **The canonical location is `media/voices/`** (filesystem.js's audio-import expects that layout — see comment at line 934). W5-1f writes to flat `ep{number}/voices/` for convenience, so this step relocates them into `media/voices/<char>/`.

Filenames are `{part}_{order:03d}_{character}_{HHMMSS}.mp3` (produced by W5-1f). The regex below accepts the new prefixed form AND the older unprefixed form (`{order}_{character}_{HHMMSS}.mp3`) so existing episodes still work.

```bash
ep_dir="ep{number}"
dest="$ep_dir/media/voices"
mkdir -p "$dest"
# Source candidates: ep/voices/ (W5 default) and ep/media/voices/ (in case some files were already relocated but still flat).
# Walk both — files already under <char>/ subdirs are untouched (the *.mp3 glob only matches flat).
for src in "$ep_dir/voices" "$dest"; do
  [ -d "$src" ] || continue
  for f in "$src"/*.mp3; do
    [ -e "$f" ] || continue   # nothing to do if already subfoldered
    base=$(basename "$f")
    # Filename: [{part}_]{order:03d}_{character}_{HHMMSS}.mp3
    # Anchor on the 3-digit order and 6-digit HHMMSS to pull the character out.
    char=$(echo "$base" | sed -E 's/^(.*_)?[0-9]{3}_([^_]+)_[0-9]{6}\.mp3$/\2/')
    mkdir -p "$dest/$char"
    mv "$f" "$dest/$char/"
  done
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

**Review (substep 8-1)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 8-2. 5 rounds exceeded → escalate to user.

---

## 8-2. CapCut export

After both image (W7) and audio (8-1) are imported, export to CapCut.
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

**Review (substep 8-2)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 8-3. 5 rounds exceeded → escalate to user.

---

## 8-3. Video generation (optional — user approval REQUIRED)

Add motion to scene images to produce video clips (Image-to-Video, Google Flow API).

**Optional — costs additional money; MUST get user confirmation before running.** If editing directly in CapCut, this step can be skipped.

```
🛑 AskUserQuestion: "Shall I start per-scene video generation? ~{N} scenes, expected cost: ..."
   - "Yes" → run AutoFlowCut's video mode
   - "No / Skip" → skip 8-3 and advance to W9 (edit directly in CapCut)
```

- If user approves → run AutoFlowCut's video mode
- If user wants to handle it themselves → skip
- Export similarly — run only after user confirmation

**Review (substep 8-3)** — when video gen runs: subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to the next Wave (W9). 5 rounds exceeded → escalate to user. If 8-3 was skipped, no review.

---

## Wave review summary
Substeps 8-0 through 8-3 enforce max-5-round review with auto-advance on 0 issues. When the last substep passes, Wave 8 completes and hands off to W9 (upload info). Escalate to user if any substep exceeds 5 rounds.

(Sections moved here from old W7 7-2c / 7-2d / 7-3. SFX scene-match validation moved here from old W5-4.)
