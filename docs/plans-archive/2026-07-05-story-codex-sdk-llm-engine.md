# Story Codex SDK LLM Engine Spec

Date: 2026-07-05
Branch: feature/story-pipeline
Status: Draft for direction review

## Goal

Add Codex SDK as a second Story LLM engine while keeping the existing Claude Agent SDK path intact. Users can choose Claude or Codex from the Story setup screen before StoryView leaves the setup phase, and Codex can use the user's local ChatGPT/Codex login without requiring an OpenAI API key.

This is an additive engine integration, not a replacement:

- Claude remains available and remains the compatibility default.
- Codex is added as selectable Story generation engine.
- Both engines share the existing Story step-machine contract.

## Source Facts

OpenAI official docs checked on 2026-07-05:

- Codex SDK controls local Codex agents programmatically via `@openai/codex-sdk`.
- Codex SDK is server-side Node.js oriented and requires Node.js 18 or later.
- The TypeScript SDK wraps the `codex` CLI and exchanges JSONL events over stdin/stdout.
- `Codex().startThread()` defaults to the current working directory; a non-git working directory requires `skipGitRepoCheck: true`.
- The TypeScript SDK returns `turn.finalResponse`; `runStreamed()` emits events including `turn.completed`.
- The TypeScript SDK supports per-turn structured output via `outputSchema`.
- The TypeScript SDK lets the host control CLI environment variables via the `new Codex({ env })` option.
- Codex CLI first run can authenticate with either a ChatGPT account or an API key.
- Codex is included in ChatGPT Free/Go/Plus/Pro/Business/Edu/Enterprise plans, with plan-specific limits.
- API key mode is separate and uses API token pricing.
- Codex config supports `model` and `model_reasoning_effort`, with reasoning values `minimal | low | medium | high | xhigh` where supported.
- Codex config supports `forced_login_method`, `approval_policy`, `sandbox_mode`, `shell_environment_policy`, `model_instructions_file`, and `projects.<path>.trust_level`.

Product decision:

- AutoFlowCut will target the ChatGPT account login path first.
- No OpenAI API key field is added for this milestone.
- If local Codex auth/session is missing, Story shows a normal step error explaining Codex login is required.
- Story generation must not trigger an interactive browser/device-login flow. Missing auth fails fast with instructions.
- Story generation must not silently switch to API-key mode if `OPENAI_API_KEY`, `CODEX_API_KEY`, or similar variables are present in the Electron process environment.

## Current Architecture

Current Story flow:

1. `src/components/story/StoryView.jsx` stores setup options and calls `start('script', { input, options })`.
2. `src/hooks/useStoryPipeline.js` sends `story:start` IPC.
3. `electron/ipc/story-api.js` owns the per-project step machine and injects an LLM adapter.
4. `electron/story/stepMachine.js` calls the injected adapter through a stable interface:
   - `generateScript`
   - `continueScript`
   - `generateTitle`
   - `splitScenes`
   - `reviewScript`
   - `reviseScript`
   - `writePrompts`
5. `electron/api/llm/llmClaude.js` implements that interface using `@anthropic-ai/claude-agent-sdk`.

This shape is already good for a second engine. Codex should fit beside Claude behind the same adapter contract.

## User Experience

Story setup shows a dynamic "생성 AI" select sourced from main process, not hard-coded JSX options.

Initial catalog:

```js
[
  {
    id: 'claude:claude-opus-4-8',
    engine: 'claude',
    model: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
  },
  {
    id: 'claude:claude-sonnet-5',
    engine: 'claude',
    model: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
  },
  {
    id: 'codex:gpt-5.5',
    engine: 'codex',
    model: 'gpt-5.5',
    label: 'Codex GPT-5.5',
    reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'xhigh',
  },
  {
    id: 'codex:gpt-5.4',
    engine: 'codex',
    model: 'gpt-5.4',
    label: 'Codex GPT-5.4',
    reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'high',
  },
]
```

Behavior:

- Default selection remains Claude Opus 4.8 for backwards compatibility.
- The select value is a stable catalog id, not just a model string. Recommended id format: `${engine}:${model}`.
- When a Codex option is selected, Story setup shows a "추론 수준" select.
- When a Claude option is selected, the reasoning select is hidden and not included in outgoing options.
- Existing hydrated projects without `options.engine` are treated as Claude.
- Existing saved `options.model` values continue to hydrate.

Outgoing Story options:

