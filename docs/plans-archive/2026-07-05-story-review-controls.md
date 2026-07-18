# Story Review Controls Spec

Date: 2026-07-05
Branch: feature/story-pipeline

## Goal

Extend Story AI review from script-only M3 into a controllable review system for script, scenes, and prompts:

- Automatic review during the normal pipeline.
- Manual "AI review" controls on each completed tab.
- Per-stage review round counts.
- Script review rubric centered on immersion/curiosity/anticipation, not genre meta-prompt rules.

## Decisions

- Keep generation meta prompts unchanged. The script generator may still use genre meta prompts.
- Do not pass genre metaPrompt into review prompts. Review should judge whether the viewer wants to keep watching.
- Review calls must use review-specific options with `metaPrompt` removed, even when the script generation step loaded a genre meta prompt for generation.
- Use a unified review option:

```js
review: {
  script: { enabled: true, rounds: 3 },
  scenes: { enabled: true, rounds: 2 },
  prompts: { enabled: true, rounds: 2 },
}
```

- `rounds: 0` disables that stage.
- The existing legacy `reviewLoop: true` maps to script review only and preserves current provider behavior:
  - Claude models: existing `reviewRounds(model)` result, currently 3.
  - Non-Claude models: existing `reviewRounds(model)` result, currently 1.
  - Scenes/prompts remain disabled. This avoids surprising old projects by adding new review stages.
- A new explicit `review` object is the source of truth when present. If both `review` and `reviewLoop` exist, `review` wins.
- Legacy hydrate must display scenes/prompts as disabled (`rounds:0` or `enabled:false`). Opening a legacy project and starting/saving without touching review controls must not silently enable scenes/prompts review.
- Legacy hydrate must also preserve provider-specific script rounds. Until the user edits any review control, `currentOptions()` keeps `reviewLoop:true` and omits the new `review` object. The displayed script rounds are derived from the selected model using the existing `reviewRounds(model)` behavior (Claude 3, non-Claude 1). If the user edits review controls, the UI converts to an explicit `review` object from that point onward.
- New setup UI writes `review` instead of only `reviewLoop` after any review control is edited.
- Defaults in setup remain off. Displayed rounds are script=3 for Claude models, script=1 for non-Claude models, scenes=1, prompts=1.

## Review Rubrics

### Script

Use an immersion-first rubric:

- Curiosity: does the opening and each beat raise a question the viewer wants answered?
- Anticipation: does the story create expectation for the next moment?
- Momentum: are there dull/expository stretches that should be tightened?
- Clarity: can the viewer follow who wants what and why?
- Payoff: does the ending satisfy or deepen the hook?

Genre is only light context. Do not enforce genre-specific formulas from meta prompts.

### Scenes

Review the split itself, not only text quality:

- No important script beat is omitted.
- Scene boundaries follow meaning/action changes.
- Scene length is suitable for the configured granularity.
- Speaker attribution is correct.
- Character speaker list and appearance are consistent.
- SFX segments are necessary and placed at the right story moment.
- The resulting scene sequence preserves curiosity/anticipation.

If revision is needed, return revised `SCENES_SCHEMA` output. The step machine must validate it, inherit story/segment ids, and save only a valid candidate.
When revised speakers are applied, preserve existing user choices by normalized speaker name/id where possible:

- Existing `voice` mapping survives if the same speaker remains.
- Existing `appearance` may be updated by the revised speaker when present.
- Removed speakers lose their voice mapping.
- New speakers start with `voice:null`.

### Prompts

Review prompt output against the already accepted scenes:

- Every scene has non-empty English image/video prompts.
- Prompts express the actual scene beat and camera/action clearly.
- Character appearance stays consistent.
- Video prompts are motion/action oriented, not a duplicate of image prompts.
- No scene structure, segment order, speaker ids, or story ids are changed.

If revision is needed, return revised `PROMPTS_SCHEMA` output and merge prompt fields only.

## LLM Adapter Surface

Add methods to each Story LLM adapter and router:

- `reviewScenes(scriptMd, scenes, speakers, opts, ctx) -> { verdict, critique }`
- `reviseScenes(scriptMd, scenes, speakers, critique, opts, ctx) -> { scenes, speakers }`
- `reviewPrompts(scenes, context, opts, ctx) -> { verdict, critique }`
- `revisePrompts(scenes, context, critique, opts, ctx) -> { scenes }`

