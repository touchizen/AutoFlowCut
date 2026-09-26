# Task 3 Report: TTS adapters two-tier key contract

## Files changed

- `electron/api/tts/index.js` — `createTtsAdapter(provider, deps)` now merges `provider` into deps: `make({ ...deps, provider })`.
- `electron/api/tts/typecast.js` — added `import { MissingProviderKeyError, ProviderAuthError, isAuthResponse } from '../keyErrors.js'`; factory `createTypecastAdapter({ getKey, fetch, provider = 'typecast' })`; `synthesize()` throws `MissingProviderKeyError(provider)` on `key == null`, maps auth-shaped `!res.ok` to `ProviderAuthError(provider, { status, detail })` via `isAuthResponse`. `listVoices()`/`fetchAndCacheVoices()`/`capabilities()` untouched.
- `electron/api/tts/elevenlabs.js` — same pattern, `provider = 'elevenlabs'`. `listVoices()` untouched (still does nullable-key seed fallback).
- `electron/api/tts/gemini.js` — same pattern, `provider = 'gemini'`. `listVoices()` (sync, returns `KNOWN_VOICES`) untouched.
- `electron/api/tts/googletts.js` — same pattern, `provider = 'googletts'`. `listVoices()` untouched.
- `tests/electron/api/tts/adapterKeyContract.test.js` — new, exact content from the brief (10 tests: missing-key / listVoices-no-throw / 401-auth for typecast+elevenlabs+googletts, plus googletts 400 API_KEY_INVALID case).
- `tests/electron/api/tts/typecast.test.js` — updated 1 pre-existing assertion (see below).
- `tests/electron/api/tts/adapters.test.js` — updated 3 pre-existing assertions (see below).

Only `synthesize()` and the factory signature line were touched in each adapter; every other line (voice caching, headers, body construction, `capabilities()`, `listVoices()`) is byte-identical to before.

## TDD sequence

1. Wrote `tests/electron/api/tts/adapterKeyContract.test.js` verbatim from the brief.
2. Ran it first to confirm failure:
   ```
   npx vitest run tests/electron/api/tts/adapterKeyContract.test.js
   ```
   Result: `7 failed | 3 passed (10)` — synthesize threw generic `Error('No X API key')` / raw HTTP-status errors instead of the typed errors, exactly as the brief predicted.
3. Applied the Step 3a–3e changes verbatim from the brief.
4. Re-ran the new test — all green:
   ```
   npx vitest run tests/electron/api/tts/adapterKeyContract.test.js
   ```
   Output:
   ```
    RUN  v4.1.10 /Users/tuxxon/workspace/AutoFlowCut-bugfix

    Test Files  1 passed (1)
         Tests  10 passed (10)
   ```

## Existing adapter regression run

First pass (before fixing pre-existing assertions):
```
npx vitest run tests/electron/api/tts/
```
```
 ❯ tests/electron/api/tts/typecast.test.js (15 tests | 1 failed)
     × 키 없으면 throw
 ❯ tests/electron/api/tts/adapters.test.js (18 tests | 3 failed)
     × 키 없으면 throw / HTTP 실패 throw
     × 키 없음/HTTP 실패/audioContent 없음 throw
     × 키 없음/데이터 없음 throw

 FAIL adapters.test.js > ElevenLabs 어댑터 > 키 없으면 throw / HTTP 실패 throw
   AssertionError: expected [Function] to throw error matching /ElevenLabs API key/ but got 'No elevenlabs API key'
 FAIL adapters.test.js > Google Cloud TTS 어댑터 > 키 없음/HTTP 실패/audioContent 없음 throw
   AssertionError: expected [Function] to throw error matching /Google TTS API key/ but got 'No googletts API key'
 FAIL adapters.test.js > Gemini TTS 어댑터 > 키 없음/데이터 없음 throw
   AssertionError: expected [Function] to throw error matching /Gemini API key/ but got 'No gemini API key'
 FAIL typecast.test.js > createTypecastAdapter > 키 없으면 throw
   AssertionError: expected [Function] to throw error matching /Typecast API key/ but got 'No typecast API key'

 Test Files  2 failed | 8 passed (10)
      Tests  4 failed | 72 passed (76)
```
All 4 failures were message-string assertions that called the factories directly (not through `index.js`), so `provider` fell back to its lowercase default (`typecast`/`elevenlabs`/`googletts`/`gemini`), and the resulting `MissingProviderKeyError` message (`No typecast API key`) no longer matched the old capitalized regex (`/Typecast API key/`, `/ElevenLabs API key/`, etc.).

