# Phase Plan — Split Hook into a Standalone W3 Output

**Status**: planned (not started)
**Owner**: TBD
**Estimated effort**: 1–2 working days end-to-end (planning included)
**Risk level**: Medium — cascades through W3 → W8

---

## Motivation

Hook is the single highest-leverage element of every video (the 30s
retention gate). Today the hook lives inside `part1_setup.md`, which:

1. Forces the writer to keep the hook craft in the same head-space as
   the paced narrative of Setup. Hook style (sensory / teaser /
   flash-forward) ≠ Setup style (paced establishment). Same-file =
   genre bleed; writers default to "Long ago…" openings.
2. Makes it impossible to A/B test or re-spin the hook without
   re-running the entire part1 generation (and downstream TTS for
   part1).
3. Buries the hook quality discussion: reviewers reading `07_review.md`
   often don't notice when the hook is the actual weak link, because
   it's one paragraph inside a longer file.

Separating the hook into its own file fixes all three.

Spec contradiction this also resolves:
- `docs/en/W3-writing.md` says "Hook → Setup → Rising → Crisis → Resolution"
- `meta-prompts/dark-history/screenplay_guidelines.md` says
  "Act I → II → III → IV → Hook" (Hook last)
After this split, the wave doc will codify Hook-last as the structural
rule (writer drafts hook only after seeing the full story).

---

## Scope

### In scope
- Add a 5th W3 output file: `{title}_hook.md` (yadam: `{title}_hook.md` or `{title}_훅.md` — TBD)
- Re-order W3 sub-steps: hook is written LAST, after 4 parts.
- W4 extracts narration/dialogue/SFX from hook too: `narration_hook.txt`, `dialogs_hook.json`, hook section in `08_sfx_list.md`
- W5 TTS pipeline handles `hook` part: `segments_hook/`, `final_hook.mp3`, `timeline_hook.json`
- W5-3 merge: 4-part merge → **5-part merge** (hook + 4 parts) producing `media/final_full.mp3` and `media/final_full.srt`
- W6 scenes.csv: hook scenes use full-timeline timecodes anchored at 0:00 (hook is first in the merged audio)
- W7: scene generation includes hook scenes (same flow, just an extra "part")
- W8: CapCut export includes hook segment at the start of the timeline

### Out of scope
- Migrating existing finished episodes (yadam ones already in production).
  Decision: existing eps stay on the 4-part schema; new eps from this
  release onward use 5-output. Add genre-version field to STATE.md.
- UI / generator changes outside story-engine pipeline.
- Renaming `part` token internally (we keep `part_{N}` for parts 1–4
  and add `hook` as a sibling, not `part_0`).

---

## Cascade map (file/area impact)

| Wave | File / Spec | Change |
|---|---|---|
| W3 | `docs/{lang}/W3-writing.md` | Writing order updated; output list grows to 5 files; sub-step decomposition table adds `W3-5 hook-write` after `W3-1..4`. |
| W3 | `meta-prompts/{genre}/screenplay_guidelines.md` | Already says hook-last; cross-reference the new hook file. |
| W3 | `workflows/execute-pipeline.md` | Wave I/O table: hook file added to outputs. Filename convention section updated. |
| W4 | `docs/{lang}/W4-extraction.md` | Extract narration/dialogue/SFX from hook file too. |
| W4 | `workflows/execute-pipeline.md` | I/O table: add `narration_hook.txt`, `dialogs_hook.json`. |
| W5 | `docs/{lang}/W5-tts.md` + scripts | `generate_tts_*.cjs` invoked for hook part. `merge_audio.cjs` handles 5 inputs. SFX timeline math anchors hook at t=0. |
| W5 | `workflows/execute-pipeline.md` | "W5-3 4-part merge" → "W5-3 5-part merge (hook + 4)". I/O table additions. |
| W6 | `docs/{lang}/W6-csv.md` + scripts | scenes.csv generator: hook scenes get timeline anchored at 0:00; part1 timeline shifts by hook duration. `timeline_hook.json` consumed alongside timeline_{1..4}.json. |
| W7 | (no spec change) | Generator processes hook scenes from scenes.csv same as part scenes — no special-case in W7 itself. |
| W8 | `docs/{lang}/W8-assembly.md` + CapCut export | First segment in CapCut timeline = hook. Audio import order: hook → part1..part4. |
| Pipeline | `STATE.md` schema | Add `hook_written_at` audit line (parallel to wave_started/wave_completed). |
| Tests | `tests/story-engine/*` (if any exist) | Update fixtures with 5-output W3, 5-part W5. |

---