```js
{
  engine: 'codex',
  model: 'gpt-5.5',
  reasoningEffort: 'xhigh',
  genre,
  language,
  lengthValue,
  lengthUnit,
  sceneGranularity,
  reviewLoop,
}
```

Claude options keep the same shape plus `engine: 'claude'`:

```js
{
  engine: 'claude',
  model: 'claude-opus-4-8',
  genre,
  language,
  lengthValue,
  lengthUnit,
  sceneGranularity,
  reviewLoop,
}
```

## Main Process Model Catalog

Create a small LLM catalog module:

- New file: `electron/api/llm/storyLlmCatalog.js`
- Export:
  - `STORY_LLM_OPTIONS`
  - `DEFAULT_STORY_LLM`
  - `normalizeStoryLlmOptions(options)`
  - `findStoryLlmOption(engine, model)`
  - `findStoryLlmOptionById(id)`
  - `hydrateStoryLlmSelection(options, catalog = STORY_LLM_OPTIONS)`

Register an IPC endpoint:

- Channel: `story:list-llm-options`
- Handler returns the catalog and default option.
- Preload exposes `window.electronAPI.storyListLlmOptions()`.

Rationale:

- Keeps StoryView free of provider-specific option literals.
- Lets future model additions change one main-process catalog.
- Avoids pretending there is a stable SDK API for account-specific model discovery.

Non-goal:

- Do not dynamically query the user's actual Codex account model availability in this milestone.

## Renderer Catalog Consumption

Keep `StoryView` mostly presentational. Existing tests instantiate it with a mocked `pipeline` object, so the catalog should arrive through that object.

Renderer flow:

1. `useStoryPipeline({ projectPath, onPushScenes })` calls `window.electronAPI.storyListLlmOptions()` once on mount.
2. It stores `{ options, defaultOption }` in local hook state.
3. It returns them as `pipeline.llmOptions` and `pipeline.defaultLlmOption`.
4. `StoryView` renders the "생성 AI" select from `pipeline.llmOptions`.
5. `StoryView` stores the selected value as a catalog `id`, not a raw model string.
6. It derives outgoing `{ engine, model, reasoningEffort }` from the selected catalog entry.
7. If `pipeline.llmOptions` is absent in a unit test or older preload, `StoryView` uses a small local fallback containing the same four initial options. This fallback is only a renderer resilience path; main catalog remains authoritative.

Hydration helper:

```js
hydrateStoryLlmSelection(options, catalog)
```

Rules:

- If `options.engine` and `options.model` match a catalog entry, return that entry id.
- If `options.engine` is missing and `options.model` is `claude-opus-4-8`, return `claude:claude-opus-4-8`.
- If `options.engine` is missing and `options.model` is `claude-sonnet-5`, return `claude:claude-sonnet-5`.
- If `options.model` already looks like a catalog id, accept it only if the catalog contains it; otherwise fall back.
- Invalid or unavailable old values fall back to `DEFAULT_STORY_LLM.id`.
- Late catalog arrival must re-hydrate only if the user has not changed the select since mount.
- For Codex entries, missing `options.reasoningEffort` falls back to the selected catalog entry's `defaultReasoningEffort`.
- For Claude entries, `reasoningEffort` is ignored and omitted from outgoing options.

Tests:

- `useStoryPipeline` calls `storyListLlmOptions` and exposes returned catalog.
- `useStoryPipeline` tolerates a missing `storyListLlmOptions` bridge and still returns `null`/fallback-safe values.
- `preloadContract.test.js` catches any renderer call to `storyListLlmOptions` that is not exposed in `electron/preload.js`.
- `StoryView` renders from injected `pipeline.llmOptions` so unit tests do not need real IPC.
- `StoryView` hydrates old `model`-only state, new `engine/model` state, invalid values, late catalog arrival, and IPC failure fallback.
- `tests/mocks/electronAPI.js` includes a `storyListLlmOptions` mock so hook/component tests stay explicit.

## LLM Routing

Create a router adapter:

- New file: `electron/api/llm/storyLlmRouter.js`
- It exports the same Story LLM adapter methods as `llmClaude.js`.
- It imports `llmClaude` and `llmCodex`.
- For each call, normalize `opts.engine` and dispatch:
  - `engine === 'codex'` -> `llmCodex`
  - otherwise -> `llmClaude`

`electron/main.js` changes:

- Import `storyLlmRouter` instead of passing `llmClaude` directly to `registerStoryIPC`.
- Keep Claude imports available only where needed by the router.

Compatibility rules:

- Missing `engine` means Claude.
- Models starting with `claude-` imply Claude if `engine` is missing.
- Models starting with `gpt-` and cataloged as Codex imply Codex only when `engine === 'codex'` or when migration code explicitly normalizes old saved options.
- Unknown engine throws a clear error.

Normalization boundaries:

- UI payload creation calls `hydrateStoryLlmSelection` / selected catalog lookup before sending `story:start`.
- `stepMachine` normalizes and persists `params.options` when it writes `state.input.options` for generated, pasted, continued, and split flows.
- `stepMachine` uses normalized options when building `opts` for script, scenes, prompts, review/revise, continuation, and title generation.
- `storyLlmRouter` normalizes again before dispatch as the final boundary.
- `story:generate-title` accepts `{ scriptMd, options }`, where `options` is the current normalized UI option snapshot.
- `StoryView.resolveTitle()` must call `pipeline.generateTitle(scriptText, currentOptions())` so blank-title split/rewrite routes through the engine the user has selected right now, even before that option has been persisted by a later `story:start`.
- `useStoryPipeline.generateTitle(scriptMd, options)` forwards both `scriptMd` and `options` to IPC.
- `electron/ipc/story-api.js` forwards `options` to `machine.generateTitle(scriptMd, options)`.
- `stepMachine.generateTitle(scriptMd, optionsOverride)` normalizes `optionsOverride` first; if absent, it falls back to normalized `state.input.options`.
- Title generation does not persist Story options by itself. The subsequent `start('script'|'scenes', { options: currentOptions() })` call remains responsible for persistence.
- Tests must cover pasted-script Codex -> scenes/prompts routing, `continueScript` routing, blank-title split/rewrite `generateTitle` routing with current Codex UI options, and old Claude default routing.

## Codex SDK Adapter

Create:

- `electron/api/llm/codexSdk.js`
- `electron/api/llm/llmCodex.js`

`codexSdk.js` responsibilities:

- Isolate direct `@openai/codex-sdk` import behind `defaultCodexRun`.
- Use a controlled temporary working directory, not the AutoFlowCut repo, not the user's project path, and not the packaged app path.
- Create the Codex thread with:
  - `workingDirectory: <controlled temp dir>`
  - `skipGitRepoCheck: true`
- Build Codex run configuration from Story options:
  - `model`
  - `config.model_reasoning_effort = reasoningEffort`
  - `config.forced_login_method = 'chatgpt'`
  - `config.approval_policy = 'never'`
  - `config.sandbox_mode = 'read-only'`
  - `config.shell_environment_policy = { inherit: 'core', exclude: ['*KEY*', '*SECRET*', '*TOKEN*'] }` or stricter SDK-compatible equivalent.
  - `config.projects.<controlled temp dir>.trust_level = 'untrusted'` when the SDK accepts dotted config overrides for project trust.
  - `config.model_instructions_file` pointing to an AutoFlowCut-owned temporary instruction file that replaces project `AGENTS.md` influence.
- Instantiate `new Codex({ env, config })` with an explicit env allowlist:
  - Include only minimal runtime variables needed to find the packaged CLI (`PATH`, `HOME`, platform basics).
  - Do not pass `OPENAI_API_KEY`, `CODEX_API_KEY`, or arbitrary `*_KEY`/`*_TOKEN` values.
  - Preserve local ChatGPT/Codex session discovery through the user's normal Codex home only if required by the SDK/CLI; never copy secrets to project files.
- Run a non-interactive preflight before the real Story call:
  - Small prompt such as "Return OK only."
  - Same config/env/login method.
  - Bounded timeout.
  - If auth is missing or Codex attempts interactive login, throw the login-required error before Story generation begins.
- Apply a bounded timeout to every Codex run so Story does not hang indefinitely.
- Extract final response text from `turn.finalResponse` first, then `turn.completed` final data from streamed mode if used, then legacy/string variants only as fallback.
- Bridge abort signals if the SDK exposes abort support; otherwise check `signal.aborted` before and after calls and return `Aborted`.
- Tests must prove helper options never point Codex at the AutoFlowCut repo or the current project path.

`llmCodex.js` responsibilities:

- Reuse existing prompt builders from `prompts.js`.
- Implement the same methods as `llmClaude.js`.
- For script generation and continuation:
  - Call Codex with the prompt.
  - Return final text as `scriptMd`.
  - Streaming deltas are best-effort. If SDK result is non-streaming, no deltas are emitted until final state update.
