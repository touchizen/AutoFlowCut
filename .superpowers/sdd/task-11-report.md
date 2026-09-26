# Task 11 Report — StoryView 드롭다운 → 모달 + App state sync

## Status
DONE

Note: this file previously held a report for an unrelated, differently-numbered "Task 11"
(integration tests + packaging smoke test for the Claude pipeline) from an earlier planning pass.
It has been overwritten with this VoicePicker/StoryView integration report per the current
brief's instructions (same situation Task 10's report flagged for its own file).

## Commit
`fbfd0bd` — feat(story): replace voice dropdown with modal picker + gender state sync

## What changed

### VoicePicker.jsx
- Added `onConfirm`/`onCancel` props. Footer `[취소]` now calls `onCancel?.()`; footer
  `[이 성우로 지정]` still calls `onSelect(...)` first (unchanged — keeps the existing
  "footer confirm is enabled for the default voice" test green) and now also calls `onConfirm?.()`.
- Extended `VoicePicker.test.jsx` with a test asserting confirm/cancel wiring.

### useVoicePreview.js
- `lastGender` now includes `provider` (`{ provider, voiceId, gender, f0, confidence }`). It was
  missing `provider` before, which would have made the F0 auto-tag merge un-keyable in App's
  `ttsVoices` list (keyed by `${provider}:${id}`). Verified against `tests/hooks/useVoicePreview.test.js`
  — no assertions depend on the exact shape of `lastGender`, so this is additive/safe.

### StoryView.jsx
- Replaced the per-speaker provider-`<select>` + search-`<input>` + voice-`<select>` block with a
  single `[🎙 <voice name or 기본 성우>]` button. The button's `aria-label` reuses the existing
  `story.audio.voiceFor` i18n key, so it keeps the same accessible name as the old voice `<select>`.
  Clicking it opens a `Modal` (the existing generic `src/components/Modal.jsx` wrapper — same
  pattern already used for `StylePicker`) containing `<VoicePicker>` scoped to that speaker.
- New state: `voicePickerSpeaker` (open speaker id or `null`) and `pickerSelection`
  (`{provider, voiceId}`, temporary until confirmed).
- `openVoicePicker(sp)` seeds `pickerSelection` from `providerForSpeaker(sp)`/`voiceIdForSpeaker(sp)`
  and opens the modal. `confirmVoice()` commits `pickerSelection` into the existing
  `providerBySpeaker`/`voiceBySpeaker` maps (the same ones `buildAudioParams` already reads) and
  closes the modal. `onCancel` just closes without touching those maps.
- `handleOverrideGender({provider,voiceId,gender})` forwards to `onTagGender?.({..., source:'manual'})`.
- Added `useVoicePreview()` inside StoryView; `VoicePicker`'s `onPreview` calls `preview.play(voice)`.
  A `useEffect` on `preview.lastGender` forwards `onTagGender?.({...lastGender, source:'f0'})` to
  App — this only refreshes the renderer's voice list (App branches on `source` to skip a duplicate
  IPC persist for `'f0'`, since `useVoicePreview` already persists F0 tags internally via
  `ttsTagVoiceGender`).
- `buildAudioParams`/`voiceIdForSpeaker`/`providerForSpeaker` are untouched — the audio step params
  contract (`params.speakers[].voice = {provider, voiceId}`, or `voice: null` when voiceId is empty)
  is unchanged and still exercised end-to-end by the rewritten tests below.
- Removed now-dead helpers `voiceSearchText`/`filterVoicesForSearch`/`voiceOptionLabel` and the
  `voiceSearchBySpeaker` state (only used by the removed dropdown+search UI), and the now-unused
  `STORY_TTS_PROVIDER_LABEL` import (the old provider `<select>`'s labels — `VoicePicker`'s own
  provider chips render their own labels).
- Added `useSafeIsKo()` (mirrors the existing `useSafeT`/`useHasI18n` pattern: tries `useI18n()`,
  falls back to `true` — Korean — when no `I18nProvider` is mounted, e.g. in unit tests) to derive
  `isKo` for `VoicePicker`.

### App.jsx
- Added `handleTagGender({provider, voiceId, gender, f0, confidence, source})`: always does an
  optimistic `mergeTtsVoices([{ provider, id: voiceId, gender, genderSource: source, f0, confidence }])`;
  only calls `window.electronAPI.ttsTagVoiceGender(...)` (fire-and-forget, `.catch(()=>{})`) when
  `source === 'manual'` — F0 tags are already persisted by `useVoicePreview` itself, so this avoids
  a duplicate IPC call for that path.
- Passes `onTagGender={handleTagGender}` to `<StoryView>`.
- Left `onVoiceSearch={handleTtsVoiceSearch}` wiring untouched (see Concern 1).

