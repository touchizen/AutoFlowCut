# W5: TTS / SFX + Timecode Validation

This document is the W5 (TTS / SFX generation + timecode validation) stage guide for the story-engine skill — dark-history genre.

Uses the narration / dialogue / SFX data extracted in W4 to generate audio.

---

## TTS provider options (overview)

Generate narration and per-character dialogue from the extracted script using TTS. The table below is an overview of provider options; the actual execution order is **5-0 → 5-1**.

**TTS provider options** (user selects):

| Provider | Bundled script | Modes | Credentials | Notes |
|----------|---------------|-------|-------------|-------|
| **ElevenLabs** | `generate_tts_elevenlabs.cjs` | narration | `~/.elevenlabs/credentials` | Multilingual; with-timestamps alignment |
| **Typecast** | `generate_tts_typecast.cjs` | narration + dialogue | `~/.typecast/credentials` | Korean-strong; with-timestamps alignment; emotion params (normal/happy/sad/angry) |
| **Vrew** | (none — local app, manual) | — | — | AI subtitles + editor; free credits |
| **Google AI Studio** | (none — TBD) | — | `~/.google-ai-studio/credentials` | Gemini TTS |

**Supported combos** (unified alignment shape — downstream is provider-agnostic):
- **EL only**: 5-1a EL narration → no dialogue
- **EL + TC**: 5-1a EL narration → 5-1f TC dialogue
- **TC only (narration + dialogue)**: 5-1a TC narration → 5-1f TC dialogue
- **Vrew narration + TC dialogue**: user imports Vrew mp3+srt as `final_{part}.mp3` / `.srt` → 5-1f TC dialogue. No segments dir, so each dialog must carry an explicit `start` in dialogs.json (`after_paragraph` cannot be auto-resolved).

> **Unsupported**: "TC dialogue-only (no narration)" — there is no master timeline source for W6+ (scenes.csv / SRT matching can't anchor). If you really need it, the user must author a master `final_{part}.mp3/.srt` externally and feed it in, then run 5-1f.

---

## 5-0. Character voice assignment (MANDATORY before any TTS call)

**Run this step BEFORE any TTS generation if the script contains character dialogue.**

### 5-0-prep. Provider selection (do this first)

Use `AskUserQuestion` to settle the two tracks separately:

1. **Narration provider**: ElevenLabs / Typecast / Vrew (external import)
2. **Dialogue provider**: Typecast / (no dialogue)
   - The bundle currently ships a **Typecast-only dialogue script** (`generate_tts_typecast.cjs dialogue`). There is no bundled ElevenLabs dialogue path.
   - If you picked Typecast in #1, dialogue uses the same provider naturally. If you picked ElevenLabs in #1, dialogue falls back to Typecast — or rewrite the script so it has no dialogue.

The choice routes 5-0 voice recommendations:
| Provider | voice ID format | Recommendation source |
|----------|-----------------|----------------------|
| ElevenLabs | 22-char alphanumeric (e.g. `nucVFUFVgPmKHjgXNbJ7`) | ElevenLabs voice library + `/v1/voices` API |
| Typecast | `tc_` prefix (e.g. `tc_6800a387534948f191cc952b`) | Typecast `/v1/voices` API |

> **No mixing**: feeding a Typecast voice_id to the ElevenLabs script returns 401 (and vice versa). Match provider exactly.

### 5-0-assign. Per-character voice assignment

1. **Extract unique characters** from `dialogs_{part}.json` (all parts combined). De-duplicate by character name.
2. **Load existing mappings** from memory (`tts_settings.md`). Separate characters into:
   - **Mapped**: already has a voice ID assigned
   - **Unmapped**: new character — voice ID missing
3. **If any unmapped characters exist → STOP and ask the user.** Use `AskUserQuestion` with:
   - Character name + short personality hint from the script (age, role, tone)
   - 3–4 recommended voices from **the provider chosen in 5-0-prep** (gender, age range, style)
   - "Let me choose manually" option — user provides a voice ID
4. **Apply choices** — write the new mappings back to `tts_settings.md`. `narrator` may be either EL or TC, but **every character (dialogue) entry MUST be Typecast (`tc_*`)** because the bundled dialogue script is Typecast-only — non-`tc_` IDs are rejected before any API call:
   ```
   # narrator option A (ElevenLabs):
   narrator: nucVFUFVgPmKHjgXNbJ7          # Aaron — deep documentary

   # narrator option B (Typecast):
   # narrator: tc_6800a387534948f191cc952b # Taewoo — grave, deliberate

   # Characters (all tc_*):
   Reverend: tc_6731b3ac075b04a944644234   # stern middle-aged male
   Mercy:    tc_677f2aa4a854ddffa0ebda89   # young female
   ```
5. **Confirm with user** — show the full mapping table including each entry's provider before proceeding to 5-1.

**Narration voice setting (applies to mono-narrator scripts too):**
- Dark-history narration: prefer grave, slow, slightly gravelly voices with clean diction
- If no `narrator` entry exists in `tts_settings.md`, ask the user in the same AskUserQuestion call as above.

---

## 5-1. TTS voice generation (5-step: narration is automatic, only meaning-unit refinement is manual)

**Principle:** mp3 + baseline SRT both fall out of the **automatic TTS step**. Meaning-unit splitting is an **optional refinement** the user applies on top of the baseline.

> **Script path (used by every W5 script step — 5-1a~f + 5-2 SFX):**
>
> Every bundled script invoked in W5 (5-1a~f for TTS / subtitles / merge, plus 5-2 for SFX) is called via an absolute path into the **installed skill bundle**, so it works regardless of cwd. Pick the line that matches **your shell** — every command in W5 then reuses it.
>
> | Shell | SCRIPT_DIR setup | Reference in commands |
> |-------|------------------|----------------------|
> | **bash** (macOS / Linux / Windows Git Bash / WSL) | `SCRIPT_DIR="$HOME/.claude/skills/story-engine/scripts"` | `"$SCRIPT_DIR/..."` |
> | **PowerShell** (Windows) | `$SCRIPT_DIR = "$HOME/.claude/skills/story-engine/scripts"` | `"$SCRIPT_DIR/..."` (same as bash — PowerShell also expands `$VAR` and accepts forward slashes) |
> | **cmd.exe** (Windows) | `set SCRIPT_DIR=%USERPROFILE%\.claude\skills\story-engine\scripts` | `"%SCRIPT_DIR%\..."` (backslash + `%VAR%`) |
>
> Every W5 command below is written as a **single-line invocation** (sidesteps the per-shell line-continuation difference).
> - **bash / PowerShell**: paste as-is
> - **cmd.exe**: substitute `$SCRIPT_DIR` → `%SCRIPT_DIR%` and `/` → `\` first, then paste
>
> If you want to break a long command for readability, the per-shell continuation chars are: bash/Git Bash `\` · PowerShell backtick (`` ` ``) · cmd `^`. They don't cross-translate, so the doc keeps everything on one line.
>
> The repo-relative path `skills/story-engine/scripts/` only works in dev mode and breaks in installed environments — do NOT use it.

