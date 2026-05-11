# Phase Plan — Move Audio Import from W8 to End of W5

**Status**: implemented + review-corrected (this session)

**Review correction summary (post-implementation)**:
- W5-3a renamed to **W5-5** and moved AFTER W5-4 mechanic QA. Importing before W5-4 risked the user reviewing audio with broken timecodes / out-of-range SFX.
- W8-1 verification logic via `/api/audio-reviews` was REMOVED. That GET returns the app's currently-loaded reviews regardless of folder, so non-empty data could be leftover from a different episode. W8-1 now calls `/api/audio-import` idempotently for the explicit episode folder path — the only reliable way to guarantee the app is on this episode's audio package before CapCut export.
- "pre-audio-import" wording on W8-0 changed to "before W8-1 re-import / W8-2 CapCut export" since audio is normally already imported by W5-5.
- Top-level role descriptions (SKILL.md, W7 docs, execute-pipeline.md wave roles table) updated: W5 includes "initial audio import (best-effort)"; W8 is "SFX scene-match + idempotent audio re-import + CapCut + video".
**Estimated effort**: ~30 min (docs only, no script changes)
**Risk level**: Low — additive sub-step, W8 keeps backwards-compat fallback

---

## Motivation

Today the audio import (`http://localhost:3210/api/audio-import`) runs at
**W8-1**, which means the user cannot listen to / flag bad TTS until the
expensive W7 image generation has already finished. If a clip is broken, the
user has paid Google Flow credits for images that may need to be redone
alongside the audio regeneration.

If we import as soon as the W5-3 5-part merge produces `media/final_full.mp3`
+ `media/sfx/`, the user can review audio in the app's Audio tab **in parallel
with W6 (CSV) and W7 (image generation)** — the slowest wave. By the time W8
starts, audio review is typically already complete.

---

## Decision: single import trigger, not per-part

Per-part import after W5-1e (narration only, no SFX) was considered. Rejected
because:

- Two import triggers complicate the pipeline spec and the audio-review state machine
- Narration without SFX sounds incomplete and may produce false-positive flags
- Marginal benefit (catching bad part1 TTS while part2 generates) is small —
  W5 TTS for all 5 parts typically takes 2–5 minutes; W7 image generation
  takes 30+ minutes, so the review window is dominated by W7 anyway

Single trigger at end of W5-3.

---

## Scope

### In scope
- New sub-step `W5-3a audio-import` after `W5-3 5-part merge`, before `W5-4 mechanic QA`
- W8-1 becomes **verification + back-fill** — if audio is already imported, verify and surface any existing flags; if not (backwards-compat for v1 episodes), do a first-time import
- W5 subagent gains the audio-import side effect
- User-facing message: "Audio imported — review in Audio tab while W6/W7 run"

### Out of scope
- Changing the import API itself
- Changing audio-review data format (`.audio_review.json`)
- voices/ folder reorganization logic (stays as-is)

---

## Cascade map

| File | Change |
|------|--------|
| `workflows/execute-pipeline.md` | W5 sub-step decomposition: insert `W5-3a audio-import` between `W5-3` and `W5-4`. W8 sub-step: `W8-1 audio-import` → `W8-1 audio-import (verify; fallback to import if missing)`. W5 subagent prompt section gains the import action. |
| `docs/{en,ko}/W5-tts-sfx.md` | New § "5-3a. Audio import to AutoFlowCut" after the merge section. Documents the API call, the user-facing chat message, and the precondition (W5-3 outputs exist). |
| `docs/{en,ko}/W8-assembly.md` | W8-1 reframed as verification step. Original first-time-import path retained as fallback for episodes imported pre-this-spec. |
| `docs/plans/audio-import-early.md` | This file. |
| `TODO.md` | Backlog entry pointing to this plan + mark as in-progress. |

---

## Implementation phases (single PR, all docs)

This is doc-only — no script or app code changes. The API endpoint exists,
just gets called earlier.

1. Update `execute-pipeline.md` (W5 + W8 sub-step decomposition, W5 subagent prompt)
2. Update W5 wave docs (en + ko) with new `5-3a` section
3. Update W8 wave docs (en + ko) — W8-1 to verification mode
4. Add this plan doc + TODO backlog entry

**Verification**: spec re-read for internal consistency. Wave I/O table
unchanged (the import side effect doesn't add a new file output — the audio
review state lives inside the AutoFlowCut app, not the episode folder).

---

## Open questions (answer during implementation)

1. **Idempotency of the import API** — if W5 imports and then W8-1 verifies
   by re-calling the import API on the same folder, does it duplicate or
   no-op? Likely the app's import logic deduplicates by file path. If not,
   W8-1 verification uses `api/audio-reviews` (read) instead of re-import.
   ⇒ Spec writes the safer pattern: **W8-1 reads `/api/audio-reviews` first;
   only re-imports if the list is empty**.

2. **What if user is offline / app not running at W5-3?** — Import fails.
   W5 should log a warning and continue (W5-4 mechanic QA does not depend
   on the app). W8-1 falls back to first-time import.
   ⇒ Spec writes: **import is best-effort at W5-3a; failure logs a warning
   but does NOT block the wave**.

3. **Audio review flags surfaced when?** — User can flag in the app during
   W6/W7. Those flags persist in `.audio_review.json`. W8-1 reads them and
   either auto-unflag (if file was regenerated) or escalate.
   ⇒ Existing W8-1 logic already handles flag refresh; no change needed.

---

## Risk register

| Risk | Mitigation |
|------|-----------|
| Import side effect at W5-3a triggers app dialog that blocks orchestrator | The import API is a non-interactive HTTP POST — no dialog. Confirmed by W8-1 current usage. |
| Audio review flag races with W7 image generation | Flags live in `.audio_review.json` (file-level). W7 doesn't touch audio files. No race. |
| User regenerates audio during W6/W7 (manually re-runs W5-1a for a part) | Out of scope for this phase — manual mid-pipeline reruns are an existing edge case. Documented in W5-1d (user-review step) as the right place to refine. |