- For structured tasks:
  - Pass `outputSchema: toJsonSchema(...)` to the TypeScript SDK turn.
  - Parse loose JSON using a helper compatible with the Claude path.
  - Validate against the same Gemini-style schemas already used by Claude.
  - Run `validateScenesSegments` for `splitScenes`.
- For review loop:
  - Implement `reviewScript` and `reviseScript`.
  - Respect existing `reviewRounds()` behavior in `stepMachine`: Codex should use the non-Claude path unless explicitly changed later, so review loop runs 1 round by default.

Prompt discipline:

- Codex prompts must tell the agent not to edit files, run commands, or change the repository.
- The adapter should ask Codex to act as a text/JSON generation engine only.
- Prompting is defense in depth only. Safety must primarily come from controlled cwd, untrusted project config, `approval_policy:'never'`, `sandbox_mode:'read-only'`, explicit env, and no repo/project working directory.

Error handling:

- Wrap SDK failures as `Codex SDK failed: <message>`.
- Auth/session failures should include a user-actionable hint: `Codex login required. Run Codex once and sign in with your ChatGPT account.`
- Do not ask for or store an OpenAI API key in this milestone.
- Do not open browser login or request permissions during Story generation.
- If the SDK only exposes behavior that cannot satisfy these isolation/auth requirements, stop implementation and report the SDK limitation before wiring Codex into Story.

## Packaging

`package.json`:

- Add dependency `@openai/codex-sdk`.
- Verify installed package shape because the TypeScript SDK wraps the `codex` CLI from `@openai/codex`.
- Add `node_modules/@openai/codex*/**` to `build.asarUnpack` if the installed package contains CLI/native/runtime assets that must not be packed.
- Add an import/package-shape smoke test similar to `tests/electron/api/llm/claudeSdkImport.test.js`.

SDK contract gate:

- Before implementing `llmCodex`, create and run a package-shape/SDK-contract test after installing `@openai/codex-sdk`.
- The test must verify the installed package exposes the TypeScript surface this spec depends on:
  - `Codex` named export is importable.
  - A `Codex` instance has `startThread()` and `resumeThread()` methods.
  - A `Thread` object can be exercised through a mocked/fake SDK boundary or inspected types/source to confirm `run(prompt, { outputSchema })` is the intended call shape.
  - The final response property expected by docs is `turn.finalResponse`.
  - `runStreamed()` exists if streaming support is implemented; otherwise Codex script streaming is explicitly disabled.
  - The dependency graph includes the wrapped `@openai/codex` CLI/runtime package or equivalent package assets.
  - `package.json build.asarUnpack` covers every installed `node_modules/@openai/codex*/**` path that contains CLI/native/runtime files.
- If the installed SDK shape differs from this spec, stop before adapter implementation, update this spec, and re-run direction review.

No GCF deployment is needed for this feature.

## State And Migration

`story.json` currently stores user options under `state.input.options`.

Migration behavior:

- Existing `options.model: 'claude-opus-4-8'` hydrates as Claude Opus 4.8.
- Existing `options.model: 'claude-sonnet-5'` hydrates as Claude Sonnet 5.
- Missing `options.engine` hydrates as Claude.
- New Codex selections store `engine`, `model`, and `reasoningEffort`.
- If `state.engine.llm` exists, leave it for backwards compatibility but do not rely on it for routing. Routing uses normalized `state.input.options`.
- Pasted-script flows do not call an LLM for the script step, but they still persist normalized engine/model options so later scenes/prompts/title calls route to the selected engine.
- Continue/rewrite flows also persist normalized engine/model options.

No one-time disk migration is needed; normalize at hydrate/run boundaries.

## Testing Strategy

Use TDD. No production code without a failing test first.

Slice 0: SDK contract and package shape

- RED: importing `@openai/codex-sdk` exposes `Codex`.
- RED: `Codex` instance exposes `startThread` and `resumeThread`.
- RED: the installed package/type/source confirms per-turn `{ outputSchema }` support.
- RED: the installed package/type/source confirms final response is `turn.finalResponse`.
- RED: detect whether `runStreamed` exists; if absent, tests assert Codex script streaming is disabled and final-text-only.
- RED: package dependency/runtime inspection identifies `@openai/codex` or equivalent CLI/runtime assets.
- RED: `package.json build.asarUnpack` includes `node_modules/@openai/codex*/**` when runtime assets require unpacking.

Slice 1: Dynamic catalog IPC

