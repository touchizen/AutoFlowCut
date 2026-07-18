# Story Synopsis Review Spec

Date: 2026-07-10
Extends: `2026-07-05-story-review-controls.md`

## Goal

Add a manual **[검수]** (review) button to the synopsis gate so the user can have the LLM
critique and revise the synopsis draft — body text and characters — before confirming it
and generating the scenario.

Today `script`, `scenes`, and `prompts` each have a review target. The synopsis has none,
so the user's only options at the gate are "accept as written" or "regenerate from scratch".

## Background: why synopsis is not a step

The stepper renders `설정 / 리서치 / 시놉시스 / 시나리오 / 씬 / 오디오 / 프롬프트`, but the
step machine only knows four steps: `script`, `scenes`, `audio`, `prompts`.

`설정`, `리서치`, and `시놉시스` are **gate tabs**, deliberately kept out of the step machine
core (`StoryStepper.jsx`: "시놉시스는 실행 스텝이 아닌 게이트 탭 … 스텝머신 코어 불변").
A gate must stop and wait for a human. If synopsis were a step, `AUTO_STEPS`
(`['scenes','audio','prompts']`) run-all would blow straight through the confirmation gate.

Research follows the same pattern (`researchAnalyze` / `researchFactCheck` side actions).

**Consequence for this design:** synopsis review is a *side action*, not a `reviewOnly` step
run. The step machine core stays unchanged. Because side actions never create a running step,
they are invisible to every mechanism keyed on step state — op filtering, progress-badge
clearing, and the abort button all need explicit wiring. Those are the traps below.

## Decisions

1. **Manual only.** No auto-review toggle, no participation in the generate pipeline.
   The synopsis gate exists so a human eyeballs the draft; auto-revising it before the
   human sees it defeats the gate. `synopsis` is therefore **not** added to
   `REVIEW_TARGET_ORDER` and never appears in the Setup tab.

2. **Reviews body + characters together.** Characters are derived from the synopsis. Revising
   prose alone would desync the character cards. `reviseSynopsis` returns both, matching
   `generateSynopsis`'s existing `{ synopsisMd, characters }` return shape.

3. **Draft-only, no persistence.** Review updates the renderer's local `synopsisDraft` /
   `characterDrafts` state. It does not write to disk. Committing remains the sole job of
   `confirmSynopsis`, preserving the existing gate contract.

4. **Reuses `synopsisController`.** The side action takes the same controller as
   `generateSynopsis`, so the existing `abort()` cancels it. The *UI* for abort/busy is not
   free, however — see Decision 6.

5. **Rounds are session-local.** The control renders `검수 횟수 [1] [검수]`. The value lives in
   `reviewSettings.synopsis.rounds` and rides along in `currentOptions().review` whenever some
   *other* action calls `start()`, but nothing guarantees it is persisted: `confirmSynopsis`
   does not write `state.input.options`, and in `pasted` mode the script step is already done,
   so no `start('script', …)` ever follows the gate. Do **not** claim reopen hydration for this
   value. The `enabled` field is unused for this target.

6. **New `synopsisReviewing` renderer state — do not reuse `synopsisGenerating`.**
   `synopsisGenerating` swaps the textarea for the streaming view
   (`StoryView.jsx`: `synopsisGenerating ? <stream> : <textarea>`), which would hide the very
   draft under review. A separate flag keeps the draft visible while still disabling the
   action buttons and revealing `[⏹ 중단]`.

7. **The draft is frozen while reviewing.** The textarea goes `readOnly` and the character cards
   go `disabled` for `synopsisGenerating || synopsisReviewing`. Today the textarea is always
   editable and the cards disable only on `synopsisGenerating`. Without this, a user who edits
   during a review has those edits silently overwritten when the result lands.

## Review Rubric

### Synopsis

Review the synopsis as a *story premise*, not as prose to be polished:

- Hook: does the premise raise a question worth a full episode?
- Stakes: is it clear what a character stands to lose or gain?
- Shape: is there a beginning, a turn, and a payoff — not just a situation?
- Character grounding: does each listed character have a want, and does the synopsis
  motivate their presence?
