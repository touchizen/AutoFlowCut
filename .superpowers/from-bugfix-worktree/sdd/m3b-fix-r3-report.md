# M3b — R3 residual spec-clause fixes (Story audio key gate)

Branch: `feature/story-audio-apikey-gate`
Commits: `7e6415ae` (Finding 1), `44cf2f2c` (Finding 2)

## Finding 1 — §4.8: story:tts-preview loses errorKind → raw untranslated auth toast

### Change

The IPC handler `story:tts-preview` ran `machine.synthPreview(...)` inside `guarded(...)`
and let it throw straight through. `ProviderAuthError`/`MissingProviderKeyError`
(`electron/api/keyErrors.js`) carry `errorKind`/`provider`, but Electron's
`ipcRenderer.invoke`/`ipcMain.handle` boundary only serializes `Error.message` on a
rejection — so the renderer only ever saw the raw English message (e.g.
`"typecast auth failed: 401"`), with no `errorKind` to translate.

The file already had this exact problem solved once, for `story:load-audio-package`, via an
`asKind` wrapper (~story-api.js:167-172) that catches, and if the error carries `errorKind`,
resolves `{ error: e.errorKind }` instead of rethrowing (rethrows anything without
`errorKind` — bugs stay visible). I applied the identical pattern directly in the
`story:tts-preview` handler (no need for a separate `asKind` extraction — it's now a 3-line
try/catch in the handler body):

```js
ipcMain.handle('story:tts-preview', guarded(async ({ segmentIds, speakers, sfxSources }) => {
  try {
    return await machine.synthPreview({ segmentIds, speakers, sfxSources })
  } catch (e) {
    if (!e?.errorKind) throw e
    return { error: e.errorKind, provider: e.provider }
  }
}))
```

`machine.synthPreview` itself (`electron/story/stepMachine.js:2018`) is untouched — it still
throws on auth/missing-key (verified by the existing `stepMachine.preview.test.js`, which
tests it directly and is unaffected).

### IPC shape change

- **Before**: `story:tts-preview` invoke **rejects** with an `Error` whose `.message` is the
  only thing that survives IPC serialization (e.g. `"typecast auth failed: 401"`).
- **After**: on a typed key error, it **resolves** with `{ error: 'story-audio-tts-auth' | 'story-audio-no-tts-key', provider: <providerId> }` — same shape family as
  `story:load-audio-package`'s `{ error: kind }`. Any other exception (network, programmer
  error, anything without `errorKind`) is still rethrown/rejected unchanged — no behavior
  change for those.
- This does **not** collide with the success shape: `synthPreview` resolves
  `{ ok: true, segments: [...] }` or `{ busy: true }` on success/busy; the new `{ error, provider }`
  shape is disjoint (no `ok`/`busy`/`segments` key), so callers that check `r?.busy` /
  `r?.segments` first are unaffected, and a new `r?.error` check was added ahead of them.

### Renderer

`src/components/story/StoryView.jsx` — `runSegmentTestGuarded` (~L1227-1247, the function
`testSegment` and its `audioGate.retry()` path both funnel through) now checks the resolved
shape before falling through to the existing catch:

```js
const r = await ttsPreview?.({ segmentIds: [segId], speakers: ap.speakers, sfxSources: ap.sfxSources })
if (r?.busy) { toast.error(t('story.audio.busy')); return }
if (r?.error) {
  toast.error(t('story.audio.testFailed', { error: resolveDisplayError(t, r.error, r.error) }))
  return
}
const seg = r?.segments?.find((s) => s.id === segId)
if (seg?.audioPath) playAudio(seg.audioPath)
```

The `catch (e)` block (network/other, unchanged) still does
`toast.error(t('story.audio.testFailed', { error: e?.message || e }))` as the fallback for
errorKind-less exceptions. `resolveDisplayError` (imported already at StoryView.jsx:40) maps
`story-audio-tts-auth`/`story-audio-no-tts-key` to the existing `errorSection.kind.*` locale
strings (`src/locales/ko.js:1378-1379`, `en.js:1379-1380`), which were already present — no
locale changes needed.