Existing:

- `reviewScript(scriptMd, opts, ctx)`
- `reviseScript(scriptMd, critique, opts, ctx)`

All review prompts use the selected provider/model/reasoning options. Review prompts must include the Story backend guard for Codex.

Router option index contract:

```js
reviewScenes: 3
reviseScenes: 4
reviewPrompts: 2
revisePrompts: 3
```

Tests must cover a Codex-selected call for every new method so `METHOD_OPTION_INDEX` mistakes are caught.

## Step Machine

### Automatic Review

- `script` step: after generation, run script review if enabled. Save each valid revised script. If script changes, normal script downstream reset already applies.
- `scenes` step: after split and before final save, run scenes review if enabled. Each revise output must pass schema/post-validation and identity normalization before it can replace the candidate.
- `prompts` step: after prompt generation and before final save/push, run prompts review if enabled. Each revise output must pass prompt coverage validation before it can replace prompt fields.

Review failures are soft failures:

- Emit review progress error.
- Keep the last valid candidate.
- Mark the step `done` unless the base generation/split/writePrompt operation failed.

### Manual Tab Review

Use the same `start(step, params)` path with `params.reviewOnly === true`.
Manual review calls must include current renderer LLM/options:

```js
{ reviewOnly: true, options: currentOptions(), review: { ... } }
```

StepMachine resolves LLM options as `{ ...state.input.options, ...params.options }`, then applies `params.review`.
If `params.options` is absent, it falls back to `state.input.options`.

- Script tab: `start('script', { reviewOnly:true, options:currentOptions(), review:{ script:{ rounds:N } } })`
  - Loads current `script.md`; does not generate.
  - If revised, saves script and resets scenes/audio/prompts.
  - If pass/no revision, leaves downstream statuses unchanged.
- Scenes tab: `start('scenes', { reviewOnly:true, options:currentOptions(), review:{ scenes:{ rounds:N } } })`
  - Loads current `script.md` and `scenes.json`; does not split from scratch.
  - If revised, validates/normalizes/saves scenes and resets audio/prompts.
  - Preserves speaker `voice` selections for unchanged speakers.
  - If pass/no revision, leaves downstream statuses unchanged.
- Prompts tab: `start('prompts', { reviewOnly:true, options:currentOptions(), review:{ prompts:{ rounds:N } } })`
  - Loads current `scenes.json`; does not call writePrompts from scratch.
  - If revised, saves prompt fields and emits push if prompts were already done/pushable.

For `reviewOnly`, downstream reset is deferred until after the step returns. Current `start()` resets
downstream before executing a step; implementation must change this:

- Normal generation/split/prompt runs keep the current pre-run downstream reset.
- `reviewOnly` runs do not pre-reset downstream.
- If the review step returns `{ changed:false }`, downstream status, `pendingPushRevision`, `lastPushedRevision`, manifest `pushRevision`, and push state remain unchanged.
- If the review step returns `{ changed:true }`, reset only that step's true downstream:
  - script review changed: reset scenes/audio/prompts.
  - scenes review changed: reset audio/prompts.
  - prompts review changed: do not reset downstream.

### Prompt Review Revision Ownership

Manual prompt review that changes prompt fields must follow the same push/revision ownership rule as the normal prompts step:

- Increment `pendingPushRevision` only after a valid changed prompt candidate exists and before saving/pushing.
- If story audio manifest exists and is already stamped for the previous pushed revision, restamp it to the new `pendingPushRevision` using the same manifest logic as the normal prompts step.
- Flush state/scenes/manifest before emitting `pushScenes`.
- Emit `pushScenes` only for a changed prompt review.
- Pass/no-change prompt review must not alter `pendingPushRevision`, `lastPushedRevision`, manifest `pushRevision`, or emit push.

## Progress Events

Generalize review progress:

```js
{ kind: 'review', target: 'script'|'scenes'|'prompts', round, of, phase: 'reviewing'|'revising'|'error', error? }
```

Renderer keeps `reviewProgress` and displays the badge on the relevant tab/panel:

- `대본 검토 중 1/3`
- `씬 수정 중 1/2`
- `프롬프트 검토 중 1/2`

Backward compatibility: renderer may still accept old `kind:'script-review'` events during transition, but new code emits `kind:'review'`.

## UI

### Setup Tab

Replace the old `대본 자동 검토·수정` checkbox with compact review controls:

- Toggle: `AI 자동 검수·수정`
- Steppers/number inputs:
  - `대본` default 3
  - `씬` default 2
  - `프롬프트` default 2

When toggle is off, all stages are disabled in `review`.
When toggle is on, each stage is enabled if its rounds > 0.

Legacy `reviewLoop:true` hydrate behavior:

- Show auto review enabled.
- Show script rounds derived from current selected model (`reviewRounds(model)`), not the generic setup default.
- Show scenes/prompts disabled.
- If the user starts without changing review controls, send `reviewLoop:true` and no `review`.
- If the user changes any review control, send explicit `review` and stop relying on `reviewLoop`.

### Stage Tabs

Add compact controls where a user naturally reviews that stage:

- Script editor controls: `AI 검수` button + rounds input.
- Scenes tab shared bottom action row, beside the existing step buttons: `AI 검수` button + rounds input.
- Prompts tab shared bottom action row, beside the existing step buttons: `AI 검수` button + rounds input.

The manual review controls should look and behave consistently across script/scenes/prompts:

- The review label, round input, and run button stay on one horizontal control unit; wrapping may move the whole unit, not individual characters.
- Button and number input heights match the existing story action density.
- All visible review strings and accessibility labels use `story.*` localization keys, with Korean fallback only for provider-less unit tests.

Disable the button while any step is running. Disable when required files are missing:

- Script: no script text.
- Scenes: no scenes.
- Prompts: no prompts.

## Tests

### Unit/Adapter

- Prompt builders do not include genre metaPrompt in review prompts.
- StepMachine passes review-specific opts without `metaPrompt` to `reviewScript`, `reviseScript`, scenes review, and prompt review.
- Claude/Codex/Gemini adapters expose scenes/prompts review and revise methods.
- Router routes new methods and preserves selected model/reasoning options.
- Router tests cover all new method option indexes using Codex options.

### Step Machine

- Legacy `reviewLoop:true` triggers only script review.
- Legacy `reviewLoop:true` keeps existing round behavior: Claude 3, non-Claude 1.
- New `review` option can run script/scenes/prompts reviews with configured rounds.
- When both `review` and `reviewLoop` are present, `review` wins.
- Script manual review pass does not reset downstream; revise does.
- Scenes manual review pass does not reset audio/prompts; revise does.
- Scenes revised output is schema/post-validated and identity-normalized.
- Scenes revised speakers preserve existing `voice` mapping for unchanged speakers.
- Prompts revised output cannot change scene structure and must cover all input scenes.
- Prompt manual review pass/no-change does not change `pendingPushRevision`, `lastPushedRevision`, manifest `pushRevision`, or emit push.
- Prompt manual review changed path increments `pendingPushRevision`, restamps manifest when present, flushes before push, and emits one push.
- Review failure emits error progress and keeps last valid candidate.

### Renderer

- Setup UI writes `review` object with per-stage rounds.
- Existing hydrated `reviewLoop:true` still shows script review enabled.
- Existing hydrated `reviewLoop:true` shows scenes/prompts disabled and saving/starting without changing review controls keeps them disabled.
- Existing hydrated non-Claude `reviewLoop:true` starts with script rounds 1 and sends `reviewLoop:true` without `review` if the user does not edit review controls.
- Hydrated `review` object restores enabled state and all three round counts.
- If hydrated options include both `review` and `reviewLoop`, UI uses `review`.
- Each tab renders manual review controls.
- Scenes/prompts manual review controls render in the same shared bottom button row as the tab's existing action buttons.
- Review controls render localized visible labels and accessibility names when `I18nProvider` is present.
- Manual tab controls call `start(step,{reviewOnly:true, options: currentOptions(), ...})`.
- Review progress badge labels target stage and phase.

## Non-Goals

- No visible numeric quality score in v1. The LLM may use an internal immersion score, but app state only stores pass/revise/critique behavior.
- No manual critique editor in v1.
- No cross-repo/GCF changes.
