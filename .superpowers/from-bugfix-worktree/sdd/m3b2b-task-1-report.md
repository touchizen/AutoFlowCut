# M3b-2b Task 1 Report — AudioKeyGateCard

## Status
Complete. TDD followed: failing test written first (module-not-found), implementation added, test passes, wrapper regression suite stays green.

## Commit
`136763e3` — "Add AudioKeyGateCard (inline key entry per missing provider)"

## Files

### Created
- `src/components/story/AudioKeyGateCard.jsx` — implemented exactly per brief Step 3. Renders `null` when `missing` is empty/undefined. For each `{provider,keyId}` in `missing`, looks up `API_KEY_REGISTRY[provider]` for the label; if `keyIdForProvider(provider) === 'genai'` renders `<GenaiApiKeyField>`, else renders `<TtsApiKeyField>` with `label`/`getKeyUrl` from the registry/`GETKEY_URL` map. Both wrappers get `onSaved={() => onKeySaved?.(m.provider)}` so the card's caller can be notified per-provider save.
- `tests/components/story/AudioKeyGateCard.test.jsx` — verbatim from the brief (2 tests: renders both labels for gemini+typecast; renders no `<input>` when `missing=[]`).

### Modified (onSaved addition)
- `src/components/settings/GenaiApiKeyField.jsx`
  - Signature: `({ t }) → ({ t, onSaved })`
  - Success branch: `if (res?.success) { setKeyInput(''); toast.success(t('settings.apiKeySaved')) }` → `... toast.success(t('settings.apiKeySaved')); onSaved?.() }`
- `src/components/settings/TtsApiKeyField.jsx`
  - Signature: `({ provider, label, getKeyUrl, extraNote, t }) → (..., onSaved)`
  - Success branch: `if (res?.success) { setKeyInput(''); toast.success(t('settings.ttsKeySaved')) }` → `... toast.success(t('settings.ttsKeySaved')); onSaved?.() }`

Both additions are exactly one line each, optional-chained (`onSaved?.()`), placed after the existing `toast.success(...)` call in the save success branch. No other lines touched. Settings tab call sites pass no `onSaved` prop, so `onSaved` is `undefined` there and `onSaved?.()` is a no-op — behavior unaffected.

## Test commands + raw output

```
$ npx vitest run tests/components/story/AudioKeyGateCard.test.jsx
 RUN  v4.1.10 /Users/tuxxon/workspace/AutoFlowCut-bugfix
 Test Files  1 passed (1)
      Tests  2 passed (2)
   Duration  673ms
```

Prior to implementation, the same command failed with:
```
Error: Failed to resolve import "../../../src/components/story/AudioKeyGateCard" from "tests/components/story/AudioKeyGateCard.test.jsx". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```
(module-not-found, as expected before Step 3 — confirms the test genuinely fails before implementation.)

```
$ npx vitest run tests/components/settings/
 RUN  v4.1.10 /Users/tuxxon/workspace/AutoFlowCut-bugfix
 Test Files  9 passed (9)
      Tests  61 passed (61)
   Duration  1.07s
```
All 9 existing settings test files (including `GenaiApiKeyField.test.jsx` and `TtsApiKeyField.test.jsx`) pass unchanged — confirms `onSaved` being optional didn't break the settings tab usage.

## Concerns
- `package.json` had a pre-existing unstaged modification unrelated to this task; left untouched/unstaged per the brief's explicit file list (not committed).
- `GETKEY_URL` map in `AudioKeyGateCard.jsx` only covers `typecast`/`elevenlabs`/`googletts`; any future provider added to `API_KEY_REGISTRY` without an entry here will render `TtsApiKeyField` with `getKeyUrl={undefined}` — not a regression from this task, just worth noting for the next provider addition.
- The card itself is presentational only — nothing in this task wires it into a real "missing providers" pre-flight check or into StoryView; that's presumably a later task in M3b-2b.
