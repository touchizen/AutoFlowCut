# M2 audio pre-flight — review findings fix report

Branch: `feature/story-audio-apikey-gate`
Scope: `electron/story/stepMachine.js`, `electron/main/keyResolvers.js`,
`tests/electron/story/audioPreflight.test.js`

## Finding 1 (MUST-FIX) — audioPreflight ignores onlySpeaker → over-blocks

**Change.** `audioPreflight` now mirrors `audio()`'s `onlySpeaker` scoping exactly.

`canonicalSpeaker`/`belongsTo` used to be reimplemented **locally inside `audio()`**
(not actually machine-scope despite the task description assuming so — verified by
reading the function body). Since `audioPreflight` is a sibling method closing over
the same `createStepMachine` scope but not over `audio()`'s function body, it could
not reach them without either reimplementing the matching logic or hoisting the
binding. Per the task's fallback instruction, I hoisted it:

- Added two new machine-scope helpers right next to `findSpeakerByRef`
  (`electron/story/stepMachine.js`, after line 455):
  ```js
  const canonicalSpeakerOf = (speakers, ref) => findSpeakerByRef(speakers, ref)?.id ?? ref
  const belongsToSpeakerOf = (speakers, spk) => (seg) => canonicalSpeakerOf(speakers, seg.speaker) === spk
  ```
- `audio()`'s local `canonicalSpeaker`/`belongsTo` now **delegate** to these hoisted
  helpers instead of reimplementing the `findSpeakerByRef` lookup:
  ```js
  const canonicalSpeaker = (ref) => canonicalSpeakerOf(speakers, ref)
  const belongsTo = (spk) => belongsToSpeakerOf(speakers, spk)
  ```
  All downstream call sites in `audio()` (`scopedNarration`, `importSpeakers`,
  `belongsToSource`, `needsReview`, `imported.filter(belongsTo(spk))`) are
  byte-identical in behavior — same normalization, same result.
- `audioPreflight()` now computes `partialAudioRun` with the **same guard** as
  `audio()` (empty/whitespace `onlySpeaker` is not a partial run, since
  `isNarratorTrackSpeaker('')` is `true` and would otherwise silently scope to the
  narrator), and skips non-matching narration segments:
  ```js
  const partialAudioRun = typeof params.onlySpeaker === 'string' && !!params.onlySpeaker.trim()
  const isTargetSpeaker = partialAudioRun
    ? belongsToSpeakerOf(speakers, canonicalSpeakerOf(speakers, params.onlySpeaker))
    : null
  ...
  } else {
    if (partialAudioRun && !isTargetSpeaker(seg)) continue
    ...
  }
  ```

**Test added** (`tests/electron/story/audioPreflight.test.js`):
`onlySpeaker scopes narration to the target speaker and excludes SFX entirely
(Finding1+3)` — speaker A=typecast, B=gemini, one elevenlabs sfx segment. Without
`onlySpeaker`, preflight requires `{typecast, gemini, elevenlabs}`. With
`onlySpeaker: 'A'`, preflight returns exactly `['typecast']`.

## Finding 3 (folded into Finding 1) — sfxFor gate

**Change.** `audio()` only synthesizes sfx when
`sfxSegs = !partialAudioRun && sfxFor ? segments.filter(sfx) : []`
(`electron/story/stepMachine.js:1584`, unchanged). `audioPreflight` now applies the
identical gate before considering any sfx segment:

```js
if (type === 'sfx') {
  if (partialAudioRun || !sfxFor) continue
  ...
}
```

`sfxFor` is already a `createStepMachine({ ..., sfxFor = null, ... })` parameter
(line 204), so it was already reachable from `audioPreflight`'s scope — no hoisting
needed for this half.

