# Story Claude AgentSDK Effort Spec

Date: 2026-07-05
Branch: feature/story-pipeline

## Goal

Add reasoning-level controls to Claude AgentSDK Story generation and keep the model selector plus reasoning selector on one compact row.

## Source Facts

- Claude Agent SDK TypeScript official docs expose `effort: 'low' | 'medium' | 'high' | 'max'`.
- The local SDK type also includes `xhigh`; this feature intentionally exposes the official stable subset only.
- The SDK also supports `thinking`, whose default is adaptive for supported models.
- Current AutoFlowCut Claude helper forces `thinking: { type: 'disabled' }`.
- Codex already uses `reasoningEffort` in renderer/story options and maps it to Codex SDK reasoning.

## Decisions

- Keep Story option field `reasoningEffort` for both Claude and Codex.
- Claude catalog entries get `reasoningEfforts: ['off', 'low', 'medium', 'high', 'max']`.
- Claude default is `off` to preserve current behavior.
- `off` maps to `thinking: { type: 'disabled' }` and no SDK `effort`.
- `low|medium|high|max` maps to `thinking: { type: 'adaptive' }` plus `effort`.
- Renderer/story options must not pass raw SDK thinking controls. Strip or ignore `thinking`, `effort`,
  `maxThinkingTokens`, and `max_thinking_tokens`; only normalized `reasoningEffort` may control Claude thinking.
- Codex keeps its existing `minimal|low|medium|high|xhigh` values and defaults.
- StoryView always shows the reasoning selector when the selected catalog entry has reasoning efforts.
- Hydrated saved Story options preserve a valid Claude `reasoningEffort`; missing/invalid values fall back to `off`.
- Model and reasoning selectors render in one `.story-llm-row`; CSS wraps on narrow widths with the
  reasoning label and select kept together as one wrapping group.

## Tests

- Catalog: Claude entries expose/default reasoning; normalization keeps valid Claude effort and defaults invalid/missing to `off`.
- Catalog: raw SDK thinking controls are stripped, so renderer options cannot override `reasoningEffort`.
- Claude SDK helper: `off` preserves disabled thinking; non-off maps to adaptive thinking plus `effort`.
- StoryView: default Claude payload includes `reasoningEffort:'off'`; changing Claude effort sends selected value; hydrated Claude effort remains selected; model and reasoning controls share one row/wrapping group; Codex behavior remains intact.
- Existing stepMachine/router paths should continue to pass because they already forward normalized options.
