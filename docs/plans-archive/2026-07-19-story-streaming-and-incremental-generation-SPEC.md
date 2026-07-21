# Story Streaming and Incremental Generation — Feasibility-First Spec

**Date:** 2026-07-19  
**Worktree / branch:** `/Users/tuxxon/workspace/AutoFlowCut-bugfix` / `bugfix`  
**Status:** Proposed; streaming-first, fan-out only after measurement  
**Primary goal:** Reduce perceived and actual latency on long scripts in the `scenes` and `prompts` steps without weakening scene-text identity, audio alignment, or prompt consistency.

## 1. Feasibility verdicts

| Piece | Verdict | Evidence and decision |
|---|---|---|
| Scenes live streaming display | **POSSIBLE-WITH-CAVEAT** | The append-only parser already emits each closed top-level `scenes[]` item and defaults to `arrayKey: 'scenes'` (`electron/api/llm/partialScenes.js:1-5`, `electron/api/llm/partialScenes.js:25-41`, `electron/api/llm/partialScenes.js:115-148`). Claude `splitScenes` already accepts raw partial text (`electron/api/llm/llmClaude.js:380-385`); Codex's transport can forward raw JSON deltas (`electron/api/llm/codexAppServer.js:277-282`) but its `splitScenes` adapter does not yet pass the callback (`electron/api/llm/llmCodex.js:127-133`). Gemini structured calls are currently non-streaming `generateContent` (`electron/api/llm/llmGemini.js:113-140`, `electron/api/llm/llmGemini.js:143-149`). Therefore Claude/Codex can provide item-level token streaming after small wiring; Gemini can provide completed-chunk progress only unless its adapter changes. The renderer also needs work because StoryView currently replaces the scenes table with `StoryRunning` while generation runs (`src/components/story/StoryView.jsx:1807-1820`). |
| Scenes chunked-parallel labeling | **POSSIBLE-WITH-CAVEAT** | Today the machine makes one `llm.splitScenes` call, then normalizes identity, merges speakers, reviews, stamps, and saves (`electron/story/stepMachine.js:1128-1163`). Repeating that existing adapter call over deterministic paragraph spans is feasible above the adapter layer. The caveat is semantic: the model must preserve the source's normalized spoken content and order, not rewrite it, because identity inheritance matches normalized segment text (`electron/story/sceneIdentity.js:9-18`, `electron/story/sceneIdentity.js:21-49`) and audio aligns normalized segment text against the SRT stream (`electron/story/srtImport.js:109-117`, `electron/story/srtImport.js:240-301`; call site `electron/story/stepMachine.js:1243-1253`). Chunk boundaries also weaken the whole-script pronoun requirement in the current split prompt (`electron/api/llm/prompts.js:206-220`, especially `:213`). Ship only behind a long-script threshold and an evidence gate. |
| Prompts live streaming | **POSSIBLE — SHIPPED** | Commit `f43a713d` shipped the production path for the currently routed Claude/Codex engines. The machine emits op-gated `started` and per-scene prompt deltas (`electron/story/stepMachine.js:1690-1701`), adapters parse closed scene objects (`electron/api/llm/llmClaude.js:508-517`, `electron/api/llm/llmCodex.js:215-223`), the hook accumulates `previewPrompts` and clears it on terminal `story:state` (`src/hooks/useStoryPipeline.js:39-40`, `src/hooks/useStoryPipeline.js:87-89`, `src/hooks/useStoryPipeline.js:201-211`, `src/hooks/useStoryPipeline.js:268-287`), and StoryView renders ghost prompts without replacing durable scenes (`src/components/story/StoryView.jsx:2174-2212`). Gemini remains non-streaming and is not in the production router, which currently injects only Claude and Codex (`electron/main.js:20-22`, `electron/main.js:285-292`). |
| Prompts per-scene / K-batch generation | **POSSIBLE-WITH-CAVEAT** | Prompts are derived fields and do not participate in scene-text identity or SRT alignment. The current builder already reduces each scene to `sceneNo`, summary, and segment text (`electron/api/llm/prompts.js:410-426`), and adapters merge outputs by `sceneNo` while preserving other scene fields (`electron/api/llm/llmClaude.js:518-533`, `electron/api/llm/llmCodex.js:224-238`, `electron/api/llm/llmGemini.js:215-225`). K-batch fan-out is therefore structurally safe for normal granularity; `sceneGranularity: 'segment'` is excluded because its sentence-level split rule can create hundreds of scenes (`electron/api/llm/prompts.js:203-205`). The caveat is the current review loop: after generation it can revise the entire accumulated array (`electron/story/stepMachine.js:631-653`, `electron/story/stepMachine.js:1702-1707`; full-array revise prompt at `electron/api/llm/prompts.js:361-372`), which would erase isolation and latency gains unless revision becomes targeted. |
| Inline prompt `@mentions` | **POSSIBLE-WITH-CAVEAT** | The current LLM instruction explicitly forbids reference syntax and asks for plain text (`electron/api/llm/prompts.js:420-426`), while `mapScene` later prepends mentions (`electron/story/stepMachine.js`). Both must change so the LLM places mentions naturally. The portable grammar has two forms behind the same leading-boundary rule: plain `@name` for `^[A-Za-z0-9_-가-힣]+$`, and exact braced `@{name}` for non-empty names without `{`, `}`, or newline. A closing `}` terminates a braced token, so it needs no trailing-boundary rule and may be followed immediately by prompt text. Braced names never use particle stripping; `@{Mina-style}` is exact in both consumers and is recommended when `-`/`_` could otherwise expose the plain parsers' boundary difference. Space-containing names emit the braced form. Names containing braces/newlines and validation failures retain the existing character-tag/reference fallback; commit `37aadcdc` injects references not represented by Flow mention chips through `computeSceneGapReferences` (`src/engine/engineFlow.js`). Acceptance remains gated by the real `extractMentionNames` plus `resolveMentions` path, not a descriptive regex alone. |
| Scenes per-scene rewrite / Codex two-pass design | **NOT-RECOMMENDED for this scope** | A safe atom-ID boundary pass is theoretically possible, but a per-scene detail-generation pass invites paraphrase and the extra global boundary call does not directly solve first-result latency. Paraphrase breaks the text-based identity and audio contracts above. It would also bypass the existing three adapter implementations of `splitScenes` (`electron/api/llm/llmClaude.js:380-385`, `electron/api/llm/llmCodex.js:127-133`, `electron/api/llm/llmGemini.js:143-149`). Use deterministic source chunking plus the existing labeling call instead. |

