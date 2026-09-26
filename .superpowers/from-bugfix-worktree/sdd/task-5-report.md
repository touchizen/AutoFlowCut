# Task 5 Report: keyStoreMulti genai split-brain removal

## Files changed
- `electron/api/keyStoreMulti.js` — removed the `genai: 'genai-key.enc'` line from `FILENAME_BY_PROVIDER` (lines 8-9). `PROVIDERS` is derived via `Object.keys(FILENAME_BY_PROVIDER)`, so `'genai'` is now automatically excluded from the allowlist. No other logic touched.
- `tests/electron/api/keyStoreMultiGenai.test.js` — new test file (per brief), verifying `PROVIDERS` excludes `'genai'` and that `setKey/getKey/hasKey('genai')` are no-ops (unknown provider). One deviation from the brief's literal text: the brief's Step 1 snippet passes `path: require('node:path')` into `createMultiKeyStore` inside an ESM test file that already does `import path from 'node:path'` at the top — `require` is undefined in this repo's ESM/vitest setup (`"type": "module"`, no CJS shim). Used the already-imported `path` binding (`path: path`) instead of calling `require`, preserving the test's intent (real `node:path.join` semantics) without introducing a `ReferenceError: require is not defined`.

## Test commands + raw output

### New test (Step 2 — verify failing before fix)
```
$ npx vitest run tests/electron/api/keyStoreMultiGenai.test.js
FAIL tests/electron/api/keyStoreMultiGenai.test.js > ... > genai is not in PROVIDERS allowlist
  AssertionError: expected [ 'genai', 'elevenlabs', …(3) ] to not include 'genai'
FAIL tests/electron/api/keyStoreMultiGenai.test.js > ... > setKey(genai) is rejected and writes no file
  AssertionError: expected true to be false
Test Files  1 failed (1)
     Tests  2 failed (2)
```

### New test (Step 4 — after implementation)
```
$ npx vitest run tests/electron/api/keyStoreMultiGenai.test.js
Test Files  1 passed (1)
     Tests  2 passed (2)
Duration  542ms
```

### Regression — full electron/api test dir
```
$ npx vitest run tests/electron/api/
Test Files  62 passed (62)
     Tests  754 passed (754)
Duration  4.33s
```

## Existing tests updated?
None needed updating. Checked:
- `tests/electron/api/keyStoreMulti.test.js` — never used `'genai'` as a provider; only exercises `typecast`, `elevenlabs`, and generic allowlist-rejection cases (`../evil`, prototype-pollution keys). Unaffected.
- `tests/electron/api/keyStore.test.js` and `tests/electron/api/genai.test.js` — these test the separate single-file `keyStore.js` and the `genai.js` REST client respectively; their `genai` references are filenames/module names, not `keyStoreMulti` provider calls. Unaffected.

No existing test asserted `genai` was a valid `keyStoreMulti` provider, so no test needed to be migrated to `typecast`/`elevenlabs`/`googletts`.

## Downstream sanity check (not required by task scope, done for confidence)
Grepped consumers of `keyStoreMulti` (`electron/main.js`, `electron/ipc/tts-api.js`, `src/config/apiKeyRegistry.js`, `src/hooks/useTtsKeys.js`, `src/components/settings/TtsKeyTab.jsx`) for `genai` usage routed through the multi-store:
- `src/config/apiKeyRegistry.js:10` already maps `gemini: { keyId: 'genai', store: 'genai', ... }` where `store: 'genai'` is a distinct alias meaning "the single `keyStore` module", not `keyStoreMulti`'s `'genai'` provider key.
- `electron/main.js:237` already has `gemini: () => genaiKeyStore.getKey()` — reads from the separate single `genaiKeyStore` (backed by `genai-key.enc` via `main.js:213-215`), not `keyStoreMulti`.

So the Gemini key path was already routed exclusively through the single `keyStore`/`genaiKeyStore` before this change; removing `'genai'` from `keyStoreMulti`'s allowlist closes the dead/unused split-brain path without affecting any live code path.

## Concerns
- `git status` showed `package.json` modified (`buildNumber` 1119 → 1223) before I touched anything — unrelated to this task (looks like an auto-increment from some other process/session). Left uncommitted/untouched; only the two files named in the brief were staged and committed.
- None regarding the actual change — it's a pure allowlist-shrink with no other logic touched, and the full `tests/electron/api/` suite (754 tests) is green.
