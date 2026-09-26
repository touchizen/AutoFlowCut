## refactor(story): extract useStoryVoiceSelection hook from StoryView

status: DONE
commit: f7f1c06
tests: tests/hooks/useStoryVoiceSelection.test.js 5/5 pass; tests/components/story full suite 165/165 pass (regression, unchanged); full repo suite 4387/4387 pass
concerns: none — behavior identical, pure extraction. Note: `speakers` hook param is accepted but unused internally (providerForSpeaker/voiceIdForSpeaker/openVoicePicker/confirmVoice all operate on the `sp` object passed by the caller, not a lookup by id from `speakers`); kept only to match the requested signature.

## feat(story): re-enable ElevenLabs remote voice search via debounced picker search

status: DONE
commit: 1a1d489
tests: tests/components/story/VoicePicker.test.jsx 14/14 pass (4 new); tests/components/story tests/hooks full suite 141 files / 1166 tests pass (no regressions)
concerns: none — client-side filter behavior unchanged; remote search fires only for the elevenlabs provider (including when the "all" chip is active), debounced 300ms, gated on query length >= 2, and skipped entirely when `onVoiceSearch` is not provided.
