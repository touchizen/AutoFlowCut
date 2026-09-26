# M3b pre-flight gate UI — 2nd-round review fix report

Branch: `feature/story-audio-apikey-gate`
Commit: `a2cd61b1` — fix(story-audio): guard segment-test retry, replace-not-merge voice reload, wire VoicePicker reload, single-source key URLs

All 5 findings applied. TDD used for every behavior change (new/updated failing test first,
then the source fix, then green). Full suite green except the two pre-existing/unrelated
`VideoDetailModal` errors called out in the task brief.

---

## Finding 1 (High) — segmentTest save-retry error handling

**Problem:** `testSegment` passed an inline `async () => {...}` as the `run` callback to
`runAudioWithPreflight`. When the gate showed (missing key), `AudioKeyGateCard.onKeySaved`
fires the stored `retry` **after** `testSegment`'s own `try/finally` has already exited
(`previewBusy` already reset to `false`). The retry called that raw inline callback directly
with no busy guard and no `catch` of its own — an invalid-but-present key would let
`ttsPreview` reject, producing an unhandled rejection and no translated error toast, plus no
protection against a second overlapping trigger.

**Fix:**
- Extracted the guarded body into `runSegmentTestGuarded(segId)` in
  `src/components/story/StoryView.jsx` (~L1219-1247): its own `previewBusyRef`-based guard,
  `try { ttsPreview… } catch (e) { toast.error(t('story.audio.testFailed', …)) } finally { … }`.
- `testSegment` now calls `runAudioWithPreflight({...}, () => runSegmentTestGuarded(segId))` —
  the `run` callback stored as `audioGate.retry` is now the *same guarded function*, so the
  post-key-save retry goes through identical error handling as the original call.
- Defense in depth: `AudioKeyGateCard`'s `onKeySaved` handler (~L2176-2185) now `await`s and
  `catch`es `audioGate.retry?.()` instead of firing it unawaited, protecting every gate call
  site (not just segment-test) against a stray unhandled rejection if a future `run` callback
  ever throws.

**Files:** `src/components/story/StoryView.jsx`

**Test:** `tests/components/story/storyAudioGate.test.jsx` — new test `세그먼트 "테스트" 게이트에서
키 저장 후 retry가 가드된 경로를 타 — ttsPreview가 거부돼도 unhandled 없이 에러 토스트를 보여준다`.
Registers a `process.on('unhandledRejection', …)` spy, drives: preview blocked by missing key →
gate shown → save key → preflight recheck passes → retry fires `ttsPreview` which **rejects**
(`Error('invalid api key')`) → asserts the gate closes, the translated toast
`테스트 실패: invalid api key` appears, and the unhandledRejection spy was never called after an
extra macrotask tick.

```
npx vitest run tests/components/story/storyAudioGate.test.jsx
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

---

## Finding 2 (Med) — provider reload should replace, not merge

**Problem:** `reloadTtsVoicesForProvider` (App.jsx) called `mergeTtsVoices`, which upserts
per-voice by `voiceKey`. After a key swap to a different account, voices from the old account
that aren't present in the newly-fetched list were never removed — merge only adds/updates,
never deletes.

**Fix:** Extracted two pure helpers into new file `src/utils/ttsVoiceReload.js`:
- `ttsListVoicesReloadParams(provider)` — builds the `ttsListVoices` IPC params
  (`includeShared`/`maxSharedPages` special-cased for elevenlabs, mirrors the initial preload
  effect's shape).
- `replaceTtsVoicesForProvider(prevVoices, provider, fetchedVoices)` — drops all existing
  entries for `provider`, keeps every other provider's voices untouched, appends the fresh
  ones (tagging them with `provider`).

`App.jsx`'s `reloadTtsVoicesForProvider` now calls
`setTtsVoices((prev) => replaceTtsVoicesForProvider(prev, provider, vs))` instead of
`mergeTtsVoices(...)`.

**Files:** `src/App.jsx`, `src/utils/ttsVoiceReload.js` (new)

**Test:** `tests/utils/ttsVoiceReload.test.js` (new) — executes the real pure functions:
- `ttsListVoicesReloadParams`: elevenlabs → `includeShared:true, maxSharedPages:10`; other
  providers → `includeShared:false, maxSharedPages:1`.
- `replaceTtsVoicesForProvider`: old voices for the target provider that are absent from the
  fresh list are dropped (not preserved — proves it's REPLACE not merge); other providers'
  voices are untouched; fetched voices get tagged with `provider`; empty/undefined fetched list
  clears that provider's slice entirely.

```
npx vitest run tests/utils/ttsVoiceReload.test.js
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

