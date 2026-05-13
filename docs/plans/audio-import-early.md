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

If we import as soon as the **W5-4 mechanic QA passes** (i.e., audio +
SFX have been validated for collisions, range, offsets), the user can
review audio in the app's Audio tab **in parallel with W6 (CSV) and
W7 (image generation)** — the slowest wave. By the time W8 starts,
audio review is typically already complete.

---

## Decision: single import trigger, after W5-4 mechanic QA

Considered and rejected:

- **Per-part import after W5-1e** (narration only, no SFX) — two import triggers complicate the spec and the audio-review state machine; narration without SFX may produce false-positive flags; marginal benefit small since W7 (the long wave) dominates the review window.
- **Import right after W5-3 merge, before W5-4** — the first iteration of this plan placed it here. Rejected after review: W5-4 catches timecode collisions / SFX out-of-range, and the user shouldn't listen to a mechanically-broken package. If W5-4 fails and timecodes change, the early import would be stale.

Single trigger at **W5-5**, immediately after W5-4 passes.

---

## Scope

### In scope (final, post-review)
- New sub-step `W5-5 audio-import` **after `W5-4 mechanic QA passes`** — importing before W5-4 would let the user review audio with broken timecodes / out-of-range SFX
- W8-1 becomes an **idempotent re-import** (safety net for W5-5) — calls `/api/audio-import` with the explicit episode folder path so the app is guaranteed to be on THIS episode's audio package before CapCut export, regardless of whether W5-5 ran successfully
- voices/ folder reorganization shell loop made idempotent (portable `find -maxdepth 1 -type f -name '*.mp3' \| while read` form) so W8-1 re-running it on already-organized folders is a no-op, and the snippet works in both bash and zsh without shell-specific options
- User-facing message: "🎧 Audio imported — review in Audio tab while W6/W7 run"

### Out of scope
- Changing the import API itself
- Changing audio-review data format (`.audio_review.json`)

---

## Cascade map

| File | Change |
|------|--------|
| `workflows/execute-pipeline.md` | W5 sub-step decomposition: append `W5-5 audio-import` AFTER `W5-4 mechanic-QA`. W8 sub-step: `W8-1 audio-import` → `W8-1 audio-import (idempotent re-import — safety net for W5-5)`. W5 subagent prompt gains W5-5 step. Wave I/O role descriptions updated (W5 includes initial import; W8 includes idempotent re-import). |
| `docs/{en,ko}/W5-tts-sfx.md` | New § "5-5. Audio import (best-effort, post-mechanic-QA)" after § 5-4. Documents the API call, idempotent voices/ reorg, best-effort semantics, user chat message, re-import trigger on regeneration. |
| `docs/{en,ko}/W8-assembly.md` | § 8-1 reframed as idempotent re-import. Explicit note on why `/api/audio-reviews` is NOT used for verification (returns app-wide state regardless of folder). § 8-0 wording updated to "before W8-1 re-import / W8-2 CapCut export". |
| `docs/{en,ko}/W7-image-production.md` + `SKILL.md` | Top-level role descriptions corrected: W5 carries initial audio import, W8 carries idempotent re-import + CapCut + video. |
| `docs/plans/audio-import-early.md` | This file. |
| `TODO.md` | Backlog entry pointing to this plan + mark as in-progress. |

---

## Implementation result (final)

Doc-only — no script or app code changes. The API endpoint exists,
just gets called earlier.

Done:
1. `execute-pipeline.md` — W5 sub-step decomposition adds W5-5 after W5-4. W8 sub-step W8-1 reframed. W5 subagent prompt includes W5-5. Wave role descriptions updated.
2. W5 wave docs (en + ko) — new § 5-5 "Audio import (best-effort, post-mechanic-QA)".
3. W8 wave docs (en + ko) — § 8-1 idempotent re-import. § 8-0 wording corrected.
4. W7 wave docs (en + ko) + SKILL.md — role descriptions updated.
5. This plan + TODO backlog entry.

**Verification**: spec re-read; no active "W5-3a" instructions or
`/api/audio-reviews`-based skip logic remain anywhere under
`skills/story-engine/`. The only remaining "W5-3a" mention lives in this
file's own correction-history summary at the top (intentional —
documents the rename). The W8-1 rationale block explains why
`/api/audio-reviews` is NOT used for verification; it doesn't reference
the W5-3a name.

---

## Resolved questions (decision log)

1. **Idempotency of `/api/audio-import`** — confirmed by reading
   `electron/main.js` audio-import handler: calling with the same folderPath
   on a package already loaded re-runs the loader (effectively a no-op for
   correctness, possibly a brief re-scan). Calling with a different
   folderPath switches the app to the new package. Safe to call from both
   W5-5 and W8-1.

2. **`/api/audio-reviews` is folder-agnostic** — confirmed by reading the
   endpoint: the GET returns whatever `window.__mcpGetAudioReviews()`
   returns, which is the app's currently-loaded review state with no
   folder filter. Non-empty data ≠ "this episode is imported"; could be
   leftover from a different episode. Therefore W8-1 cannot use this GET
   as evidence of "already imported"; must call `/api/audio-import` with
   explicit folderPath.

3. **What if user is offline / app not running at W5-5?** — Import fails.
   W5 logs a warning and continues (W5-4 mechanic QA does not depend on
   the app). W8-1's idempotent re-import then performs the import for the
   first time.
   ⇒ Spec: **import is best-effort at W5-5; failure logs a warning but
   does NOT block the wave. W8-1 covers via idempotent re-import.**

4. **Audio review flags surfaced when?** — User can flag in the app during
   W6/W7. Those flags persist in `.audio_review.json`. W8-1 re-imports
   then refreshes; existing flag-handling logic processes them.
   ⇒ No additional logic needed beyond what W8-1 already does.

---

## Risk register

| Risk | Mitigation |
|------|-----------|
| Import side effect at W5-5 triggers app dialog that blocks orchestrator | The import API is a non-interactive HTTP POST — no dialog. Confirmed by W8-1's current usage of the same endpoint. |
| Audio review flag races with W7 image generation | Flags live in `.audio_review.json` (file-level). W7 doesn't touch audio files. No race. |
| User regenerates audio during W6/W7 (manually re-runs W5-1a for a part) | Out of scope for this phase — manual mid-pipeline reruns are an existing edge case. Documented in W5-1d (user-review step) as the right place to refine. |