**Tests.**
- Adjusted the pre-existing `sfx segment contributes its source; library excluded`
  test to inject a `sfxFor` stub (previously it didn't inject one, so the old
  "unconditionally add sfx sources" behavior happened to match; under the fixed gate
  this test would otherwise regress from `['elevenlabs']` to `[]`, which is now the
  *correct* prediction for an audio() run with no sfx adapter injected).
- Added `sfxFor not injected → sfx skipped entirely, even for a non-library source
  (Finding3)` — explicit regression test for the gate itself.
- Also injected `sfxFor` into the pre-existing `reusable sfx segment ... contributes
  nothing` test so it keeps exercising the `canReuseSfx` path (previously it was
  reusing the `!sfxFor` skip incidentally, no longer verifying reuse).

## Finding 2 — resolveKeyWithSource is the single source

**Change** (`electron/main/keyResolvers.js`). `resolveKeyWithSource` is now defined
first (canonical store→fallback chain for `typecast`/`elevenlabs`/`googletts`/
`genai`), and `ttsKeyFor`/`sfxKeyFor` derive their key purely from it instead of
independently re-deriving the same chain:

```js
const ttsKeyFor = {
  typecast: () => resolveKeyWithSource('typecast').key,
  elevenlabs: () => resolveKeyWithSource('elevenlabs').key,
  googletts: () => resolveKeyWithSource('googletts').key,
  gemini: () => resolveKeyWithSource('genai').key,
}
const sfxKeyFor = {
  elevenlabs: ttsKeyFor.elevenlabs,
}
```

`disableFallback` behavior is unchanged — it's still enforced entirely inside
`typecastFallback`/`credFallback`, which `resolveKeyWithSource`'s `FALLBACK` table
calls; `ttsKeyFor` no longer touches `disableFallback` at all, it just reads the
single `resolveKeyWithSource` result.

Sole caller (`electron/main.js:236`, `buildKeyResolvers({...})`) is unaffected — the
returned shape (`{ ttsKeyFor, sfxKeyFor, resolveKeyWithSource }`) is unchanged.

**Tests.** No new tests needed (pure internal refactor, external contract identical).
Verified both `keyResolvers.test.js` (nullable resolvers, incl. the
`getKey()`-called-with-no-arguments assertion for gemini) and
`resolveKeyWithSource.test.js` stay green — see raw output below.

## Nit — forceRegen test

Added `regenerate forces re-synth even for an otherwise reuse-eligible segment (nit)`
to `tests/electron/story/audioPreflight.test.js`: a segment that is `status:'done'`
with matching `voiceKey` and a present file (normally reuse-eligible → `[]`) is
still required again when `params.regenerate` includes its id
(`audioPreflight({ regenerate: ['s1'] })` → `['gemini']`), confirming `forceRegen`
inside `makeAudioSelection`'s `canReuse` is honored by the preflight path too.

## Hoist note (per task's fallback instruction)

`canonicalSpeaker`/`belongsTo` were **not** actually machine-scope before this
change — they lived inside `audio()`'s function body. I hoisted the core
normalization (`canonicalSpeakerOf`/`belongsToSpeakerOf`) to machine scope (next to
`findSpeakerByRef`, which they depend on and which was already machine-scope) and
made `audio()`'s local names thin wrappers around the hoisted versions. This keeps
`audio()`'s behavior byte-identical (same lookup, same result for every existing call
site) while giving `audioPreflight()` access to the same matching rule without
reimplementing it. `sfxFor` needed no such change — it was already a
`createStepMachine` parameter reachable from every method.

## Test commands + raw output

### Targeted (Finding 1/2/3 + nit + regression gate)

```
npx vitest run --reporter=verbose \
  tests/electron/main/keyResolvers.test.js \
  tests/electron/main/resolveKeyWithSource.test.js \
  tests/electron/story/audioPreflight.test.js \
  tests/electron/story/stepMachine.audio.test.js \
  tests/electron/ipc/audioPreflightIpc.test.js
```

