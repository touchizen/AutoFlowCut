# M2b-1 R2 Remaining Findings Design

**Goal:** Close R2-B1/B2/B3 and the Fable R2 minors without weakening workflow isolation or allowing a hung provider to freeze workflow switching.

## Session and cancellation design

Correctness and liveness use separate mechanisms.

- Story persistence and emission check both operation generation and the main-owned current session immediately before every post-await save or emit. The Story IPC emitter also resolves the payload token back to the current coordinator session and uses `isCurrent(session)` before sending.
- `machine.abort()` invalidates the operation generation and aborts every available controller. Preview receives its own controller and settles as a no-op when stale.
- Coordinator transitions invalidate the epoch immediately, then await the previous machine's abort only up to a short configured deadline. The transition proceeds after the deadline because stale-session gates make any surviving promise harmless.
- User cancellation is not session invalidation. `story:abort` and `shopping:abort` are guarded machine-operation commands that retain the current token. Workflow/project opens and work-folder authority changes remain the only session disposal paths.

## Filesystem authority design

Work-folder confirmation records the canonical path plus `{ dev, ino }`. Uses re-check the canonical path with `lstat`/`stat`, require a real directory rather than a symlink, and compare identity. Project validation similarly snapshots work-folder and project identities. After the previous workflow is quiesced (or its bounded deadline expires), the coordinator revalidates that snapshot immediately before Story machine or Shopping store creation.

## Renderer fixes

- Re-check `superseded()` after fresh-project persistence and before publishing workflow/settings state.
- Close Settings after a successful Shopping project creation.
- Localize the Header Shopping label through `header.shoppingShorts` in both locale tables.

## Test design

Tests isolate each invariant: delayed preview switch safety, bounded transition liveness, abort/restart versus switch/stale-token, eager epoch invalidation, work-folder and project identity replacement, renderer authority mismatch, superseded publish suppression, Settings closure, and Header localization. Mutation-sensitive assertions observe the protected side effect directly: save/send call counts, machine invocation counts, token acceptance, store construction, state setters, close callback, and translated label.