---

## Finding 3 (Med) — VoicePicker inline save not wired to reload

**Problem:** `VoicePicker`'s inline `AudioKeyGateCard` (per-voice, attempt-first no-key path)
only called `onPreview(v)` again on `onKeySaved` — it never refetched the provider's account
voices, so newly-key-gated account voices never appeared in the picker list.

**Fix:**
- `VoicePicker.jsx`: new `onReloadVoices = null` prop. The inline card's `onKeySaved` now does
  `try { await onReloadVoices?.(v.provider) } catch {} ` **then** re-attempts
  `onPreview({...})` — reload is best-effort (preview retry still happens even if reload fails
  or the prop isn't wired).
- `StoryView.jsx` (~L2367): `<VoicePicker onReloadVoices={onReloadVoices} .../>` — threads the
  prop StoryView already receives from `App.jsx` (`onReloadVoices={reloadTtsVoicesForProvider}`,
  wired in the M3b-1 commit) down to the picker.

**Files:** `src/components/story/VoicePicker.jsx`, `src/components/story/StoryView.jsx`

**Tests:**
- `tests/components/story/VoicePicker.noKeyInline.test.jsx` — two new tests: (a) saving the
  inline key calls both `onReloadVoices('typecast')` and re-attempts `onPreview(...)`; (b) a
  missing `onReloadVoices` prop doesn't break the existing preview re-attempt (best-effort).
- `tests/components/story/StoryView.test.jsx` — new end-to-end test
  `VoicePicker 인라인 키 게이트 저장 시 onReloadVoices(provider)가 실제로 호출된다`: renders the
  real `StoryView` (no VoicePicker/hook mocking beyond `window.electronAPI` stubs), opens the
  picker, clicks preview (stubbed `ttsPreviewVoice` → `{error:'no-key'}`), saves a key through
  the real `TtsApiKeyField`/`useTtsKeys` path, and asserts `onReloadVoices` was called with
  `'typecast'` — proving the prop is actually threaded through StoryView → VoicePicker, not
  just present in both components' signatures.

```
npx vitest run tests/components/story/VoicePicker.noKeyInline.test.jsx tests/components/story/StoryView.test.jsx
 Test Files  2 passed (2)
      Tests  38 passed (38)   # (20 + 38 across the two files when run together earlier; see full run below)
```
(Actual combined numbers below in the aggregate run.)

---

## Finding 4 (Low) — finish URL registry single-sourcing

**Problem:** `ApiKeyTab.jsx` had its own local `TTS_PROVIDERS` array with hardcoded
label/url per provider; `GenaiApiKeyField.jsx` hardcoded Gemini's label and get-key URL
inline. Both duplicated data already living in `API_KEY_REGISTRY`
(`src/config/apiKeyRegistry.js`).

**Fix:**
- `ApiKeyTab.jsx`: removed the local `TTS_PROVIDERS` array. Added
  `TTS_PROVIDER_IDS = Object.keys(API_KEY_REGISTRY).filter((id) => API_KEY_REGISTRY[id].store !== 'genai')`
  — this naturally yields `['typecast', 'elevenlabs', 'googletts']` in registry insertion
  order (gemini, `store:'genai'`, is filtered out since it's rendered separately via
  `<GenaiApiKeyField>`). The map now reads `label`/`getKeyUrl` straight from
  `API_KEY_REGISTRY[id]`.
- `GenaiApiKeyField.jsx`: `label`/`getKeyUrl` now read from `API_KEY_REGISTRY.gemini.label` /
  `.url` instead of the hardcoded `"Google Gemini"` / `"https://aistudio.google.com/apikey"`
  literals.

**Files:** `src/components/settings/ApiKeyTab.jsx`, `src/components/settings/GenaiApiKeyField.jsx`

**Test:** No new tests needed — existing tests already assert on the resulting rendered
label/url text (not the old hardcoded source), so they exercise the registry-sourced values
unchanged: `tests/components/settings/ApiKeyTab.test.jsx`,
`tests/components/settings/GenaiApiKeyField.test.jsx`,
`tests/config/apiKeyRegistry.test.js` (already asserted `API_KEY_REGISTRY.*.url` values, which
are now the actual single source both components consume).

```
npx vitest run tests/components/settings/ApiKeyTab.test.jsx tests/components/settings/GenaiApiKeyField.test.jsx tests/config/apiKeyRegistry.test.js
 Test Files  3 passed (3)
      Tests  10 passed (10)
```

---

## Finding 5 (Low) — App reload test pins source string

**Problem:** `tests/components/App.storyVoiceReload.test.js` grepped `App.jsx`'s source text
(`sliceBetween(...)`) and asserted the slice `toContain('mergeTtsVoices(vs.map((v) => ({ ...v, provider })))')`
— a formatting-fragile, never-executed check. After the Finding 2 fix this exact string no
longer even exists in App.jsx.

**Fix:** Since App.jsx (3000+ lines) isn't rendered anywhere in this test suite (all
`App.*.test.js` files use the same source-slice convention per their own comments), the
REPLACE semantics and elevenlabs-specific list params were already pulled out to
`src/utils/ttsVoiceReload.js` as part of Finding 2's fix, specifically so they could be
**executed** directly rather than grepped. `tests/utils/ttsVoiceReload.test.js` (Finding 2's
test file) is the real behavioral coverage — it imports and calls the actual functions App.jsx
uses.