```
 RUN  v4.1.10 /Users/tuxxon/workspace/AutoFlowCut-bugfix

 ✓ tests/electron/main/resolveKeyWithSource.test.js > resolveKeyWithSource > store hit → source store 1ms
 ✓ tests/electron/main/resolveKeyWithSource.test.js > resolveKeyWithSource > fallback hit → source fallback 0ms
 ✓ tests/electron/main/resolveKeyWithSource.test.js > resolveKeyWithSource > missing → null/null 0ms
 ✓ tests/electron/main/resolveKeyWithSource.test.js > resolveKeyWithSource > genai resolves from genaiKeyStore as store 0ms
 ✓ tests/electron/main/resolveKeyWithSource.test.js > resolveKeyWithSource > disableFallback: fallback ignored → null 0ms
 ✓ tests/electron/main/keyResolvers.test.js > buildKeyResolvers (nullable, dev switch) > typecast: store hit wins, never throws 1ms
 ✓ tests/electron/main/keyResolvers.test.js > buildKeyResolvers (nullable, dev switch) > typecast: falls back to loader, returns null instead of throwing when absent 0ms
 ✓ tests/electron/main/keyResolvers.test.js > buildKeyResolvers (nullable, dev switch) > disableFallback: ignores env/credentials, store-only 0ms
 ✓ tests/electron/main/keyResolvers.test.js > buildKeyResolvers (nullable, dev switch) > gemini resolves from genaiKeyStore only, calling getKey() with no arguments (real keyStore.getKey() contract) 0ms
 ✓ tests/electron/main/keyResolvers.test.js > buildKeyResolvers (nullable, dev switch) > sfx elevenlabs mirrors tts elevenlabs resolution 0ms
 ✓ tests/electron/story/audioPreflight.test.js > audioPreflight — required providers > narration with assigned gemini voice + typecast default → both when unassigned exists 6ms
 ✓ tests/electron/story/audioPreflight.test.js > audioPreflight — required providers > import-voice speaker is excluded (no key needed) 2ms
 ✓ tests/electron/story/audioPreflight.test.js > audioPreflight — required providers > sfx segment contributes its source; library excluded 2ms
 ✓ tests/electron/story/audioPreflight.test.js > audioPreflight — required providers > sfxFor not injected → sfx skipped entirely, even for a non-library source (Finding3) 1ms
 ✓ tests/electron/story/audioPreflight.test.js > audioPreflight — required providers > onlySpeaker scopes narration to the target speaker and excludes SFX entirely (Finding1+3) 2ms
 ✓ tests/electron/story/audioPreflight.test.js > audioPreflight — required providers > scenes.json missing → returns [] without throwing 1ms
 ✓ tests/electron/story/audioPreflight.test.js > audioPreflight — required providers > unassigned speaker with no default voice is skipped (no provider added) 1ms
 ✓ tests/electron/story/audioPreflight.test.js > audioPreflight — required providers > reusable narration segment (done, matching voiceKey, file present) contributes nothing 2ms
 ✓ tests/electron/story/audioPreflight.test.js > audioPreflight — required providers > reusable sfx segment (done, matching sfxKey, file present) contributes nothing 2ms
 ✓ tests/electron/story/audioPreflight.test.js > audioPreflight — required providers > segmentTest mode scopes to segmentIds and ignores reuse (always requires provider for targeted segment) 2ms
 ✓ tests/electron/story/audioPreflight.test.js > audioPreflight — required providers > regenerate forces re-synth even for an otherwise reuse-eligible segment (nit) 2ms
 ✓ tests/electron/ipc/audioPreflightIpc.test.js > buildAudioPreflightResult > maps providers to keyId + status via resolveKeyWithSource 1ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > 세그먼트 TTS 생성 → 실측 → SRT → 재그룹 → manifest 저장 10ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > 세그먼트 파일 확장자는 어댑터가 반환한 format을 따른다(.wav 하드코딩 금지) 4ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > scenes.json 세그먼트에 id가 없으면 audio 스텝은 즉시 throw한다 3ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > scenes.json 세그먼트 id가 중복되면 audio 스텝은 즉시 throw한다 3ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > scenes.json 세그먼트 id가 안전 패턴(영숫자/_/-)을 벗어나면 audio 스텝은 즉시 throw하고 TTS를 호출하지 않는다 3ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > 세그먼트 id에 슬래시가 섞여도(a/b) audio 스텝은 즉시 throw한다 3ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > final.srt 쓰기 직후 abort되면 manifest.json/scenes.json은 쓰이지 않는다 (각 커밋 직전 재체크) 4ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > audio 완료 시 steps.audio.status=done, prompts는 pending 리셋 3ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > manifest.json은 scenes.json보다 먼저 쓰인다 (스펙 §5 write order) 3ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > narration 세그먼트 실측이 0ms면 audio 스텝은 즉시 실패한다(0 accept 금지) 3ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > 합성이 인증 에러로 실패하면 그 사유를 스텝 에러에 보존한다 3ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > 합성이 MissingProviderKeyError로 실패하면 errorKind를 스텝 상태까지 보존한다 3ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > 미배정 화자가 있으면 TTS 호출 전에 즉시 throw한다 (사전 검증) 3ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > voice 객체가 있어도 voiceId가 없으면 TTS 호출 전에 즉시 throw한다 (말형 voice 검증) 3ms
 ✓ tests/electron/story/stepMachine.audio.test.js > audio 스텝 > voiceId가 빈 문자열이면 TTS 호출 전에 즉시 throw한다 2ms

 Test Files  5 passed (5)
      Tests  37 passed (37)
   Start at  02:19:22
   Duration  589ms (transform 445ms, setup 359ms, import 555ms, tests 85ms, environment 1.23s)
```