- Consistency: do the character cards (name, appearance, gender, role) match the body text?
- Scope: is this producible at the configured scene length, or is it a three-episode plot?

Genre is light context only. Do not enforce genre-specific formulas from meta prompts.

## LLM Adapter Surface

Add to `llmClaude.js` and `llmCodex.js` (Gemini is not routed for story — `pickAdapter`
selects codex or claude only):

- `reviewSynopsis(synopsisMd, characters, opts, ctx) -> { verdict, critique }`
- `reviseSynopsis(synopsisMd, characters, critique, opts, ctx) -> { synopsisMd, characters }`

### Output contracts — asymmetric, on purpose

`reviewSynopsis` **uses the existing `REVIEW_SCHEMA`** (structured call), exactly like
`reviewScript`. Verdict normalizes to `pass` unless the model says `revise`.

Note what `critique: out.critique || ''` actually does: `REVIEW_SCHEMA` declares
`required: ['verdict','critique']` and `assertSchema` throws `missing required 'critique'`
before the adapter ever runs. So the `|| ''` normalizes a **present-but-empty** critique, not a
missing one. A model that omits `critique` produces a schema error — that is existing,
intended behavior and this feature does not change it.

`reviseSynopsis` **does not use a schema.** There is no synopsis JSON schema — synopsis output
is plain text terminated by a `CHARACTERS_JSON` marker followed by a character array, parsed by
`splitSynopsisOutput()` in `electron/api/llm/synopsisOutput.js`. `reviseSynopsis` must:

- emit the same marker contract that `buildSynopsisPrompt` establishes, and
- parse its result with `splitSynopsisOutput()`, inheriting the lenient
  `characters: []` fallback on a missing/broken marker.

Do not import a "synopsis schema" — none exists. Do not convert `generateSynopsis` to a
structured call; that would break the existing streaming delta gate
(`createSynopsisDeltaGate`) and its tests.

New prompt builders: `buildSynopsisReviewPrompt`, `buildSynopsisRevisePrompt`.

Router (`storyLlmRouter.js`) `METHOD_OPTION_INDEX`:

- `reviewSynopsis: 2`
- `reviseSynopsis: 3`

## Step Machine

New side action `reviewSynopsis(params)`, declared beside `generateSynopsis`.

Busy guard is identical to `generateSynopsis`:

```
previewing || synopsisController || researchController || any step running  →  { error: 'busy' }
```

Flow:

1. Acquire the controller in two statements, exactly as `generateSynopsis` does — a chained
   `synopsisController = myController = new AbortController()` is a `ReferenceError` under ESM
   strict mode because `myController` is never declared:

   ```js
   const operationId = randomUUID()
   const myController = new AbortController()
   synopsisController = myController
   ```
2. **Emit `send('story:synopsis-delta', { phase: 'started', text: '' }, operationId)` first.**
   This is the only thing that sets the renderer's `synopsisActiveOpRef`
   (`useStoryPipeline.js`: `if (p.phase === 'started') synopsisActiveOpRef.current = p.operationId`).
   Without it every subsequent progress event is orphaned.
3. Resolve rounds via existing helpers, not by hand:
   `reviewConfig(buildLlmOptions(effectiveOptions(params)), 'synopsis')`. `effectiveOptions`
   already merges `params.review` over `params.options.review`. If `cfg.enabled` is false,
   return `{ changed: false }`.
4. **Clamp the upper bound locally: `const rounds = Math.min(5, cfg.rounds)`.**
   `reviewConfig` only does `Math.max(0, Math.floor(n))` — it has **no upper clamp**. The 1..5
   limit lives in the renderer's `clampReviewRounds`, which an IPC caller bypasses. Without this
   line a crafted `rounds: 999` runs 999 LLM round-trips. Do not "fix" `reviewConfig` globally;
   that changes `script`/`scenes`/`prompts` behavior and is out of scope.
