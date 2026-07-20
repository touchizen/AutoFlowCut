# Prompts Progressive Streaming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Stream completed prompt scene objects into provisional renderer rows without changing final prompt authority.

**Architecture:** A reusable stateful partial-array parser consumes raw JSON deltas from Claude and Codex. The prompts step emits sanitized, operation-gated progress events that the renderer stores in a sceneNo map and displays only until the next authoritative story state.

**Tech Stack:** Electron ESM, React 18 hooks/components, Vitest, Testing Library.

---

### Task 1: Incremental partial-array parser

**Files:**
- Create: `electron/api/llm/partialScenes.js`
- Create: `tests/electron/api/llm/partialScenes.test.js`

1. Add tests for mid-token chunks, strings containing escaped quotes/braces, whitespace, one/all elements per chunk, custom array key, and malformed tails.
2. Run `npx vitest run tests/electron/api/llm/partialScenes.test.js` and capture the expected missing-module RED.
3. Implement a stateful append-only scanner that emits each closed direct array element once and never throws for malformed partial elements.
4. Re-run the same test for GREEN.

### Task 2: Claude partial text and writePrompts plumbing

**Files:**
- Modify: `electron/api/llm/llmClaude.js`
- Modify: `tests/electron/api/llm/llmClaude.structured.test.js`

1. Add tests that structured `input_json_delta.partial_json` and fallback `text_delta.text` reach `onPartialText`, callback omission is safe, and final return remains the result payload.
2. Add `writePrompts` tests that closed scene objects call `onPartialPrompt` by sceneNo while final merged scenes still come from `result`.
3. Run the focused test and capture RED.
4. Feed partial stream events before existing result handling and create one parser per `writePrompts` call.
5. Re-run for GREEN.

### Task 3: Codex and router callback plumbing

**Files:**
- Modify: `electron/api/llm/codexAppServer.js`
- Modify: `electron/api/llm/storyLlmRouter.js` only if its generic wrapper does not already preserve the context argument
- Modify: `tests/electron/api/llm/codexAppServerRun.test.js`
- Modify: `tests/electron/api/llm/storyLlmRouter.test.js` if callback preservation needs explicit coverage

1. Add a failing `runCodexJson` test asserting raw `params.delta` reaches `onPartialText` and final JSON parse is unchanged.
2. Add/fix a router test proving the writePrompts context callback reaches the selected adapter and a non-streaming adapter may ignore it.
3. Run focused tests for RED.
4. Map the structured-call callback to `runCodexTurn`'s existing `onDelta` dependency without changing `runCodexText` behavior.
5. Re-run for GREEN.

### Task 4: Step-machine prompt progress events

**Files:**
- Modify: `electron/story/stepMachine.js`
- Modify: `tests/electron/story/stepMachine.audioPrompts.integration.test.js` or add a focused prompt streaming integration test

1. Add a failing test asserting started is emitted before deltas, callback data is sanitized, and operationId is stable.
2. Run the focused test for RED.
3. Emit the prompt started gate immediately before each writePrompts call and pass `onPartialPrompt` in the adapter context.
4. Re-run for GREEN.

### Task 5: Renderer map and ghost rows

**Files:**
- Modify: `src/hooks/useStoryPipeline.js`
- Modify: `src/components/story/StoryView.jsx`
- Modify: `src/components/story/StoryView.css`
- Add/Modify: `tests/hooks/useStoryPipeline.promptDelta.test.js`
- Modify: `tests/components/story/StoryView.test.jsx`

1. Add hook tests for started reset, sceneNo accumulation, stale-op and ungated drop, final `story:state` clear, and project switch reset.
2. Add a component test that prompts-running retains final scene rows and renders streamed values as non-editable ghost cells.
3. Run both focused tests for RED.
4. Add prompt-specific state/ref handling and expose `previewPrompts`; render map values only during prompts generation with provisional styling.
5. Re-run for GREEN.

### Task 6: Verification

1. Run every new/affected focused test and record file/test counts.
2. Run the touched LLM, step-machine, hook, and StoryView suites together.
3. Run `git diff --check`, inspect `git diff`, and verify no item-4 provisional scene preview or commits were added.
