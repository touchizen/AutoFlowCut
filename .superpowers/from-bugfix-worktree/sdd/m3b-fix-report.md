# M3b pre-flight gate UI — review findings fix report

Branch: `feature/story-audio-apikey-gate`
Scope: `src/App.jsx`, `src/components/story/{StoryView,VoicePicker,AudioKeyGateCard}.jsx`, `src/config/apiKeyRegistry.js`, plus corresponding tests.

All 5 findings addressed via TDD (fix applied, tests added/updated, confirmed red against the pre-fix code where the finding was behavioral, then green after the fix).

## Finding 1 (High) — `onKeySaved` voices refetch is a prod no-op

**Root cause confirmed:** `StoryView`'s gate called `onVoiceSearch?.(provider)` (a plain string), but `onVoiceSearch` is wired in `App.jsx` to `handleTtsVoiceSearch({ provider, query })`, which does `if (!provider || q.length < 2) return`. Called with a bare string as the first (and only) positional arg, destructuring gives `provider=undefined, query=undefined` → immediate no-op. Even if called correctly, `handleTtsVoiceSearch` is a debounced remote *search*, not a full provider reload.

**Fix:**
- `src/App.jsx`: added `reloadTtsVoicesForProvider(provider)` (mirrors the initial per-provider load effect at ~L711-727) — calls `window.electronAPI.ttsListVoices({ provider, includeShared, limit, maxSharedPages })` then `mergeTtsVoices(vs.map(v => ({ ...v, provider })))`. Threaded into `<StoryView onReloadVoices={reloadTtsVoicesForProvider} ...>` (existing `onVoiceSearch={handleTtsVoiceSearch}` prop kept as-is for VoicePicker's real search).
- `src/components/story/StoryView.jsx`: signature gained `onReloadVoices = null`; the gate's `onKeySaved` now calls `onReloadVoices?.(provider)` instead of `onVoiceSearch?.(provider)`.

**Files:** `src/App.jsx:752-784` (new fn + prop wiring), `src/components/story/StoryView.jsx:406,2138-2153`

**Tests:**
- `tests/components/story/storyAudioGate.test.jsx` — the test that used to assert `onVoiceSearch` was called with `'typecast'` (encoding the wrong contract) now asserts `onReloadVoices` was called with `'typecast'` **and** `onVoiceSearch` was *not* called. A sibling passing-preflight test also switched its prop from `onVoiceSearch` to `onReloadVoices`.
- `tests/components/App.storyVoiceReload.test.js` (new, node-env source-slice test — same convention as the existing `App.emptyRefGateWiring.test.js`, since App.jsx is too large/coupled for a full render test and no other App.jsx-internal voice-loading fn has direct unit coverage either): asserts `reloadTtsVoicesForProvider`'s body calls `ttsListVoices` + `mergeTtsVoices`, and that `<StoryView>` wires `onReloadVoices={reloadTtsVoicesForProvider}` while keeping `onVoiceSearch={handleTtsVoiceSearch}`.

```
npx vitest run tests/components/story/storyAudioGate.test.jsx tests/components/App.storyVoiceReload.test.js
 Test Files  2 passed (2)
      Tests  10 passed (10)
```

## Finding 2 (High) — redo & segment-regenerate hide the gate card

**Root cause confirmed:** `displayStep` falls back to `currentStep` whenever `viewedStep` is `null`, and `computeCurrentStep` skips `done` steps to return the first non-done one. `handleStepRedo` and `regenerateSegment` are only reachable when `steps.audio.status === 'done'`. Both called `runAudioWithPreflight(...)` **without awaiting** and then unconditionally `setViewedStep(null)` on the very next line. When preflight blocks (missing key), `start()` never runs, so `steps.audio` stays `'done'` — `computeCurrentStep` then skips it and lands on e.g. `'prompts'`, so `displayStep` leaves `'audio'` and the panel containing `AudioKeyGateCard` unmounts. (The other 3 `runAudioWithPreflight` call sites — `handlePrimaryAction`'s audio branch, `runSpeakerAudio`, `triggerAutoStep` — don't have this bug: the first two never navigate on a *done* audio step in this path, and `runSpeakerAudio` never calls `setViewedStep` at all.)

**Fix:** both handlers now `await runAudioWithPreflight(...)` and only clear `viewedStep` when the run actually proceeded; if blocked (`result?.error === 'preflight-missing-key'`), force `setViewedStep('audio')` — since `steps.audio.status` is still `'done'`, the `displayStep` ternary's `(viewedStep && steps[viewedStep]?.status === 'done') ? viewedStep : currentStep` branch keeps resolving to `'audio'`, keeping the panel (and gate card) mounted.

**Files:** `src/components/story/StoryView.jsx:1171-1181` (`regenerateSegment`), `:1360-1372` (`handleStepRedo`)

```js
const regenerateSegment = async (segId) => {
  const result = await runAudioWithPreflight(buildAudioParams([segId]), (p) => start('audio', p))
  setScriptPhase(null)
  setViewedStep(result?.error === 'preflight-missing-key' ? 'audio' : null)
}

const handleStepRedo = async () => {
  if (redoStep === 'scenes') { handleSplit(); return }
  if (redoStep === 'audio') {
    const result = await runAudioWithPreflight(buildStepParams(redoStep), (p) => start('audio', p))
    setViewedStep(result?.error === 'preflight-missing-key' ? 'audio' : null)
    return
  }
  start(redoStep, buildStepParams(redoStep))
  setViewedStep(null)
}
```

**Tests (new, in `tests/components/story/storyAudioGate.test.jsx`):**
- `'완료된 오디오 "다시 생성"이 missing 키로 막히면 오디오 패널(과 게이트 카드)이 그대로 보인다'`
- `'세그먼트 "재생성"이 missing 키로 막히면 오디오 패널이 그대로 보인다'`

Both asserted the gate card text and the redo/regenerate button remain visible, `start` not called. **Verified red-before-fix**: stashed only `StoryView.jsx` and re-ran — 4 tests failed (these 2, plus the Finding-1 and Finding-3 tests below, since all four exercise code paths this same file touches), confirming the tests genuinely exercise the bugs. Un-stashed and re-ran green.

```
npx vitest run tests/components/story/storyAudioGate.test.jsx
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

Regression check — all 5 audio trigger sites and existing redo/regenerate specs stayed green:
```
npx vitest run tests/components/story/StoryView.test.jsx tests/components/story/StoryView.audioRedo.test.jsx tests/components/story/StoryView.sfx.test.jsx tests/components/story/StoryView.perSpeakerAudio.test.jsx tests/components/story/StoryView.scenesRedo.test.jsx tests/components/story/StoryView.autoRun.test.jsx
 Test Files  6 passed (6)
      Tests  63 passed (63)
```

## Finding 3 (High) — segment test (`testSegment`) is ungated

**Root cause confirmed:** `testSegment` called `ttsPreview?.(...)` directly with no preflight check, unlike the 5 batch entry points which all go through `runAudioWithPreflight`. Backend `stepMachine.audioPreflight` already special-cases `params.mode === 'segmentTest'` (stepMachine.js:1971) to scope the required-provider computation to just the tested segment IDs — this contract existed but was unused by the renderer.

**Fix:** `testSegment` now wraps its `ttsPreview` call in `runAudioWithPreflight`, passing `{ ...buildAudioParams(), mode: 'segmentTest', segmentIds: [segId] }` as the preflight params (matches what the segment-test IPC call actually needs: `speakers` for narration voice resolution, `sfxSources` for sfx). On missing key it returns early (the shared `audioGate` state, rendered once at the top of the audio panel, already shows the card); on success it runs the same `ttsPreview` call as before.

**Files:** `src/components/story/StoryView.jsx:1208-1229`

```js
const testSegment = async (segId) => {
  if (previewBusy) return
  setPreviewBusy(true)
  try {
    const ap = buildAudioParams()
    const result = await runAudioWithPreflight({ ...ap, mode: 'segmentTest', segmentIds: [segId] }, async () => {
      const r = await ttsPreview?.({ segmentIds: [segId], speakers: ap.speakers, sfxSources: ap.sfxSources })
      if (r?.busy) { toast.error(t('story.audio.busy')); return }
      const seg = r?.segments?.find((s) => s.id === segId)
      if (seg?.audioPath) playAudio(seg.audioPath)
    })
    if (result?.error === 'preflight-missing-key') return
  } catch (e) {
    toast.error(t('story.audio.testFailed', { error: e?.message || e }))
  } finally {
    setPreviewBusy(false)
  }
}
```

**Test (new):** `'세그먼트 "테스트"도 preflight를 거친다 — missing 키면 ttsPreview를 안 부르고 게이트 카드를 보여준다'` in `tests/components/story/storyAudioGate.test.jsx` — asserts `audioPreflight` called with `{ mode: 'segmentTest', segmentIds: ['s1-1'] }`, gate card shown, `ttsPreview` never called.

Regression: `StoryView.test.jsx`'s existing `'세그먼트 테스트 버튼은 그 세그먼트만 화자 매핑과 함께 ttsPreview로 합성한다'` (pipeline mock has no `audioPreflight` → `runAudioWithPreflight` bypasses the gate, same as all other call sites) stayed green — confirms the wrap didn't change behavior when no preflight is wired.

## Finding 4 (Med) — VoicePicker inline card has no `onKeySaved`

**Fix:** `src/components/story/VoicePicker.jsx`'s inline `AudioKeyGateCard` (rendered on a no-key preview failure) now gets `onKeySaved={() => onPreview({ provider: v.provider, voiceId: v.id, language: v.language, genderSource: v.genderSource, name: v.name })}` — the in-scope `v` from the `.map(v => ...)` closure, mirroring the exact shape the play button already passes to `onPreview` a few lines above. Saving the key re-attempts the preview for that same voice, which naturally dismisses the card once `previewStatus` moves off `'error'`.

**Files:** `src/components/story/VoicePicker.jsx:268-274`

**Test (new):** `tests/components/story/VoicePicker.noKeyInline.test.jsx` — `'finding4: saving the key inline re-attempts the preview for that same voice (dismisses the card on success)'`. Restructured the file's `useTtsKeys` mock to route `saveKey` through a controllable `mockTtsSaveKey` (same pattern as `storyAudioGate.test.jsx`'s `mockSaveKey`), typed a key into the inline field for the `typecast` voice, clicked save, and asserted `onPreview` was called with the voice's full shape.

```
npx vitest run tests/components/story/VoicePicker.noKeyInline.test.jsx tests/components/story/VoicePicker.test.jsx
 Test Files  2 passed (2)
      Tests  18 passed (18)
```

## Finding 5 (Low) — `GETKEY_URL` duplication → registry

**Fix:** Added a `url` field to each provider entry in `API_KEY_REGISTRY` (`src/config/apiKeyRegistry.js`), copied verbatim from `ApiKeyTab.jsx`'s `TTS_PROVIDERS` (typecast/elevenlabs/googletts) and `GenaiApiKeyField.jsx`'s hardcoded Gemini URL (`https://aistudio.google.com/apikey`). `AudioKeyGateCard.jsx`'s local `GETKEY_URL` map was removed; it now reads `meta.url` (`meta = API_KEY_REGISTRY[m.provider]`) for the `TtsApiKeyField` branch.

Left `ApiKeyTab.jsx` and `GenaiApiKeyField.jsx` untouched (per the "optional, else leave" instruction) — they're independent settings-tab call sites, not part of the gate-card duplication this finding targets, and repointing them isn't needed to remove the actual duplication (the two `GETKEY_URL`-shaped maps that existed for the *same* purpose in two places). Keeping the change surgical to the flagged duplication.

**Files:** `src/config/apiKeyRegistry.js:7-12`, `src/components/story/AudioKeyGateCard.jsx:5-9,30`

**Test:** added `'each provider carries a get-key url (single source of truth for AudioKeyGateCard/ApiKeyTab)'` to `tests/config/apiKeyRegistry.test.js`, asserting all 4 URLs. Existing `AudioKeyGateCard.test.jsx` (label rendering) stayed green unchanged.

```
npx vitest run tests/config/apiKeyRegistry.test.js tests/components/story/AudioKeyGateCard.test.jsx
 Test Files  2 passed (2)
      Tests  6 passed (6)
```

## Full suite

```
npm run test:run
 Test Files  656 passed (656)
      Tests  6725 passed (6725)
     Errors  2 errors
   Duration  41.68s (transform)/197.92s (tests)
```

The 2 unhandled-rejection errors are the pre-existing, unrelated `VideoDetailModal.jsx:163` (`Cannot read properties of null (reading 'seed')`) issue flagged in the task brief as a known pre-existing gap — untouched by this change, reproduces identically on `git stash` of all 5 finding diffs.

## Concerns / notes

- Finding 1's App.jsx-level wiring test (`App.storyVoiceReload.test.js`) is a source-slice check, not a full render — consistent with this repo's existing pattern for App.jsx (see `App.emptyRefGateWiring.test.js`; App.jsx is 3000+ lines and none of its internal voice-loading functions, including the pre-existing `handleTtsVoiceSearch`/`mergeTtsVoices`, have direct render-level unit coverage anywhere in the suite). The real behavioral contract (gate → `onReloadVoices(provider)` → retry) is covered by a genuine `StoryView` render test in `storyAudioGate.test.jsx`.
- Finding 2's fix only touches `regenerateSegment` and `handleStepRedo` — the other 3 `runAudioWithPreflight` sites (`handlePrimaryAction`, `runSpeakerAudio`, `triggerAutoStep`) were checked by hand and don't have the "done step + unconditional `setViewedStep(null)`" shape that causes the panel to disappear, so they were left as-is per the instruction to keep the change surgical.
- Finding 5 intentionally left `ApiKeyTab.jsx`/`GenaiApiKeyField.jsx` unrepointed — see rationale above.

## Commits

Findings 1-3 share `StoryView.jsx`/`storyAudioGate.test.jsx` too heavily to split cleanly, so they landed as one commit (with App.jsx's half of Finding 1 split out since it's a separate file with no overlap):

- `4b80e00b` — `refactor(story-audio): move key-fetch URLs into apiKeyRegistry` (Finding 5)
- `80da150b` — `fix(story-audio): re-attempt voice preview after inline key save` (Finding 4)
- `7f68acae` — `fix(story-audio): add provider voice reload path for the key gate` (Finding 1, App.jsx half)
- `4e682e7d` — `fix(story-audio): wire voice reload into gate, keep panel open when blocked, gate segment test` (Finding 1 StoryView half + Findings 2 + 3)