## 2. Non-negotiable invariants

1. **Narration coverage is consumer-normalized, not raw-substring verbatim.** For each chunk, build `expected` from its exact emission span after removing only this source-only omission whitelist: complete Markdown header lines (`^#{1,6}\s+...$`, including header text); a leading confirmed-roster speaker label ending in `:`, `：`, or ` - ` on a dialogue line; stage-direction spans explicitly delimited by `[...]`, `(...)`, or `*...*`; quote marks surrounding spoken text; and inter-segment whitespace. Build `actual` by concatenating narration `segment.text` in scene/segment order; SFX has no source-text ownership. Normalize both streams with NFC, lowercase, and removal of all whitespace plus Unicode punctuation/symbol characters—the alignment normalization class, which also subsumes identity's whitespace/punctuation folding (`electron/story/sceneIdentity.js:9-15`, `electron/story/srtImport.js:109-117`). Each normalized segment must consume the next characters at a monotonic cursor and the final cursor must equal `expected.length`. Thus normalized wording/order has complete coverage with no normalized omission, duplication, or paraphrase, while line wrapping, curly-versus-straight quotes, and whitelisted non-narrated markup do not false-fail. Nothing outside the whitelist may disappear. This is the contract protecting ID inheritance and source-ordered SRT matching (`electron/story/sceneIdentity.js:21-49`, `electron/story/sceneIdentity.js:64-93`, `electron/story/srtImport.js:193-211`, `electron/story/srtImport.js:264-320`).
2. **Preview is never durable state.** Streamed items populate renderer-only `previewScenes` / `previewPrompts`; only the final validated result may update `scenes.json`. This mirrors the shipped prompts behavior, where deltas are display-only and the final `writePrompts` result is authoritative (`electron/story/stepMachine.js:1690-1709`).
3. **Source order wins over completion order.** Parallel calls may complete out of order, but concatenation, speaker merge, scene numbering, validation, review, saving, and push use original chunk/scene order. Existing final-save and post-flush push ordering remains authoritative (`electron/story/stepMachine.js:1708-1720`, `electron/story/stepMachine.js:2376-2382`).
4. **No duplicate overlap output.** Adjacent text may be supplied only as clearly marked read-only context. It is never part of the emission span. Duplicate segments are especially unsafe because segment-ID inheritance deliberately refuses ambiguous/mutually non-unique matches (`electron/story/sceneIdentity.js:72-90`).
5. **Bounded fan-out and shared cancellation.** All calls in one step share the step's `AbortSignal`; any failed required batch fails the step without partial disk writes. The step wrapper already treats aborted or replaced controllers as stale and blocks late completion from committing (`electron/story/stepMachine.js:2345-2375`).

