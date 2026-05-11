# Phase Plan — Surface SFX Prompts in AudioTab

**Status**: planned (not started)
**Estimated effort**: ~2–4 hours (app code, not just docs)
**Risk level**: Low — additive UI; no contract changes to existing audio pipeline

---

## Motivation

After W5-2 produces SFX files (`media/sfx/*_MMSS.mp3`), AudioTab plays the
clips but **does not show the prompt that generated each clip**. The user
hears a sound effect and has to mentally cross-reference `08_sfx_list.md`
to evaluate "is this prompt correct, or do I need to fix it and regenerate?"

That cross-reference is the main friction in SFX QA. If we surface the
prompt directly next to the audio clip in AudioTab, the user can:

- See **anchor narration** ("…the church bell struck") to know WHERE the cue lands
- See **English prompt** ("Distant church bell tolling slowly at dusk") to know WHAT the prompt asked for
- Hear the clip and judge fit at a glance — no doc-jumping

This pairs naturally with the W5-5 early-import work: SFX is imported
into AudioTab at W5-5, the user can now review SFX quality and prompts
**while W6/W7 run in parallel**, and any flag/regenerate decision is made
before W8 export.

---

## Decision: read-only display in v1; edit-and-regenerate is a later phase

**In scope (v1)**:
- AudioTab shows, per SFX clip:
  - `Anchor narration` (the script phrase)
  - `Placement` (before / concurrent / after, with offset)
  - `English prompt`
  - `Duration` (seconds)
- Auto-refresh when `08_sfx_list.md` or `media/sfx/` changes (file watcher already exists for `.audio_review.json` — extend)

**Out of scope (v2+, separate plan)**:
- In-app prompt editing
- One-click regenerate-this-SFX from AudioTab
- Bulk re-roll of flagged SFX

Keeping v1 read-only lets the user *evaluate* SFX prompts in AudioTab; the
existing `flag → manually fix prompt → re-run W5-2 for that cue` path stays
as the regeneration mechanism. The lift to add edit/regenerate UI is much
bigger and deserves its own design pass.

---

## Source of truth: `08_sfx_list.md`

The W4-3 output table is already the canonical SFX metadata source:

```markdown
| # | Part | Filename | Anchor narration | Placement | Offset (sec) | English prompt | Duration (sec) |
|---|------|----------|-----------------|-----------|-------------|----------------|----------------|
| 1 | setup | 01_bell_toll | "the church bell struck" | concurrent | 0 | Distant church bell tolling slowly at dusk | 3 |
```

After W5-3 timecode conversion, `media/sfx/` filenames carry the cue number
and a full-timeline `_MMSS` suffix (e.g. `01_bell_toll_0030.mp3`,
`13_marketplace_0858.mp3`). The mapping is:

```
media/sfx/<NN>_<filename>_<MMSS>.mp3   ↔   08_sfx_list.md row where `#` == NN
```

This NN ↔ row mapping is unique within an episode, so it's a reliable join
key. The `_MMSS` suffix is purely placement info (also displayable but not
needed for the join).

---

## Architecture sketch

```
Episode folder
├── 08_sfx_list.md           ← prompt metadata (markdown table)
└── media/sfx/
    ├── 01_bell_toll_0030.mp3
    ├── 13_marketplace_0858.mp3
    └── …

AudioTab loader (extension):
  1. On folder import, parse 08_sfx_list.md → array of {cue_no, part,
     filename_stem, anchor, placement, offset, prompt, duration}
  2. Build a Map<filename_stem, metadata>
  3. When rendering each SFX clip, look up by filename stem
     (strip the trailing _MMSS) → enrich the row

UI (new fields next to existing SFX row):
  ┌──────────────────────────────────────────────────────────┐
  │ 01_bell_toll_0030.mp3                           [▶ flag] │
  │ ⚓ "the church bell struck"  ▶ concurrent @ 0:00         │
  │ 💬 Distant church bell tolling slowly at dusk            │
  │ ⏱ 3s                                                     │
  └──────────────────────────────────────────────────────────┘
