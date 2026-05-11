# W4: Production Extraction + Review

This document is the W4 (production extraction + review) stage guide for the story-engine skill — dark-history genre.

**Bundled scripts** (`skills/story-engine/scripts/` — invoked from W5; W4 is text extraction only):

| Script | Purpose |
|--------|---------|
| `generate_tts_elevenlabs.cjs` | ElevenLabs TTS narration (with-timestamps → mp3 + alignment JSON) |
| `generate_tts_typecast.cjs` | Typecast TTS — `narration` mode (narration) or `dialogue` mode (per-character lines). Both return with-timestamps alignment. |
| `draft_subtitles.cjs` | Auto-draft baseline `subtitles_{part}.txt` (refine into meaning units afterward) |
| `build_srt.cjs` | alignment + `subtitles_{part}.txt` → `final_{part}.srt` |
| `merge_audio.cjs` | Concat one part's segment mp3s → `final_{part}.mp3` (W5-1e). Full **5-part** merge (hook + the four narrative parts) into `final_full.*` is a separate ffmpeg step in W5-3. |
| `generate_sfx.cjs` | ElevenLabs Sound Generation (SFX, manifest-driven) |

---

## Production extraction + review

**Run only after the script has been confirmed through W3 review.** Extracting before the script is locked causes rework on every revision.

### 4-1. Narration extraction
**Narration extraction** → `narration_{part}.txt` — pure narration text (dialogue and stage directions removed). `{part}` substitutes the genre's 5 canonical keys (see `execute-pipeline.md` Notation):
- **yadam**: `narration_hook.txt`, `narration_기.txt`, `narration_승.txt`, `narration_전.txt`, `narration_결.txt`
- **dark-history & bespoke**: `narration_hook.txt`, `narration_setup.txt`, `narration_rising.txt`, `narration_crisis.txt`, `narration_resolution.txt`

The cold-open file `{title}_hook.md` produces `narration_hook.txt` on the same contract as the four narrative parts. Hook narration extracts identically; the downstream TTS/SRT/timeline pipeline treats it as a fifth part whose only special property is being merged at offset `0` of the full timeline (see W5-3).

**Review (substep 4-1)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 4-2. 5 rounds exceeded → escalate to user.

### 4-2. Per-character dialogue extraction
**Per-character dialogue extraction** → `dialogs_{part}.json` (also produced for `part=hook` when the cold open contains dialogue; typically hook is narration-only and the file is then `[]`)

**Required fields per entry:**
| Field | Type | Notes |
|-------|------|-------|
| `order` | int | Per-part dialogue order (starts at 1; used as `{order:03d}` filename prefix) |
| `character` | string | Character name (key into the W5-0 voice map) |
| `line` | string | Dialogue text |
| `emotion` | string | Emotion label (e.g. "desperate", "stern") — Typecast's `EMOTION_MAP` auto-routes to normal/happy/sad/angry |
| **`after_paragraph`** | **int** | **0-based index of the narration paragraph that immediately precedes this line** (in `narration_{part}.txt`). W5-1f matches it against `segments_{part}/index.json`'s `paragraph_idx` to derive the timecode. |

> **`after_paragraph` is mandatory.** Without it, W5-1f cannot derive the `_HHMMSS` filename and would risk silent `00:00:00` collisions — the script throws instead. While parsing the script.md, keep a narration-paragraph counter and record the index for each dialogue.
>
> **Consecutive dialogues are OK** — multiple dialogues sharing one `after_paragraph` are auto-stacked by W5-1f in `order` sequence (previous dialog end + 0.2s gap), so they never collide. The first dialog in a group uses narration end + 0.3s; each subsequent dialog uses previous dialog end + 0.2s.

**(Optional)** `start` field — if narration was produced externally (Vrew, etc.) and you already know each line's SRT-format start time, set it here. Takes precedence over `after_paragraph`.

**Review (substep 4-2)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 4-3. 5 rounds exceeded → escalate to user.

### 4-3. SFX extraction
**SFX extraction** → `08_sfx_list.md` — list of sound-effect beats (with English prompts)

**`08_sfx_list.md` format (SRT-anchor based):**

| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | setup | 01_bell_toll | "the church bell struck" | concurrent | 0 | Distant church bell tolling slowly at dusk | 3 |
| 2 | setup | 02_door_creak | "the door swung open" | before | 0.5 | Heavy wooden door creaking open | 2 |
| 3 | rising | 03_rain | "the rain began to fall" | concurrent | 0 | Heavy rain on tiled rooftop | 4 |

**Column definitions:**
- **Anchor narration**: exact phrase from the script used to locate the SRT entry in W5
  - Must be a **short, unique phrase** that fits entirely within a single SRT entry (3–10 words recommended)
  - Avoid phrases that repeat elsewhere in the script; pick a more distinctive excerpt if needed
  - **0 matches or 2+ matches in SRT → escalate immediately** (do NOT guess a position)
- **Placement**: `before` / `concurrent` / `after`
  - `before N sec`: place N seconds **before** the anchor entry's `SRT_start` (anticipatory)
  - `concurrent`: place at `SRT_start` (SFX starts with the narration)
  - `after N sec`: place N seconds **after** the anchor entry's `SRT_end` (emphasis / reverb tail)
- **Offset (sec)**: distance to shift. Must be `0` for `concurrent`

**Review (substep 4-3)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to the next Wave. 5 rounds exceeded → escalate to user.

### Extraction review method (subagent, max 5 rounds per substep)

- The subagent **reads the script files and extraction files directly with the Read tool** and cross-checks
- **No program / code cross-check**: must use the Read tool and visual inspection
- Repeat until no revisions are needed (max 5)

### SFX categories

| Category | Examples |
|----------|----------|
| Props | counting beads, turning ledger pages, quill scratching, lock turning, snuff candle |
| Ambient | wind through bare trees, rain on rooftops, crow calls, crowded market, crickets, church bells |
| Human | breath, sigh, footsteps on gravel / flagstones / wood, robes rustling |
| Metal / doors | heavy wooden door creaking, iron latch, padlock clicking, chain dragging |
| Writing | quill scratching parchment, wax seal pressed |
| Crowd | muttering, gasps, whispered prayer, distant laughter |
| Supernatural / atmosphere (dark-history-specific) | distant thunder, wolves howling, wind through ruins, unexplained knock, chanting in Latin |

---

## Wave review summary
Each substep above enforces max-5-round review with auto-advance on 0 issues. Wave 4 completes when the last substep's review passes. Escalate to user if any substep exceeds 5 rounds.
