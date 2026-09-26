# Slice1 Review Fix Report

Branch: feature/story-pipeline

## Command run (all 4 covering test files together)

```
npx vitest run tests/electron/api/tts/typecast.test.js tests/electron/api/tts/elevenlabs.test.js tests/electron/api/tts/voiceGenderCache.test.js tests/utils/voiceGender.test.js
```

## Output

```
 RUN  v4.1.4 /Users/tuxxon/workspace/AutoFlowCut


 Test Files  4 passed (4)
      Tests  22 passed (22)
   Start at  00:27:30
   Duration  684ms (transform 108ms, setup 490ms, import 55ms, tests 46ms, environment 1.75s)
```

## Per-finding mapping

- **Finding 1** (typecast.js listVoices getKey-throw fallback) — covered by new test
  `listVoices falls back to seeds when getKey throws (production no-key behavior)` in
  tests/electron/api/tts/typecast.test.js — PASS (part of the 22 above).
- **Finding 2** (elevenlabs.js KNOWN_VOICES seed gender/genderSource) — covered by new test
  `seed fallback voices carry structured gender (e.g. Rachel)` in
  tests/electron/api/tts/elevenlabs.test.js — PASS.
- **Finding 3** (voiceGenderCache.js get() non-object degrade) — covered by new test
  `degrades to {} for valid-but-wrong JSON: %s` (`[]`, `42`, `"x"`) in
  tests/electron/api/tts/voiceGenderCache.test.js — PASS (3 cases).
- **Finding 4** (voiceGenderCache.js tag() manual > f0) — covered by new test
  `f0 does not override an existing manual entry` in
  tests/electron/api/tts/voiceGenderCache.test.js — PASS. Existing
  `manual overrides existing f0 entry` test still PASS.
- **Finding 5** (voiceGender.js classify from rounded F0) — existing 4 tests in
  tests/utils/voiceGender.test.js (120Hz male/high, 210Hz female/high, 170Hz female/low,
  silence→null) all still PASS after the fix.

## Regression check (full tts/story suite, no push)

Command:
```
npx vitest run tests/electron/api/tts/ tests/electron/story/ tests/electron/ipc/tts-api.test.js
```

Output:
```
 RUN  v4.1.4 /Users/tuxxon/workspace/AutoFlowCut


 Test Files  36 passed (36)
      Tests  224 passed (224)
   Start at  00:27:41
   Duration  1.88s (transform 809ms, setup 4.07s, import 1.36s, tests 2.26s, environment 9.55s)
```

No regressions.
