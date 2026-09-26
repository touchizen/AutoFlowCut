# Slice 3 Code Review Fixes — Evidence Report

Branch: `feature/story-pipeline`
Files touched: `src/hooks/useVoicePreview.js`, `src/components/story/VoicePicker.jsx`, `tests/hooks/useVoicePreview.test.js`, `tests/components/story/VoicePicker.test.jsx`

## Finding 1 (Important) — resource leaks / no cleanup

**Fix:** Added `urlRef` to track the current object URL. Added a `cleanup()` helper (pauses audio, clears `onended`/`onerror`, revokes `urlRef.current`, nulls both refs). `cleanup()` is called at the start of every `play()` (replacing the old bare `audioRef.current.pause()`), and a `useEffect` unmount cleanup calls `cleanup()` + `ctxRef.current?.close?.()`.

**Test:** `tests/hooks/useVoicePreview.test.js` — "unmount pauses audio, revokes the object URL, and closes the AudioContext". Spies on `Audio.pause`, `AudioContext.close`, and `URL.revokeObjectURL`; renders the hook, plays a voice, unmounts, asserts all three were called.

**Verified failing before fix** (`pauseSpy` never called — no unmount cleanup existed), **passing after fix**.

## Finding 2 (Important) — swallowed play() failure

**Fix:** `audio.play().catch(...)` now sets `status: 'error'` (seq-guarded) instead of swallowing silently. Added `audio.onerror` with the same seq-guarded error transition.

**Test:** `tests/hooks/useVoicePreview.test.js` — "play() rejection sets status to error". Mocks `Audio.play()` to reject, plays with `genderSource: 'adapter'` (skips the AudioContext decode path to isolate the assertion), asserts `state.status === 'error'`.

**Verified failing before fix** (status stuck at `'playing'`, waitFor timed out), **passing after fix**.

## Finding 3 (Minor) — unawaited IPC

**Fix:** `window.electronAPI.ttsTagVoiceGender?.({...})?.catch?.(() => {})` — swallows rejection without awaiting, keeping behavior otherwise identical.

**Test:** `tests/hooks/useVoicePreview.test.js` — "does not throw when ttsTagVoiceGender rejects". Mocks `ttsTagVoiceGender` to reject and feeds a synthetic 100Hz sine wave into the `AudioContext.decodeAudioData` mock (the default all-zero/silent mock never produces a detectable F0, so `lastGender` would never be set — this was a test-construction issue, not a product bug). Asserts no unhandled rejection propagates and `lastGender` is set.

## Finding 4 (Minor) — default-voice select vs confirm mismatch

**Fix:** Introduced `const effectiveProvider = selected?.provider || 'typecast'` used by both the default-voice card's `onClick` and the footer confirm button's `disabled`/`onClick` logic, so both agree on the same fallback.

**Test:** `tests/components/story/VoicePicker.test.jsx` — "footer confirm is enabled for the default voice when selected={}". Renders with `selected={}`, asserts the confirm button is NOT disabled, clicks it, asserts `onSelect` was called with `{ provider: 'typecast', voiceId: '' }`.

**Verified failing before fix** (button was `disabled=""`), **passing after fix**.

## Test runs

```
npx vitest run tests/hooks/useVoicePreview.test.js tests/components/story/VoicePicker.test.jsx
  Test Files  2 passed (2)
  Tests  8 passed (8)

npx vitest run tests/components/story tests/hooks
  Test Files  140 passed (140)
  Tests  1153 passed (1153)
```