```

No new files in the episode folder. No changes to W4/W5/W8 wave docs.

---

## Cascade map

| Component | Change |
|-----------|--------|
| App: audio-package loader (electron / renderer) | Parse `08_sfx_list.md` when folder is imported; cache `Map<stem, meta>` keyed by the bare filename (no `_MMSS` suffix). |
| App: AudioTab SFX row component | When rendering an `media/sfx/*.mp3` row, look up metadata by stripped stem and render the four extra fields (anchor / placement / prompt / duration). Fallback to filename-only display when no match. |
| App: file watcher | Add `08_sfx_list.md` and `media/sfx/` to the existing AudioTab watcher so edits/regenerations refresh the panel without re-import. |
| `electron/main.js` `/api/audio-import` handler | Return the sfx-metadata map alongside the existing audio review payload so the renderer can render immediately on first import. |
| MCP tool `list_audio_reviews` | Optionally extend response to include the sfx metadata (read-only field). Useful for future MCP-driven QA flows. Defer unless needed. |
| `docs/{en,ko}/W8-assembly.md` | Brief note that SFX prompts are surfaced in AudioTab from W5-5 onward (no behavior change to the wave). |
| `skills/story-engine/SKILL.md` | One-line mention under "AutoFlowCut MCP 도구" or W5/W8 description: "SFX 프롬프트는 W5-5 import 후 AudioTab에서 확인 가능". |

No story-engine wave/orchestrator change required — the new field is a pure
app UX addition consuming existing artifacts.

---

## Implementation phases

1. **Markdown table parser** (~30 min) — utility in renderer or main that
   parses the W4-3 table. Tolerant: skip header row; handle missing
   columns; ignore commented-out rows.
2. **Loader hook + cache** (~30 min) — wire the parser into the
   `/api/audio-import` flow; cache the result in the audio package.
3. **AudioTab UI** (~1 hour) — extend the SFX row component; add the
   four metadata fields with the visual treatment shown above; ensure
   it gracefully degrades when metadata is missing.
4. **File watcher** (~30 min) — refresh when `08_sfx_list.md` or
   `media/sfx/` changes.
5. **Manual QA** (~30 min) — load one real episode, scroll through
   SFX list, confirm anchor/prompt visible, flag a clip, edit prompt
   manually in `08_sfx_list.md`, confirm UI refreshes.

Total: ~3 hours of focused work + plan reading time.

---

## Open questions

1. **Should the anchor narration link to the SRT position?** Future
   nice-to-have: click anchor → AudioTab jumps to that SRT cue. Not in
   v1 — keep it as plain text first.
2. **Should we color-code by category?** SFX `08_sfx_list.md` has
   categories (props / ambient / human / metal / writing / crowd /
   supernatural). Could add subtle color hints. Defer.
3. **What if `08_sfx_list.md` is missing** (SFX-skip mode from the
   production-scope-gate plan)? AudioTab simply has no SFX rows. No
   special handling needed — feature degrades cleanly.
4. **Internationalization** — prompts are English (W4-3 spec), anchor
   narrations are in episode language. UI labels need en/ko
   translation. Existing app convention applies.

---

## Risk register

| Risk | Mitigation |
|------|-----------|
| Markdown table parser breaks on user-edited rows with weird whitespace | Be tolerant: trim, allow varying column counts; skip rows that lack `Filename` field; never crash the loader on parse failure. |
| Filename ↔ row mapping drift (user manually renames an SFX file) | Display "(metadata not found)" inline; do NOT auto-match by approximate name. User can fix `08_sfx_list.md`. |
| `media/sfx/` has files NOT in `08_sfx_list.md` (e.g., manually dropped) | Show the audio row with filename-only display. Treat as orphan SFX, no metadata. |
| Performance: re-parsing on every folder switch | Cheap — `08_sfx_list.md` is < 5KB typically. Parse on import + on file-watcher trigger only. |
