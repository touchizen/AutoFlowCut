### Task 11: StoryView 드롭다운 → 모달 + App state sync

**Files:**
- Modify: `src/components/story/StoryView.jsx` (dropdown ~L1173 → button+modal; onSelect sets provider+voice)
- Modify: `src/App.jsx:585` (`onTagGender` → persist + optimistic `mergeTtsVoices`; pass through to StoryView/VoicePicker)
- Test: `tests/components/story/StoryView.voice.test.jsx` (integration)

**Interfaces:**
- Consumes: `VoicePicker`, `useVoicePreview`, `ttsVoices`, `mergeTtsVoices`.
- Produces: audio step params unchanged (`params.speakers[].voice = {provider, voiceId}`).

- [ ] **Step 1: Write failing integration test**

```jsx
// tests/components/story/StoryView.voice.test.jsx
// Render StoryView audio panel with speakers; open VoicePicker via [성우 선택] button;
// select a voice; assert providerBySpeaker + voiceBySpeaker updated and audio params
// builder yields { provider, voiceId }. (Follow existing StoryView test setup/mocks.)
it('selecting a voice in the modal updates speaker voice mapping', () => {
  // ...render, click [성우 선택], pick Kore, assert onFieldChange/params includes {provider:'gemini', voiceId:'Kore'}
})
```

(Implementer: mirror the existing StoryView audio test harness; assert the audio params contract at L547 is preserved and empty voiceId clears to default per L553.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**
  - Replace the per-speaker `<select>` dropdown with a `[성우 선택]` button showing current voice name; clicking opens `<VoicePicker>` in a modal for that speaker.
  - `onSelect({provider, voiceId})` → `setProviderBySpeaker(s => ({...s,[sp.id]:provider}))` and `setVoiceBySpeaker(s => ({...s,[sp.id]:voiceId}))`. Empty `voiceId` preserved (default path L553).
  - App: `const handleTagGender = (payload) => { window.electronAPI.ttsTagVoiceGender?.(payload); mergeTtsVoices([{ provider: payload.provider, id: payload.voiceId, gender: payload.gender, genderSource: payload.source, f0: payload.f0 ?? null, confidence: payload.confidence ?? null }]) }` — pass to StoryView → VoicePicker `onOverrideGender`, and also call from `useVoicePreview`'s F0 result path (via VoicePicker `onPreview` completion or lastGender effect).
  - Wire `useVoicePreview` inside StoryView (or VoicePicker) so preview + F0 gender updates flow to `mergeTtsVoices`.

- [ ] **Step 4: Run** → PASS. Then `npm run test:run` (full suite green).

- [ ] **Step 5: Commit**

```bash
git add src/components/story/StoryView.jsx src/App.jsx tests/components/story/StoryView.voice.test.jsx
git commit -m "feat(story): replace voice dropdown with modal picker + gender state sync

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## SLICE 5 — 마무리