## Implementation phases

### Phase 1 — Spec + W3 (day 1 morning)
1. Update `execute-pipeline.md`:
   - Wave I/O table for W3 (add 5th output)
   - Sub-step decomposition: `W3-1..4 part-write × 4, W3-5 hook-write, W3-6 self-review, W3-7 external-review, W3-8 polish`
   - Filename convention notes per genre
2. Update `docs/en/W3-writing.md` + `docs/ko/W3-writing.md`:
   - Writing order: `Setup → Rising → Crisis → Resolution → Hook (W3-5) → Review`
   - File structure: 5 output files
   - Rationale (hook needs full story view)
3. Subagent prompt: instruct W3 subagent to output hook as separate file in W3-5.

**Verification**: spec-only changes; no code yet. Re-read for internal consistency.

### Phase 2 — W4 + W5 pipeline (day 1 afternoon)
1. W4: subagent extracts from hook file too. Test with one episode.
2. W5: TTS for hook → `segments_hook/`, `final_hook.mp3`, `timeline_hook.json`.
3. W5-3: update `merge_audio.cjs` to take 5 inputs (hook + 4 parts). SFX manifest anchor logic: hook anchors stay at `t=0..hook_duration`; part1 anchors shift by `+hook_duration`; part2 by `+hook_duration+part1_duration`, etc.

**Verification**: end-to-end one episode through W5. Assert `final_full.mp3` duration ≈ sum of 5 parts; SFX placements visually inspected on waveform.

### Phase 3 — W6/W7/W8 + CapCut (day 2 morning)
1. W6: scenes.csv generator reads `timeline_hook.json` first, then `timeline_{1..4}.json`. Each scene gets a `full_timeline_start` computed against the merged track.
2. W7: scene generation walks scenes.csv as-is — hook scenes are just rows.
3. W8: CapCut export places hook segment at start. Audio track import order: hook → 1 → 2 → 3 → 4.

**Verification**: export one episode to CapCut, open, confirm visual timeline matches expected (hook first).

### Phase 4 — Migration + tests + docs (day 2 afternoon)
1. STATE.md schema: `hook_written_at` audit line.
2. Episode-genre-version field: existing episodes flagged as `schema: v1`, new as `schema: v2`. Pipeline branches on schema field.
3. Update tests (if any). Add new unit test for 5-part merge math in W5-3.
4. Update `TODO.md`, mark phase complete.

**Verification**: re-run one old episode through `/story-resume` — should follow v1 schema and not crash. Run one new episode through full pipeline — v2 schema, hook separate.

---

## Decisions to make before starting

1. **Hook filename** — `{title}_hook.md` (English everywhere) vs `{title}_훅.md` for yadam (Korean) vs `00_hook.md` (number-prefixed like 01_analysis.md). Recommendation: `{title}_hook.md` (English) consistent across genres — matches dark-history's `partN` ASCII filename rule.
2. **Hook duration target** — typical cold open is 15–30s. Should W2 synopsis set an explicit target, or leave it free-form? Recommendation: synopsis specifies "Hook target: 20s ± 5s".
3. **Hook scene count** — how many scenes (W6/W7) does the hook get? Today chapter 1 is the hook and gets ~3–5 scenes. Recommendation: hook = 2–4 scenes, distinct from chapter 1's "world introduction" scenes.
4. **Re-spin command** — does Path B unlock a future `/story-rewrite --hook-only` command? Recommendation: yes, scope it as a follow-up after this phase lands.

---

## Risk register

| Risk | Mitigation |
|---|---|
| W5-3 merge math wrong → audio/SFX desync | Phase 2 verification step explicitly checks waveform alignment for one full episode before moving on. |
| Existing episodes break when resumed | `schema: v1` flag in STATE.md branches the pipeline. Old eps follow old code path verbatim. |
| Writer still buries the hook craft inside the file | Subagent prompt explicitly instructs: hook file must contain ONLY the cold-open ≤ 30s of content. Review checklist verifies. |
| CapCut export confused by 5 audio tracks | Test one full export to confirm. If CapCut requires concat, we still merge to single `final_full.mp3` — only the SFX manifest needs 5 anchors. |

---

## Open questions

- Should hook be re-generatable independently in the existing `/story-rewrite` flow? (Likely yes — separate file makes this trivial.)
- Does the 20-chapter synopsis framework need to add a Chapter 0 (Hook) row, or keep Chapter 1 as the hook?
- For bespoke genre, does the reference-script synthesis (W1-5) need a hook-specific section in `_meta_supplement.md`?

These are not blockers — answer during Phase 1 spec work.
