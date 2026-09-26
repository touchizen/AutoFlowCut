# M1 review findings — fix report

Branch: `feature/story-audio-apikey-gate`. All fixes applied TDD-style (red test → source
fix → green). Full raw command outputs below.

## Finding 1 (MOST IMPORTANT) — errorKind end-to-end test gap

**Problem:** `tests/electron/story/stepMachine.audio.test.js` had a mock `synthesize` that threw
a plain `new Error('No Typecast API key')` (no `errorKind`), and the test only asserted the raw
message. The real adapters throw `MissingProviderKeyError` (`errorKind: 'story-audio-no-tts-key'`).
Nothing locked that stepMachine actually preserves `errorKind` end-to-end from adapter throw →
segment-loop capture (`electron/story/stepMachine.js` ~1691/~1720) → step failure construction
(~1755-1759) → final step-state write (~2567).

**Change:** `tests/electron/story/stepMachine.audio.test.js`
- Added `import { MissingProviderKeyError } from '../../../electron/api/keyErrors.js'`.
- Added a new test: `'합성이 MissingProviderKeyError로 실패하면 errorKind를 스텝 상태까지 보존한다'`.
  Mock `synthesize` now throws `new MissingProviderKeyError('typecast')`. Asserts:
  ```js
  expect(state.steps.audio.status).toBe('error')
  expect(state.steps.audio.errorKind).toBe('story-audio-no-tts-key')
  expect(state.steps.audio.error).toMatch(/No typecast API key/)
  ```
