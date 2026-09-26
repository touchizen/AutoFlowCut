# M2 Task 1 report — stepMachine 선별 헬퍼 hoist + audioPreflight

## Status: DONE

Commit: `5e0c5bfc` — "stepMachine: hoist audio selection helpers + add audioPreflight (required providers)"
(branch `feature/story-audio-apikey-gate`, repo `/Users/tuxxon/workspace/AutoFlowCut-bugfix`, no git remote — local only)

## What was hoisted

`electron/story/stepMachine.js`, machine scope, right after `effectiveEmotion` (was ~line 210, landed at line ~262 after `effectiveEmotion` so it can reference it and `ttsVoiceKey` without relying purely on hoisting semantics):

```js
function makeAudioSelection(params, speakers, defaultVoiceCfg) {
  const forceRegen = new Set(params.regenerate || [])
  const segmentsDir = path.join(projectPath, 'story', 'audio', 'segments')
  const reusePathOf = (seg) => path.join(segmentsDir, path.basename(seg.audioPath))
  const voiceOf = (spk) => findSpeakerByRef(speakers, spk)?.voice || defaultVoiceCfg || null
  const canReuse = async (seg) => { /* exact original body from :1573-1580 */ }
  const sfxSourceOf = (seg) => params.sfxSources?.[seg.id] || seg.sourceMode || 'elevenlabs'
  const sfxKeyOf = (seg) => `${sfxSourceOf(seg)}:${seg.description || ''}:${seg.durationHint ?? 'auto'}`
  const canReuseSfx = async (seg) => { /* exact original body from :1584-1588 */ }
  return { forceRegen, segmentsDir, reusePathOf, voiceOf, canReuse, canReuseSfx, sfxSourceOf, sfxKeyOf }
}
```

