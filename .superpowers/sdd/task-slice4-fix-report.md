# Slice 4 Code Review Fix — Evidence Report

Branch: `feature/story-pipeline`
Files touched: `src/hooks/useVoicePreview.js`, `src/App.jsx`, `tests/hooks/useVoicePreview.test.js`

## Finding (Important) — manual gender override overwritten by later F0 preview

**Bug:** `useVoicePreview.js` ran F0 gender estimation for any voice whose `genderSource` was not `'adapter'`/`'seed'` (line 57), which included `'manual'`. Replaying a preview on a voice the user had manually tagged (e.g. female) could re-estimate gender via F0 (e.g. male) and `App.jsx handleTagGender` would merge `{ genderSource: 'f0' }` into `ttsVoices`, flipping the renderer's displayed gender even though the persisted main-process cache correctly protects manual > f0.

**Fix (two layers):**

1. `src/hooks/useVoicePreview.js` line 57 — excluded `'manual'` from the F0-estimation condition, so F0 auto-tagging only runs for voices with `genderSource` `null` or `'f0'` (genuinely unknown):
   ```js
   if (voice.genderSource !== 'adapter' && voice.genderSource !== 'seed' && voice.genderSource !== 'manual') {
   ```

2. `src/App.jsx handleTagGender` (~line 636) — added a defensive second layer: a `ttsVoicesRef` (kept in sync with `ttsVoices` state via `useEffect`) lets the handler look up the current voice by `provider`+`id`. For an incoming `source === 'f0'` tag, if the existing voice's `genderSource === 'manual'`, the merge (and the whole call) is skipped entirely. Manual tags and f0-tags-on-unknown-voices are unaffected.

**Test:** `tests/hooks/useVoicePreview.test.js` — new case "does not run F0 gender estimation for a voice already tagged genderSource 'manual' (manual override protected)". Plays a voice with `genderSource: 'manual'`, spies on `AudioContext.decodeAudioData`, asserts it is never called, `ttsTagVoiceGender` is never called, and `lastGender` stays `null`.

**Verified failing before fix** (`decodeSpy` called once — F0 estimation ran for the manual voice), **passing after fix**.

**App.jsx guard — verified by inspection, not unit-tested.** No existing test in this repo imports `src/App.jsx` directly or exercises `handleTagGender` (confirmed via `grep -rl "from '.../src/App'" tests/` — zero hits); `App.jsx` is a ~2500-line monolithic component wired to many hooks and `window.electronAPI`, not designed for isolated handler unit tests, and the task scope restricted edits to `src/hooks/useVoicePreview.js`, `src/App.jsx`, and `tests/hooks/useVoicePreview.test.js` (no new `src/services/*` extraction file, which is the pattern this codebase otherwise uses for testable App.jsx guards — see `src/services/startGuard.js` / `tests/components/App.handleStart.test.js`). The guard was verified by code inspection: `handleTagGender` only takes the early-return branch when `source === 'f0'` AND the looked-up `ttsVoicesRef.current` entry has `genderSource === 'manual'`; all other combinations (manual tags, f0 tags on `null`/`'f0'`-sourced voices, unknown provider+id) fall through unchanged to the pre-existing `mergeTtsVoices` call.

## Test runs

```
npx vitest run tests/hooks/useVoicePreview.test.js
  Test Files  1 passed (1)
  Tests  6 passed (6)

npx vitest run tests/components/story tests/hooks
  Test Files  140 passed (140)
  Tests  1155 passed (1155)
```