**Regression gate confirmed green**:
`tests/electron/story/stepMachine.audio.test.js` — 15/15 passed, no changes made to
this file.

### Full suite

```
npm run test:run
```

```
 Test Files  644 passed (644)
      Tests  6691 passed (6691)
     Errors  2 errors
   Start at  02:19:30
   Duration  41.51s
```

The 2 "Errors" are the pre-existing, unrelated `VideoDetailModal` unhandled
rejections (`TypeError: Cannot read properties of null (reading 'seed')` at
`src/components/VideoDetailModal.jsx:163`, from
`tests/components/VideoDetailModal.generateButton.test.jsx`) — present before this
change, not touched by it, and don't fail any test (all 6691 tests report passed).

## Concerns

- None blocking. The one design call: Finding 1/3's hoist widens
  `canonicalSpeakerOf`/`belongsToSpeakerOf` to machine scope rather than passing them
  through `makeAudioSelection`'s returned object. I chose the direct hoist because
  `makeAudioSelection` is speaker-list-agnostic scaffolding for reuse/source
  resolution (`canReuse`, `sfxSourceOf`, etc.) and mixing in onlySpeaker-scoping
  concerns there would broaden its purpose beyond what Finding 1/3 asked for — the
  helpers live next to `findSpeakerByRef`, the function they depend on, which felt
  like the more surgical placement. No other call sites reference the old inline
  `canonicalSpeaker`/`belongsTo` definitions inside `audio()`, so this doesn't
  affect anything outside the two touched methods.
- The pre-existing `sfx segment contributes its source; library excluded` and
  `reusable sfx segment ... contributes nothing` tests in `audioPreflight.test.js`
  needed `sfxFor` injected to keep testing what they originally intended (source
  contribution / reuse), since Finding 3's gate now short-circuits sfx entirely
  without it. This is a genuine behavior change (audioPreflight no longer predicts
  sfx providers when `audio()` itself wouldn't synthesize sfx), which is exactly
  what Finding 3 asked for — flagging it here since it's the one place existing test
  expectations changed rather than just extended.