- Test `storyLlmCatalog` returns all 4 initial options.
- Test every catalog entry has a stable `id`.
- Test default is Claude Opus 4.8.
- Test preload exposes `storyListLlmOptions`.
- Test `registerStoryIPC` exposes `story:list-llm-options`.
- Test `tests/mocks/electronAPI.js` exposes `storyListLlmOptions`.
- Test StoryView uses catalog results rather than hard-coded provider options.

Slice 2: StoryView option payload

- RED: selecting Codex GPT-5.5 shows reasoning select.
- RED: selecting Codex GPT-5.5 + xhigh sends `{ engine:'codex', model:'gpt-5.5', reasoningEffort:'xhigh' }`.
- RED: selecting Claude hides reasoning select and sends `{ engine:'claude', model:'claude-opus-4-8' }` without `reasoningEffort`.
- RED: old hydrated state with only `model:'claude-sonnet-5'` selects the right Claude option.
- RED: new hydrated Codex state selects the right Codex option and reasoning effort.
- RED: invalid catalog id/model falls back to the default Claude option.
- RED: late catalog arrival does not overwrite a user-changed selection.
- RED: catalog IPC failure still renders fallback options.

Slice 3: Router

- RED: `engine:'codex'` dispatches every adapter method to `llmCodex`.
- RED: missing engine dispatches to `llmClaude`.
- RED: unknown engine throws a clear error.
- RED: `generateTitle` routes using current UI options passed through IPC, not only stale persisted state.
- RED: `continueScript`, pasted-script follow-up scenes/prompts, and review/revise routes use normalized options.

Slice 4: Codex SDK helper

- RED: `buildCodexRunOptions` maps model and reasoning effort.
- RED: Codex config forces ChatGPT auth, read-only sandbox, never approvals, controlled env, and controlled temp working directory with `skipGitRepoCheck:true`.
- RED: helper rejects or omits API-key env vars.
- RED: non-interactive auth preflight failure returns the login-required hint.
- RED: result extraction handles `turn.finalResponse`, streamed `turn.completed` final data, string/final_response/result fallback variants.
- RED: abort signal before call throws `Aborted`.
- RED: auth-like errors are wrapped with login hint.
- RED: timeout aborts a hung SDK run.

Slice 5: Codex LLM adapter

- RED: `generateScript` builds script prompt and returns `scriptMd`.
- RED: `continueScript` appends generated continuation.
- RED: `generateTitle` returns first non-empty line.
- RED: `splitScenes` passes `outputSchema`, parses JSON, validates schema, and returns scenes/speakers.
- RED: `writePrompts` passes `outputSchema`, parses JSON, and rejects missing prompt coverage.
- RED: `reviewScript` normalizes verdict.
- RED: `reviseScript` returns revised markdown.

Slice 6: Integration smoke

- Test `registerStoryIPC` with router and a mocked Codex adapter can run `script` step through Codex options.
- Test pasted-script Codex options are persisted, then `scenes` and `prompts` dispatch to Codex.
- Test `story:generate-title` uses the currently selected engine/model/reasoning options passed from the renderer for blank-title split/rewrite.
- Test packaging import smoke for `@openai/codex-sdk`.
- Run targeted Story tests.
- Run full test suite before final review.

## Review Gates

Before implementation:

- This spec must receive direction review from a subagent/Codex reviewer using `model: gpt-5.5` and reasoning effort `xhigh`.
- Loop until findings are 0.

After implementation:

- Run TDD slices RED -> GREEN.
- Run targeted tests after each slice.
- Run full test suite.
- Request code review with `gpt-5.5` / `xhigh`.
- Loop until findings are 0.

## Open Questions

Resolved:

- Claude and Codex are both supported.
- Codex is an additional option, not a replacement.
- Codex uses ChatGPT/Codex login path first; API key UI is out of scope.
- Model options are dynamically provided by main-process catalog.
- `story:generate-title` receives current UI LLM options so blank-title split/rewrite does not use stale persisted engine state.

Implementation gate:

- Slice 0 must confirm the installed `@openai/codex-sdk` package surface before adapter implementation.
- If the installed SDK does not support the required `Codex`, `startThread`, `run(prompt, { outputSchema })`, `finalResponse`, config, env, or isolation contracts, implementation stops and this spec is updated/re-reviewed.
- If `runStreamed()` is unavailable or unsuitable, Story script streaming remains Claude-only for now and Codex commits final text at completion.

## Non-Goals

- No OpenAI API key management UI.
- No account-specific model discovery.
- No removal of Claude.
- No changes to TTS/SFX/BGM/export tracks.
- No GCF deployment.
- No production release or push without user approval.