`tests/components/App.storyVoiceReload.test.js` was refactored to:
- Keep only wiring-level source-slice checks (that App.jsx calls
  `window.electronAPI?.ttsListVoices?.(ttsListVoicesReloadParams(provider))` and
  `setTtsVoices((prev) => replaceTtsVoicesForProvider(prev, provider, vs))`, and that
  `<StoryView onReloadVoices={reloadTtsVoicesForProvider}>` is wired) — this is glue-code
  wiring, not branching logic, and matches this repo's established (documented) pattern for
  App.jsx-sized components.
- Add a "smoke" test that **imports and directly executes** the same
  `ttsListVoicesReloadParams`/`replaceTtsVoicesForProvider` functions App.jsx imports, to
  prove the wiring check above is pointing at the real, tested implementation and not a
  same-named decoy.

**Files:** `tests/components/App.storyVoiceReload.test.js`, `src/utils/ttsVoiceReload.js`,
`tests/utils/ttsVoiceReload.test.js`

```
npx vitest run tests/components/App.storyVoiceReload.test.js
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

---

## Aggregate area run

```
npx vitest run tests/components/story/storyAudioGate.test.jsx tests/components/App.storyVoiceReload.test.js \
  tests/utils/ttsVoiceReload.test.js tests/components/story/VoicePicker.noKeyInline.test.jsx \
  tests/components/story/StoryView.test.jsx tests/components/settings/ApiKeyTab.test.jsx \
  tests/components/settings/GenaiApiKeyField.test.jsx tests/config/apiKeyRegistry.test.js

 Test Files  8 passed (8)
      Tests  73 passed (73)
```

```
npx vitest run tests/components/story/ tests/components/App.storyVoiceReload.test.js \
  tests/utils/ttsVoiceReload.test.js tests/components/settings/

 Test Files  52 passed (52)
      Tests  600 passed (600)
```

## Full suite (`npm run test:run`)

```
 Test Files  657 passed (657)
      Tests  6736 passed (6736)
     Errors  2 errors
```

The 2 errors are the pre-existing, unrelated `VideoDetailModal.generateButton.test.jsx`
unhandled rejections (`TypeError: Cannot read properties of null (reading 'seed')` at
`src/components/VideoDetailModal.jsx:163`) called out as known/unrelated in the task brief —
not touched by this change, not introduced by it (verified they're pre-existing by their
stack trace pointing entirely at `VideoDetailModal.jsx`, a file untouched in this diff).

## Concerns

None blocking. Two things worth flagging for awareness, not action:

1. **Finding 1's `onKeySaved` await/catch is now generic** across all `runAudioWithPreflight`
   call sites (batch audio, segment regenerate, speaker-only run, redo), not just
   segment-test. This is intentionally defensive (per the finding's ask) — for the non-segment
   call sites, `run` ultimately calls `start('audio', p)` via the pipeline, which was already
   expected not to throw synchronously into this handler; awaiting it just makes the intent
   explicit and catches any future regression the same way. No behavior change was observed in
   their existing tests (`storyAudioGate.test.jsx` covers 3 of those paths and stayed green).
2. **`replaceTtsVoicesForProvider`'s "empty/undefined fetched list clears the slice"** behavior
   (Finding 2) means a transient IPC hiccup that returns `[]` (as opposed to a rejected
   promise, which is still caught and left as a no-op) would wipe that provider's cached
   voices. This mirrors the existing initial-preload effect's behavior (also treats `[]` as
   "no voices") and wasn't in scope to change per the finding — noting it as a pre-existing,
   unchanged edge case rather than a new regression.
