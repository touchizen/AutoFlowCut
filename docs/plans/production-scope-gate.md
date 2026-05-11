# Phase Plan — Production-Scope Gate (skip SFX / Dialogue TTS on demand)

**Status**: planned (not started)
**Estimated effort**: ~1 hour (spec + spec-driven wave subagent branches)
**Risk level**: Low — additive flags; defaults preserve current behavior

---

## Motivation

W5 is the second-longest wall-clock wave (after W7 image generation). Two
sub-steps dominate its time budget:

| Sub-step | Typical cost | Skippable? |
|----------|-------------|------------|
| W5-1f dialogue TTS (per-character lines) | 2–5 min | yes — if script has no dialogue or user accepts narrator-only |
| W5-2 SFX generation (50–80 cues via ElevenLabs SFX API) | 8–20 min | yes — if script tolerates no atmospheric layer |
| **Combined skip** | **~10–25 min** | episode-by-episode user choice |

Today the only way to skip is to manually edit `dialogs_{part}.json` to `[]`
and delete `08_sfx_list.md` between waves — fragile and not communicated to
the rest of the pipeline. A first-class gate makes this a clean user-driven
optimization for draft/preview episodes (or for episodes where the script
deliberately avoids dialogue/SFX).

---

## Decision: single gate at W4-0, scope persisted in STATE.md

**Where to ask**: W4-0, a new sub-step inserted at the start of Wave 4
(extraction). By W4 the W3 script is locked, so the user knows what the
episode actually needs.

**Why not W2 (synopsis)?** Too early — the user is still designing the
story and shouldn't be making production-cost trade-offs.
**Why not W5-0-prep?** W4-2 (dialogue extraction) and W4-3 (SFX list) would
already have produced unused artifacts. Move the gate before W4-1.

**What to ask** (AskUserQuestion with checkboxes — defaults preserve current
behavior):

```
이번 에피소드의 프로덕션 범위:
[x] Dialogue TTS (다중 화자 — Typecast dialogue mode)
[x] SFX (atmospheric/긴장 환기)

조합:
- Full (default)        : 둘 다 켬
- Narration + Dialogue  : SFX 끄기 → ~10–20분 절약
- Narration + SFX       : dialogue 끄기 → ~2–5분 절약 (대사 없는 스크립트일 때)
- Narration only        : 둘 다 끔 → ~12–25분 절약 (draft / preview용)
```

**Persisted in STATE.md** (read by every downstream subagent that branches):

```markdown
## Decisions
- production_scope:
    dialogue: true       # default true
    sfx: true            # default true
```

Once set, the choice is sticky for the rest of the pipeline. Re-asking on
`/story-resume` is wrong — would invite mid-pipeline state churn. The user
can manually edit STATE.md if they really need to change mid-flight.

---

## Cascade map

| Wave / sub-step | When flag is OFF | Behavior |
|-----------------|------------------|----------|
| **W4-0** | (new gate) | AskUserQuestion if `production_scope` is missing in STATE.md; otherwise skip the question and continue. Idempotent on resume. |
| W4-1 narration extraction | always runs | unaffected (narration is mandatory) |
| W4-2 dialogue extraction | `dialogue: false` | skip entirely. `dialogs_{part}.json` is NOT produced. W5-1f also skips by absence-of-file. |
| W4-3 SFX list | `sfx: false` | skip entirely. `08_sfx_list.md` is NOT produced. W5-2 also skips by absence-of-file. |
| W5-0-assign | `dialogue: false` | only `narrator` row required in `tts_settings.md`. Character voice assignment skipped. |
| W5-1f dialogue TTS | `dialogue: false` | skipped. `voices/` directory not created. |
| W5-2 SFX | `sfx: false` | skipped. `media/sfx/` empty (or absent). |
| W5-3 5-part merge | `sfx: false` | merge of `final_{part}.mp3` runs as usual; SFX timecode conversion section becomes a no-op. |
| W5-4 mechanic QA | `sfx: false` | "collision / per-part range / full range / per-part offset" SFX checks all become vacuous (0 cues). Mechanic QA still runs (validates narration timing). |
| W6 scenes.csv | `sfx: false` | no change — scenes.csv is anchored to SRT only. |
| W8-0 SFX scene-match | `sfx: false` | skipped entirely. |
| W8-1 audio import | always runs | unaffected — imports whatever audio actually exists. |
| W8-2 CapCut export | both flags | CapCut project simply lacks the SFX/voices tracks. |

