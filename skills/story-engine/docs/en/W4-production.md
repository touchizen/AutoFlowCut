# W4: Production Extraction + Review

This document is the W4 (production extraction + review) stage guide for the story-engine skill — dark-history genre.

**Reference scripts** (`~/workspace/AutoFlowCut/scripts/`):

| Script | Purpose |
|--------|---------|
| `generate_tts_elevenlabs.py` | ElevenLabs TTS (narration + dialogue, with-timestamps → mp3 + SRT) |
| `generate_tts_typecast.py` | Typecast TTS (per-character dialogue, auto-timecoded filenames) |
| `generate_sfx.cjs` | ElevenLabs Sound Generation (SFX, skill-bundled — `skills/story-engine/scripts/`) |

---

## Production extraction + review

**Run only after the script has been confirmed through W3 review.** Extracting before the script is locked causes rework on every revision.

### 4-1. Narration extraction
**Narration extraction** → `narration_{part}.txt` — pure narration text (dialogue and stage directions removed)

**Review (substep 4-1)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 4-2. 5 rounds exceeded → escalate to user.

### 4-2. Per-character dialogue extraction
**Per-character dialogue extraction** → `dialogs_{part}.json` — character name, line, emotion, order

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
