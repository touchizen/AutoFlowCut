# W5: TTS / SFX + Timecode Validation

This document is the W5 (TTS / SFX generation + timecode validation) stage guide for the story-engine skill — dark-history genre.

Uses the narration / dialogue / SFX data extracted in W4 to generate audio.

> **`production_scope` gate (read at startup).** The W5 subagent reads `STATE.md` `## Decisions` for a `production_scope:` block (see `workflows/execute-pipeline.md` "STATE.md schema — production_scope block" for the full spec). Missing block → fallback `{ dialogue: true, sfx: true }` (current behavior preserved). The two flags route the branching at 5-0-assign, 5-1f, 5-2, 5-3, and 5-4 — see the per-substep skip conditions below. **File absence is equally authoritative** — if `dialogs_{part}.json` or `08_sfx_*.md` is not on disk, the corresponding substep auto-skips (empty file vs missing file are NOT distinguished).

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

### 5-0-prep + key preflight (MANDATORY before 5-0-assign)

**After provider selection is settled (and AFTER the `production_scope` block has been read at W5 startup)**, the subagent runs a **key preflight loop** so missing or stale API keys are surfaced BEFORE any expensive work begins (W1–W4 outputs are not wasted on a credentials failure deep inside W5).

> **v1 = manual-assisted preflight.** The subagent reads / validates keys and guides the user to the right credentials file path, but **does NOT write the credentials file itself**. The user pastes the key into `~/.<provider>/credentials` manually (one line, dotenv format) and the subagent re-validates. Auto-persist is a deferred follow-up.

**Step 1 — compute the required-key set from provider choices + `production_scope`.** Start empty, then add:

| Narration choice | Dialogue choice | `production_scope.sfx` | Required keys |
|------------------|-----------------|------------------------|---------------|
| ElevenLabs       | Typecast        | true                   | ElevenLabs + Typecast |
| Typecast         | Typecast        | true                   | Typecast + ElevenLabs (for SFX) |
| ElevenLabs       | (no dialogue)   | true                   | ElevenLabs |
| Vrew (external)  | Typecast        | true                   | Typecast + ElevenLabs (for SFX) |
| Typecast         | (no dialogue)   | true                   | Typecast + ElevenLabs (for SFX) |
| Vrew (external)  | (no dialogue)   | true                   | ElevenLabs (for SFX only) |
| (any narration)  | (any)           | **false**              | (drop the ElevenLabs-for-SFX entry) |

**`production_scope.dialogue: false`** drops the dialogue-side Typecast requirement, BUT it does NOT drop Typecast if narration is Typecast — narration is mandatory. Likewise, **`production_scope.sfx: false`** drops the ElevenLabs-for-SFX requirement; if no other slot in the row uses ElevenLabs, ElevenLabs is not in the required set at all.

Final rule: **the required set is the union of {narration provider} ∪ {dialogue provider when `production_scope.dialogue: true`} ∪ {ElevenLabs when `production_scope.sfx: true`}**. Vrew has no key (local app) and contributes nothing.

**Step 2 — for each provider in the required set, validate.** Try `readApiKey(provider)` first (env var → credentials file fallback; already implemented in `lib_afc.cjs` for `elevenlabs` and `typecast`). Then issue a cheap GET to confirm the key actually authenticates:

| Provider | Method | URL | Header | Success | Failure (bad key) | Signup URL (shown on miss) |
|----------|--------|-----|--------|---------|-------------------|----------------------------|
| ElevenLabs | GET | `https://api.elevenlabs.io/v1/voices` | `xi-api-key: <key>` | 200 | 401 | `https://elevenlabs.io/app/speech-synthesis/api-keys` |
| Typecast | GET | `https://api.typecast.ai/v1/voices` | `x-api-key: <key>` | 200 | 401 | `https://app.typecast.ai/api-keys` |
| Google AI Studio (Gemini) | GET | `https://generativelanguage.googleapis.com/v1beta/models?key=<key>` | (key in URL) | 200 | 400 / 403 | `https://aistudio.google.com/app/apikey` |

> Gemini is **documented here for forward-compat only** — the bundled `lib_afc.cjs` `readApiKey()` does NOT yet support `gemini`, and no bundled W5 script consumes a Gemini key today. If a future provider choice selects Gemini, the preflight loop is structurally identical (same three classify-and-remediate branches), but the v1 bundle will block on it. Use the env-name / credentials-path placeholders below as the forward-compatible target.

All three validation endpoints are read-only and free (no usage charge for `GET /voices` or `GET /models`). Each call should complete in < 1 s. Treat 5xx as "validation skipped, proceed with warning" — do NOT block the pipeline on transient infra; let the actual TTS call surface a more specific failure if it recurs.

**Step 3 — classify each result and emit user-facing chat lines.** Print one banner per provider so the user sees the heartbeat:

```
▸ Validating ElevenLabs API key…
✅ ElevenLabs key OK
▸ Validating Typecast API key…
⚠ Typecast key missing (~/.typecast/credentials)
  [paste / open-file / switch-to-elevenlabs-for-dialogue]
```

Three buckets, three branches:

- **Found + validates (200)** → mark provider OK, continue to the next provider in the required set.
- **Not found (no env var, no credentials file)** → "first-time setup" remediation menu (see Step 4).
- **Found but 401 / 403** → "stale/invalid key" remediation menu (Step 4). Chat opener:
  `⚠ Typecast key at ~/.typecast/credentials returned 401. Likely expired or wrong account.`

**Step 4 — remediation menu (AskUserQuestion).** Same four options for both miss and stale; only the chat opener differs:

