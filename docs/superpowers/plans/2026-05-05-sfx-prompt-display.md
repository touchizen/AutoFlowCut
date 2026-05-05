# SFX Prompt Display — 0.9.7 Item

**Status:** Brainstorm / Direction note (not yet a full plan)
**Created:** 2026-05-05
**Target release:** 0.9.7

---

## Problem

AudioDetailModal does not show the generation prompt for SFX clips. The
ElevenLabs prompt is only present in the SFX manifest at generation time
and is **not persisted** anywhere the app can read.

- `generate_sfx.cjs` reads `[{num, part, filename, prompt, duration}]`
  from a manifest, calls ElevenLabs, writes only `*.mp3` to outDir.
- Prompt evaporates after generation — not embedded in mp3, not saved
  alongside it, not in `음향효과_추출.md` (that file has Korean
  description/usage, not the English ElevenLabs prompt).
- `AudioPanel.jsx` clipSelect builds `selectedItem` with `matchedScene`
  + `srtMatch` only; no prompt field exists in the data path.
- Voice clips don't have this issue because the SRT subtitle text serves
  as the displayed "prompt".

## Proposed direction

Reuse the existing CSV pattern (like scenes/references) and surface the
SFX prompt list at the **final step of the audio import flow** — let
the user see (and eventually edit) prompts in a CSV-like grid.

The user-facing pieces:
1. Audio import flow's last button → opens a CSV view of SFX cues
2. CSV columns: filename, timecode, duration, prompt
3. AudioDetailModal shows the prompt when clicked (read from CSV)
4. (Optional later) edit prompt in the CSV → trigger regeneration

## Open questions (resolve before planning)

1. **"가져오기 마지막 버튼"** — exact button location in current import
   UI (which component, which step) — confirm with user before planning.
2. **CSV pattern fidelity** — full grid edit (like scenes CSV) or
   read-only table view? Decides scope significantly.
3. **Row unit** — per SFX file or per manifest cue? They may differ if
   a cue maps to multiple files or vice versa.
4. **Backfill** — only new SFX going forward, or migrate existing? If
   manifest is lost, no backfill possible.

## Implementation sketch (post-decisions)

Storage layer:
- `generate_sfx.cjs` writes `<outDir>/sfx_prompts.json` (copy of
  manifest) alongside mp3s.
- `useAudioImport` reads `sfx_prompts.json` during scan, attaches
  `prompt` to each `audioPackage.sfx[].files[]` entry.

UI layer:
- New "SFX Prompts" CSV view, accessed from import flow's final step.
- `AudioPanel.jsx` clipSelect → include `selectedItem.prompt`.
- `AudioDetailModal.jsx` → render new "🎙️ Prompt" card when present.

## Why deferred (not 0.9.7 patch)

- Touches storage format (new sidecar JSON), import flow UI, and modal
  rendering — three layers, one cohesive change.
- Existing 0.9.7 release scope is closing; this is a feature addition,
  not a bugfix.

## Bigger concern (raised 2026-05-05)

> "SFX를 생성해도 맞게 여겨지기도 힘들어." — user

ElevenLabs sound-generation output quality varies; even a well-formed
prompt often produces SFX that doesn't quite "feel right" against the
target scene. This means:

- **Prompt visibility is more important than initially thought** — when
  an SFX feels off, users need to see *why* it was generated that way
  before deciding to regenerate, edit, or replace.
- A read-only prompt card may not be enough. The CSV view should
  probably be **editable + regenerate-on-save** so users can iterate.
- Long-term consideration: maybe the 1:1 prompt→file mapping is the
  wrong unit. Should the system generate **N candidates per cue** and
  let the user pick? Out of scope for this note, but worth flagging.

This elevates the feature from "nice-to-have metadata display" to
"core trust/iteration loop for the SFX pipeline."

## Alternative source: web import (raised 2026-05-05)

> "웹에서 가져오게 할 수도 있고." — user

Generation is not the only option. Allow importing SFX from free web
sources (Freesound, Pixabay SFX, ZapSplat, Mixkit, etc.) per cue. This
sidesteps the AI quality variability entirely.

Implications for the CSV/data model:

| Field | Generated | Web-imported |
|---|---|---|
| `prompt` | ElevenLabs text | (empty or original search query) |
| `source` | `'elevenlabs'` | `'web'` |
| `sourceUrl` | — | original URL |
| `attribution` | — | required for some licenses (Freesound CC) |
| `license` | — | CC0 / CC-BY / royalty-free / etc. |

