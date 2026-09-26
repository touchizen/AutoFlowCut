# M3b-2b Task 2 Report — StoryView runAudioWithPreflight + entry-point wiring + gate render

## Status
Complete. TDD followed: failing integration test written first against the real `StoryView` mount (mirroring `StoryView.perSpeakerAudio.test.jsx`/`StoryView.audioRedo.test.jsx` harnesses), implementation added, all 4 new tests pass, full `StoryView` suite (39 files / 516 tests) and full repo suite (652 files / 6711 tests) stay green.

## Commit
(pending — see below; brief's suggested message used)

## Files

### Created
- `tests/components/story/storyAudioGate.test.jsx` — 4 tests, full `StoryView` mount (not an extracted helper — mounting worked fine once i18n + key-field hooks were mocked):
  1. missing key → `AudioKeyGateCard` shown (`Typecast` label), `start` NOT called.
  2. all providers ok → gate never renders, `start` called directly, and (strengthened beyond the brief's minimum) `audioPreflight` is asserted to have actually been called — this catches a regression where the wrapper is silently bypassed.
  3. key saved (via the real `TtsApiKeyField` → `ApiKeyField` save button, using mocked `useTtsKeys`) → `onVoiceSearch(provider)` called, `audioPreflight` re-invoked (2nd call resolves ok), gate clears, `start('audio', …)` runs (the original queued action, via `retry`).
  4. key saved but re-check still reports missing → gate stays, `start` NOT called.

## Modified
- `src/components/story/StoryView.jsx`

### 1. Imports (top of file)
```diff
-import { useState, useEffect, useRef, useMemo } from 'react'
+import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
 import { readTextFile } from '../../utils/decodeTextFile'
 import { useI18n, I18nProvider } from '../../hooks/useI18n'
+import { useAudioPreflight } from '../../hooks/useAudioPreflight'
+import AudioKeyGateCard from './AudioKeyGateCard'
```
`useCallback` wasn't previously imported — needed it for `runAudioWithPreflight`.

### 2. Hook + gate state + wrapper (after the `pipeline` destructure, before `const steps = state?.steps || {}`)
```js
const preflight = useAudioPreflight(pipeline)
const [audioGate, setAudioGate] = useState(null) // { missing, retry, paramsForRecheck } | null
const runAudioWithPreflight = useCallback(async (params, run) => {
  if (typeof pipeline.audioPreflight !== 'function') return run(params)
  const r = await preflight.check(params)
  if (!r.ok) {
    setAudioGate({ missing: r.missing, retry: () => run(params), paramsForRecheck: params })
    return { error: 'preflight-missing-key' }
  }
  setAudioGate(null)
  return run(params)
}, [preflight, pipeline])
```
**Deviation from the brief's literal snippet**: added a guard — `if (typeof pipeline.audioPreflight !== 'function') return run(params)`. Rationale below (behavior-preservation section) — required to keep ~20 existing `StoryView.*.test.jsx` files green, since their lightweight `pipeline` mocks don't define `audioPreflight`, and `useAudioPreflight.check` calls `pipeline.audioPreflight(params)` unconditionally (that hook is out of this task's scope — committed in M3b-2a with its own test contract that assumes `audioPreflight` is always present). The real `useStoryPipeline.js` hook always provides `audioPreflight`, so production behavior is unaffected — this only short-circuits for test doubles/older callers that don't have the capability wired.

### 3. Five wrap sites

**`regenerateSegment` (was line ~1145, now ~1165)**
```diff
 const regenerateSegment = (segId) => {
-  start('audio', buildAudioParams([segId]))
+  runAudioWithPreflight(buildAudioParams([segId]), (p) => start('audio', p))
   setScriptPhase(null)
   setViewedStep(null)
 }
```

**`runSpeakerAudio` (was line ~1151, now ~1171)**
```diff
 const runSpeakerAudio = async (sp) => {
-  const result = await start('audio', { ...buildAudioParams(), onlySpeaker: sp.id })
+  const result = await runAudioWithPreflight({ ...buildAudioParams(), onlySpeaker: sp.id }, (p) => start('audio', p))
+  // preflight가 막은 경우엔 게이트 카드가 이미 안내하므로 별도 토스트 없이 조용히 돌아간다.
+  if (result?.error === 'preflight-missing-key') return
   if (result?.error && result.error !== 'busy') {
     toast.error(...)
```
Added the `preflight-missing-key` early-return — otherwise the existing `result?.error && result.error !== 'busy'` branch would fire an unrelated error toast (`resolveDisplayError(t, 'preflight-missing-key', ...)`) on top of the gate card, which would be wrong/confusing UX and not requested by the brief.

**`handlePrimaryAction` audio branch (was line ~1302, now ~1325)**
```diff
 } else {
-  start(currentStep, buildStepParams(currentStep))
+  if (currentStep === 'audio') {
+    runAudioWithPreflight(buildStepParams(currentStep), (p) => start('audio', p))
+  } else {
+    start(currentStep, buildStepParams(currentStep))
+  }
   setScriptPhase(null)
   setViewedStep(null)
 }
```
Scoped to `currentStep === 'audio'` only (prompts still calls `start` directly, unchanged). Kept `runAudioWithPreflight(...)` un-awaited (fire-and-forget), matching the original's un-awaited `start(...)` call, so `setScriptPhase(null)`/`setViewedStep(null)` still run synchronously and timing for the `prompts` path is untouched.

**`handleStepRedo` (was line ~1314, now ~1340)**
```diff
 const handleStepRedo = () => {
   if (redoStep === 'scenes') { handleSplit(); return }
-  start(redoStep, buildStepParams(redoStep))
+  if (redoStep === 'audio') {
+    runAudioWithPreflight(buildStepParams(redoStep), (p) => start('audio', p))
+  } else {
+    start(redoStep, buildStepParams(redoStep))
+  }
   setViewedStep(null)
 }
```
`redoStep` can be `'audio'` or `'prompts'` here (scenes handled above); only audio is routed through the gate.

**`triggerAutoStep` (was line ~1402, now ~1428)**
```diff
 setScriptPhase(null); setViewedStep(null)
-const res = await start(step, buildStepParams(step))
+const res = step === 'audio'
+  ? await runAudioWithPreflight(buildStepParams(step), (p) => start('audio', p))
+  : await start(step, buildStepParams(step))
 if (res?.error) setAutoRunning(false)
```
Kept the `await` (original awaited too) so a gated audio step correctly reports `{ error: 'preflight-missing-key' }` and the existing stuck-prevention logic (`if (res?.error) setAutoRunning(false)`) halts auto-run instead of looping — this is *more* correct than before (auto-run used to have no way to notice a missing-key condition).

### 4. Gate card render (inside the audio panel, `displayStep === 'audio'` block, right after the opening `<div className="story-audio-panel">`)
```jsx
{audioGate && (
  <AudioKeyGateCard
    missing={audioGate.missing}
    t={t}
    onKeySaved={async (provider) => {
      try { await onVoiceSearch?.(provider) } catch { /* best-effort */ }
      const r = await preflight.check(audioGate.paramsForRecheck)
      if (r.ok) { setAudioGate(null); audioGate.retry?.() }
      else setAudioGate((g) => (g ? { ...g, missing: r.missing } : g))
    }}
  />
)}
```
One deviation from the brief's literal snippet: `setAudioGate({ ...audioGate, missing: r.missing })` → `setAudioGate((g) => (g ? { ...g, missing: r.missing } : g))`, using the functional updater to avoid closing over a stale `audioGate` (React best practice inside an async callback that fires after other state changes) and guarding against a `null` gate if it was somehow cleared in between.

## Test approach + raw output

Full `StoryView` mount, not an extracted helper — the existing `tests/components/story/*.test.jsx` harnesses (e.g. `perSpeakerAudio`, `audioRedo`) already mount the real component cheaply with a lightweight `pipeline` object, `I18nProvider`+`ToastProvider`, and `vi.mock` for `LiveTimeline`. I mirrored that and additionally mocked `useApiKey`/`useTtsKeys` (same mocks as `AudioKeyGateCard.test.jsx`) so the real `GenaiApiKeyField`/`TtsApiKeyField` render inside the gate without touching Electron IPC.

```
$ npx vitest run tests/components/story/storyAudioGate.test.jsx
 RUN  v4.1.10 /Users/tuxxon/workspace/AutoFlowCut-bugfix
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  1.44s
```

Before implementation (red, confirming genuine failure): 3 of 4 tests failed — "missing key blocks" failed because the gate never rendered (`screen.findByText('Typecast')` timed out) and `start` was called directly; "key saved" tests failed the same way. The "ok → start runs directly" test needed strengthening first (see below) because it passed trivially even pre-implementation (it only asserted `start` was called, which was already true via the old direct call path) — added an `audioPreflight` was-called assertion so it actually exercises the wrapper.

```
$ npx vitest run tests/components/story/
 RUN  v4.1.10 /Users/tuxxon/workspace/AutoFlowCut-bugfix
 Test Files  39 passed (39)
      Tests  516 passed (516)
   Duration  6.32s
```

```
$ npm run test:run
 RUN  v4.1.10 /Users/tuxxon/workspace/AutoFlowCut-bugfix
 Test Files  652 passed (652)
      Tests  6711 passed (6711)
     Errors  2 errors
   Duration  47.11s
```
The 2 errors are the pre-existing, unrelated `VideoDetailModal.generateButton.test.jsx` unhandled rejections (`TypeError: Cannot read properties of null (reading 'seed')` in `src/components/VideoDetailModal.jsx:163`) — exactly the "pre-existing VideoDetailModal 2 errors unrelated" the brief called out. Confirmed these are not new: they're an unhandled-rejection warning outside the test assertions, and the test file itself is not part of this change.

## Behavior-preservation notes
- Non-audio steps (`prompts`, `scenes`) are untouched at all 3 shared sites (`handlePrimaryAction`, `handleStepRedo`, `triggerAutoStep`) — they still call `start(...)` directly, no gate involvement.
- All ~20 pre-existing `StoryView.*.test.jsx` files construct `pipeline` mocks without `audioPreflight`. Without the `typeof pipeline.audioPreflight !== 'function'` guard in `runAudioWithPreflight`, every one of those that exercises an audio site (`audioRedo`, `perSpeakerAudio`, `autoRun` audio-on case, `audioProgress`, `sfx`, `speakerProgress`, etc.) would have thrown `pipeline.audioPreflight is not a function` inside `useAudioPreflight.check`. Verified this is exactly why 39/39 story test files still pass unchanged — production (`useStoryPipeline.js`) always supplies `audioPreflight`, so real-app behavior is fully gated; only test doubles / hypothetical older callers bypass it.
- `runSpeakerAudio`'s existing error-toast branch needed an explicit `preflight-missing-key` early return so the gate card isn't accompanied by a spurious error toast.

## Concerns
- The `typeof pipeline.audioPreflight !== 'function'` fallback in `runAudioWithPreflight` is a deliberate compatibility shim, not literally what the brief's Step 1 snippet shows — flagging it explicitly since it's the one place this task diverged from the brief's exact code for a real reason (see Behavior-preservation notes). If a future task decides all `pipeline` mocks should supply `audioPreflight` explicitly instead, this guard could be removed — but that would mean updating ~20 existing test files that are outside this task's scope.
- `ApiKeyField`'s placeholder text (`t('settings.ttsKeyPlaceholder', { label })`) assumes a native `t(key, params)` 2-arg i18n signature. When rendered through the Settings tab (`SettingsModal` → `ApiKeyTab`, which passes the real `useI18n().t` straight through) this works fine. But `AudioKeyGateCard` only exists inside `StoryView`, which passes its own `useSafeT()` wrapper — signature `t(key, fallback, params = {})` — so the `{ label }` object lands in the `fallback` slot instead of `params`, and the real i18n call ends up as `i18nT(key, {})`, leaving the literal `{label}` token unreplaced in the rendered placeholder (e.g. shows `{label} API 키를 붙여넣으세요` instead of `Typecast API 키를 붙여넣으세요`). This is a pre-existing gap between `AudioKeyGateCard`'s child components and `useSafeT`'s contract — not introduced by this task, and out of scope to fix here (fixing it would mean changing `useSafeT`'s signature or `ApiKeyField`'s call convention, both used elsewhere). The new test works around it with a CSS selector (`.audio-key-gate input[type="password"]`) instead of `getByPlaceholderText`. Worth a follow-up ticket since it's a real (if cosmetic) UI bug specific to the Story audio gate path.
- `package.json` has a pre-existing unstaged modification unrelated to this task (noted in Task 1's report too) — left untouched/unstaged, not part of this commit.