### Updated existing tests and why

- `tests/electron/api/tts/typecast.test.js`: `'키 없으면 throw'` — changed `.rejects.toThrow(/Typecast API key/)` → `.rejects.toBeInstanceOf(MissingProviderKeyError)`. Added `import { MissingProviderKeyError } from '../../../../electron/api/keyErrors.js'`.
- `tests/electron/api/tts/adapters.test.js`: 3 assertions (`ElevenLabs 어댑터 > 키 없으면 throw / HTTP 실패 throw`, `Google Cloud TTS 어댑터 > 키 없음/...`, `Gemini TTS 어댑터 > 키 없음/...`) — same substitution, `.rejects.toThrow(/X API key/)` → `.rejects.toBeInstanceOf(MissingProviderKeyError)`. Added the same import once at the top.
- These are exactly the class of update the brief flagged in Step 4 ("if an existing test asserted the old raw `'No X API key'` message string, update that assertion"). No other assertions in the directory referenced the old message text.

Second pass after fixing:
```
npx vitest run tests/electron/api/tts/
```
```
 RUN  v4.1.10 /Users/tuxxon/workspace/AutoFlowCut-bugfix

 Test Files  10 passed (10)
      Tests  76 passed (76)
```

### Out-of-scope check

`tests/electron/story/stepMachine.audio.test.js` also contains a literal `'No Typecast API key'` string, but it's a hand-rolled `tts` mock (`synthesize: async () => { throw new Error('No Typecast API key') }`) injected directly into `createStepMachine`, not a call through the real adapter factories — untouched by this change and out of the brief's scope (`tests/electron/api/tts/` only). Ran it anyway as a sanity check: `npx vitest run tests/electron/story/stepMachine.audio.test.js` → `14 passed (14)`.

Searched `electron/` and `src/` for any other direct callers of `createTypecastAdapter` / `createElevenLabsAdapter` / `createGeminiAdapter` / `createGoogleTtsAdapter` — only the adapter files themselves and the two test files above; no production code calls the factories directly (all go through `createTtsAdapter` in `index.js`), so no other regression surface exists.

## Self-review

- `listVoices()` (and `fetchAndCacheVoices()`/`capabilities()`) in all 4 adapters are byte-for-byte unchanged — confirmed via `git diff`, which shows only the import line, the factory destructuring line, and the two lines inside `synthesize()` (`requireKey` check + auth-mapping branch) touched per file.
- No adapter logic beyond the key/auth boundary changed — headers, request bodies, voice caching/model resolution, PCM→WAV wrapping, etc. are identical to before.
- `key == null` (not `!key`) used per the brief, so an empty-string key (not currently produced by `keyStore`, but semantically distinct from "no key") does not misfire `MissingProviderKeyError`.

## Commit

`36408acc` — "TTS adapters: two-tier key contract (requireKey at synthesize) + auth mapping"
8 files changed, 55 insertions(+), 13 deletions(-).
(Note: an unrelated pre-existing unstaged change to `package.json` was left untouched/unstaged — not part of this task.)

## Concerns

None blocking. Two minor observations, no action taken (out of scope):
1. `tests/electron/story/stepMachine.audio.test.js:302,309` still hardcodes the raw Typecast message string via a hand-rolled mock rather than the real adapter/error type — fine for now since it's testing stepMachine's error-preservation behavior, not the adapter contract, but if a future task wires stepMachine to construct/inspect `MissingProviderKeyError`/`ProviderAuthError` directly, that test may want updating too.
2. `tests/electron/api/tts/voicePreviewService.test.js:49` also has a similar hand-rolled mock string; same reasoning, untouched.