### 5-1a. Narration TTS — pick a provider (ElevenLabs or Typecast)

**ElevenLabs:**
```bash
node "$SCRIPT_DIR/generate_tts_elevenlabs.cjs" ep{N}/narration_{part}.txt ep{N}/segments_{part}/ <narrator_voice_id>
```

**Typecast:**
```bash
node "$SCRIPT_DIR/generate_tts_typecast.cjs" narration ep{N}/narration_{part}.txt ep{N}/segments_{part}/ <narrator_voice_id>
```

**Outputs (identical for both providers):** `segments_{part}/seg_NNN.mp3` + `seg_NNN.json` (character-level alignment, ElevenLabs-compatible shape) + `index.json`

> Both providers emit a unified alignment format, so 5-1b onward runs identically regardless of provider.

### 5-1b. Auto-draft baseline subtitles
```bash
node "$SCRIPT_DIR/draft_subtitles.cjs" ep{N}/segments_{part}/ ep{N}/subtitles_{part}.txt
```
**Outputs:** `subtitles_{part}.txt` (each subtitle ≤ 42 chars, split at sentence/clause boundaries)
**Format:** `[NNN|N] subtitle1|subtitle2|subtitle3` (N = narration, D:CharacterName = dialogue)

### 5-1c. Build baseline SRT (+ timeline JSON)
```bash
node "$SCRIPT_DIR/build_srt.cjs" ep{N}/segments_{part}/ ep{N}/subtitles_{part}.txt ep{N}/final_{part}.srt ep{N}/timeline_{part}.json
```
**4th arg `timeline_{part}.json` REQUIRED** — input for W6's scenes.csv builder. W6 will block without it.

**Outputs:** `final_{part}.srt` (alignment-accurate timecodes) + `timeline_{part}.json` (per-segment cumulative start/end times — consumed by W6).

### 5-1d. User review (optional refinement)
- Read the baseline SRT and check whether the cuts respect meaning units
- Looks good → continue
- Needs adjustment → edit `subtitles_{part}.txt` by hand (merge or split chunks with `|`) → re-run 5-1c

