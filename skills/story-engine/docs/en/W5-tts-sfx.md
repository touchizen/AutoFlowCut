# W5: TTS / SFX + Timecode Validation

This document is the W5 (TTS / SFX generation + timecode validation) stage guide for the story-engine skill — dark-history genre.

Uses the narration / dialogue / SFX data extracted in W4 to generate audio.

---

## TTS provider options (overview)

Generate narration and per-character dialogue from the extracted script using TTS. The table below is an overview of provider options; the actual execution order is **5-0 → 5-1**.

**TTS provider options** (user selects):

| Provider | API | Credentials | Notes |
|----------|-----|-------------|-------|
| **ElevenLabs** | `https://api.elevenlabs.io/v1/text-to-speech` | `~/.elevenlabs/credentials` | Multilingual, custom voices, automatic SRT generation |
| **Typecast** | `https://api.typecast.ai/v1/text-to-speech` | `~/.typecast/credentials` | Emotion parameters (normal/happy/sad/angry); Korean-strong |
| **Vrew** | Local app (manual) | — | AI subtitles + editor, free credits |
| **Google AI Studio** | `https://generativelanguage.googleapis.com/v1beta/models` | `~/.google-ai-studio/credentials` | Gemini TTS; to be integrated later |

> Current default: **ElevenLabs** (narration + per-character voice separation supported)
> Switch providers on user request.

---

## 5-0. Character voice assignment (MANDATORY before any TTS call)

**Run this step BEFORE any TTS generation if the script contains character dialogue.**

1. **Extract unique characters** from `dialogs_{part}.json` (all parts combined). De-duplicate by character name.
2. **Load existing mappings** from memory (`tts_settings.md`). Separate characters into:
   - **Mapped**: already has a voice ID assigned
   - **Unmapped**: new character — voice ID missing
3. **If any unmapped characters exist → STOP and ask the user.** Use `AskUserQuestion` with:
   - Character name + short personality hint from the script (age, role, tone)
   - 3–4 recommended voice options from ElevenLabs voice library matching the character (gender, age range, style)
   - "Let me choose manually" option — user provides a voice ID
4. **Apply choices** — write the new mappings back to `tts_settings.md` with format:
   ```
   narrator: nucVFUFVgPmKHjgXNbJ7   # Aaron — deep documentary
   Reverend: oR4uPy4PQZyMPPPpXrX5   # stern middle-aged male
   Mercy:    EXAVITQu4vr4xnSDxMaL   # young female
   ```
5. **Confirm with user** — show the full mapping table before proceeding to 5-1.

**Narration voice setting (applies to mono-narrator scripts too):**
- Dark-history narration: prefer grave, slow, slightly gravelly voices with clean diction
- If no `narrator` entry exists in `tts_settings.md`, ask the user in the same AskUserQuestion call as above.

---

## 5-1. TTS voice generation

**mp3 + SRT generated together (required):**

When using ElevenLabs TTS, mp3 and SRT MUST be generated **at the same time**.

- **API endpoint**: `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps`
- The response contains audio (base64) + character-/word-level timestamps
- Timestamps are used to build a per-segment SRT
- The SRT is the basis for SFX timecode calculation

**Never generate only mp3 and skip the SRT.** Without an SRT, SFX timecodes cannot be calculated precisely.

**Fallback (if only mp3 exists):**
- Measure each segment mp3 duration with ffprobe and accumulate to compute timecodes → build SRT
- `ffprobe -v quiet -show_entries format=duration -of csv=p=0 {mp3}`

**Manual subtitle splitting (required):**

The SRT MUST be **split by hand, by meaning units** — not by code. Auto-splitting breaks on meaningless boundaries and lowers quality.

1. Write `subtitles_{part}.txt` manually
2. Format: `[segmentNumber|type:character] subtitle1|subtitle2|subtitle3`
3. Use `|` as the delimiter; keep each subtitle ≤ 42 chars (English subtitle norm)
4. `generate_srt.py` takes this file + the timestamp JSON → SRT

```
# Example (subtitles_setup.txt)
[000|N] In the winter of sixteen ninety-two,|a letter arrived at Hartford parish|that no one would ever forget.
[001|D:Reverend] Read it again, boy.|Read it slowly.
```

- N = narration, D:CharacterName = dialogue
- Segment number matches the file index in `segments_{part}/`

**Generated files:**
- `segments_{part}/` — per-segment mp3 + JSON timestamps
- `segments_{part}.json` — segment metadata
- `subtitles_{part}.txt` — manual-subtitle-split source
- `timeline_{part}.json` — per-segment start/end times (cumulative)
- `final_{part}.mp3` — ffmpeg concat merge
- `final_{part}.srt` — meaning-unit subtitles (from manual split)

**Output:** `segments_{part}/{idx:03d}_{character}.mp3` + `.json` + `final_{part}.srt`

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
   - `node generate_sfx.cjs manifest.json sfx/`

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

## 5-3. Full-audio merge + SFX timecode conversion

Merge the four parts' `final_{part}.mp3` and `final_{part}.srt` into `media/`. Convert SFX files from per-part to full-timeline timecodes and save to `media/sfx/`.

**mp3 merge:**
```bash
# merge_all.txt
file 'final_setup.mp3'
file 'final_rising.mp3'
file 'final_crisis.mp3'
file 'final_resolution.mp3'

ffmpeg -y -f concat -safe 0 -i merge_all.txt -c copy media/final_full.mp3
```

**SRT merge:**
- Add each preceding part's cumulative length as offset to each part's SRT timecodes
- Measure each `final_{part}.mp3` length with `ffprobe` to compute offsets
- Renumber subtitles from 1 continuously

**Full SFX timecode conversion:**
- Measure each part's `final_{part}.mp3` length with ffprobe → compute per-part offsets
- Convert per-part timecodes in `sfx/` originals to full-timeline timecodes
- Save converted files to `media/sfx/`

```bash
# Example per-part offsets (ep10)
# setup: 0s, rising: 395s (6:35), crisis: 776s (12:56), resolution: 1379s (22:59)
# sfx/13_marketplace_0201.mp3 (rising 2:01 = 121s)
# → media/sfx/13_marketplace_0836.mp3 (395 + 121 = 516s = 8:36)
```

**Final output:**
- `media/final_full.mp3` — full audio (setup + rising + crisis + resolution concatenated)
- `media/final_full.srt` — full subtitles (offsets applied)
- `media/sfx/*.mp3` — SFX (MMSS timecodes on the full timeline)

**Review (substep 5-3)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to substep 5-4. 5 rounds exceeded → escalate to user.

---

## 5-4. SFX timecode mechanic validation (W5 internal consistency only)

**Only the checks possible at W5 are performed here — the "scene match" check depends on `scenes.csv` (a W6 output), so it is moved out and runs at the start of W8 8-0 (pre-audio-import) — see `docs/{lang}/W8-assembly.md`.**

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

**Review (substep 5-4)** — subagent self-review → list issues → revise. Max 5 rounds. 0 issues → proceed immediately to the next Wave. 5 rounds exceeded → escalate to user.

---

## Wave review summary
Each substep above enforces max-5-round review with auto-advance on 0 issues. Wave 5 completes when the last substep's review passes. Escalate to user if any substep exceeds 5 rounds.
