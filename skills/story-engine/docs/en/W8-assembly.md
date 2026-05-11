# W8: Assembly (audio import + CapCut + video)

This document is the W8 (Assembly) stage guide for the story-engine skill — shared across all genres (yadam / dark-history / bespoke); genre-specific filenames & tone live in the meta-prompts under `meta-prompts/{genre}/`.

**Run only after W7 (image production) completes with user sign-off.**

W7 was the expensive wave (Google Flow credits). W8 is the free / low-cost assembly wave — audio import, CapCut export, optional video generation. This split gives a natural break point right after image QA: if the user wants to redo images, no assembly work is wasted.

---

## 8-0. SFX scene-match validation (REQUIRED before W8-1 re-import / W8-2 export)

W5-4 could not depend on `scenes.csv` (a W6 output), so it only ran mechanic validation (collision / range / per-part offset). This step performs the scenes.csv-based scene-match validation — the natural moment is right before W8-1's idempotent re-import and W8-2's CapCut export, since any scene-match failure may require regenerating SFX and therefore a fresh re-import.

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

## 8-1. Audio import — idempotent re-import (safety net for W5-5)

In the current pipeline, **audio is imported at W5-5** (after W5-4 mechanic
QA passes). W5-5 is best-effort — the app may have been offline, or the user
may have switched to another episode in the meantime. **W8-1 issues the same
import POST idempotently** so the app is guaranteed to be looking at THIS
episode's audio package before CapCut export runs.

⚠ **Why not just check `/api/audio-reviews`?** That GET returns the app's
currently-loaded reviews regardless of folder; a non-empty result might be
leftover state from a previous episode. The only reliable way to ensure the
app is on this episode's package is to call `/api/audio-import` with the
explicit folder path.

**W8-1 protocol:**

1. **Precondition** — `media/final_full.mp3` MUST exist on disk. Missing → escalate; W5 did not complete.
2. **Voices folder reorganization** (if dialogue present, and not already reorganized by W5-5) — idempotent shell loop that creates per-character subfolders. Re-running on already-organized voices is a no-op.
3. **Import POST** — call `/api/audio-import` with the episode folder path. The app loads (or re-loads, if same path) the audio package.
4. **Refresh + flag handling** — POST `/api/audio-refresh` to rescan and auto-unflag any regenerated files. Any remaining flagged entries surface in the W8-1 review report.

After step 3, the app is guaranteed to be on THIS episode's audio, regardless of whether W5-5 ran successfully.

**Import targets (episode folder):**
```
ep{number}/
└── media/
    ├── final_full.mp3           ← full narration audio (hook + setup + rising + crisis + resolution merged in that order; hook starts at t=0)
    ├── final_full.srt           ← full subtitles (offsets applied — hook subtitles are the first block)
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

**Auto-create voices/ subfolders (idempotent — safe to re-run):**
After TTS, extract character name from filenames and auto-create subfolders.
W5-5 normally does this first; W8-1's re-run must be a true no-op when the
root has no loose `*.mp3` left (post-W5-5 state). Portable form works in
both bash and zsh:
```sh
cd ep{number}/media/voices && find . -maxdepth 1 -type f -name '*.mp3' \
  | while read -r f; do
      char=$(echo "$f" | sed 's|^\./[0-9]*_\([^_]*\)_.*|\1|')
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

# Refresh audio reviews — rescans the currently-loaded package + auto-unflags
# regenerated files. The endpoint operates on the app's currently-loaded
# audio package (set by the preceding `/api/audio-import` POST), so no body
# is required; any payload is ignored by the server.
curl -s -X POST http://localhost:3210/api/audio-refresh
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