| Option | What the subagent does |
|--------|------------------------|
| **(a) "I have a key — I'll paste it into the credentials file"** | Print the exact path (`~/.<provider>/credentials`) + the exact line format (`<ENVNAME>=<value>`, mode 0600). Wait for user confirmation. Re-run Step 2 validation for this provider. **v1: user pastes manually; the subagent does NOT write the file.** |
| **(b) "Show me where to get a key"** | Print the provider's signup URL (verbatim from the table above) + a one-line hint on where the key lives in the provider's dashboard. Loop back to (a) when user has it. |
| **(c) "Switch to a different provider"** | Re-open the W5-0-prep AskUserQuestion (narration or dialogue, whichever slot is unfilled). Recompute the required-key set from Step 1 with the new choice. Re-validate from Step 2. |
| **(d) "I'll set it up myself, retry later"** | Print the credentials file path and pause the pipeline. On `/story-resume`, re-run Step 2 for the missing providers. |

Every option ends with a one-line reminder of where credentials live:

```
Credentials file: ~/.<provider>/credentials (dotenv format: <ENVNAME>=...; chmod 0600)
```

**Credentials path + env-name reference (verbatim — shown to user on miss):**

| Provider | Env var name | Credentials file path |
|----------|--------------|-----------------------|
| ElevenLabs | `ELEVENLABS_API_KEY` | `~/.elevenlabs/credentials` |
| Typecast | `TYPECAST_API_KEY` | `~/.typecast/credentials` |
| Google AI Studio (Gemini) | `GOOGLE_AI_STUDIO_API_KEY` (placeholder — not yet read by `lib_afc.cjs`) | `~/.google-ai-studio/credentials` (placeholder — not yet read by `lib_afc.cjs`) |

**Step 5 — gate.** Proceed to 5-0-assign **only after every provider in the required set has validated OK** (no provider in the {miss, 401, transient-5xx} buckets). If the user picks (d) and the pipeline pauses, on `/story-resume` the W5 subagent re-enters this preflight loop at Step 2 for whichever providers were not yet OK.

**`production_scope` interaction (explicit):**
- **`production_scope.dialogue: false`** — drop the dialogue-side Typecast from the required set. Narration-side Typecast still counts if narration = Typecast.
- **`production_scope.sfx: false`** — drop the ElevenLabs-for-SFX requirement. If no other slot uses ElevenLabs, ElevenLabs is NOT in the required set at all (and validation for it is skipped entirely).
- Both off → the required set may be as small as {Typecast} (TC narration only) or {ElevenLabs} (EL narration only). Preflight still runs for whichever single provider is left; the loop just iterates once.

**Why preflight at W5-0-prep and not earlier:** the required-key set depends on the provider choice that happens here. Asking at `/story-new` would force keys for providers that may not actually be used this episode. Asking later (mid 5-1a) would already have wasted W1–W4. W5-0-prep is the goldilocks point.

### 5-0-assign. Per-character voice assignment

> **When `production_scope.dialogue: false`**: character voice assignment is **skipped entirely**. Only the `narrator` row is required in `tts_settings.md`. Because `dialogs_{part}.json` is absent, character extraction itself is impossible — do NOT call `AskUserQuestion` for characters. (If the narrator mapping is also missing, ask for narrator only as part of 5-0-prep.)

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

> **Skip this substep entirely when `production_scope.dialogue: false` OR `dialogs_{part}.json` is absent.** Do NOT create the `voices/` directory. Either condition is sufficient (both are authoritative). After 5-1e, proceed straight to 5-2.

```bash
node "$SCRIPT_DIR/generate_tts_typecast.cjs" dialogue ep{N}/dialogs_{part}.json ep{N}/voices/ ep{N}/tts_settings.md ep{N}/segments_{part}/
```
**4th arg `ep{N}/segments_{part}/`** — segments dir from 5-1a. Required for `after_paragraph` → start auto-derivation. Without it, every dialog must carry an explicit `start` field in dialogs.json.

**Outputs:** `voices/{part}_{order:03d}_{character}_{HHMMSS}.mp3` + `voices/result_{part}.json`
- The leading `{part}_` token (e.g. `setup_`, `rising_`, `part1_setup_`) is derived from the `dialogs_{part}.json` basename (via `derivePartFromDialogsPath`). Running 4 parts sequentially into the same `voices/` directory cannot collide — even if the same character speaks at the same per-part order + HHMMSS in two parts, each gets its own mp3, so W6 speaker-split timing and W8 audio import both stay correct.
- `result_{part}.json` is also per-part, preserving each part's dialogue metadata (start/duration/character) independently.
- **Previous version (collision-prone):** filename was `{order}_{character}_{HHMMSS}.mp3` and a single `result.json` was written → the second part would silently reuse the first part's mp3 and only the last part's `result.json` survived.
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

> **Skip this substep entirely when `production_scope.sfx: false` OR `08_sfx_list.md` is absent.** Do NOT produce `sfx/` or `media/sfx/`. Either condition is sufficient (both are authoritative). After 5-1f (or 5-1e if dialogue is also off), proceed straight to 5-3.

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

## 5-3. Full-audio merge + SFX timecode conversion

> **When `production_scope.sfx: false`**: the narration mp3/SRT merge still runs (always). The SFX timecode conversion section is a **no-op** (no `sfx/*.mp3` to convert). `media/sfx/` is not created, and the AutoFlowCut import in W8 will simply have no SFX tracks. Downstream (W6 / W8) treats absent `media/sfx/` as a normal state.

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

> **When `production_scope.sfx: false`**: the SFX cue list is empty (no `08_sfx_list.md`, no `media/sfx/`). All four checks below (collision / per-part range / full range / per-part offset) become **vacuously true**. **Early-return success** — empty cue list = pass automatically. The mechanic QA substep still runs (subagent self-review loop) and validates narration-timing-related consistency, but the SFX items trivially pass with 0/0.

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
