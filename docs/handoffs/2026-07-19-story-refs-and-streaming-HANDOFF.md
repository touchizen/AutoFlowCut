# Handoff — Story reference injection + progressive streaming (2026-07-19)

Branch `bugfix` (merged to `main` at `7dc44049`; later commits on `bugfix` up to the picker
hardening are pushed to `origin/bugfix`). Full suite green (6410) at last run. Resume from here.

Two topics, user-approved to do IN ORDER: (1) re-test picker fix, (2) space-name mention fix,
(3) prompts-step streaming, (4) scenes-step streaming. Codex + Fable were consulted on (B) and
(A); their conclusions are baked in below.

---

## ITEM 1 — Re-test the narrow-window mention-picker fix (USER ACTION, no code)

The "references 완전 안됨 in 무한야담 ep02" is primarily the narrow-window mention-picker failure
already fixed this session (commits `0b2e05c4`→`5cba8a7e`, culminating in the type-filter trusted
-click + applied-verification). Forensics: only 9/149 scenes `done` in project.json, scene_1 regen
mid-fix-session. When the picker errors (`character-tab-not-found`), the WHOLE scene generation
fails → NO reference attaches for anyone (사내 included), in 147/149 scenes.
→ User must regenerate a scene on the latest `main` build and confirm 사내/순이/향리 references
attach. If they still don't, capture the runtime terminal logs (`[Flow Compose] … reason:` /
`[TrustedClick] …`) — that's a fresh downstream DOM bug, not the mapping.

---

## ITEM 2 — Space-name characters never inject in Flow scene mode (B-2)

Pre-existing bug (NOT a regression from the presence-based change; that change only widened
exposure). Project 무한야담 ep02 roster has two SPACE names: `도둑 우두머리`, `초저녁 도둑`.

Root cause (both reviewers agree):
- `MENTION_SAFE = /^[A-Za-z0-9_\-가-힣]+$/` (electron/story/stepMachine.js:742) has no `\s` →
  `withMentions` (stepMachine.js:744-748) silently drops space names → tag-only.
- `MENTION_RE` (src/utils/mentionParser.js:23) and the tokenizer in src/utils/sceneMentions.js:44
  (`isWordChar = /[0-9A-Za-z가-힣]/`) BOTH terminate at whitespace → a space name can never be a
  mention token anywhere.
- In Flow mode, a scene with ≥1 resolved mention routes `kind:'scene'` (src/engine/engineFlow.js:99)
  and DROPS tag-matched `referenceImages` (engineFlow.js:325/404; character.js:722 accepts only
  chips). So when a space name co-occurs with a safe mention (e.g. `@사내` in 143/149 scenes), the
  two bandits get NEITHER a chip NOR their tag-ref image → omitted from every Flow scene request.
  Measured: 도둑 우두머리 22 tagged / 0 mentions; 초저녁 도둑 28 / 0.