5. For each round `i` of `rounds` — **every `send` carries `operationId`**:
   - `sendReviewProgress('synopsis', { round: i, of: rounds, phase: 'reviewing' }, operationId)`
   - `reviewSynopsis(...)` → `{ verdict, critique }`
   - if `signal.aborted` → return
   - **`if (verdict !== 'revise' || !critique?.trim()) break`** — mirror the existing guard in
     `reviewScriptCandidate`. A bare `{ verdict: 'revise' }` with no critique must not trigger
     an ungrounded rewrite.
   - `sendReviewProgress('synopsis', { round: i, of: rounds, phase: 'revising' }, operationId)`
   - `reviseSynopsis(...)` → `r`
   - if `signal.aborted` → return
   - `if (!r?.synopsisMd?.trim()) throw new Error('reviseSynopsis returned empty synopsis')`
   - `changed = true`; adopt `{ synopsisMd, characters }`
6. On abort, return without a result (mirror `generateSynopsis`) and clear `synopsisController`
   in `finally` only if it is still `myController`.
7. On error, `sendReviewProgress('synopsis', { phase: 'error', error }, operationId)` and rethrow.

Returns `{ synopsisMd, characters, changed }`. Writes nothing to disk.

`changed` is true iff at least one `reviseSynopsis` round completed successfully. Do **not**
define it as `r.synopsisMd !== current`: the review scope includes characters, so a revision that
rewrites only a character card while leaving the markdown byte-identical would report
`changed: false` while returning different characters. The flag is advisory — the renderer
applies the result either way — so "a revision ran" is the honest and sufficient meaning.

## Progress Events

Reuses the existing generic review channel:

```
story:progress  { kind: 'review', target: 'synopsis', round, of, phase, error?, operationId }
```

Three renderer fixes are required for these events to survive and to look right:

1. **The step op filter drops side-action progress.** `useStoryPipeline.js` filters
   `p.operationId !== activeOpRef.current`, and `activeOpRef` is only set from a *running step*.
   A side action never sets it. Handle synopsis review **ahead of that filter**, matching
   `synopsisActiveOpRef` instead — the same escape hatch `research-fetch` already uses:

   ```js
   if (p.kind === 'review' && p.target === 'synopsis') {
     if (synopsisActiveOpRef.current && p.operationId !== synopsisActiveOpRef.current) return
     setReviewProgress({ operationId: p.operationId, target: 'synopsis', round: p.round, of: p.of, phase: p.phase, error: p.error })
     setProgressLog(...)
     return
   }
   ```

2. **Target label falls back to 시나리오.** The log-line builder maps `scenes` and `prompts` and
   falls back to `'시나리오 검수'` for everything else, so synopsis rounds would be mislabeled.
   Add `synopsis → '시놉시스 검수'`.

3. **`reviewProgress` never clears for a draft-only review.** It is cleared on a terminal
   `story:state` (`if (!anyRunning) setReviewProgress(...)`) and on `start()`. A synopsis review
   emits neither, so the badge would freeze at "수정 중 1/1" forever. The renderer's
   `reviewSynopsis` wrapper therefore clears it explicitly: `setReviewProgress(null)` before the
   invoke, and again on settle — preserving the existing rule that a `phase: 'error'` badge
   sticks.

There is no concurrency hazard with the `if (!anyRunning)` clear at `useStoryPipeline.js:134`:
the side action's busy guard rejects while any step is running, and `start()` is likewise
refused while `synopsisController` is held, so a step and a synopsis review can never overlap.

The review log rows carry `step: p.target` — i.e. `'synopsis'` — so they are correctly excluded
from `scenesProgressLog` (`!entry.step || entry.step === 'scenes'`). No filter change needed.

### Renderer wrapper contract

`pipeline.reviewSynopsis` must mirror `generateSynopsis`'s wrapper exactly, because the step
machine **rethrows** real errors and `ipcRenderer.invoke` surfaces them as a rejection:

```js
const reviewOwnerRef = useRef(null)

const reviewSynopsis = useCallback(async (params = {}) => {
  // Ownership token, not a boolean. React state is not a lock, and this hook outlives a
  // project switch — see the two races below.
  if (reviewOwnerRef.current) return { error: 'busy' }
  const myToken = Symbol('synopsis-review')
  reviewOwnerRef.current = myToken
  const isOwner = () => reviewOwnerRef.current === myToken
  setSynopsisError(null)
  setProgressLog([])                 // mirror start(): otherwise round 2 opens with round 1's rows
  setReviewProgress(null)
  setSynopsisReviewing(true)
  try {
    const r = await window.electronAPI.storyReviewSynopsis({ projectToken: tokenRef.current, ...params })
    if (isOwner() && r?.error && !/abort/i.test(String(r.error))) setSynopsisError(r.error)
    return r
  } catch (e) {
    const msg = String(e?.message || e)
    if (/abort/i.test(msg)) return { aborted: true }
    if (isOwner()) setSynopsisError(msg)
    return { error: msg }
  } finally {
    // Release only if we still own the slot — mirrors main's
    // "clear synopsisController only if it is still myController".
    if (isOwner()) {
      reviewOwnerRef.current = null
      setSynopsisReviewing(false)
      setReviewProgress((rp) => (rp?.phase === 'error' ? rp : null))
    }
  }
}, [])
```

**Every shared-state write after the `await` is owner-guarded, not just the `finally`.** The two
`setSynopsisError` calls are the trap. `story-api.js`'s `guarded()` returns
`{ error: 'stale-token' }` when `payload.projectToken !== machine.projectToken`, so an orphaned
project-A review resolves — it does not hang or reject silently — with a plain error object.
Unguarded, that lands as a `stale-token` banner on project B's synopsis panel while B's own
review is running. `isOwner()` closes it.

The returned value is safe without a guard: it flows back into project A's `handleManualReview`
closure, whose `StoryView` was unmounted by the `key` change, so its `setSynopsisDraft` is a
no-op.

`Symbol` is right here — the token is only ever compared by identity within this module. Nothing
serializes, logs, or sends it over IPC.

Two distinct races make this ownership check load-bearing, and a plain boolean flag fixes only
the first:

1. **Double-click.** Disabling `[검수]` via `synopsisReviewing` only takes effect after React
   commits the re-render; two clicks in one tick both enter the callback. The loser must return
   `{ error: 'busy' }` without touching shared state — otherwise its `finally` re-enables the
   textarea and hides `[⏹ 중단]` while the winner is still running, and the winner's result then
   silently overwrites whatever the user typed in the meantime.

2. **Project switch.** `useStoryPipeline` is called in `App` (`App.jsx:493`) and is **not**
   remounted on project change; only `StoryView` is, via `key={storyProjectPath}`
   (`App.jsx:2488`). So an in-flight review for project A survives the switch. The project-switch
   reset block clears the owner slot, project B starts a review and takes the slot, and then A's
   long-since-orphaned promise settles. With a boolean, A's `finally` would clear
   `synopsisReviewing` and `reviewProgress` out from under B's live review. With a token, A sees
   `reviewOwnerRef.current !== myToken` and cleans up nothing.

The project-switch reset block sets `reviewOwnerRef.current = null` (not `false`) alongside
`setSynopsisReviewing(false)`.

Note that the loser path returns `{ error: 'busy' }` without calling `setSynopsisError` — no
banner for a click the user did not mean to make twice. The handler's `if (!r || r.error || ...)`
guard treats it identically to main's busy response, so no extra handling is needed.

`useRef` is already imported in `useStoryPipeline.js` (`activeOpRef`, `synopsisActiveOpRef`).

`setProgressLog([])` is not optional. `start()` clears the log on every run
(`useStoryPipeline.js:300`); a side action that skips it leaves the previous review's rows in
`synopsisProgressLog`, so the second `[검수]` opens `StoryRunning` pre-populated with stale
rows. Clearing the whole log is safe here because the busy guards make a step and a synopsis
review mutually exclusive.

Note the **three** distinct non-result shapes this can return: `{ error }`, `{ aborted: true }`,
and `undefined`. `{ aborted: true }` has no `error` key — a guard that only tests `r.error` lets
it through.