- Kept the existing raw-message test (renamed the mock message to `'some non-key auth failure'`
  so it stays distinct in intent — "any non-key-shaped error still gets its message preserved
  verbatim, no errorKind" — while the new test covers the key-shaped path).

No source change was needed for this finding — stepMachine already threads `e?.errorKind` through
correctly. This test was pure verification/regression-lock, which is the entire point of the
finding (M1's reason for existing).

**Test command + output:**
```
$ npx vitest run tests/electron/story/stepMachine.audio.test.js
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

## Finding 2 — getKey arg (gemini resolver)

**Problem:** `electron/main/keyResolvers.js` called `genaiKeyStore.getKey('genai')`, but the real
`keyStore.getKey()` (`electron/api/keyStore.js:52`) takes no argument — the call site assumed a
multi-provider-keyed store shape that doesn't exist for `genaiKeyStore`.

**Change:**
- `electron/main/keyResolvers.js`: `gemini: () => genaiKeyStore.getKey('genai') ?? null` →
  `gemini: () => genaiKeyStore.getKey() ?? null`.
- `tests/electron/main/keyResolvers.test.js`: gemini fixture changed from the provider-keyed fake
  `store({ genai: 'g' })` to a `vi.fn()` spy (`{ getKey: vi.fn(() => 'g') }`) with an added
  assertion `expect(getKey).toHaveBeenCalledWith()` — this actually exercises the real no-arg
  contract (a plain arrow fixture would silently swallow the extra argument since JS doesn't
  enforce arity, so the test would false-pass without the spy).

**TDD proof:** with only the test changed (source untouched), the spy assertion failed:
```
AssertionError: expected "vi.fn()" to be called with arguments: []
Received: 1st vi.fn() call: ["genai"]
```
After the one-line source fix, all 5 tests pass:
```
$ npx vitest run tests/electron/main/keyResolvers.test.js
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

## Finding 3 — falsy key guard (empty-string key bypasses MissingProviderKeyError)

**Problem:** All 5 adapters guarded with `if (key == null) throw new MissingProviderKeyError(...)`,
which lets `key === ''` through to the real HTTP call, producing a bogus 401/403 instead of the
intended `MissingProviderKeyError`. `readCredentialsKey` can return `''`.

**Change:** `if (key == null)` → `if (!key)` in:
- `electron/api/tts/typecast.js:75`
- `electron/api/tts/elevenlabs.js:141`
- `electron/api/tts/gemini.js:88`
- `electron/api/tts/googletts.js:70`
- `electron/api/sfx/elevenlabs.js:18`

`listVoices` guards (typecast.js:44, elevenlabs.js:100/140-adjacent, gemini.js/googletts.js
lazy-populate paths) were left untouched — they already have their own try/catch → seed fallback,
which is out of scope per the finding.

**New test** (`tests/electron/api/tts/adapterKeyContract.test.js`):
```js
it('typecast: synthesize throws MissingProviderKeyError when key is empty string (falsy, not just null)', async () => {
  const a = createTtsAdapter('typecast', { getKey: () => '', fetch: okAudioFetch, provider: 'typecast' })
  await expect(a.synthesize({ text: 'hi', voiceId: 'v1' })).rejects.toBeInstanceOf(MissingProviderKeyError)
})
```
**TDD proof (red, before source fix):** promise resolved with fake audio bytes instead of rejecting.
**After fix:**
```
$ npx vitest run tests/electron/api/tts/adapterKeyContract.test.js tests/electron/api/sfx
 Test Files  3 passed (3)
      Tests  19 passed (19)
```

## Finding 4 — default adapter bypasses the nullable-key boundary

**Problem:** `electron/ipc/story-api.js:63-65` built the fallback Typecast adapter with
`getKey: () => (cachedTtsKey ??= getTypecastKey())`. `getTypecastKey` (env → `~/.typecast/credentials`
→ throw) throws when absent — that throw propagated straight out of `synthesize` as a raw `Error`
with no `errorKind`, bypassing the `MissingProviderKeyError` contract for the default/real-app path
(the exact path that ships when no `tts` is injected — i.e. production).

**Change:** `electron/ipc/story-api.js` — wrapped the loader call in try/catch, caching `null` on
failure (distinguishing "not yet resolved" `undefined` from "resolved to no key" `null`):
```js
let cachedTtsKey
const ttsAdapter = tts || createTtsAdapter('typecast', {
  getKey: () => {
    if (cachedTtsKey !== undefined) return cachedTtsKey
    try { cachedTtsKey = getTypecastKey() } catch { cachedTtsKey = null }
    return cachedTtsKey
  },
  fetch: (...a) => globalThis.fetch(...a),
})
```
`getTypecastKey` import at story-api.js:14 was already present and is unchanged.

**New test file** `tests/electron/ipc/story-api.defaultAdapter.test.js` — mocks
`electron/api/tts/typecastKey.js` (module-level `vi.mock`, since `getTypecastKey` isn't a
`registerStoryIPC` DI param) to throw, then drives `registerStoryIPC` **without** injecting `tts`
(the real default-adapter path) through `story:open` → `script` → `scenes` → `audio`, and asserts:
```js
expect(state.steps.audio.status).toBe('error')
expect(state.steps.audio.errorKind).toBe('story-audio-no-tts-key')
```
**TDD proof (red, before source fix):**
```
AssertionError: expected undefined to be 'story-audio-no-tts-key'
```
(status was already `'error'` — only `errorKind` was missing, confirming the raw-error leak.)

**After fix:**
```
$ npx vitest run tests/electron/ipc/story-api.defaultAdapter.test.js tests/electron/ipc/story-api.test.js \
    tests/electron/ipc/story-api.research.test.js tests/electron/ipc/story-api.generateTitle.test.js \
    tests/electron/ipc/story-api.synopsis.test.js
 Test Files  5 passed (5)
      Tests  62 passed (62)
```

## Nits

- `electron/main/keyResolvers.js`: `sfxKeyFor.elevenlabs` duplicated `ttsKeyFor.elevenlabs`'s
  expression verbatim. Changed to `elevenlabs: ttsKeyFor.elevenlabs` (same function reference,
  covered by the existing `sfx elevenlabs mirrors tts elevenlabs resolution` test, still green).
- `electron/api/sfx/index.js`: `createSfxAdapter` called `make(deps)` without merging `provider`
  into deps, unlike `electron/api/tts/index.js` (`make({ ...deps, provider })`). Fixed for
  symmetry: `return make({ ...deps, provider })`. `createLibrarySfxAdapter()` takes no args so the
  extra `provider` key is harmlessly ignored there; `createElevenLabsSfxAdapter` already defaults
  `provider = 'elevenlabs'` from its own deps param, so this mainly matters if a caller passes
  `provider` only as the `createSfxAdapter(provider, deps)` first arg without also duplicating it
  into `deps` (e.g. `electron/main.js:282` does exactly that). Verified via
  `tests/electron/api/sfx/sfxAdapter.test.js` (still green).

## Full-suite run

```
$ npm run test:run
...
 Test Files  641 passed (641)
      Tests  6674 passed (6674)
     Errors  2 errors
   Duration  42.30s
```

The 2 errors are the known pre-existing `VideoDetailModal` async-race unhandled rejections
(`tests/components/VideoDetailModal.generateButton.test.jsx` — `Cannot read properties of null
(reading 'seed')` in `src/components/VideoDetailModal.jsx:163`), unrelated to this work and present
before these changes. All 6674 tests pass.

## Files touched

- `tests/electron/story/stepMachine.audio.test.js` (finding 1)
- `electron/main/keyResolvers.js` (finding 2 + nit)
- `tests/electron/main/keyResolvers.test.js` (finding 2)
- `electron/api/tts/typecast.js`, `elevenlabs.js`, `gemini.js`, `googletts.js`,
  `electron/api/sfx/elevenlabs.js` (finding 3)
- `tests/electron/api/tts/adapterKeyContract.test.js` (finding 3)
- `electron/ipc/story-api.js` (finding 4)
- `tests/electron/ipc/story-api.defaultAdapter.test.js` (finding 4, new file)
- `electron/api/sfx/index.js` (nit)

## Concerns / notes

- `package.json` has an unrelated, pre-existing local diff (`buildNumber` bump from
  1119 → 1223, presumably from running the packaged app / a build script during this session).
  Not part of this work — left out of the commit.
- Not implemented (per instructions): the M2-deferred canonical `{key,source}` resolver/registry
  consumption — out of scope for M1.
- `story-api.defaultAdapter.test.js` mocks the `typecastKey.js` module at the module level (needed
  because `getTypecastKey` isn't an injectable `registerStoryIPC` param) — this is scoped to its
  own file so it doesn't affect other story-api tests that inject `tts` directly.