## 3. Scenes architecture: deterministic chunking around the existing labeler

### 3.1 Decision

Adopt Fable's shape, with Codex's preservation and repair concerns as hard guards:

1. Below the threshold, keep the current single-call path exactly.
2. Above the threshold, split the **input** into deterministic, contiguous paragraph spans.
3. Call the existing `llm.splitScenes(emissionText, opts, ctx)` once per chunk through a concurrency-limited worker pool.
4. Validate each chunk for normalized ordered coverage against its exact source span; collect by chunk index, concatenate, and renumber `sceneNo` globally.
5. Flatten chunk speaker arrays in source order and then run the existing `normalizeScenes` → `mergeSpeakers` → optional `reviewScenesCandidate` → speaker rewrite/stamp → save sequence. Those helpers and their order remain unchanged (`electron/story/stepMachine.js:370-377`, `electron/story/stepMachine.js:395-439`, `electron/story/stepMachine.js:601-628`, `electron/story/stepMachine.js:1137-1163`).

The only guards around that sequence are: validate the initial concatenated candidate before normalization, and validate the final reviewed candidate before save. Snapshot the pre-review `{scenes, speakers}` pair. If the reviewed scenes fail normalized coverage, discard **both** `reviewed.scenes` and `reviewed.speakers`, restore the complete pre-review pair, and emit a warning; never combine reviewed speakers with pre-review scenes. The current review helper evolves and returns those values together (`electron/story/stepMachine.js:601-628`), so pairwise rollback prevents roster/`appearingCharacters` stamping from desynchronizing. This keeps the existing full-array review available without allowing it to violate the source contract. Review-enabled and review-disabled latency must be measured separately because the review path still makes full-array calls (`electron/story/stepMachine.js:608-623`). Targeted scenes repair is a later optimization, not required for the first chunking experiment.

### 3.2 Chunk planner and threshold

- Represent paragraphs as offsets into the original `script.md`; slice the original string rather than rebuilding lines. Preserve line endings and punctuation inside each emission span.
- Group whole paragraphs toward a provisional target of **6,000 characters**. Do not split an oversized paragraph in v1; make it one large chunk. This may reduce speedup but avoids inventing a second sentence atomizer.
- Use chunking only when the script is at least **12,000 characters** and contains at least two usable paragraph boundaries. These are calibration defaults, not product truth; the measurement gate in section 6 may change them.
- Start with **concurrency 2**. Evaluate 3 only if latency improves further without higher throttling/failure rates. The current Gemini adapter already retries 429/5xx once (`electron/api/llm/llmGemini.js:128-139`); the orchestrator must not add an unbounded retry layer.
- Keep chunking behind an internal experiment switch until the A/B gate passes. No user-facing option is needed for the experiment.

This orchestration stays above adapters. Production routes Claude/Codex through one `splitScenes` interface (`electron/api/llm/storyLlmRouter.js:25-46`, `electron/main.js:285-292`), while `registerStoryIPC` retains Gemini as its injectable/default implementation (`electron/ipc/story-api.js:8-9`, `electron/ipc/story-api.js:50-57`). Repeating the existing call therefore preserves all three engine implementations.

### 3.3 Read-only boundary context

Chunking weakens the current instruction to resolve pronouns and aliases from the whole script (`electron/api/llm/prompts.js:213`). Mitigate, but do not pretend to eliminate, that loss:

- Pass the immediately preceding and following paragraph as `opts.splitContext.before/after`; `buildSplitPrompt` renders them in a **CONTEXT ONLY — DO NOT EMIT** block outside `--- 대본 ---`.
- Pass the same confirmed roster to every call. The current machine already builds and injects the confirmed roster for scenes (`electron/story/stepMachine.js:1130-1134`), and the shared prompt constrains speaker IDs to that roster (`electron/api/llm/prompts.js:37-56`, `electron/api/llm/prompts.js:208-213`).
- Add an explicit preservation rule: emit only spoken wording from the emission span, in order; only the enumerated omission whitelist may be dropped. Context may inform `speaker`, `appearingCharacters`, summary, emotion, and SFX placement but may not produce segments. Normalization-equivalent whitespace/punctuation changes remain acceptable to the validator.
- Treat cross-chunk pronoun/speaker consistency as an A/B quality metric. If it regresses, raise the threshold, widen read-only context, or keep single-call mode; never compensate by overlapping emitted text.

### 3.4 Failure and preview behavior

- A malformed chunk or one with normalized omission, duplication, reordering, or non-whitelisted wording changes fails the experimental run and leaves the prior `scenes.json` untouched. Do not silently issue a second full-script call after all parallel work; that converts a latency optimization into worst-case double latency.
- Stream closed scene objects as preview only. In parallel mode payloads include `{chunkIndex, localSceneNo, scene}`; the renderer sorts by `(chunkIndex, localSceneNo)` and displays provisional row numbers. Final `sceneNo` is assigned only after ordered concatenation.
- A non-streaming engine still emits the completed scenes of each finished chunk, so users see coarse incremental progress even though they do not see token-level items.

## 4. Prompts architecture: contiguous K-batches

### 4.1 Unit, context, and accumulation

Choose **K=3 contiguous target scenes**, not one call per scene. Three scenes give the model local continuity while keeping calls small; per-scene calls add overhead and lose action continuity. Start with concurrency 2 and keep the existing single call for fewer than 6 scenes. Explicitly exclude `sceneGranularity: 'segment'` from K-batching regardless of scene count: its sentence-level split rule (`electron/api/llm/prompts.js:203-205`) can produce hundreds of scenes and turn K=3 into dozens of sequential scheduling rounds. Segment granularity stays on the current single-call prompts path.

Every batch receives the same shaped context:

- the three target scenes' `sceneNo`, `storyId`, summary, and verbatim segment text;
- the confirmed non-narrator roster with canonical name, visual description, and a precomputed portable `mentionToken` when one exists; the current prompt context already receives character speakers (`electron/story/stepMachine.js:1673-1677`) and derives consistent visual descriptions (`electron/api/llm/prompts.js:412-418`);
- one adjacent scene before and after, clearly marked context-only;
- the selected style;
- no repeated full `script.md` in generation calls unless measurement shows a quality need.

Each call outputs only its three target `sceneNo` values. Accumulate by `sceneNo` in original order, merge only `imagePrompt` and `videoPrompt` onto the original scene objects, and save once after every batch and review pass succeeds. This follows the adapters' current non-prompt-field-preserving merge contract (`electron/api/llm/llmClaude.js:518-533`, `electron/api/llm/llmGemini.js:218-224`). Out-of-order streamed prompt items are already safe because `previewPrompts` is keyed by `sceneNo` (`src/hooks/useStoryPipeline.js:278-286`).

### 4.2 Review must not overwrite batch gains

Do **not** run the current `reviewPromptsCandidate` unchanged after K-batch accumulation: it passes the whole array to `revisePrompts` and replaces `currentScenes` wholesale (`electron/story/stepMachine.js:631-648`). Use this replacement flow:

1. Review the full accumulated array so the critic can judge cross-scene continuity.
2. Extend prompt review output with structured `issues: [{sceneNo, critique}]` while retaining `verdict` and top-level `critique`.
3. On `pass`, finish. On `revise`, group issue scene numbers back into their K-batches; call `revisePrompts` only for affected batches, with the same fixed roster and adjacent-scene context.
4. Merge only the repaired prompt fields, then repeat up to the existing configured round count.
5. If a `revise` verdict has no usable issue numbers, repair all K-batches independently; never fall back to one full-array revise.

For K-batch-eligible input, “never full-array revise” includes `params.reviewOnly`, which currently sends the complete saved array through `reviewPromptsCandidate` (`electron/story/stepMachine.js:1678-1688`). M6 must route review-only revisions through the same issue-number-to-K-batch repair. Legacy single-call inputs—fewer than 6 scenes and `sceneGranularity: 'segment'`—may retain full-array review. Until targeted repair ships, the experiment gate uses K-batches only when prompts review is disabled; review-enabled runs stay on the current single-call path.

