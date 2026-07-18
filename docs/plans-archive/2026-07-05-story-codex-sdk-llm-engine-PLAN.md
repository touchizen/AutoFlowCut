# Story Codex SDK LLM Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Codex SDK as an additional Story LLM engine while preserving the existing Claude Agent SDK path.

**Architecture:** Main process owns a dynamic Story LLM catalog and a router adapter that dispatches to Claude or Codex behind the existing step-machine LLM interface. Renderer receives the catalog through `useStoryPipeline`, sends normalized `{ engine, model, reasoningEffort }` options, and passes current UI options to title generation so blank-title flows route correctly.

**Tech Stack:** Electron main/preload IPC, React StoryView, Vitest, `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`.

---

## Prerequisites

- Use TDD for every production change.
- Do not commit without user approval.
- Do not push.
- If `npm install @openai/codex-sdk` fails due to network/sandboxing, request escalation.
- Stop and update the spec if the installed Codex SDK surface cannot satisfy the Slice 0 contract.

## Task 1: SDK Contract And Package Shape

**Files:**
- Modify: `package.json`
- Create: `tests/electron/api/llm/codexSdkImport.test.js`

**Step 1: Write the failing package-shape test**

Create a test that imports `@openai/codex-sdk`, verifies `Codex` exists, constructs an instance without running the network, checks `startThread`/`resumeThread`, inspects installed package metadata for the wrapped CLI/runtime dependency, and checks `package.json` `build.asarUnpack` covers `node_modules/@openai/codex*/**` when needed.

**Step 2: Run RED**

Run: `npx vitest run tests/electron/api/llm/codexSdkImport.test.js`

Expected: fail because dependency and asarUnpack are absent.

**Step 3: Install dependency and update package metadata**

Run: `npm install @openai/codex-sdk --save`

Then update `package.json`:

- Add dependency.
- Add `node_modules/@openai/codex*/**` to `build.asarUnpack` if package-shape test requires it.

**Step 4: Run GREEN**

Run: `npx vitest run tests/electron/api/llm/codexSdkImport.test.js`

Expected: pass.

## Task 2: Story LLM Catalog

**Files:**
- Create: `electron/api/llm/storyLlmCatalog.js`
- Test: `tests/electron/api/llm/storyLlmCatalog.test.js`

**Step 1: Write RED tests**

Cover:

- Four initial options.
- Stable ids.
- Default is Claude Opus 4.8.
- `hydrateStoryLlmSelection()` handles old `model`-only Claude state.
- New Codex state hydrates with reasoning default.
- Invalid values fall back to default.
- `normalizeStoryLlmOptions()` strips `reasoningEffort` for Claude and defaults it for Codex.

**Step 2: Run RED**

Run: `npx vitest run tests/electron/api/llm/storyLlmCatalog.test.js`

Expected: fail because module does not exist.

**Step 3: Implement minimal catalog module**

Add the four catalog entries and helper functions from the spec.

**Step 4: Run GREEN**

Run: `npx vitest run tests/electron/api/llm/storyLlmCatalog.test.js`

Expected: pass.

## Task 3: Catalog IPC, Preload, Hook

**Files:**
- Modify: `electron/ipc/story-api.js`
- Modify: `electron/preload.js`
- Modify: `src/hooks/useStoryPipeline.js`
- Modify: `tests/mocks/electronAPI.js`
- Test: `tests/electron/ipc/story-api.test.js`
- Test: `tests/electron/preloadContract.test.js`
- Test: `tests/hooks/useStoryPipeline.test.js`

**Step 1: Write RED tests**

Cover:

- `story:list-llm-options` returns catalog/default.
- Preload exposes `storyListLlmOptions`.
- `useStoryPipeline` calls `storyListLlmOptions` once and exposes `llmOptions/defaultLlmOption`.
- Missing bridge is tolerated.
- Mock electron API includes the new bridge.

**Step 2: Run RED**

Run targeted tests.

**Step 3: Implement IPC/preload/hook wiring**

Register `story:list-llm-options`, expose `storyListLlmOptions`, add hook state, and return catalog fields in all hook return paths including project-switch fallback.

**Step 4: Run GREEN**

Run targeted tests again.

## Task 4: StoryView Dynamic Engine UI

**Files:**
- Modify: `src/components/story/StoryView.jsx`
- Test: `tests/components/story/StoryView.form.test.jsx`
- Test: `tests/components/story/StoryView.setup.test.jsx`

**Step 1: Write RED tests**

Cover:

- Renders models from injected `pipeline.llmOptions`.
- Default remains Claude Opus 4.8.
- Codex GPT-5.5 selection shows reasoning select.
- Codex GPT-5.5 + xhigh sends `{ engine:'codex', model:'gpt-5.5', reasoningEffort:'xhigh' }`.
- Claude sends `{ engine:'claude', model:'claude-opus-4-8' }` without `reasoningEffort`.
- Old hydrated `model:'claude-sonnet-5'` selects the right option.
- New hydrated Codex state selects model and reasoning.
- Late catalog arrival does not overwrite a user-changed selection.

**Step 2: Run RED**

Run StoryView setup/form tests.

**Step 3: Implement minimal UI change**

Replace hard-coded model options with catalog ids. Add Codex-only reasoning select. Keep existing labels/layout.

**Step 4: Run GREEN**

Run StoryView setup/form tests.