### CSS
- `StoryView.css`: replaced `.story-voice-search` (dead — its `<input>` was removed) with
  `.story-voice-picker-btn` (left-aligned text, pointer cursor, still reuses `.story-input` base
  styling for consistent sizing/border/background).
- `App.css`: added `.voice-picker-modal { max-width: 800px }` / `.voice-picker-modal .modal-body`,
  mirroring the existing `.style-picker-modal` rule used for `StylePicker`'s modal.

### i18n
- Added `story.audio.voicePickerTitle` (`'{speaker} 성우 선택'` / `'{speaker} voice picker'`) to
  `ko.js`/`en.js` for the modal's title bar.

## Tests
- Extended `tests/components/story/VoicePicker.test.jsx` with the confirm/cancel wiring test
  requested by the brief.
- Rewrote 5 tests in `tests/components/story/StoryView.test.jsx` that directly manipulated the old
  `<select>`/`<input>` DOM, so they now drive the new button → modal → card click → confirm flow:
  - `화자별 목소리를 선택해 오디오 실행하면 speakers가 start("audio")에 전달된다`
  - `화자별 목소리 검색은 이름/언어/특징으로...` → renamed/rewritten to
    `VoicePicker 모달의 검색은 이름/특징으로 카드를 필터링한다` (now verifies the `voices` prop
    threads correctly from StoryView into VoicePicker's own search, rather than re-testing
    VoicePicker's internal filtering logic, which is VoicePicker's own test responsibility)
  - `기본 성우(빈 옵션) 선택은 화자 voice를 null로 비운다`
  - `화자별로 엔진(provider)을 바꿔 선택하면 그 provider+voice로 start된다` (now a single card
    click picks engine+voice together — there's no separate engine `<select>` anymore, that's the
    intended new UX)
  - `Story 오디오 엔진 목록에서는 Google TTS를 숨긴다` → renamed to
    `Story 오디오 성우 선택 모달에는 Google TTS 카드가 나타나지 않는다`
- Deleted `ElevenLabs 성우 검색어는 live search 콜백으로 전달한다` — see Concern 1.
- Did not add a separate `StoryView.voice.test.jsx`; the existing StoryView tests already exercised
  exactly the interactions the brief describes (select voice → speakers → start('audio')), and they
  needed rewriting regardless once the dropdown was removed, so I updated them in place instead of
  duplicating coverage in a new file.

## Test summary
`npx vitest run tests/components/story` → 21 files / 163 tests, all green.
Full `npm run test:run` → 459 files / 4372 tests, 1 pre-existing unrelated failure
(`tests/integration/storyPipelineM1.test.js`, a prompt-prefix string assertion in the
script→scenes→prompts pipeline) — confirmed via `git stash` that it fails identically on the
pre-Task-11 tree, so it's unrelated to this change.

## Concerns
1. **Dropped feature: ElevenLabs remote live-search-while-typing.** The old per-speaker search
   `<input>` called `onVoiceSearch({provider, query})` to fetch more ElevenLabs voices beyond the
   initially loaded 100 as the user typed. `VoicePicker` (built in Task 10) only supports
   client-side filtering over the `voices` array already passed in — it has no `onSearch`/remote-fetch
   prop, and the Task 11 brief's own VoicePicker prop list confirms this (no search callback in the
   contract). I did not invent one, per "implement only what's requested" — and Task 10's report had
   already flagged this as accepted scope. Net effect: users can no longer search the full ElevenLabs
   shared-voice catalog from the audio panel, only the ~100 initially loaded voices are
   browsable/searchable via the modal's client-side filter. I left `handleTtsVoiceSearch`/
   `onVoiceSearch` plumbing in place in `App.jsx`/`StoryView.jsx` (the prop is still accepted by
   StoryView but no longer consumed) rather than deleting it outright, in case a future task wants to
   wire a remote-search box into `VoicePicker`. Flagging this as a product regression that deserves a
   deliberate call, not something I resolved unilaterally by ripping out the plumbing too.
2. No manual/visual QA was done (no Electron app run) — only vitest + jsdom. The modal's visual
   layout/sizing (`.voice-picker-modal`) was set by copying the existing `.style-picker-modal`
   pattern but not eyeballed in the running app.

## Files touched
- `src/components/story/VoicePicker.jsx`
- `src/components/story/StoryView.jsx`
- `src/components/story/StoryView.css`
- `src/hooks/useVoicePreview.js`
- `src/App.jsx`
- `src/App.css`
- `src/locales/ko.js`, `src/locales/en.js`
- `tests/components/story/VoicePicker.test.jsx`
- `tests/components/story/StoryView.test.jsx`
