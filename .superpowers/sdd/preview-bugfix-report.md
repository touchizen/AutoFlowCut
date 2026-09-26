# Preview Bugfix Report — Typecast v30 model + ElevenLabs regional SSRF allowlist

Branch: `feature/story-pipeline`
Date: 2026-07-07

## BUG 1 — Typecast hardcoded `model: 'ssfm-v21'` breaks v30 voices

### Failing test (before fix)

```
FAIL  tests/electron/api/tts/typecast.test.js > createTypecastAdapter > synthesize resolves the per-voice model discovered via listVoices (BUG 1: v30 voices 422 with hardcoded v21)
AssertionError: expected 'ssfm-v21' to be 'ssfm-v30'

FAIL  tests/electron/api/tts/typecast.test.js > createTypecastAdapter > synthesize uses an explicit model argument over the discovered/default model
AssertionError: expected 'ssfm-v21' to be 'ssfm-v99-override'
```

(3rd new case — unknown voiceId falls back to `ssfm-v21` — already passed against old code, since old code always sent v21; it remains green after the fix by design.)

### Fix

`electron/api/tts/typecast.js`:
- Added closure-scoped `const voiceModelById = new Map()` inside `createTypecastAdapter`.
- `listVoices()` now records `voiceModelById.set(raw.voice_id, raw.model)` for every raw voice returned by the live `/v1/voices` fetch (seed KNOWN_VOICES untouched, still default to v21 when no live data).
- `synthesize({ text, voiceId, emotion = 'normal', signal, model })` now accepts an optional `model` and resolves `const useModel = model || voiceModelById.get(voiceId) || 'ssfm-v21'`, sent as `model: useModel` in the request body (replacing the hardcoded `'ssfm-v21'`).

### Passing test (after fix)

```
PASS  tests/electron/api/tts/typecast.test.js (12 tests)
 ✓ synthesize resolves the per-voice model discovered via listVoices (BUG 1: v30 voices 422 with hardcoded v21)
 ✓ synthesize uses an explicit model argument over the discovered/default model
 ✓ synthesize falls back to ssfm-v21 for an unknown/unlisted voiceId
 ✓ (all pre-existing typecast tests still pass, incl. original synthesize model=ssfm-v21 assertion — unmodified, still valid since that test never calls listVoices first)
```

---

## BUG 2 — ElevenLabs regional preview_url host (`api.us.elevenlabs.io`) blocked by SSRF allowlist

### Failing test (before fix)

```
FAIL  tests/electron/api/net/ssrfSafeFetch.test.js > isPreviewUrlAllowed > allows ElevenLabs regional API subdomains (BUG 2: api.us.elevenlabs.io preview_urls were rejected)
AssertionError: expected false to be true
```

### Fix

`electron/api/net/ssrfSafeFetch.js`:
- Removed the exact-match `ALLOW_HOSTS` array.
- `isPreviewUrlAllowed` now allows a host (after the existing https-only + private/loopback-IP checks) if:
  - `host === 'storage.googleapis.com'` (exact — unchanged, ElevenLabs CDN), OR
  - `host === 'elevenlabs.io'` OR `host.endsWith('.elevenlabs.io')` (covers `api.elevenlabs.io`, `api.us.elevenlabs.io`, any future regional subdomain).
- Suffix check via `.endsWith('.elevenlabs.io')` (with the leading dot) guards against lookalike hosts such as `elevenlabs.io.attacker.com`, which does not end with `.elevenlabs.io`.

### Passing test (after fix)

```
PASS  tests/electron/api/net/ssrfSafeFetch.test.js (14 tests)
 ✓ allows ElevenLabs regional API subdomains (BUG 2: api.us.elevenlabs.io preview_urls were rejected)
 ✓ rejects a lookalike host that merely has elevenlabs.io as a prefix
 ✓ rejects http even for an otherwise-allowed elevenlabs regional host
 ✓ (all pre-existing ssrfSafeFetch tests still pass, incl. 127.0.0.1 / private-IP rejection, byte cap, redirect bound, MIME canonicalization)
```

---

## Full regression

```
$ npx vitest run tests/electron
 Test Files  105 passed (105)
      Tests  880 passed (880)
```

## Scope

Only the 4 intended files touched:
- `electron/api/tts/typecast.js`
- `electron/api/net/ssrfSafeFetch.js`
- `tests/electron/api/tts/typecast.test.js`
- `tests/electron/api/net/ssrfSafeFetch.test.js`
