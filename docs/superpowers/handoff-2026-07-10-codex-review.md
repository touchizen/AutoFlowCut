# Handoff — Codex Review of `681298f..HEAD`

Date: 2026-07-10
Purpose: run the Codex review loop (findings → fix → re-review, until `findings: 0`) on the ten
commits made **after** the previous review loop closed.

---

## What was already reviewed

The previous loop reviewed `155dd38^..681298f` and converged to `findings: 0` after four rounds.
Every finding it produced was verified against source before fixing — several were real and are now
regression-tested. **Do not re-review that range.** Its fixes live in `ace2c64` and `681298f`.

What that loop caught (so you can recognize the same classes here):

- `splitSynopsisOutput` collapsed "no cast" and "couldn't read the cast" into the same `[]`, so one
  dropped `CHARACTERS_JSON` marker deleted every character. Partial schema mismatch was worse than
  total failure. Fixed with `charactersParsed`.
- Both synopsis side actions decided "was this a user cancel?" by regex-testing the error message for
  `abort`, silently swallowing real provider failures. Now decided by controller state.
- `useStoryPipeline` lives in `App` and is **not** remounted on project switch (only `StoryView` is,
  via `key`), so an in-flight call could clear a new project's state when it settled. Fixed with an
  ownership token (`synopsisOwnerRef`), shared by both synopsis side actions.

---

## The range to review

```
git log --oneline 681298f..HEAD     # 10 commits
git diff 681298f..HEAD              # 45 files, +1357 / −163
```

| Commit | What it did |
|---|---|
| `f6bdb5e` | `open()` now repairs step status when a done step's artifact is missing on disk |
| `5220c77` | New `useStickToBottom` hook; the three SSE streaming panels follow new text |
| `c141202` | Running step carries a `reviewOnly` marker; review runs keep their content visible and mount a log panel |
| `460ad7b` | `SCORED_REVIEW_SCHEMA` + immersion score for scenario/synopsis review, surfaced as a badge |
| `8b30c6f` | `PromptInput` gains a `footerExtra` slot; the score rides in the count row |
| `ef6e02d` | Synopsis textarea replaced by `PromptInput` (line gutter, counts, `ariaLabel` prop) |
| `484eeae` | UI rename 시나리오 → 대본 (labels only; step key `script` unchanged) |
| `0781798` | Synopsis generation prompts no longer ask for an in-body immersion score |
| `914b338` | Catalog: `Claude Fable 5` label, added `claude-haiku-4-5` (empty effort list) |
| `f662a19` | `thinkingConfigFor(model, effort)` — per-generation `thinking` shape |

---

## Where to look hardest

These are the spots where I made a judgement call under uncertainty. Verify each against source
rather than trusting this summary.

**1. `reviewOnly` marker lifetime (`c141202`).** `electron/story/stepMachine.js` writes
`{status: 'running', updatedAt, reviewOnly: true}` and relies on `done`/`error` replacing the whole
object so the marker cannot linger. It is persisted to `story.json`. Check: can a crash or abort
leave `reviewOnly` on a non-running step, and would `isReviewRun()` then mis-render a panel?

**2. `open()` artifact repair (`f6bdb5e`).** `healMissingStepArtifacts()` downgrades a done `script`
or `scenes` whose file is missing, plus everything downstream, and persists it. Check: does it fight
`healReferencedSpeakers()` (which runs right after and also flushes)? Is there a project shape where
this repair destroys recoverable state — e.g. `audio` done with a valid manifest but `scenes.json`
merely unreadable rather than absent?

**3. `useStickToBottom` (`5220c77`).** `stuckRef` starts `true` and is only updated from the
container's `onScroll`. Check: on a container that never fires `onScroll` (content shorter than the
viewport), does the effect keep writing `scrollTop`? Does the ref survive the branch switch when
`scriptRunning` flips and the stream div unmounts/remounts?

**4. Score plumbing (`460ad7b`).** `collectScore` appends to `reviewScores` on every `phase:'scored'`
event and is reached from two different branches of the `story:progress` handler — the synopsis
ahead-of-filter branch and the generic review branch. Check: can a `script-review` legacy duplicate
double-count? Does `reviewScores` reset on every path that resets `progressLog`/`reviewProgress`?

**5. Synopsis editor swap (`ef6e02d`).** `PromptInput` is a Lexical editor with a `SyncPlugin` that
mirrors the external `value`. Check: does a programmatic `setSynopsisDraft` during an in-flight
review round land correctly? Does `disabled={synopsisReviewing}` actually block edits, or only hide
the caret? Is `ariaLabel` reaching the `role="textbox"` node on both editors?

**6. `thinkingConfigFor` (`f662a19`).** Regex-keyed on the model id
(`/^claude-(fable|mythos)-/`, `/^claude-haiku-4-5/`). Check: does a dated model id
(`claude-haiku-4-5-20251001`) still match? Does any caller reach `buildClaudeSdkOptions` without
going through `normalizeStoryLlmOptions`, such that an effort could be sent to Haiku?

**7. Rename (`484eeae`).** Three files use 시나리오 to mean "a case", not the script:
`src/firebase/firestore.js`, `src/hooks/useAudioImport.js`, `src/services/videoRecovery.js`. They
were deliberately left alone. Check the rename didn't touch a label the app reads back from
`story.json`.

---

## How to run the loop

Start a fresh Codex thread (`mcp__codex__codex`, `cwd` = repo root, `sandbox: read-only`,
`approval-policy: never`). The prompt shape that worked:

- Give it the range and tell it to `git log` / `git diff` the range itself.
- Priority order: **에러 방지 (correctness) → 구조 (structure) → 중복 (duplication)**.
- Name the helpers it should check for reuse: `reviewConfig`, `effectiveOptions`, `buildLlmOptions`,
  `reviewLlmOptions`, `sendReviewProgress`, `sendStepLog`, `normalizeStoryCharacter`,
  `splitSynopsisOutput`, `renderReviewControl`, `StoryRunning`, `GenClock`, `clampReviewRounds`,
  `speakersFromCharacters`, `useStickToBottom`, `thinkingConfigFor`.
- Demand `file:line` + a concrete failure scenario per finding. Reject style nits.
- Tell it explicitly that `findings: 0` is an acceptable outcome and not to manufacture marginal
  findings.

Then, per round: **verify every finding against the source before fixing it.** The previous loop had
Codex assert things that were wrong twice (a "synopsis schema" that doesn't exist; `reviewConfig`
clamping to 1..5 when it has no upper bound) and right nine times. Reply to the same thread with what
you verified, what you fixed, and where you disagree — pushing back with evidence closed one finding
cleanly.

Fix with TDD: failing test first, then the change. `npm run test:run` must stay green
(505 files / 5150 tests at handoff).

---

## State at handoff

- Everything is committed and pushed to `origin/main`; working tree clean.
- Tests: 505 files / 5150 pass.
- **Not verified by running the app.** Two things are outstanding:
  1. **Fable 5 path** — the only LLM call path whose request actually changed
     (`{type:'disabled'}` → `adaptive` + `effort:'high'`). Haiku 4.5 was run by the user and works.
  2. **UI eyeball** — review log panels, immersion badge, the Lexical synopsis editor, the 대본 labels.
     Tests pass but the app has not been launched this session.
- Whether the Claude Agent SDK forwards `thinking` to the API verbatim or normalizes it per model is
  **not knowable from the package** — the model table lives in the CLI binary it spawns. `f662a19`
  makes the request correct either way; it is a defense, not a confirmed bug fix.