### `synopsisReviewing` ownership

The flag lives in **`useStoryPipeline`**, next to `synopsisGenerating`, and must be wired at all
three existing places or the UI silently does nothing:

1. Declared with the other synopsis state and set/cleared only by the `reviewSynopsis` wrapper.
2. Reset to `false` in the project-switch reset block, beside `setSynopsisGenerating(false)`
   (along with `reviewOwnerRef.current = null`).
3. Returned from **both** hook return statements. The first is the **`if (justSwitched)`** branch,
   which hand-writes literal defaults for every key — not a `!projectPath` bail; searching for
   that will miss it. It must gain `synopsisReviewing: false`. The second is the main return.
   Then destructure it in `StoryView`'s props alongside `synopsisGenerating`, which also needs a
   `= false` default there since the props are defaulted at the destructure site.

`synopsisReviewStartedAt` lives in **`StoryView`**, driven by the same `useEffect` shape as the
existing `synopsisStartedAt`:
`useEffect(() => { setSynopsisReviewStartedAt(synopsisReviewing ? Date.now() : null) }, [synopsisReviewing])`.

## UI

### Synopsis gate panel

```
 (시놉시스 textarea)              ← stays visible, readOnly while reviewing
 (등장인물 카드)                   ← disabled while reviewing
 {reviewBadge}                    ← new: 검토 중 1/1 · 수정 중 1/1 (sticks on error)
 <StoryRunning label="검수 중"     ← new: stopwatch + elapsed + log window
   log={synopsisProgressLog} />
 ─────────────────────────────
 [이 시놉시스로 시나리오 생성]      ← disabled while reviewing
 [시놉시스 다시]                   ← disabled while reviewing
 검수 횟수 [1] [검수]              ← new
 [⏹ 중단]                        ← now also shown while reviewing
```

### Progress UI — reuse, don't invent

`progressLog` accumulates synopsis review rows, but the synopsis panel has no container to draw
them: `StoryRunning` is the only log window, and today it is mounted only by the running
`scenes` / `audio` / `prompts` panels.

Mirror the scenes panel, which renders **both** `{reviewBadge}` and `<StoryRunning …>`:

- `{reviewBadge}` — the existing memo at `StoryView.jsx:1133`. Gives the 검토/수정 phase and
  survives as a sticky error badge after the run ends.
- `{synopsisReviewing && <StoryRunning label={t('story.review.running','검수 중')}
  startedAt={synopsisReviewStartedAt} log={synopsisProgressLog} />}` — gives the stopwatch and
  the log window, with
  `const synopsisProgressLog = progressLog.filter((e) => e.step === 'synopsis')`.

This needs one new local: `synopsisReviewStartedAt`, set on the same `useEffect` pattern as the
existing `synopsisStartedAt`. No new component and no new CSS.

`renderReviewControl` gains an `autoToggle = true` option. Synopsis passes
`{ manual: true, autoToggle: false, canReview: !!synopsisDraft.trim() }`, which suppresses the
`자동검수` checkbox and renders only the rounds input and the `[검수]` button.

`[검수]` is disabled while `synopsisGenerating || synopsisReviewing || isRunning`, or when the
draft is empty.

`[⏹ 중단]` renders when `synopsisGenerating || synopsisReviewing` and calls the existing
`handleAbort` — main's `abort()` calls `synopsisController?.abort()` unconditionally, so it
cancels the side action even though no step is running.

**The `aborting` reset effect must learn about review**, or the button sticks. It currently reads

```js
useEffect(() => { if (!synopsisGenerating && !isRunning) setAborting(false) }, [synopsisGenerating, isRunning])
```

During a synopsis review both deps are already `false` and neither ever changes, so after
`handleAbort` sets `aborting = true` the effect never re-runs and `[⏹ 중단]` stays frozen at
`중단 중…` — for this review and every one after it. Add `synopsisReviewing` to both the
condition and the dependency array.