> **Auto-split chooses clause boundaries but doesn't know your emphasis.** Touch only when something reads wrong; otherwise keep the baseline.

### 5-1e. Merge segment mp3s → per-part mp3
```bash
node "$SCRIPT_DIR/merge_audio.cjs" ep{N}/segments_{part}/ ep{N}/final_{part}.mp3
```
**Outputs:** `final_{part}.mp3` (ffmpeg concat driven by `segments_{part}/index.json`)

### 5-1f. Per-character dialogue TTS (Typecast — only when dialogue exists)
```bash
node "$SCRIPT_DIR/generate_tts_typecast.cjs" dialogue ep{N}/dialogs_{part}.json ep{N}/voices/ ep{N}/tts_settings.md ep{N}/segments_{part}/
```
**4th arg `ep{N}/segments_{part}/`** — segments dir from 5-1a. Required for `after_paragraph` → start auto-derivation. Without it, every dialog must carry an explicit `start` field in dialogs.json.

**Outputs:** `voices/{order:03d}_{character}_{HHMMSS}.mp3` + `result.json`
- The `_HHMMSS` in the filename is each line's start time (used for auto-placement in W8)
- start resolution (inside the script):
  1. Explicit `start` in `dialogs.json` (SRT-format string) — used as-is
  2. `after_paragraph` in `dialogs.json` + `paragraph_idx` lookup in `segments_{part}/index.json` → cumulative ffprobe duration + 0.3s gap → start
  3. Neither → **throws** (no silent `00:00:00` collisions)
- Emotion is auto-mapped from each dialog's `emotion` field (normal/happy/sad/angry)
- Vrew case (no segments dir): populate `start` for every dialog in `dialogs.json` and omit the 4th arg

**Final outputs (per part):**
- `segments_{part}/` — narration segment mp3s + alignment + index.json (with `paragraph_idx`)
- `subtitles_{part}.txt` — baseline (or refined) subtitle-split spec
- `final_{part}.mp3` — per-part merged audio
- `final_{part}.srt` — per-part SRT (alignment-accurate)
- **`timeline_{part}.json`** — per-segment cumulative start/end (input for W6 scenes.csv — W6 will block without it)
- `voices/` — per-character dialogue mp3s (optional, only if dialogue exists)

**Review (substep 5-1)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 5-2. 5 rounds exceeded → escalate to user.

---

## 5-2. SFX generation

Generate sound effects based on the SFX list extracted in W4.

**SFX provider:** ElevenLabs Sound Generation API
```
API: https://api.elevenlabs.io/v1/sound-generation
Credentials: ~/.elevenlabs/credentials
```

**SFX filename timecode rule (AutoFlowCut integration):**

SFX files are automatically overlay-placed on the timeline by AutoFlowCut. The number **after the last `_`** in the filename is parsed as the timecode.

| Digits | Format | Example filename | Meaning |
|--------|--------|------------------|---------|
| 4 | `MMSS` | `bell_toll_0134.mp3` | 01 min 34 sec |
| 6 | `HHMMSS` | `wind_ruins_010056.mp3` | 1 h 00 min 56 sec |

- The timecode is the absolute time on the full audio (final mp3)
- AutoFlowCut's `parseTimecodeFromFilename()` parses it automatically
- SFX files without a timecode are not placed on the timeline

**How to compute timecodes (SRT-anchor based):**

Look up each SFX cue's **anchor narration** (from W4's `08_sfx_list.md`) in `final_{part}.srt` to determine the timecode.

1. Parse `final_{part}.srt` into a list of `(start_ms, end_ms, text)` entries
2. For each SFX cue, find the SRT entry whose text contains the `anchor narration` (substring match)
   - **0 matches or 2+ matches → escalate immediately** (do NOT guess a position)
3. Apply the placement rule to get the **in-part** timecode:
   - `before N sec` → `SRT_start - N sec`
   - `concurrent` → `SRT_start`
   - `after N sec` → `SRT_end + N sec`
   - **Bounds check**: the resulting timecode must satisfy `0 ≤ timecode ≤ ffprobe(final_{part}.mp3) duration`. Negative or beyond-part-duration → escalate immediately (anchor / placement / offset must be adjusted)