### Files

- `electron/ipc/story-api.js` (handler catch/wrap)
- `src/components/story/StoryView.jsx` (`runSegmentTestGuarded`)
- `tests/components/story/storyAudioGate.test.jsx` (R3 pin updated)
- `tests/electron/ipc/story-api.test.js` (new IPC-level coverage)

### R3 test-pin note (line numbers didn't match — flagging as instructed)

The brief cited two pin locations, "storyAudioGate.test.jsx ~:214 and ~:662". The file is
only 248 lines total and I could find exactly **one** raw-message pin in the whole repo test
suite matching this bug (`mockRejectedValueOnce(new Error('invalid api key'))` /
`screen.findByText('테스트 실패: invalid api key')`, at what were lines 183/214 before my
edit). I searched the full `tests/` tree for `"auth failed"` / `"invalid api key"` and found
no second story-audio pin anywhere (the other "auth failed" hits are unrelated
useVideoAutomation/useAutomation auth-stop tests). I'm treating `~:662` as a stale line
reference (possibly from a since-trimmed version of this file) and fixed the one pin that
actually exists. If a second pin exists elsewhere in the codebase, it wasn't discoverable by
content search — worth a follow-up grep if this surfaces again.

Updated that test:
- `ttsPreview` mock: `mockRejectedValueOnce(new Error('invalid api key'))` →
  `mockResolvedValueOnce({ error: 'story-audio-tts-auth', provider: 'typecast' })` (matches the
  new IPC contract — the mock now models what the real handler actually resolves).
- Assertion: `screen.findByText('테스트 실패: invalid api key')` →
  `screen.findByText('테스트 실패: 음성 API 키가 유효하지 않습니다(인증 실패). 설정 › API 키에서 키를 다시 확인하세요.')`
  (the translated `story-audio-tts-auth` locale string).
- Added 3 new IPC-level tests in `story-api.test.js` (registering a `machine` with an
  injected `tts` adapter whose `synthesize` throws `ProviderAuthError`/
  `MissingProviderKeyError`/a plain `Error`), asserting the handler resolves
  `{ error: 'story-audio-tts-auth', provider: 'typecast' }`,
  `{ error: 'story-audio-no-tts-key', provider: 'typecast' }`, and rejects unchanged for the
  errorKind-less case, respectively.

### Test command + raw output

```
$ npx vitest run tests/electron/story/stepMachine.preview.test.js tests/components/story/storyAudioGate.test.jsx tests/electron/ipc/story-api.test.js

 Test Files  3 passed (3)
      Tests  52 passed (52)
   Duration  1.53s
```

## Finding 2 — §4.7: settings-tab key save doesn't trigger App voice reload

### Change

`ApiKeyTab.jsx` rendered `GenaiApiKeyField`/`TtsApiKeyField` without an `onSaved` prop even
though both wrappers already accepted one (added in an earlier milestone) and call it on
successful save. There was no reload wiring from Settings back up to App at all.

Threaded `onKeySaved(provider)` down the existing render chain:

- **App.jsx** — passes `onKeySaved={reloadTtsVoicesForProvider}` into `<SettingsModal>`
  (render site ~L2880). `reloadTtsVoicesForProvider` (App.jsx:777, pre-existing — the same
  function already used by the Story audio key gate's `onReloadVoices`) re-fetches the given
  provider's voices via `window.electronAPI.ttsListVoices` and does a REPLACE-not-merge swap
  via `replaceTtsVoicesForProvider` (`src/utils/ttsVoiceReload.js`). It's already best-effort
  (try/catch swallow) and provider-scoped, so calling it when Story isn't open, or for a
  provider whose voices aren't currently loaded, is a harmless no-op-ish refetch.
- **SettingsModal.jsx** — accepts `onKeySaved` prop, forwards it to
  `<ApiKeyTab t={t} onKeySaved={onKeySaved} />` (only the `apiKey` tab needs it).
- **ApiKeyTab.jsx** — accepts `onKeySaved`, passes
  `onSaved={() => onKeySaved?.('gemini')}` to `GenaiApiKeyField` and
  `onSaved={() => onKeySaved?.(id)}` to each `TtsApiKeyField` row (`id` is the existing
  per-provider loop variable from `TTS_PROVIDER_IDS`).
- `GenaiApiKeyField.jsx` / `TtsApiKeyField.jsx` were **not modified** — they already call
  `onSaved?.()` after a successful save (pre-existing, confirmed by reading both files).

### Prop chain

```
App.jsx: reloadTtsVoicesForProvider(provider)
  └─ <SettingsModal onKeySaved={reloadTtsVoicesForProvider}>
       └─ <ApiKeyTab onKeySaved={onKeySaved}>            (only when activeTab === 'apiKey')
            ├─ <GenaiApiKeyField onSaved={() => onKeySaved?.('gemini')}>
            │     └─ onSave() success → onSaved?.()  →  onKeySaved('gemini')
            └─ <TtsApiKeyField onSaved={() => onKeySaved?.(id)}>  (id ∈ typecast/elevenlabs/googletts)
                  └─ onSave() success → onSaved?.()  →  onKeySaved(id)
```

### Test

New tests in `tests/components/settings/ApiKeyTab.test.jsx` (existing list/flag tests kept
as-is), mocking `useApiKey`/`useTtsKeys` with tracked `saveKey`/`validateKey` mocks:
- Gemini save → `onKeySaved` called with `'gemini'`.
- Typecast row save → `onKeySaved` called with `'typecast'` (and not `'gemini'`).
- No `onKeySaved` prop passed → save still completes without throwing (optional-chained,
  App not yet mounted / test harness without the prop stays safe).

### Test command + raw output

```
$ npx vitest run tests/components/SettingsModal.handleSave.test.jsx tests/components/settings/ApiKeyTab.test.jsx tests/components/settings/GenaiApiKeyField.test.jsx tests/components/settings/TtsApiKeyField.test.jsx

 Test Files  4 passed (4)
      Tests  13 passed (13)
   Duration  774ms
```

## Full suite

```
$ npm run test:run
...
 Test Files  657 passed (657)
      Tests  6742 passed (6742)
     Errors  2 errors
   Duration  41.82s
```

The 2 unhandled-rejection errors are the pre-existing, unrelated
`tests/components/VideoDetailModal.generateButton.test.jsx` →
`src/components/VideoDetailModal.jsx:163` (`Cannot read properties of null (reading 'seed')`)
issue called out as a known pre-existing condition in the task brief — untouched by either
fix, confirmed present before my changes (both findings' files are disjoint from
`VideoDetailModal.jsx`).

## Concerns

- **Finding 1 line-number mismatch**: see the "R3 test-pin note" above — I could not locate a
  second raw-message pin at `~:662` anywhere in the test tree; fixed the one pin that
  actually exists (`~:214`, now moved by my edits). Worth confirming this wasn't referring to
  a file that no longer exists in this branch.
- **Finding 2 "meaningful when Story voices are loaded" scoping**: I did not gate
  `reloadTtsVoicesForProvider` behind "is Story open" — it's already unconditionally
  best-effort (swallows failures, no-op if `ttsListVoices` isn't array-shaped), matching the
  brief's "harmless when Story isn't open" instruction. If a future reviewer wants it
  explicitly skipped when Story is closed (to avoid a wasted IPC round-trip), that would be a
  small additional guard in App.jsx, not in the prop-chain itself.
- No changes to `keyErrors.js`, `synthPreview`'s throwing behavior, or the TTS/SFX adapters —
  scope was IPC-boundary translation only, per the brief.
