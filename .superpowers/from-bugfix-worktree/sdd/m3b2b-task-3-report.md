# M3b-2b Task 3 + concern-3 report

Branch: `feature/story-audio-apikey-gate`
Commits:
- `0a40fc0a` VoicePicker attempt-first: surface no-key preview + inline key entry
- `fb96a9e8` Fix gate card i18n interpolation via useSafeT params forwarding

## Part A — Task 3: VoicePicker attempt-first

### Files
- Modified: `src/hooks/useVoicePreview.js`
- Modified: `src/components/story/VoicePicker.jsx`
- New test: `tests/hooks/useVoicePreview.errorKind.test.js`
- New test: `tests/components/story/VoicePicker.noKeyInline.test.jsx`

### Change 1 — `src/hooks/useVoicePreview.js:44`

Before:
```js
if (!res || res.error) { setState({ provider: voice.provider, voiceId: voice.voiceId, status: 'error' }); return }
```

After:
```js
if (!res || res.error) { setState({ provider: voice.provider, voiceId: voice.voiceId, status: 'error', error: res?.error || 'failed' }); return }
```

Only this branch was touched per the brief ("keep the rest unchanged") — the `catch`/decode-failure/`audio.onerror`/`audio.play().catch` branches still set bare `status: 'error'` with no `error` field, unchanged from before.

### Change 2 — `src/components/story/VoicePicker.jsx`

- Imported `AudioKeyGateCard` and `keyIdForProvider` (from `../../config/apiKeyRegistry`).
- In the voice card render loop, added (after the traits tags, before the `vp-check` mark):

```jsx
{previewStatus === 'error' && previewState?.error === 'no-key' && (
  <div onClick={(e) => e.stopPropagation()}>
    <AudioKeyGateCard missing={[{ provider: v.provider, keyId: keyIdForProvider(v.provider) }]} t={t} />
  </div>
)}
```

`previewStatus` was already computed per-card as `previewState?.provider === v.provider && previewState?.voiceId === v.id ? previewState.status : 'idle'` — reusing it naturally scopes the inline gate to the exact card whose preview click failed (both provider and voiceId match), not every card sharing that provider. Wrapped in a `stopPropagation` div so clicking into the key-entry field doesn't also select the voice card (card's own `onClick` calls `onSelect`).

The voice list itself is unaffected — no upfront gate, cards render/filter/select exactly as before; the inline field only appears reactively after a failed preview attempt (attempt-first, per spec §4.7).

### Tests

`tests/hooks/useVoicePreview.errorKind.test.js` (from the brief, unmodified):
```
npx vitest run tests/hooks/useVoicePreview.errorKind.test.js
```
Red before the fix (`expected undefined to be 'no-key'`), green after.

`tests/components/story/VoicePicker.noKeyInline.test.jsx` (new, 4 cases):
1. shows the inline key field on the voice card whose preview failed with `error='no-key'`
2. does not leak a key field onto a different-provider card (asserted via `.setting-label` scoping, since the provider name also appears as a filter-chip label)
3. does not show anything when status isn't `error` or error isn't `no-key` (e.g. `unauthorized`)
4. the plain voice list still renders with no key present (keyless list preserved)

Raw output:
```
npx vitest run tests/components/story/VoicePicker.noKeyInline.test.jsx tests/components/story/VoicePicker.test.jsx
 Test Files  2 passed (2)
      Tests  17 passed (17)
```

## Part B — concern-3: gate card i18n interpolation

### Root cause (verified, not assumed)

`useSafeT()` (StoryView.jsx) already had a 3-arg signature `(key, fallback, params = {})` at HEAD — the brief's premise that it was a bare `(key, fallback)` 2-arg function was stale. The actual bug is a **calling-convention mismatch**: StoryView's own call sites always use `t(key, koFallbackString, params)`, but the shared Settings components reused via `AudioKeyGateCard` (`ApiKeyField.jsx`, `TtsApiKeyField.jsx`, `GenaiApiKeyField.jsx`) call `t` with the **real i18n signature** `t(key, params)` — 2 args, where the 2nd arg is the params object directly (matching `useI18n().t(key, params={})`).

Concretely, `src/components/settings/ApiKeyField.jsx:27`:
```js
placeholder={t('settings.ttsKeyPlaceholder', { label })}
```
When `t` is `useSafeT()`'s function, `{ label }` lands in the `fallback` parameter slot (not `params`), so:
- `interpolateFallback({label}, {})` stringifies the object → `"[object Object]"` (harmless fallback path, not hit here since a real `i18nT` exists)
- `i18nT(key, params)` is called with `params` defaulted to `{}` (the actual `{label}` object is discarded) → the real i18n string engine finds no `label` param and leaves `{label}` un-substituted in the output

This is not unique to the gate card — `StoryView.jsx:1213` (`t('story.audio.testFailed', { error: e?.message || e })`) has the exact same pre-existing bug pattern (unverified by any existing test, confirmed via `grep`), which corroborates the mismatched-convention diagnosis rather than something gate-card-specific.

### Fix — `src/components/story/StoryView.jsx` `useSafeT()`

