# Task 4 Report: SFX ElevenLabs adapter standard key errors

## Files
- Modified: `electron/api/sfx/elevenlabs.js`
- Added: `tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js`
- Depends on (unmodified, already committed): `electron/api/keyErrors.js`

## Change summary
- Added `import { MissingProviderKeyError, ProviderAuthError, isAuthResponse } from '../keyErrors.js'`
- Factory signature: `createElevenLabsSfxAdapter({ getKey, fetch, provider = 'elevenlabs' })`
- `generate()`:
  - `if (key == null) throw new MissingProviderKeyError(provider)` (was `if (!key) throw new Error('No ElevenLabs API key')`)
  - On `!res.ok`, checks `isAuthResponse(res.status, detail)` → `throw new ProviderAuthError(provider, { status, detail })`; otherwise falls through to the original generic `Error('ElevenLabs SFX failed: ...')`
- All other lines preserved exactly (comments, URL const, capabilities(), body construction, fetch call, success return).

## TDD sequence
1. Wrote failing test `tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js` (verbatim from brief).
2. Ran it — confirmed RED:
```
$ npx vitest run tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js
 FAIL  ... > generate throws MissingProviderKeyError without key
AssertionError: expected Error: No ElevenLabs API key to be an instance of MissingProviderKeyError
 FAIL  ... > generate maps 401 to ProviderAuthError
AssertionError: expected Error: ElevenLabs SFX failed: 401 no to be an instance of ProviderAuthError
 Test Files  1 failed (1)
      Tests  2 failed (2)
```
3. Implemented per brief (Step 3, verbatim).
4. Ran it again — GREEN:
```
$ npx vitest run tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

## Regression
```
$ npx vitest run tests/electron/api/sfx/
 Test Files  2 passed (2)
      Tests  8 passed (8)
```
No assertion updates were needed in `tests/electron/api/sfx/sfxAdapter.test.js`. The existing "키 없으면 throw" test used `rejects.toThrow(/api key/i)` (a regex, not the exact raw string `'No ElevenLabs API key'`), and `MissingProviderKeyError`'s message is `No elevenlabs API key` (provider name lowercase from the `createSfxAdapter` default) — still matches `/api key/i`. Grepped the whole repo for the literal string `'No ElevenLabs API key'` — no other references found, so nothing else was coupled to the old wording.

Also ran the full electron test tree for a broader safety check:
```
$ npx vitest run tests/electron/
 Test Files  190 passed (190)
      Tests  2016 passed (2016)
```

## Commit
```
f4d505a7 SFX ElevenLabs adapter: standard Missing/Auth key errors
 electron/api/sfx/elevenlabs.js                          |  7 +++++--
 tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js | 15 +++++++++++++++
 2 files changed, 20 insertions(+), 2 deletions(-)
```
Branch: `feature/story-audio-apikey-gate`. Note: `package.json` was already modified in the working tree before this task started (unrelated to this change) and was intentionally left uncommitted/unstaged — only the two intended files were staged and committed.

## Concerns
- None. The change is a narrow, surgical mirror of the Task 3 TTS pattern, scoped exactly to `generate()` and the factory signature as specified in the brief. No other lines in `elevenlabs.js` were touched.