## Task 5: Current UI Options For Title Generation

**Files:**
- Modify: `src/components/story/StoryView.jsx`
- Modify: `src/hooks/useStoryPipeline.js`
- Modify: `electron/ipc/story-api.js`
- Modify: `electron/story/stepMachine.js`
- Test: `tests/components/story/StoryView.form.test.jsx`
- Test: `tests/hooks/useStoryPipeline.scriptText.test.js`
- Test: `tests/electron/ipc/story-api.generateTitle.test.js`

**Step 1: Write RED tests**

Cover:

- Blank-title split after selecting Codex calls `generateTitle(scriptText, currentOptions())`.
- Blank-title rewrite after selecting Codex does the same.
- Hook forwards `{ scriptMd, options }`.
- IPC forwards options to `machine.generateTitle`.
- Machine uses override options before persisted state.

**Step 2: Run RED**

Run targeted tests.

**Step 3: Implement option forwarding**

Update `resolveTitle`, hook callback, IPC handler, and `machine.generateTitle(scriptMd, optionsOverride)`.

**Step 4: Run GREEN**

Run targeted tests.

## Task 6: LLM Router

**Files:**
- Create: `electron/api/llm/storyLlmRouter.js`
- Modify: `electron/main.js`
- Test: `tests/electron/api/llm/storyLlmRouter.test.js`
- Test: `tests/electron/story/stepMachine.claude.test.js`

**Step 1: Write RED tests**

Cover:

- `engine:'codex'` dispatches all methods to Codex adapter.
- Missing engine dispatches to Claude.
- Unknown engine throws clear error.
- Existing Claude default behavior remains.

**Step 2: Run RED**

Run router tests.

**Step 3: Implement router**

Add adapter factory/injection-friendly exports so tests can pass mocked Claude/Codex adapters. Switch `electron/main.js` to pass router.

**Step 4: Run GREEN**

Run router and existing stepMachine Claude test.

## Task 7: StepMachine Option Normalization

**Files:**
- Modify: `electron/story/stepMachine.js`
- Test: `tests/electron/story/stepMachine.scriptRedesign.test.js`
- Test: `tests/electron/story/stepMachine.reviewLoop.test.js`
- Test: new or existing stepMachine routing tests

**Step 1: Write RED tests**

Cover:

- Generated script persists normalized options.
- Pasted script persists normalized Codex options without calling LLM.
- Continue/rewrite persists normalized options.
- Scenes/prompts/review/revise use normalized options.
- Old missing-engine options route as Claude.

**Step 2: Run RED**

Run targeted stepMachine tests.

**Step 3: Implement normalization at run boundaries**

Call catalog normalization where `state.input.options` is written and where opts are built.

**Step 4: Run GREEN**

Run targeted stepMachine tests.

## Task 8: Codex SDK Helper

**Files:**
- Create: `electron/api/llm/codexSdk.js`
- Test: `tests/electron/api/llm/codexSdk.test.js`

**Step 1: Write RED tests**

Cover:

- Builds config with model, reasoning effort, ChatGPT auth, read-only sandbox, never approvals.
- Uses controlled temp working directory with `skipGitRepoCheck:true`.
- Does not pass API-key/token env vars.
- Preflight auth failures return login-required hint.
- Extracts `turn.finalResponse` first.
- Handles streamed `turn.completed` final data if streaming is enabled.
- Aborted signal throws `Aborted`.
- Timeout aborts hung SDK run.

**Step 2: Run RED**

Run helper tests.

**Step 3: Implement helper**

Implement with dependency injection for `Codex`, temp dir, clock/timer, and package env so tests never call real Codex.

**Step 4: Run GREEN**

Run helper tests.

## Task 9: Codex LLM Adapter

**Files:**
- Create: `electron/api/llm/llmCodex.js`
- Test: `tests/electron/api/llm/llmCodex.test.js`

**Step 1: Write RED tests**

Cover all Story LLM methods:

- `generateScript`
- `continueScript`
- `generateTitle`
- `splitScenes` with `outputSchema`
- `writePrompts` with `outputSchema`
- `reviewScript`
- `reviseScript`

**Step 2: Run RED**

Run adapter tests.

**Step 3: Implement adapter**

Reuse `prompts.js`, `toJsonSchema.js`, `schemas.js`, loose JSON parser, and validation logic mirroring Claude behavior.

**Step 4: Run GREEN**

Run adapter tests.

## Task 10: Integration And Verification

**Files:**
- Test: `tests/electron/ipc/story-api.test.js`
- Test: `tests/integration/storyClaudePipeline.test.js`
- Test: new Codex integration test if needed
- Modify: `.superpowers/sdd/progress.md`

**Step 1: Write/adjust RED integration tests**

Cover:

- IPC + router can run `script` through Codex with mocked Codex adapter.
- Pasted-script Codex options persist, then scenes/prompts route to Codex.
- Claude integration remains unchanged.

**Step 2: Run targeted tests**

Run Story/LLM targeted suites.

**Step 3: Run full verification**

Run: `npm test -- --run`

Expected: all tests pass.

**Step 4: Request implementation code review**

Use `gpt-5.5` / `xhigh`. Loop until findings 0.

**Step 5: Update progress ledger**

Update `.superpowers/sdd/progress.md` with the completed Codex SDK integration status and test/review evidence.