Both `title` and `pasted` modes get the button. Since commit `4dc3bab` the synopsis textarea
renders in both modes (a pasted script has its synopsis reverse-extracted), so the draft is
always reviewable. The stale comment above `.story-synopsis-phase` claiming pasted hides the
body is wrong but out of scope here.

### Required constant + state additions

`renderReviewControl('synopsis', …)` reads `REVIEW_TARGET_LABEL[target]` and
`reviewSettings[target].rounds`. Both are three-target today; omitting either crashes at render.

- `REVIEW_TARGET_LABEL.synopsis = '시놉시스'`
- `defaultReviewRounds('synopsis', model)` → `1`
- `makeReviewSettings` gains `synopsis: { enabled: false, rounds: clampReviewRounds(opts.review?.synopsis?.rounds ?? 1) }`
- `REVIEW_TARGET_ORDER` **unchanged** — `['script','scenes','prompts']`, so the Setup tab is untouched.

### Handler

`handleManualReview` branches on `synopsis`: instead of `start(target, …)` it calls

```js
const r = await pipeline.reviewSynopsis({
  synopsisMd: synopsisDraft,
  characters: characterDrafts.map(normalizeStoryCharacter),
  options: currentOptions(),
  review: { synopsis: { enabled: true, rounds: reviewSettings.synopsis.rounds } },
})
if (!r || r.error || r.aborted) return           // busy / abort / failure → keep the draft
if (typeof r.synopsisMd !== 'string') return     // defensive: never write undefined into the draft
setSynopsisDraft(r.synopsisMd)
setCharacterDrafts((r.characters || []).map(normalizeStoryCharacter))
```

**This guard is load-bearing, and `r.error` alone is not enough.** Three non-result shapes reach
it: `{ error: 'busy' }` from the busy guard, `{ aborted: true }` from the wrapper's abort catch —
which has **no `error` key** — and `undefined` when the step machine returns early on abort.
Applying any of them blindly calls `setSynopsisDraft(undefined)` and `setCharacterDrafts([])`,
destroying the user's draft. Double-clicking `[검수]` reproduces this through the busy path;
pressing `[⏹ 중단]` reproduces it through the abort path.

Passing the local draft mirrors how manual script review passes `scriptOverride: scriptText` —
unsaved edits are reviewed, not the last saved copy.

## IPC

- `electron/ipc/story-api.js`: `ipcMain.handle('story:review-synopsis', …)`
- `electron/preload.js`: `storyReviewSynopsis: (params) => ipcRenderer.invoke('story:review-synopsis', params)`

No new event channel — `story:progress` and `story:synopsis-delta` are already in the preload
allowlist.

## Tests

### Unit/Adapter — `tests/api/llm/llmClaude.test.js`, `llmCodex.test.js`

- `reviewSynopsis` maps a non-`revise` verdict to `pass`.
- `reviseSynopsis` parses `body + CHARACTERS_JSON + [...]` into `{ synopsisMd, characters }`.
- `reviseSynopsis` with no marker falls back to `characters: []` and keeps the body.
- Both propagate `signal` and throw `Aborted` when the signal is aborted.

Critique handling differs by adapter — assert each for what it actually does:

- **Claude** goes through `structuredClaudeCall` → `assertSchema`, and `REVIEW_SCHEMA` declares
  `required: ['verdict','critique']`. A response missing `critique` **throws**
  `missing required 'critique'`. Assert the throw. A present-but-empty `critique: ''` passes
  validation and normalizes to `''`.
- **Codex** calls an injected `runJson` and does no local `assertSchema`
  (`llmCodex.js: reviewScript`). A mocked `runJson` returning `{ verdict: 'pass' }` yields
  `critique: ''` via `out.critique || ''` and does **not** throw. Assert that. Do not add local
  schema validation to the Codex adapter — that would change `reviewScript`/`reviewScenes`
  behavior and is out of scope.

### Unit/Router — `tests/api/llm/storyLlmRouter.test.js`

- `reviewSynopsis` / `reviseSynopsis` route to codex when `engine === 'codex'`, claude otherwise.
- Options normalize at index 2 / 3 respectively.
- Missing adapter method throws the standard `does not implement` error.

