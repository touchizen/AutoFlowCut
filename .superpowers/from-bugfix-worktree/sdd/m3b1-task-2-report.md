# M3b-1 Task 2 Report — voicePreviewService errorKind classification

## Status: DONE

Commit: `ddf8e268` — "voicePreviewService: classify preview failures by errorKind (fallback to regex)"
(branch `feature/story-audio-apikey-gate`)

## Harness used

The brief's test harness sketch matched the real `createVoicePreviewService({ cacheDir, fs, ttsFor, voiceMeta, ssrfSafeFetch, fetch })`
signature exactly (verified by reading `electron/api/tts/voicePreviewService.js:31` before writing anything) —
no adaptation was needed. Used verbatim:

```js
// tests/electron/api/tts/voicePreviewErrorKind.test.js
import { describe, it, expect } from 'vitest'
import { createVoicePreviewService } from '../../../../electron/api/tts/voicePreviewService.js'
import { MissingProviderKeyError, ProviderAuthError } from '../../../../electron/api/keyErrors.js'

function makeService(throwErr) {
  return createVoicePreviewService({
    cacheDir: '/tmp/nope-cache',
    ttsFor: () => ({ synthesize: async () => { throw throwErr } }),
    voiceMeta: () => ({}),
    ssrfSafeFetch: async () => ({ audio: Buffer.alloc(0), mimeType: 'audio/mpeg' }),
    fetch: async () => ({}),
    fs: { existsSync: () => false, readFileSync: () => Buffer.alloc(0), mkdirSync: () => {}, writeFileSync: () => {}, renameSync: () => {} },
  })
}

describe('voicePreviewService getPreview — errorKind classification', () => {
  it('MissingProviderKeyError → {error:"no-key", provider}', async () => {
    const svc = makeService(new MissingProviderKeyError('typecast'))
    const res = await svc.getPreview({ provider: 'typecast', voiceId: 'v1', language: 'ko' })
    expect(res).toEqual({ error: 'no-key', provider: 'typecast' })
  })
  it('ProviderAuthError → {error:"unauthorized", provider}', async () => {
    const svc = makeService(new ProviderAuthError('gemini', { status: 400 }))
    const res = await svc.getPreview({ provider: 'gemini', voiceId: 'Kore', language: 'ko' })
    expect(res).toEqual({ error: 'unauthorized', provider: 'gemini' })
  })
  it('generic error → {error:"failed", provider}', async () => {
    const svc = makeService(new Error('network boom'))
    const res = await svc.getPreview({ provider: 'elevenlabs', voiceId: 'x', language: 'ko' })
    expect(res).toEqual({ error: 'failed', provider: 'elevenlabs' })
  })
})
```

Why this reaches `ttsFor(provider).synthesize`: `voiceMeta()` returns `{}` (no `previewUrl`), so
`produce()` skips the elevenlabs preview_url branch and goes straight to `ttsFor(provider).synthesize(...)`
(voicePreviewService.js:57-59). The disk-cache loop misses because injected `fs.existsSync` always
returns `false`.

## Implementation change

`electron/api/tts/voicePreviewService.js:79-88` (getPreview's `.catch`):

```js
.catch((e) => {
  const kind = e?.errorKind
  let error
  if (kind === 'story-audio-no-tts-key') error = 'no-key'
  else if (kind === 'story-audio-tts-auth') error = 'unauthorized'
  else {
    const msg = String(e?.message || e)
    error = /no .* key|No .* API key/i.test(msg) ? 'no-key' : /401|unauth/i.test(msg) ? 'unauthorized' : 'failed'
  }
  return { error, provider: e?.provider || provider }
})
```

Matches the brief's Step 3 code verbatim.

## Files touched

- Modified: `/Users/tuxxon/workspace/AutoFlowCut-bugfix/electron/api/tts/voicePreviewService.js` (catch block, lines ~79-88)
- Added: `/Users/tuxxon/workspace/AutoFlowCut-bugfix/tests/electron/api/tts/voicePreviewErrorKind.test.js`

No existing test needed updating — `tests/electron/api/tts/voicePreviewService.test.js:48-53`
("returns error object when no key") throws a plain untyped `Error('No Typecast API key')`
(not `MissingProviderKeyError`), so it stays on the regex fallback path and still matches
`/no .* key/i` → `'no-key'`. `r.error` is asserted only as truthy, unaffected either way.

## Test commands + raw output

### 1. New test, before fix (confirm fail)

```
$ npx vitest run tests/electron/api/tts/voicePreviewErrorKind.test.js
```
```
 ❯ tests/electron/api/tts/voicePreviewErrorKind.test.js (3 tests | 1 failed) 6ms
     × ProviderAuthError → {error:"unauthorized", provider} 3ms

AssertionError: expected { error: 'failed', provider: 'gemini' } to deeply equal { error: 'unauthorized', …(1) }
- Expected
+ Received
  {
-   "error": "unauthorized",
+   "error": "failed",
    "provider": "gemini",
  }

 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
```
Exactly the failure the brief predicted (Step 2): MissingProviderKeyError and generic-Error cases
already passed by regex coincidence; ProviderAuthError('gemini',{status:400}) failed because
"gemini auth failed: 400" doesn't match `/401|unauth/i`.

### 2. New test, after fix

```
$ npx vitest run tests/electron/api/tts/voicePreviewErrorKind.test.js
```
```
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  374ms
```

### 3. Regression — tts directory

```
$ npx vitest run tests/electron/api/tts/
```
```
 Test Files  11 passed (11)
      Tests  80 passed (80)
   Duration  727ms
```

### 4. Full suite

```
$ npm run test:run
```
```
 Test Files  648 passed (648)
      Tests  6701 passed (6701)
     Errors  2 errors
   Duration  43.25s
```
The 2 "Errors" are pre-existing unhandled rejections in
`tests/components/VideoDetailModal.generateButton.test.jsx` (`TypeError: Cannot read properties
of null (reading 'seed')` at `src/components/VideoDetailModal.jsx:163`) — exactly the
"VideoDetailModal 2 errors unrelated" the task instructions called out in advance. All 6701 tests
still report passed; unrelated to this change.

## Commit

```
$ git add electron/api/tts/voicePreviewService.js tests/electron/api/tts/voicePreviewErrorKind.test.js
$ git commit -m "voicePreviewService: classify preview failures by errorKind (fallback to regex)"
```
```
[feature/story-audio-apikey-gate ddf8e268] voicePreviewService: classify preview failures by errorKind (fallback to regex)
 2 files changed, 41 insertions(+), 3 deletions(-)
 create mode 100644 tests/electron/api/tts/voicePreviewErrorKind.test.js
```

`git log --oneline -3`:
```
ddf8e268 voicePreviewService: classify preview failures by errorKind (fallback to regex)
bb0a01ba Add locale strings for story-audio missing-key / auth errorKinds
b1ce1308 Add M3b-1 plan: errorKind locale + voicePreview classification
```

Note: `package.json` had a pre-existing unstaged modification unrelated to this task
(`git diff --stat package.json` → 1 line changed). Left untouched and not committed, per
"add specific files by name" discipline.

## Concerns

None. Brief's harness sketch matched the real signature exactly — no adaptation was required.
Both the new errorKind test and the full pre-existing suite are green. The only pre-existing
failures (VideoDetailModal) were flagged in advance by the task instructions and are unrelated
to `voicePreviewService.js`.