Fix options (design fork — DECIDE, then TDD + Codex/Fable review):
- (a) **mention-safe aliasing** (both reviewers' first choice; smaller, in-contract): one shared
  `mentionSafeName(name)` = `name.replace(/\s+/g,'_')` applied CONSISTENTLY at `structuredCharacter`
  (stepMachine.js ~707), `withMentions` (745), the `characters` tag (mapScene ~769), the Flow entity
  displayName, and the renderer Ref-card name — so name/tag/entity/mention all agree and the picker
  search types the aliased form. ⚠️ VERIFY the actual Flow entity/Ref name for these chars in
  project.json before choosing — if Flow already registered them as "도둑 우두머리" (space), aliasing
  the mention to `도둑_우두머리` won't match the picker search unless the entity displayName is also
  aliased (touches the Ref-sync path). `parseSceneMentions` (sceneMentions.js:20,58) matches known
  Ref names longest-first (not MENTION_RE), which helps.
- (b) **route-gap fix** (structurally complete, bigger): pass tag-matched `referenceImages` through
  `flow:generate-scene` (character.js:722) + engineFlow.js:325/404 so tag-only refs inject via
  mediaId conditioning alongside chips. Fixes ALL "mixed mention + tag-only" scenes, not just spaces.

Also: replace the test that codifies the silent drop — tests/electron/story/stepMachine.characterRefs.test.js:348
("space name → tag only") — with the new expectation, and add a mixed-mention routing test.

---

## ITEM 3 — Prompts-step progressive streaming (A, small; best value/effort S–M)

Feasible. Show each scene's imagePrompt/videoPrompt as it streams, as ghost text painted onto the
already-final scene rows (prompts merge by `sceneNo`→`storyId`, llmClaude.js:499-513 — clean key).

## ITEM 4 — Scenes-step progressive streaming (A, full; scope M)

Feasible as a PROVISIONAL PREVIEW overlay only. Streamed scenes must NEVER become source of truth —
storyId is assigned only in `normalizeScenes` (stepMachine.js:370), speaker-merge + the review loop
can wholesale-REPLACE the array (stepMachine.js:1145-1148), and `stampAppearingCharacters` runs on
the whole set. Preview rows have no storyId → separate `previewScenes` state, cleared on final
`story:state` (useStoryPipeline.js:204).

Shared architecture for A (both reviewers converge):
1. New `electron/api/llm/partialScenes.js`: stateful incremental parser fed appended text; tracks
   brace/string/escape depth inside the top-level `"scenes":[...]` array; on each closed top-level
   element, `JSON.parse` just that element → `onScene(scene, index)`. MUST be fail-silent.
2. Claude hook: in `structuredClaudeCall` loop (llmClaude.js:335) add a `m.type==='stream_event'`
   branch feeding `input_json_delta.partial_json` (+ `text_delta` for the no-outputFormat fallback
   at :351) into the extractor. `'result'` handling stays byte-identical (final parse authoritative).
3. Codex hook: plumb `onDelta` through `runCodexJson` (codexAppServer.js:277) into the same extractor
   (onDelta already exists at codexAppServer.js:211-216; verify delta shape vs `item/completed`).
   Gemini structured is non-streaming AND not in the prod router (storyLlmRouter.js:25 routes only
   codex/claude) → emits nothing → UI falls back to all-at-once automatically.
4. stepMachine: pass an `onPartialScene` callback into splitScenes/writePrompts; emit
   `send('story:progress', { kind:'scene-preview', phase:'started'|'scene', index, scene }, opId)` —
   mirror the `story:synopsis-delta` started/op-gate pattern; reset preview per LLM call (review
   revise = new whole-array candidate). Sanitize payload (segments text + summary for scenes;
   sceneNo + prompts for prompts).
5. Renderer: separate `previewScenes` state in useStoryPipeline (accumulate like the `audio-segment`
   map, op-gate like `synopsisActiveOpRef`); render only while step running; clear on final
   story:state. Provisional/non-editable/never-persisted.

Top risks: preview↔final divergence (must look provisional + reset per call), partial-JSON parser
edge cases (fail-silent), stale-op leakage (reuse operationId gating), Codex delta-shape verification.

User's framing note: they suspect per-scene generation may also improve QUALITY ("한꺼번에 만들면
결과물이 별로 안 좋아짐"), i.e. possibly separate per-scene LLM calls rather than one big call whose
JSON is streamed. That's a DIFFERENT approach (per-scene generation, not partial-JSON streaming) —
worth raising with the user before A: streaming the display of one big call ≠ generating each scene
independently. Clarify intent first.

---

## Working style for whoever resumes (ROLE SPLIT — mandatory)
- **Codex (gpt-5.6-sol via mcp — do NOT pass a model override, ChatGPT account rejects gpt-5.6*;
  let config.toml default apply, xhigh) AUTHORS the hard parts**, directly in the worktree
  (sandbox: workspace-write). For these items that means: the partial-JSON incremental parser
  (`partialScenes.js`), the Claude/Codex streaming hooks, and the B-2 space-name fix.
- **Fable 5 (Agent subagent_type Explore, model:'fable') REVIEWS** every milestone — it found the
  real race/failure gaps Codex's own review missed this session, so always run BOTH.
- **Opus ORCHESTRATES + VERIFIES** — never trust a paper fix: run the tests yourself, diff raw
  data, mutation-check the key change reverts red. Loop Codex→Fable→verify to findings 0 per
  milestone (3–5 rounds max; if findings don't shrink, the scope isn't captured).
- TDD every change (failing test first). Commits in English. Flow DOM changes need packaged/real-app
  verification — unit tests can be green while the app is broken (proven repeatedly this session).