All bodies were copied verbatim (byte-identical logic) from the original inline definitions — no behavior was rewritten, only relocated and parameterized (`params`/`speakers`/`defaultVoiceCfg` instead of closing over `audio()`'s locals directly).

`audio()` now does:

```js
const sel = makeAudioSelection(params, speakers, defaultVoice)
const { voiceOf, canReuse, canReuseSfx, sfxSourceOf, sfxKeyOf, reusePathOf, forceRegen } = sel
```

right where the old inline `voiceOf` used to sit (immediately after `if (params.speakers) { state.speakers = ...; await flush() }`), and the original inline block (old `forceRegen`/`segmentsDir`/`reusePathOf`/`canReuse`/`sfxSourceOf`/`sfxKeyOf`/`canReuseSfx`, previously right before the TTS concurrency section) was deleted — replaced with a one-line comment pointing at `sel`. Destructuring keeps every downstream reference in `audio()` (`voiceOf(...)`, `canReuse(seg)`, `canReuseSfx(seg)`, `sfxSourceOf(seg)`, `sfxKeyOf(seg)`, `reusePathOf(seg)`, `forceRegen.has(...)`) textually unchanged — this was deliberate to minimize the risk of missing a call site during the hoist.

Comments describing *why* each rule exists (IP5-a resume/reuse, Codex-M2a-2b MED path staleness, Codex-TTS HIGH voiceKey fingerprint, C1-a default-voice fallback, M2b sfx reuse fingerprint) were moved into `makeAudioSelection` alongside the code they explain, since that's now where the logic lives. `audio()` keeps a short pointer comment instead of duplicating them.

`segmentsDir` is returned from the factory but not destructured/used directly in `audio()` (it was previously only used internally by `reusePathOf`); that's unchanged — no behavior difference.

## audioPreflight implementation

Added as a method on the **actual returned machine object** (the `return { ... }` starting ~line 1969, right after `open()`), **not** inside the internal `const steps = { ... }` object that `audio()`/`prompts()`/`scenes()` etc. live in. This distinction mattered — see "risk found and fixed" below.

```js
async audioPreflight(params = {}) {
  const scenesJson = JSON.parse((await store.loadText('scenes.json')) || 'null')
  if (!scenesJson) return []
  const speakers = params.speakers || state?.speakers || []
  const sel = makeAudioSelection(params, speakers, defaultVoice || null)
  const segments = scenesJson.scenes.flatMap((sc) => sc.segments || [])
  const isTest = params.mode === 'segmentTest'
  const ids = isTest ? new Set(params.segmentIds || []) : null
  const required = new Set()
  for (const seg of segments) {
    const type = seg.type || 'narration'
    if (isTest && !ids.has(seg.id)) continue
    if (type === 'sfx') {
      const source = sel.sfxSourceOf(seg)
      if (source === 'library') continue
      if (!isTest && await sel.canReuseSfx(seg)) continue
      required.add(source)
    } else {
      const voice = sel.voiceOf(seg.speaker)
      if (!voice || voice.provider === 'import') continue
      if (!isTest && await sel.canReuse(seg)) continue
      required.add(voice.provider || 'typecast')
    }
  }
  return [...required]
}
```

One deliberate deviation from the brief's literal sketch: `state.speakers` → `state?.speakers`. `state` can be `null` if `audioPreflight` is ever called before `open()` populates it; the existing `synthPreview` method (same file) already uses the same `state?.speakers || []` guard for the identical reason, so this matches established convention rather than introducing a new one.

Read-only: no `store.saveText`/`flush`/`send` calls — matches the brief's "부수효과 없음" requirement.

## Risk found and fixed during implementation

The brief said "Register it on the machine's returned object next to the step methods." I first added `audioPreflight` inside `const steps = { ... }` (right next to `audio()`/`prompts()`, since that's textually where `audio()` lives) — but `steps` is an **internal** dispatch table only reachable via `machine.start(stepName, params)` (see `async start(step, params = {})` further down), not exposed on the object `createStepMachine(...)` actually returns to callers. The first test run failed with `TypeError: machine.audioPreflight is not a function`, which caught this immediately. Moved the method to the real returned object (next to `open()`/`loadAudioPackage()`/`getState()`/`synthPreview()`), and it resolved.

## Tests

New file: `tests/electron/story/audioPreflight.test.js` (8 tests). Harness copied from `tests/electron/story/stepMachine.audio.test.js`'s pattern — real filesystem via `mkdtemp`/`tmpdir`, real `createStoryStore` (not mocked), `story/scenes.json` written directly, `story/story.json` pre-seeded with a `speakers` array so `state.speakers` is populated by `machine.open()` (exercising the `params.speakers || state.speakers` fallback exactly as `audio()` does), and `defaultVoice` passed as a `createStepMachine` constructor option (matches `audio()`'s injection point).

Tests cover: (1) mixed assigned/default-voice narration → both providers, (2) import-voice speaker excluded, (3) sfx source contributes, `library` excluded, (4) `scenes.json` missing → `[]` no throw, (5) unassigned speaker + no default voice → skipped, (6) reusable narration segment (done + matching voiceKey + file present on disk at `reusePathOf`) → contributes nothing, (7) reusable sfx segment (done + matching sfxKey + file present) → contributes nothing, (8) `segmentTest` mode scopes to `segmentIds` and ignores reuse (a reuse-eligible segment still required when targeted; an untargeted segment excluded even though it would otherwise need a provider).

### New test run

```
$ npx vitest run tests/electron/story/audioPreflight.test.js
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

### Full stepMachine regression

```
$ npx vitest run tests/electron/story/
 Test Files  48 passed (48)
      Tests  607 passed (607)
```

`stepMachine.audio.test.js` specifically:

```
$ npx vitest run tests/electron/story/stepMachine.audio.test.js
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

Other stepMachine consumers outside `tests/electron/story/` (found via grep for `createStepMachine`/`stepMachine.js`):

```
$ npx vitest run tests/integration/storyClaudePipeline.test.js tests/integration/storyPipelineM1.test.js tests/electron/ipc/story-api.test.js
 Test Files  3 passed (3)
      Tests  38 passed (38)
```

Full project suite (`npm run test:run`), to be thorough given this touches the core audio path:

```
 Test Files  642 passed (642)
      Tests  6682 passed (6682)
     Errors  2 errors  (unhandled rejections in tests/components/VideoDetailModal.generateButton.test.jsx,
                        "Cannot read properties of null (reading 'seed')" in src/components/VideoDetailModal.jsx:163 —
                        pre-existing, unrelated to this change: unrelated component, not on the stepMachine/audio path.
                        Both tests still report "passed"; this is a stray warning, not a failure caused by this commit.)
```

## Behavior-preservation checks performed

- Traced every call site of `voiceOf`, `canReuse`, `canReuseSfx`, `sfxSourceOf`, `sfxKeyOf`, `reusePathOf`, `forceRegen`, `segmentsDir` inside `audio()` (lines 1345–1851 pre-edit) via grep to confirm the destructure covers all of them (it does — `segmentsDir` itself is unused directly, only via `reusePathOf`, unchanged).
- Confirmed `makeAudioSelection`'s free variables (`findSpeakerByRef`, `ttsVoiceKey`, `effectiveEmotion`, `projectPath`, `path`, `stat`) are all machine-scope closures/module imports already available at the call site, and — since `makeAudioSelection` is only *invoked* well after `createStepMachine`'s synchronous body finishes initializing all its `const`s — the placement is safe regardless of textual declaration order (same pattern the codebase already relies on, e.g. `audio()` itself is declared far below `findSpeakerByRef` and uses it fine).
- `node --check electron/story/stepMachine.js` after each edit.
- Diffed the final method bodies of `canReuse`/`canReuseSfx` against the original lines verbatim — no logic characters changed, only surrounding declaration/closure structure.
- `git diff` reviewed in full before commit; confirmed no accidental changes outside the two intended files (an unrelated `package.json` `buildNumber` bump — likely from some dev-mode auto-increment hook — was deliberately left unstaged/uncommitted since it's unrelated to this task).

## Concerns / follow-ups for later tasks (not blocking this task)

- `audioPreflight` does not call `assertSegmentIdsValid` (unlike `audio()`/`synthPreview()`), matching the brief's spec exactly (it's a pure read-only prediction, not a write path — malformed/duplicate ids there don't corrupt anything since nothing is persisted). Worth confirming this is the intended contract for whoever wires the API-key gate on top of this (M2 task 2+), since a scenes.json with duplicate/missing ids would silently produce a plausible-looking (but not 1:1 addressable) provider set.
- `audioPreflight` reads `defaultVoice` from the machine's constructor injection only (not from `params`), matching `audio()`'s own asymmetry (speakers can be overridden per-call via `params.speakers`, but `defaultVoice` cannot). This is intentional parity with `audio()`, not a new asymmetry introduced by this task.
