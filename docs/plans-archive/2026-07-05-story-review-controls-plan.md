# Story Review Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-stage Story AI review controls for script, scenes, and prompts with automatic and manual review modes.

**Architecture:** Extend the existing M3 script review loop into reusable review helpers in `stepMachine`, add scenes/prompts review+revise adapter methods, and expose compact review controls in `StoryView`. Preserve legacy `reviewLoop` behavior until the user edits the new review controls.

**Tech Stack:** Electron main step machine, Story LLM adapters/router, React StoryView, Vitest.

---

### Task 1: Review Option And Prompt Contracts

**Files:**
- Modify: `electron/api/llm/prompts.js`
- Modify: `electron/api/llm/schemas.js`
- Modify: `electron/api/llm/storyLlmRouter.js`
- Test: `tests/electron/api/llm/llmClaude.structured.test.js`
- Test: `tests/electron/api/llm/llmCodex.test.js`
- Test: `tests/electron/api/llm/llmGemini.test.js`
- Test: `tests/electron/api/llm/storyLlmRouter.test.js`

**Steps:**
1. RED: add tests for immersion-focused script review prompt without metaPrompt.
2. RED: add tests for scenes/prompts review+revise adapter methods.
3. RED: add router tests for new method option indexes, especially Codex model/reasoning routing.
4. GREEN: add prompt builders, schemas if needed, adapter methods, and router indexes.
5. Verify targeted LLM tests.

### Task 2: StepMachine Automatic Review

**Files:**
- Modify: `electron/story/stepMachine.js`
- Test: `tests/electron/story/stepMachine.reviewLoop.test.js`
- Test: new `tests/electron/story/stepMachine.reviewControls.test.js`

**Steps:**
1. RED: legacy `reviewLoop:true` preserves Claude 3/non-Claude 1 script-only behavior.
2. RED: explicit `review` runs script/scenes/prompts with configured rounds.
3. RED: review opts passed to LLM do not include `metaPrompt`.
4. GREEN: add review option normalization and reusable review loop helpers.
5. Verify targeted stepMachine tests.

### Task 3: StepMachine Manual Review

**Files:**
- Modify: `electron/story/stepMachine.js`
- Test: `tests/electron/story/stepMachine.reviewControls.test.js`

**Steps:**
1. RED: manual script review pass does not reset downstream; revise does.
2. RED: manual scenes review pass does not reset audio/prompts; revise does and preserves speaker voice mappings.
3. RED: manual prompts review pass/no-change does not change push revisions; revise increments/stamps/flushes/pushes.
4. GREEN: implement `params.reviewOnly` reset deferral and changed-result handling.
5. Verify targeted stepMachine tests.

### Task 4: Renderer Controls

**Files:**
- Modify: `src/components/story/StoryView.jsx`
- Modify: `src/components/story/StoryView.css`
- Modify: `src/hooks/useStoryPipeline.js`
- Test: `tests/components/story/StoryView.reviewLoop.test.jsx`
- Test: `tests/hooks/useStoryPipeline.progress.test.js`

**Steps:**
1. RED: setup writes explicit `review` object after review controls are edited.
2. RED: legacy `reviewLoop:true` hydrates script-only and sends legacy shape until review controls are edited.
3. RED: each tab renders manual review button+rounds and calls `start(step,{reviewOnly:true, options:currentOptions(), review:{...}})`.
4. RED: generalized review progress labels target script/scenes/prompts.
5. RED: scenes/prompts manual review controls render in the shared bottom button row beside existing tab actions, and review labels/aria names localize through `story.*`.
6. GREEN: implement UI state, controls, progress mapping, shared bottom action placement, consistent review sizing, and locale keys.
7. Verify component/hook tests.

### Task 5: Review And Final Verification

**Steps:**
1. Run focused tests after each task.
2. Request code review with `model:gpt-5.5`, `reasoning_effort:xhigh`.
3. Fix review findings until findings 0.
4. Run `npm test`, `npm run build`, `git diff --check`.
5. Update `.superpowers/sdd/progress.md`.
6. Commit only after user approval or explicit commit request, with `Co-Authored-By`.