4. This value is the **in-part timecode** — use it as the `_MMSS` in the `sfx/` filename (part offset is added only in 5-3)
5. Build a `generate_sfx.cjs` manifest from the SRT lookup results, then run it:
   ```json
   [{"num":1,"part":"setup","filename":"01_bell_toll_0030","prompt":"...","duration":3}]
   ```
   - `filename` already contains the in-part `_MMSS` timecode → `generate_sfx.cjs` uses it as-is
   - `node "$SCRIPT_DIR/generate_sfx.cjs" manifest.json sfx/`

**Unmatched anchor handling:**
- 0 matches or 2+ matches → fix the anchor in W4's `08_sfx_list.md` to a shorter, more unique phrase, then re-run (do NOT guess a position)

**SFX directories (two stages):**

1. **`sfx/`** — per-part timecoded originals (generated by `generate_sfx.cjs`)
   - Filename's `_MMSS` is measured against that part's `final_{part}.mp3`
2. **`media/sfx/`** — full-timeline originals (converted after 5-3 merge)
   - Filename's `_MMSS` is measured against `final_full.mp3`
   - AutoFlowCut import uses these files

**Full-timecode conversion:**
```
Part start time = cumulative ffprobe lengths of each final_{part}.mp3
Full timecode = part offset + in-part timecode
e.g.) Rising SFX at 2:01 → setup 6:35 + 2:01 = 8:36 full
```

```
sfx/                              ← originals (per-part)
├── 01_bell_toll_0030.mp3
├── 13_marketplace_0201.mp3       ← rising part @ 2:01
└── ...

media/sfx/                        ← final (full timeline)
├── 01_bell_toll_0030.mp3         ← setup 0:30 unchanged
├── 13_marketplace_0836.mp3       ← rising 2:01 → 8:36 full
└── ...
```

**SFX data structure:**
```python
# (number, part, filename, anchor_narration, placement, offset_sec, english_prompt, duration_sec)
(1, "setup", "01_bell_toll",
 "the church bell struck", "concurrent", 0,
 "Distant church bell tolling slowly in a medieval village at dusk", 3)
```

**Output:** `sfx/{filename}_{per-part timecode}.mp3` → after merge: `media/sfx/{filename}_{full timecode}.mp3`

**Review (substep 5-2)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 5-3. 5 rounds exceeded → escalate to user.

---

## 5-3. Full-audio merge + SFX timecode conversion (5-part)

Merge the **five parts**' `final_{part}.mp3` and `final_{part}.srt` into
`media/`. Merge order — `hook` first, then the four narrative parts in their
genre-canonical order:
- **yadam**: `hook → 기 → 승 → 전 → 결`
- **dark-history & bespoke**: `hook → setup → rising → crisis → resolution`

Hook leads the full timeline at offset 0. Convert SFX files from per-part to
full-timeline timecodes and save to `media/sfx/`.

**mp3 merge:**
```bash
# merge_all.txt
file 'final_hook.mp3'
file 'final_setup.mp3'
file 'final_rising.mp3'
file 'final_crisis.mp3'
file 'final_resolution.mp3'

ffmpeg -y -f concat -safe 0 -i merge_all.txt -c copy media/final_full.mp3
```

**SRT merge:**
- Add each preceding part's cumulative length as offset to each part's SRT timecodes
- Measure each `final_{part}.mp3` length with `ffprobe` to compute offsets (hook first)
- Renumber subtitles from 1 continuously

**Full SFX timecode conversion:**
- Measure each part's `final_{part}.mp3` length with ffprobe → compute per-part offsets
- Hook part's offset is `0` (it starts the full timeline)
- Convert per-part timecodes in `sfx/` originals to full-timeline timecodes
- Save converted files to `media/sfx/`

```bash
# Example per-part offsets (ep10 with hook = 22s)
# hook: 0s, setup: 22s (0:22), rising: 417s (6:57), crisis: 798s (13:18), resolution: 1401s (23:21)
# sfx/13_marketplace_0201.mp3 (rising 2:01 = 121s)
# → media/sfx/13_marketplace_0858.mp3 (417 + 121 = 538s = 8:58)
```

**Final output:**
- `media/final_full.mp3` — full audio (hook + setup + rising + crisis + resolution concatenated)
- `media/final_full.srt` — full subtitles (offsets applied)
- `media/sfx/*.mp3` — SFX (MMSS timecodes on the full timeline)

**Review (substep 5-3)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 5-4. 5 rounds exceeded → escalate to user.

---

## 5-4. SFX timecode mechanic validation (W5 internal consistency only)

**Only the checks possible at W5 are performed here — the "scene match" check depends on `scenes.csv` (a W6 output), so it is moved out and runs at the start of W8 8-0 (before CapCut export / verify-import) — see `docs/{lang}/W8-assembly.md`.**