**Filename convention**: nothing changes. Files that aren't produced are
simply absent. Downstream subagents check existence; do NOT special-case
"empty file" vs "missing file".

---

## Spec touch list

| File | Change |
|------|--------|
| `workflows/execute-pipeline.md` | Wave I/O table for W4: outputs listed as conditional ("`dialogs_{part}.json` — when `production_scope.dialogue`", "`08_sfx_list.md` — when `production_scope.sfx`"). Sub-step decomposition for W4: insert `W4-0 production-scope` at the start. W4 subagent prompt: read STATE.md `production_scope`; gate W4-2 / W4-3 accordingly. W5 sub-step + prompt updates for the same flags. STATE.md schema documentation: new `production_scope` block. |
| `docs/{en,ko}/W4-production.md` | New § "4-0 Production scope (user gate)" before § 4-1. § 4-2 / § 4-3 each prefaced with "Skip when `production_scope.{dialogue,sfx}` is false." |
| `docs/{en,ko}/W5-tts-sfx.md` | § 5-0-assign: voice-map requirements drop character rows when dialogue is off. § 5-1f: skip when dialogue is off. § 5-2: skip when sfx is off. § 5-3 / § 5-4: SFX-related steps no-op when sfx is off. § 5-5: import works either way. |
| `docs/{en,ko}/W8-assembly.md` | § 8-0 SFX scene-match: skip when sfx is off. |
| `workflows/new-episode.md` | STATE.md template adds `production_scope` block (defaults: both `true`, i.e., current behavior). |
| `workflows/resume.md` | Read `production_scope` from STATE.md; do NOT re-ask. If missing on a pre-spec episode, default to `{ dialogue: true, sfx: true }` so legacy episodes behave identically. |
| `SKILL.md` | Brief mention of the production-scope flag in the W5 row of the wave table. |

---

## Implementation phases

This is doc-driven — the actual flag-reading logic lives inside the W4 / W5 /
W8 subagent prompts (instructed by the wave docs). No new code or scripts
needed.

1. **Spec** (`execute-pipeline.md` + W4/W5/W8 wave docs en+ko + STATE schema)
2. **Subagent prompt updates** — wave subagents must read STATE.md
   `production_scope` and branch accordingly. The "skip W4-2 when
   `dialogue: false`" rule must be in the W4 subagent prompt, not just the
   wave doc, so the subagent honors it without orchestrator hand-holding.
3. **Verification** — manual run on one episode with each combination
   (Full / no-SFX / no-dialogue / narration-only). Confirm absent files
   don't break downstream waves. Confirm `/story-resume` doesn't re-ask.

---

## Open questions

1. **Should the gate also affect the synopsis/preflight review?** If the
   user commits to "narration only" upfront, W2 preflight could verify
   "synopsis works without dialogue" (i.e., no character interactions are
   critical to the plot). For now, OUT OF SCOPE — the gate is at W4 which
   is post-script. A later phase can wire a W2-side hint if needed.

2. **Should `/story-rewrite` re-ask?** Probably not — the script's already
   committed and rewrite is about engagement diagnosis, not production
   trade-offs. Inherit from STATE.md. If the user wants to change scope
   mid-flow they can edit STATE.md manually.

3. **Auto-detect dialogue presence?** If `dialogs_{part}.json` would be `[]`
   for all parts (i.e., the script has zero dialogue), we could auto-set
   `dialogue: false` and skip the question. Nice-to-have but adds a code
   path; defer to a follow-up.

---

## Risk register

| Risk | Mitigation |
|------|-----------|
| Downstream subagent forgets to read the flag and runs anyway | Subagent prompts include an explicit precondition check; orchestrator's W4/W5 START banner echoes the production-scope decision so the user sees what's being skipped. |
| Legacy episodes resumed mid-pipeline don't have `production_scope` in STATE.md | `resume.md` rule: missing flag → default `{ dialogue: true, sfx: true }` (full mode = current behavior). No silent change to existing work. |
| User picks "narration only" then discovers script has critical dialogue | W4-0 AskUserQuestion shows a quick scan summary: "Script has ~N dialogue lines across N characters" so the user sees the trade-off before committing. |
| SFX absent breaks W5-4 mechanic QA (loops on "no cues to check") | W5-4 must early-return success when `sfx: false`. Spec explicit: empty cue list = pass. |