### Unit/Step Machine — `tests/story/stepMachine.test.js`

- Emits `story:synopsis-delta { phase:'started' }` before any progress event, sharing one
  `operationId` across every event of the run.
- Runs exactly `rounds` review calls when every verdict is `revise` with a non-empty critique.
- Stops early and never calls `reviseSynopsis` when the verdict is `pass`.
- Stops early when the verdict is `revise` but the critique is blank.
- Clamps `rounds: 999` down to 5 review calls.
- Returns `{ changed: false }` without calling the LLM when `reviewConfig` reports disabled.
- Throws when `reviseSynopsis` returns an empty synopsis.
- Reports `changed: true` for a revision that alters only `characters`, leaving `synopsisMd`
  byte-identical.
- Returns `{ synopsisMd, characters, changed }` and writes nothing to `store`.
- Returns `{ error: 'busy' }` while a step is running, a preview is active, or another
  synopsis/research side action holds a controller.
- Abort mid-round resolves without a result and releases `synopsisController`.

### Unit/Renderer — `tests/hooks/useStoryPipeline.test.js`

- A `kind:'review', target:'synopsis'` event whose `operationId` matches `synopsisActiveOpRef`
  is **not** dropped by the step op filter and lands in `progressLog`.
- The same event with a stale `operationId` is dropped.
- The log line reads `시놉시스 검수`, not `시나리오 검수`.
- Log rows carry `step: 'synopsis'` and so do not leak into `scenesProgressLog`.
- A second `reviewSynopsis` call starts with an empty `progressLog` (no stale rows from the first).
- A re-entrant `reviewSynopsis` call while one is in flight returns `{ error: 'busy' }` without
  invoking IPC, sets no `synopsisError`, and leaves `synopsisReviewing` true until the *first*
  call settles.
- A review in flight across a project switch does not clear the new project's
  `synopsisReviewing` / `reviewProgress` when its promise finally settles (owner-token check).
- An orphaned review resolving with `{ error: 'stale-token' }` after a project switch does **not**
  set `synopsisError` on the new project.
- `synopsisReviewing` is exported from both hook return paths (including the `justSwitched`
  literal-default return) and reset on project switch.
- `reviewProgress` is cleared when `reviewSynopsis` settles, but an `error` badge survives.
- An invoke rejection is converted to `{ error: msg }`; a rejection whose message matches
  `/abort/i` is converted to `{ aborted: true }` and sets no `synopsisError`.

### Integration — `tests/components/story/StoryView.synopsisReview.test.jsx`

- The synopsis panel renders a `[검수]` button and a rounds input, and **no** `자동검수` checkbox.
- The button renders in both `title` and `pasted` modes.
- `[검수]` is disabled when the draft is empty and while generating/reviewing.
- Clicking `[검수]` calls `pipeline.reviewSynopsis` with the current draft and the normalized
  `characterDrafts` — including card edits not yet confirmed.
- A resolved review replaces the textarea content and the character cards.
- **`{ error: 'busy' }`, `{ aborted: true }`, and `undefined` each leave the draft and
  characters untouched** — one case per assertion, since `{ aborted: true }` has no `error` key.
- The textarea stays visible during review (it is not swapped for the streaming view) and is
  `readOnly`; the character cards are `disabled`.
- `[⏹ 중단]` appears while reviewing and calls `abort`.
- After aborting a review, `aborting` resets so a subsequent review renders `[⏹ 중단]` enabled
  rather than a stuck `중단 중…`.
- Review progress renders in `reviewBadge`, and `StoryRunning` mounts with the synopsis-filtered
  log rows.
- The Setup tab still shows exactly three review controls.

Mirror `tests/components/story/StoryView.reviewLoop.test.jsx` for harness setup.

## Out of Scope

- Auto-review of the synopsis during generation.
- Reviewing the research step.
- Persisting review critiques for later display.
- Adding an upper clamp to `reviewConfig` for the existing three targets.