**Items checked in W5-4 (do NOT require scenes.csv):**
1. **Collision** — If 3 or more SFX pile onto the same timecode, fail (CapCut track explosion)
2. **Per-part range** — Each `sfx/` original timecode must satisfy `0 ≤ tc ≤ final_{part}.mp3` duration (re-checks the 5-2 boundary rule)
3. **Full range** — `media/sfx/` timecodes must not exceed `final_full.mp3` length
4. **Per-part offset** — `sfx/` original per-part timecode + part offset = `media/sfx/` full timecode (consistency of the W5-3 conversion)

**Validation script (example):**
```python
# Parse timecodes from both sfx/ and media/sfx/ filenames (last _MMSS / _HHMMSS suffix)
# 1. Collision: if ≥3 SFX within ±1s of the same timecode in media/sfx/ → fail
# 2. Per-part range: every sfx/{part}/* timecode must satisfy 0 ≤ tc ≤ ffprobe(final_{part}.mp3) → fail otherwise
# 3. Full range: every media/sfx/* timecode must be ≤ ffprobe(media/final_full.mp3) → fail otherwise
# 4. Offset: for each sfx/ file, (part_offset + in-part timecode) MUST equal the media/sfx/ timecode
```

**On validation fail:**
- Collision / range fail: update the anchor, placement, or offset for the offending SFX in W4's `08_sfx_list.md` → re-run 5-2 timecode computation
- Offset mismatch: check the 5-3 conversion script (part offset calculation error)
- Re-validate → loop until pass

**Moved to W8 (for reference):**
- **Scene match** — Each SFX timecode must fall within some scene's `[start_time, end_time]` in `scenes.csv`, plus a cross-check against the anchor narration. `scenes.csv` is a W6 output, so this check cannot run in W5. → See `docs/{lang}/W8-assembly.md` "8-0 SFX scene-match validation".

**STATE.md update:**
- step: `W05_sfx_timecode_qa`
- Record after mechanic validation passes (scene-match recorded separately in W8)

**Review (substep 5-4)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 5-5. 5 rounds exceeded → escalate to user.

---

## 5-5. Audio import (best-effort, post-mechanic-QA)

Runs **only after W5-4 mechanic QA passes**. Importing earlier risks the user
listening to audio with broken timecodes / out-of-range SFX; importing after
W5-4 guarantees the user reviews a mechanically-clean audio package while
W6 (CSV) and W7 (image generation) run in parallel.

**Voices folder reorganization** (if dialogue present) — must happen
before the API call so character subfolders are created. Idempotent so
W8-1 can re-run safely. **Portable** — works in bash AND zsh (uses
`find`, not glob expansion):
```sh
cd ep{number}/media/voices && find . -maxdepth 1 -type f -name '*.mp3' \
  | while read -r f; do
      char=$(echo "$f" | sed 's|^\./[0-9]*_\([^_]*\)_.*|\1|')
      mkdir -p "$char"
      mv "$f" "$char/"
    done
```
After all root-level `*.mp3` are moved into character subfolders, the
`find` returns empty and the loop is a true no-op on re-run.

**API call (single POST):**
```bash
curl -s -X POST http://localhost:3210/api/audio-import \
  -H "Content-Type: application/json" \
  -d '{"folderPath": "/path/to/project/story/ep{number}"}'
```

**Best-effort semantics:**
- App offline / network error / non-2xx → log a one-line warning and continue. Do NOT block the wave or retry. W8-1 issues the same POST idempotently as the safety net.
- Successful import → emit ONE chat line to the user:
  `🎧 Audio imported — review in the AutoFlowCut Audio tab while W6/W7 run.`

**Why best-effort, not mandatory:** the in-app audio review is an
optimization (parallel feedback). The pipeline still produces correct
outputs even if no user review ever happens. W8-1 re-imports
idempotently regardless of whether W5-5 succeeded.

**Re-import on regeneration:** if the user flags audio in the Audio tab
during W6/W7 and triggers regeneration of any segment, W5-5 (or W8-1's
idempotent import) MUST be re-run after the regenerated output lands so
the app reflects the latest audio package.

**No new file artifacts.** The import side effect lives in the app's state
(`.audio_review.json` is written by the app, not by W5).

**Review (substep 5-5)** — pass-through: this is a side-effect step, not a content step. No review loop; either succeeded (continue) or warned (continue, W8-1 covers).

---

## Wave review summary
Each substep above enforces max-5-round review with auto-advance on 0 issues. Wave 5 completes when the last substep's review passes. Escalate to user if any substep exceeds 5 rounds.