Before:
```js
function useSafeT() {
  let i18nT = null
  try {
    i18nT = useI18n().t
  } catch {
    i18nT = null
  }
  return (key, fallback, params = {}) => {
    const fallbackValue = interpolateFallback(fallback, params)
    if (!i18nT) return fallbackValue
    const v = i18nT(key, params)
    return v === key ? fallbackValue : v
  }
}
```

After:
```js
function useSafeT() {
  let i18nT = null
  try {
    i18nT = useI18n().t
  } catch {
    i18nT = null
  }
  return (key, fallback, params) => {
    // Two calling conventions land on this `t`: StoryView's own (key, koFallbackString, params)
    // and the real i18n signature (key, params) used by shared Settings components (ApiKeyField/
    // TtsApiKeyField/GenaiApiKeyField) that StoryView reuses via AudioKeyGateCard. Passing a
    // params object straight through as `fallback` silently dropped it (params defaulted to {}),
    // so `{label}` etc. rendered literally instead of interpolating — detect that shape here.
    const isParamsShorthand = fallback !== null && typeof fallback === 'object'
    const realParams = isParamsShorthand ? fallback : (params || {})
    const fallbackValue = isParamsShorthand ? key : interpolateFallback(fallback, realParams)
    if (!i18nT) return fallbackValue
    const v = i18nT(key, realParams)
    return v === key ? fallbackValue : v
  }
}
```

Design: detect an object-typed 2nd argument (`fallback !== null && typeof fallback === 'object'`) and treat that call as the real-i18n shorthand — forward it as `params` and use `key` itself as the ultimate fallback (matching what the real `useI18n().t` does for an unresolvable key: return the bare key). All existing `(key, fallbackString)` and `(key, fallbackString, params)` call sites are untouched — `fallback` is a string there, so `isParamsShorthand` is `false` and the old `interpolateFallback(fallback, params)` path runs exactly as before.

I deliberately fixed this at `useSafeT` (global) rather than wiring a separate params-forwarding `t` just for `AudioKeyGateCard`, because `AudioKeyGateCard` itself mixes both conventions internally — its own title (`t('story.audio.keyGateTitle', '오디오를 만들려면...')`) uses the StoryView fallback-string convention, while the `TtsApiKeyField`/`GenaiApiKeyField`/`ApiKeyField` it renders use the params-object convention — so a single `t` prop threaded through has to support both regardless. Scoping the fix to `useSafeT` also fixes the identical pre-existing bug at `StoryView.jsx:1213` for free, with no separate call site to touch.

### Tests

New: `tests/components/story/StoryView.audioGateI18n.test.jsx` — renders `StoryView` inside a real `I18nProvider` (ko locale), drives it to the audio step with a `missing: typecast` pre-flight result, and asserts the gate card's input placeholder is `"Typecast API 키를 붙여넣으세요"` (interpolated) rather than the literal `"{label} API 키를 붙여넣으세요"`.

Red (before fix):
```
TestingLibraryElementError: Unable to find an element with the placeholder text of: Typecast API 키를 붙여넣으세요
...
placeholder="{label} API 키를 붙여넣으세요"   ← confirmed present in the DOM dump
```

Green (after fix):
```
npx vitest run tests/components/story/StoryView.audioGateI18n.test.jsx
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

Regression check — all existing `useSafeT`-dependent tests still pass, including the pre-flight gate flow tests that exercise the same `AudioKeyGateCard` render path:
```
npx vitest run tests/components/story/
 Test Files  41 passed (41)
      Tests  521 passed (521)
```

## Full suite (after both parts)

```
npm run test:run
...
 Test Files  655 passed (655)
      Tests  6717 passed (6717)
     Errors  2 errors
```

The 2 "errors" are the pre-existing, unrelated unhandled rejections in `tests/components/VideoDetailModal.generateButton.test.jsx` (`Cannot read properties of null (reading 'seed')` at `src/components/VideoDetailModal.jsx:163`), present before this change and explicitly called out as pre-existing/unrelated in the task brief. All 655 test files report as passed; no test regressions from either part.

## Concerns / follow-ups

1. **`StoryView.jsx:1213`** (`t('story.audio.testFailed', { error: e?.message || e })`) had the identical bug (params object landing in `fallback`) before this fix and is now also fixed as a side effect of the `useSafeT` change, but I did not add a dedicated regression test for that specific call site — it wasn't in scope for this task and no existing test exercised it. Worth a follow-up test if `testFailed` messaging is user-visible enough to matter.
2. `useVoicePreview.js`'s other failure branches (`catch` on the IPC call, decode-failure, `audio.onerror`, `audio.play().catch`) still collapse to bare `status: 'error'` with no `error`/kind field, per the brief's "keep the rest unchanged" instruction for Task 3 step 3. If VoicePicker's no-key inline card should also appear after those failure paths (e.g. a thrown/rejected `ttsPreviewVoice` call that should have surfaced `no-key`), that would need a deliberate follow-up — not attempted here since it was out of the brief's stated scope.
3. Per the brief's self-review note, §4.4's main-process re-check (TOCTOU window between render pre-flight and main-process execution using the same resolver) was called out as optional/deferred and remains untouched.
4. `package.json` has an unrelated pre-existing modification in the working tree (not touched or committed by this task).
