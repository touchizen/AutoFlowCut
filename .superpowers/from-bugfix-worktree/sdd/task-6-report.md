# Task 6 Report: main resolver nullable 통일 + 폴백 dev 스위치

## Status: DONE

## Files

- Added: `electron/main/keyResolvers.js` — pure `buildKeyResolvers({ multiKeyStore, genaiKeyStore, getTypecastKey, readCredentialsKey, disableFallback })`.
- Added: `tests/electron/main/keyResolvers.test.js` — 5 unit tests from the brief (verbatim, with the one fix below).
- Modified: `electron/main.js` — new import, inline `ttsKeyFor`/`sfxKeyFor` object literals replaced with a `buildKeyResolvers(...)` call.

## Deviation from the brief (and why)

The brief's `gemini` resolver was `gemini: () => genaiKeyStore.getKey() ?? null` (no argument). Its own test uses a generic `store(map)` fixture for `genaiKeyStore` keyed by `'genai'`:

```js
const store = (map) => ({ getKey: (p) => map[p] ?? null })
...
genaiKeyStore: store({ genai: 'g' }), ...
expect(ttsKeyFor.gemini()).toBe('g')
```

Calling `getKey()` with no argument means `p === undefined`, so `map[undefined]` is `undefined`, not `'g'` — the test as specified would fail against the brief's own implementation (verified directly in a node repl before touching real code). Real `genaiKeyStore.getKey()` (`electron/api/keyStore.js`) takes zero parameters and ignores any extra argument, so passing one is harmless there. Fix: call `genaiKeyStore.getKey('genai')` instead — satisfies both the test fixture and the real store's actual (arg-ignoring) signature. No other deviations.

## main.js wiring diff (semantic)

Before (two inline literals, ~line 233 and ~line 273):

```js
const ttsKeyFor = {
  typecast: () => multiKeyStore.getKey('typecast') || getTypecastKey(),
  elevenlabs: () => multiKeyStore.getKey('elevenlabs') || readCredentialsKey('elevenlabs', 'ELEVENLABS_API_KEY'),
  googletts: () => multiKeyStore.getKey('googletts') || readCredentialsKey('googletts', 'GOOGLE_TTS_API_KEY'),
  gemini: () => genaiKeyStore.getKey(),
}
...
const sfxKeyFor = {
  elevenlabs: () => multiKeyStore.getKey('elevenlabs') || readCredentialsKey('elevenlabs', 'ELEVENLABS_API_KEY'),
  library: () => null,
}
```

After:

```js
import { buildKeyResolvers } from './main/keyResolvers.js'
...
const { ttsKeyFor, sfxKeyFor: sfxKeyForBuilt } = buildKeyResolvers({
  multiKeyStore,
  genaiKeyStore,
  getTypecastKey,
  readCredentialsKey,
  disableFallback: process.env.AUTOFLOWCUT_DISABLE_KEY_FALLBACK === '1',
})
...
const sfxKeyFor = { ...sfxKeyForBuilt, library: () => null }
```

Note: the real `sfxKeyFor` in main.js also has a `library: () => null` provider (SFX-only, not part of the tts key surface, not covered by `buildKeyResolvers`'s spec-defined shape). Kept it by spreading `sfxKeyForBuilt` and adding `library` back in main.js, so `sfxFor('library')` behavior is unchanged. `buildKeyResolvers` itself stays exactly as spec'd (elevenlabs only) so the pure function/unit test surface matches the brief.

`ttsFor`/`sfxFor` consumption logic untouched — they still index into `ttsKeyFor[p]` / `sfxKeyFor[p]` exactly as before.

`getTypecastKey`/`readCredentialsKey` imports (lines 27–28) unchanged and still referenced (now only as bindings passed into `buildKeyResolvers`).

## Tests

Unit (TDD): `npx vitest run tests/electron/main/keyResolvers.test.js`

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Full suite: `npm run test:run`

```
 Test Files  640 passed (640)
      Tests  6671 passed (6671)
     Errors  2 errors
```

The 2 errors are the pre-existing, unrelated `VideoDetailModal` async-race unhandled rejections (`tests/components/VideoDetailModal.generateButton.test.jsx`, `TypeError: Cannot read properties of null (reading 'seed')` in `src/components/VideoDetailModal.jsx:163`) — present before this task, not touched by this change, and explicitly called out as known/unrelated in the task instructions.

`node --check electron/main.js` — syntax OK.

## Concerns

- None blocking. The one deviation (gemini resolver arg) is a one-line fix to the brief's own inconsistency, verified against the real `genaiKeyStore.getKey()` signature so behavior in production is unaffected (extra arg ignored).
- `sfxKeyFor.library` is spread in at the main.js call site rather than inside `buildKeyResolvers`, since the brief's pure-function contract (and its test) only covers `elevenlabs` for SFX. If a future task wants `library` inside the pure builder too, that's a 1-line addition.

## Commit

```
git add electron/main/keyResolvers.js electron/main.js tests/electron/main/keyResolvers.test.js
git commit -m "main: nullable key resolvers + AUTOFLOWCUT_DISABLE_KEY_FALLBACK dev switch"
```