UI implications:
- CSV grid needs a **source picker per row** (generate vs. web)
- Web mode → small search panel with audio preview before import
- Modal shows prompt OR source link + attribution depending on origin
- License field surfaces in export so user can compile credits

This widens the 0.9.7 scope but addresses the real problem (trust),
not just the symptom (invisible prompts). Worth deciding direction
before planning starts:

- (a) **Just prompt visibility** — minimal scope, ships fast
- (b) **Prompt visibility + edit + regenerate** — iteration loop
- (c) **Multi-source (generate + web)** — full trust solution

**User decision (2026-05-05): pursue option (c) — multi-source.**

## Inline prompt display in timeline (raised 2026-05-05)

> "목록 오른쪽은 텅 비어 있는데, 여기에 프롬프트가 있으면 보여주는게
> 좋을 것 같아." — user

Currently the expanded `_media` file rows render an empty lane (only
the parent sub-track lane shows actual clips). Reuse that empty space
to display the prompt inline, anchored to the clip's time position.

### Design (revised 2026-05-05 per user feedback)

> "클립은 상단에서 한꺼번에 보여주고 있잖아? 하단엔, 그냥 프롬프트만
> 보여주는 거지.. 생성버튼도 보여주고, 수정 가능하게 하고.." — user

**Key revision:** drop the "anchor prompt at clip.startMs" idea. Clips
are already shown bundled in the parent sub-track lane above. The
expanded file rows become a **prompt edit interface**, not another
visualization of clip positions.

**Clarification (2026-05-05):** CSV's role is **import/export only**,
not the in-app display surface. The earlier "CSV grid view" wording
conflated the two.

```
[manifest / user CSV] ──import──→ [sidecar JSON next to mp3s]
                                            ↓
                                  [inline edit UI in timeline]
                                            ↓
                                  [save to sidecar + optional CSV export]
```

CSV uses:
- Bulk seed initial prompts (from manifest, spreadsheet, prior project)
- Backup / share with collaborators
- Round-trip with external tools

The "가져오기 마지막 버튼" mentioned earlier is the entry point for
this CSV import — not a CSV display screen.

Layout per file row (height needs to grow from `FILE_ROW_H = 22` to
~40-48px to accommodate input):

```
[label col]                            [prompt-edit lane]
0:00  🎙️ 01_quill_on_paper.mp3        [ Quill scratching on parchment, intimate close-up ] [🔄]
0:01  🎙️ 03_candle_room_tone          [ Soft candle room tone, warm intimate ambience    ] [🔄]
1:32  🌐 05_harbor_new_york            🌐 freesound.org · CC-BY · "harbor 1872"             [🔍]
```

Rules:
- **No horizontal anchoring** — prompt input fills the lane left-to-right
- **Inline edit** — text input or contenteditable; commit on blur or
  Enter; saves to sidecar JSON
- **Per-row action button**:
  - Generated row: 🔄 = regenerate this single SFX with current prompt
  - Web import row: 🔍 = re-search web with original query
- **Source icon prefix in label column**: 🎙️ (generated) / 🌐 (web)
- **Regeneration state**: spinner + disabled input during API call
  (consider routing through existing `useGenerationQueue` so concurrent
  scene/ref/SFX generation stays controlled)

### Empty-prompt fallback

To avoid mixed-density rows (some with text, some blank), render a
placeholder for rows missing prompt data:

- Generated cue with lost manifest: `— prompt unavailable —`
- Web import without metadata: `— web source —`
- User can still edit the prompt later through the CSV view

### Component touch points

- `AudioTimeline.jsx` — file row renders a new `<PromptStrip>` instead
  of the empty `.atl-lane atl-lane-file`
- New CSS: `.atl-prompt-strip { position: absolute; left: <px>; ... }`
- Data: `clip.prompt`, `clip.source`, `clip.sourceUrl` carried through
  `useAudioTimeline` (need to thread these from sidecar JSON to the
  visibleTracks file items)

### Why this matters alongside the modal

The modal (option a/b) shows full detail on click. The inline strip
gives **scan-level visibility** — the user sees 30 prompts at once and
can spot the wrong one in seconds, instead of opening 30 modals.

## References

- Generator: `skills/story-engine/scripts/generate_sfx.cjs:3` — manifest
  schema doc
- Modal that should show prompt:
  `src/components/AudioDetailModal.jsx:88-102`
- Import path: `src/hooks/useAudioImport.js`
- SFX scan output structure:
  `src/utils/audioTimeline.js:116` (parseSfxTimecodes)