### 4.3 Inline mention emission

Change prompt ownership from post-processing to generation:

- For each portable roster name, provide an exact token such as `@Mina` and require the LLM to place it at the natural noun-phrase position in **both** `imagePrompt` and `videoPrompt`, for example `A slow dolly toward @Mina as she opens the letter`, not `@Mina A slow dolly...`.
- A portable token uses the shared leading boundary (start or `src/utils/mentionParser.js`'s allowed whitespace/punctuation set) and one of two bodies: plain `@name`, where `name` matches `[A-Za-z0-9_-가-힣]+`, or braced `@{name}`, where `name` is non-empty and contains no `{`, `}`, or newline. Plain form retains its existing consumer boundary and Korean-particle behavior. In braced form, `}` is the terminator: there is no trailing-boundary rule and no particle stripping, so `@{도둑 우두머리}A young...` and exact `@{Mina-style}` are portable. Prefer braces for `-`/`_` names when exactness must be explicit across both parsers.
- The fixed rubric is: **every portable character required by the scene appears at least once in each of `imagePrompt` and `videoPrompt`, and every emitted mention token resolves**. Validation must run `extractMentionNames` and `resolveMentions` against the confirmed roster (`src/utils/mentionParser.js`); a hand-written acceptance regex is not the gate. The existing validation gate covers braces automatically once the brace-aware `extractMentionNames` and `resolveMentions` land. Missing extracted tokens and `resolveMentions().missing` are validation failures.
- M4 ships an interim fail-open-to-plain-text fallback. On any missing required mention, non-portable boundary, unresolved token, or unknown token, sanitize the affected prompt: pass all parser-extracted names to `stripMentionsForNames` (`src/utils/mentionParser.js:122-130`), and remove the sigil from any raw `@` candidate the real parser did not extract. Keep the resulting names as plain text, emit a scene/field warning, and continue the prompts step. Never save a token known to hard-block Flow, and never fail the step for an LLM mention-formatting miss: current `withMentions` never fails (`electron/story/stepMachine.js:744-748`), while unresolved mixed routing can return an error (`src/engine/engineFlow.js:99-108`). The compatibility `withMentions` path must not reinsert tokens stripped from newly generated prompts. Character tags/reference images and the `37aadcdc` gap-reference path remain the conditioning fallback. M5 retains this behavior; once M6 targeted repair exists, repair may run first, but exhausted repair still degrades safely to this fallback.
- Never emit ambiguous `@Full Name` for a space-containing canonical name; emit exact `@{Full Name}`. If the name contains `{`, `}`, or newline, or if brace validation fails, keep the ordinary full name inline and rely on character tags/reference injection. Commit `37aadcdc` remains the safety net: refs not represented by Flow chips are retained as gap references (`src/engine/engineFlow.js`) and passed through both synchronous and submitted scene-generation paths.
- Make the current `withMentions` step idempotent and legacy-only. It currently prepends every safe name (`electron/story/stepMachine.js:741-759`); new generated prompts must pass through unchanged, while old saved/manual prompts may retain a compatibility fallback. Never prepend a second copy when an inline mention already exists.

## 5. Streaming contract

Use the shipped prompts pattern for scenes rather than inventing another IPC channel:

1. Main emits `story:progress {kind:'scene-delta', phase:'started'}` before the first call, then `{kind:'scene-delta', chunkIndex, localSceneNo, scene}` per closed scene. M1 uses `chunkIndex: 0` and the parser item's scene number as `localSceneNo`; defining coordinates from M1 lets the renderer keep one payload and sorting contract when M3 adds parallel calls. `story:progress` is already an allowed preload channel (`electron/preload.js:145-150`).
2. `stepMachine` owns one replaceable `createPartialScenesParser` per in-flight call. It passes both `onPartialText` and `onPartialReset` through `llmClaude.splitScenes`; reset discards the first-attempt parser and creates a fresh one before fallback bytes arrive, mirroring the shipped prompts adapter pattern (`electron/api/llm/llmClaude.js:508-517`). This is required because `structuredClaudeCall` can reset and re-stream on its second attempt (`electron/api/llm/llmClaude.js:349-363`), while `splitScenes` currently forwards only partial text (`electron/api/llm/llmClaude.js:380-382`). Codex `splitScenes` forwards `onPartialText` to the already-capable `runCodexJson`; completed chunks provide the coarse fallback for Gemini.
3. `useStoryPipeline` adds a separate `sceneActiveOpRef` and `previewScenes`, mirroring the prompt gate. Accept deltas only after `started` and only for the matching `operationId`. A terminal `story:state` where `steps.scenes.status !== 'running'` clears both preview and gate, just as prompts do now (`src/hooks/useStoryPipeline.js:201-211`, `src/hooks/useStoryPipeline.js:268-287`).
4. StoryView renders `StoryRunning` **and** the scenes table during generation, with streamed rows styled as ghosts. Today it uses an either/or conditional that hides the table (`src/components/story/StoryView.jsx:1807-1820`); prompts already demonstrate the required render condition (`src/components/story/StoryView.jsx:2174-2212`).
5. Preview never calls `normalizeScenes`, inherits IDs, changes `state.speakers`, saves files, or pushes project scenes. Terminal `story:state` remains the only transition from preview to durable rows.

## 6. Measurement-first release gate

The latency pain is real and the code confirms both steps each make one large generation call (`electron/story/stepMachine.js:1133-1136`, `electron/story/stepMachine.js:1690-1701`). What is not yet measured is whether fan-out preserves or improves quality. Run a cheap A/B before enabling either fan-out mode automatically:

- **Corpus:** three representative long scripts (roughly 10, 20, and 30 minutes), using the same model, effort, roster, granularity, and review setting. Run current single-call and experimental mode once each; repeat only anomalous cases.
- **Wall-clock:** record first-preview latency, split/write call latency, and terminal step latency. Separate generation from optional review.
- **Normalized narration coverage:** for every chunk and the final concatenation, run the invariant-1 cursor validator over whitelist-filtered source versus ordered narration segments. Required result for both paths is equality after consumer-parity normalization: zero normalized omissions, duplications, reorderings, or non-whitelisted wording changes. Report accepted whitespace/punctuation/quote normalization separately so it cannot be mistaken for content loss.
- **Identity stability:** rerun against the same prior `scenes.json` and report the percentage of `storyId` and segment IDs inherited. The current matching deliberately requires text match and mutual uniqueness (`electron/story/sceneIdentity.js:21-49`, `electron/story/sceneIdentity.js:64-93`).
- **Speaker consistency:** count roster violations, unknown-speaker-to-narrator rewrites, and the same canonical speaker receiving different IDs across chunks. The current fallback logs and rewrites unknown speakers (`electron/story/stepMachine.js:467-485`), so it is measurable.
- **Boundary quality:** blind-check chunk boundaries for pronoun resolution, `appearingCharacters`, scene grouping, and duplicated/missing SFX. This is the quality dimension not established by the latency complaint.
- **Prompt quality:** blind-check action continuity and visual consistency; record portable mention resolution in both `parseSceneMentions` and `resolveMentions`, plus missing/unknown mentions.
- **Cost/reliability:** record total input/output tokens, call count, retries, throttles, abort latency, and failed-batch rate. The session tracker distinguishes Claude call deltas from Codex thread cumulative totals (`electron/api/llm/usageTracker.js:7-15`, `electron/api/llm/usageTracker.js:21-59`).

**Enablement rule:** ship scenes display streaming unconditionally. Keep prompts streaming as shipped. Enable scenes chunking above the threshold only if it improves median terminal latency by at least 25%, keeps normalized narration coverage at 100%, does not reduce identity inheritance, and does not worsen speaker/boundary quality. Enable prompt K-batches only for non-segment granularity if they improve terminal latency, preserve or improve blind quality, resolve 100% of emitted portable mentions in both consumers, and targeted review is present. Otherwise retain the single-call path and keep the streaming UX benefit.

## 7. Milestones — small, independently shippable, TDD each time

Every milestone follows red → minimal green → focused suite → full `npm run test:run`; the test command is defined in `package.json:37-39`.

### M0 — Preserve shipped prompts streaming

No code changes. Treat commit `f43a713d` and its existing adapter, machine, hook, and StoryView tests as the regression baseline. Any later milestone must keep final-result authority, stale-op filtering, and terminal preview cleanup.

### M1 — Scenes preview streaming (unconditional)

**Files:** modify `electron/story/stepMachine.js`, `electron/api/llm/llmClaude.js`, `electron/api/llm/llmCodex.js`, `src/hooks/useStoryPipeline.js`, `src/components/story/StoryView.jsx`, `src/components/story/StoryView.css`; add/update `tests/electron/story/stepMachine.scenesStreaming.test.js`, `tests/electron/api/llm/llmClaude.structured.test.js`, `tests/electron/api/llm/llmCodex.test.js`, `tests/hooks/useStoryPipeline.sceneDelta.test.js`, `tests/components/story/StoryView.test.jsx`. Reuse `electron/api/llm/partialScenes.js`; do not fork its parser.

**Tests first:** started-before-delta; every delta includes `chunkIndex: 0` and `localSceneNo`; wrong/late op rejected; closed scenes appear once; Claude fallback reset discards first-attempt preview bytes/items; preview clears on done/error/abort/project switch; final rows replace ghosts; the scenes table remains visible while running; Codex forwards raw partial JSON. Gemini may have no token delta.

### M2 — Deterministic chunk planner and A/B harness (experiment only)

**Files:** create `electron/story/storyChunks.js`, `tests/electron/story/storyChunks.test.js`, and `scripts/story-split-ab.mjs`; modify `electron/story/stepMachine.js` only to expose explicit single/parallel experiment modes and timing/quality records.

**Tests first:** original-offset paragraph spans; exact reconstruction; no emitted overlap; oversized paragraph remains whole; stable chunking; bounded worker concurrency; abort stops scheduling; out-of-order results reorder by chunk index; the normalized-coverage validator accepts line-wrap, curly/straight-quote, and whitelisted-markup differences but rejects normalized paraphrase, omission, duplication, and reordering. Run the A/B corpus before changing the default.

### M3 — Gated scenes chunk orchestration

**Files:** modify `electron/story/stepMachine.js`, `electron/api/llm/prompts.js`, `electron/story/storyChunks.js`; add/update `tests/electron/story/stepMachine.scenesChunked.test.js`, `tests/electron/api/llm/prompts.test.js`, `tests/electron/story/stepMachine.rerunIdentity.test.js`, `tests/electron/story/stepMachine.audioImport.test.js`.

**Tests first:** below-threshold path makes exactly one unchanged call; above-threshold path calls `llm.splitScenes` with emission-only text and context-only neighbors; adapters need no chunk API; streamed deltas reuse M1 coordinates and sort by `(chunkIndex, localSceneNo)` with no renderer changes; concat/renumber is deterministic; speaker merge/review/stamp order remains; failed chunk writes nothing; duplicate context output fails; rerun IDs remain stable; a reviewed normalized-coverage violation discards reviewed scenes and reviewed speakers together; audio alignment receives normalization-equivalent text.

### M4 — Inline portable mentions

**Files:** modify `electron/api/llm/prompts.js`, `electron/story/stepMachine.js`, `src/utils/mentionParser.js`, `src/utils/sceneMentions.js`, `src/utils/promptLexicalAdapter.js`, `src/components/mentionLiveTransform.js`, `src/engine/engineFlow.js`; add/update `tests/electron/api/llm/prompts.test.js`, `tests/electron/story/stepMachine.characterRefs.test.js`, `tests/utils/mentionParser.test.js`, `tests/utils/sceneMentions.test.js`, `tests/utils/promptLexicalAdapter.test.js`, `tests/components/mentionTransform.test.js`, `tests/components/PromptInput.storymode.test.jsx`, `tests/engine/engineFlow.test.jsx`.

**Tests first:** prompt instructions provide portable mention tokens and require natural inline placement in both outputs; each required portable character appears at least once in each output; every plain or braced token is gated through `extractMentionNames` plus `resolveMentions`; existing inline tokens are not prepended/duplicated; shared leading boundaries pass; malformed/unclosed/empty/nested braces remain plain text; braced names resolve exact with no particle stripping and need no trailing boundary; missing/unknown/unresolved tokens are stripped to plain text with a warning and never fail the step; allowed punctuation and plain Korean particles remain parseable; space names emit `@{name}` while `{}`/newline names and validation failures retain tag/gap-reference injection from `37aadcdc`; editor round-trips resolved and unresolved brace tokens without data loss; legacy glued prompts are repaired deterministically.

### M5 — Prompt K-batches with review off (experiment only)

**Files:** create `electron/story/storyPromptBatches.js` and `tests/electron/story/storyPromptBatches.test.js`; modify `electron/story/stepMachine.js`, `electron/api/llm/prompts.js`; add/update `tests/electron/story/stepMachine.promptsBatched.test.js`, `tests/electron/story/stepMachine.audioPrompts.integration.test.js`.

**Tests first:** K=3 contiguous targeting; fixed roster/style and read-only adjacent context; concurrency 2; out-of-order accumulation by `sceneNo`; only prompt fields merge; streamed previews arrive independently; failure/abort writes nothing; fewer than 6 scenes and every `sceneGranularity: 'segment'` request stay single-call; review-enabled requests remain on legacy single-call mode; M4 mention fallback remains active.

### M6 — Targeted prompt review and gated enablement

**Files:** modify `electron/api/llm/schemas.js`, `electron/api/llm/prompts.js`, `electron/api/llm/llmClaude.js`, `electron/api/llm/llmCodex.js`, `electron/api/llm/llmGemini.js`, `electron/story/stepMachine.js`, `electron/story/storyPromptBatches.js`; add/update `tests/electron/story/stepMachine.reviewLoop.test.js`, `tests/electron/api/llm/llmClaude.structured.test.js`, `tests/electron/api/llm/llmCodex.test.js`, `tests/electron/api/llm/llmGemini.test.js`.

**Tests first:** review returns structured scene issues; only affected batches revise; no full-array revise call occurs for normal generation or K-batch-eligible `reviewOnly`; repaired prompt fields merge without touching structure/IDs; missing issue numbers safely repair independent batches; configured rounds and abort semantics remain; exhausted mention repair uses M4's warning-plus-strip fallback; review-enabled K-batches activate only after the A/B gate.

## 8. Cross-cutting risks

- **Identity/audio corruption:** any normalized wording change, duplicate overlap, or omission can destabilize IDs and SRT alignment. The normalized ordered-coverage validator is a release blocker for scenes chunking, not a raw-format checker or quality warning.
- **Forced boundaries:** paragraph chunking prevents a scene from spanning a chunk boundary and reduces long-range pronoun context. Thresholding, read-only neighbors, fixed roster, and A/B boundary review are the controls.
- **Rate limits and cost:** parallelism reduces wall-clock only if provider throttling and repeated context do not dominate. Keep concurrency bounded and measure tokens/retries.
- **Review re-globalization:** full-array prompt revision can undo batch isolation; do not enable reviewed K-batches before M6, including through `reviewOnly`. Scenes review remains global in v1, so measure its latency separately and atomically reject any reviewed scenes/speakers pair whose scenes violate normalized coverage.
- **Out-of-order UI:** parallel previews may arrive from later chunks first. They are explicitly provisional and sorted by source coordinates; durable numbering waits for final concat.
- **Mention grammar split:** Flow and API still have separate plain-token boundary/particle logic. Use exact brace tokens for space names and when `-`/`_` ambiguity matters; brace tests in both consumers are parity blockers. Names containing braces/newlines and validation failures must use the `37aadcdc` tag/gap-reference path rather than aliases.
- **Late deltas and partial commits:** follow the existing operation gate and terminal `story:state` cleanup; never persist previews. The wrapper's stale-controller checks remain the commit boundary (`electron/story/stepMachine.js:2345-2382`).

## FEASIBILITY SUMMARY

Live progress is feasible now: prompts streaming is already shipped in `f43a713d`, and scenes can reuse the same parser, op gate, ghost preview, and terminal cleanup with Claude reset forwarding, a small Codex wiring change, and a StoryView render-condition fix. Actual latency reduction is also feasible, but the two steps require different designs: scenes must preserve normalized source coverage, so use thresholded deterministic paragraph chunks with read-only neighbor context, bounded parallel calls, ordered concat/renumber, and consumer-parity validation; reject per-scene rewriting and the two-pass design for this scope. Prompts may use K=3 generation batches for non-segment granularity because prompt text is derived, provided full-array review (including eligible `reviewOnly`) is replaced by targeted batch repair and inline `@mentions` use the strict plain-or-braced portable grammar with a warning-plus-strip M4 fallback. Space names use exact `@{name}`; brace/newline-invalid names and validation failures keep tag/gap-reference conditioning. Build streaming unconditionally; enable either fan-out path only after the stated A/B gates pass.
