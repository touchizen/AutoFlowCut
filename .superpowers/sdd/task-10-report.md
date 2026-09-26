# Task 10 Report — VoicePicker 컴포넌트

## Status
Complete.

## Commit
`0964e3a` — feat(story): VoicePicker modal card component

## Files
- Created: `src/components/story/VoicePicker.jsx`
- Created: `src/components/story/VoicePicker.css`
- Created: `tests/components/story/VoicePicker.test.jsx`
- Modified: `src/locales/ko.js`, `src/locales/en.js` (added `story.voicePicker.*`, 16 keys each)

## TDD flow
1. Wrote the 3 tests verbatim from the brief.
2. Ran `npx vitest run tests/components/story/VoicePicker.test.jsx` → failed as expected (module not found — component didn't exist yet).
3. Implemented `VoicePicker.jsx` + `.css` + i18n keys.
4. Re-ran → 3/3 pass.
5. Also ran the full `tests/components/story` + `tests/i18n` suites (21 files / 162 tests) → all pass, nothing else broke.

## Test summary
3/3 new tests pass (gender-segment filter, onSelect on card click, onPreview on play click); 162/162 total tests in `tests/components/story` + `tests/i18n` pass.

## Implementation notes
- Component is **content-only** — no modal chrome (no title bar / X close button), since the prop contract has no `onClose`/`title`. It's designed to be dropped into the existing generic `src/components/Modal.jsx` wrapper during Task 11 integration (confirmed by reading `Modal.jsx`: it already supplies header/title/close/portal, matching how `StylePicker` is used as body content elsewhere).
- Structure implemented per brief: provider chips (전체/Typecast N/Gemini/ElevenLabs with counts from the full `voices` array, unaffected by other filters — matches mockup behavior), gender segment (전체/♀ 여성/♂ 남성), search (name + traits), grid capped at `RENDER_CAP = 120` with a `[더 보기]` button that increases the cap by 120 per click, a leading `[기본 성우]` card, per-voice cards (preview button with idle/loading/playing/error visual states driven by `previewState`, gender label color-coded via the `gender` field, language, traits, provider badge, selected ring), and a footer with selection summary + `취소`/`이 성우로 지정` buttons.
- Manual gender override: right-click (`onContextMenu`) opens a small ♀/♂ menu only when `genderSource` is `null`, `'f0'`, or `'manual'` (checked against the actual `genderSource` values used elsewhere in the codebase — `electron/api/tts/*.js`, `genderOverlay.js`) — hidden for `'adapter'`/`'seed'` sourced voices. Clicking an option calls `onOverrideGender({ provider, voiceId, gender })` and closes via an invisible overlay or explicit selection.
- `onPreview` is called with `{ provider, voiceId, language, genderSource, name }`, matching the shape `useVoicePreview.play()` expects (verified against `src/hooks/useVoicePreview.js`).
- CSS: adapted mockup palette (`--vp-accent: #a855f7`, `--vp-female: #f472b6`, `--vp-male: #38bdf8`, `--vp-unknown`) scoped locally under `.voice-picker`, while structural chrome (backgrounds/borders/text) reuses the app's existing global theme variables (`--bg-secondary`, `--border-color`, `--text-color`, `--text-secondary`, `--error-color` from `src/App.css`) to stay consistent with `StylePicker.css` conventions rather than introducing a parallel dark-theme variable set.
- Footer's primary `이 성우로 지정` button is disabled when `selected.provider` is falsy and otherwise re-affirms the current `selected` prop via `onSelect` (harmless/idempotent) — this is not covered by a test since the prop contract has no separate "confirm" signal; card clicks already call `onSelect` immediately (controlled component, same pattern as `StylePicker`). The `취소` button is rendered per the required footer structure but has no wired behavior, since no `onClose` prop exists in this task's contract (expected to be supplied by the `Modal` wrapper in Task 11).

## Concerns
- Footer button semantics (`취소` no-op, `이 성우로 지정` redundant with card-click auto-select) are a judgment call filling a gap in the prop contract — flag for Task 11 to confirm whether the integration wants a distinct "pending selection vs. committed selection" model, or whether immediate-select-on-click (current behavior) is correct.
- The `기본 성우` card's "selected" ring uses `!selected?.voiceId` as its condition, which will also render as selected before any real selection is made (e.g., on first mount with `selected = {}`) — this seems like the intended default-state affordance but worth eyeballing visually in Task 11.
- No visual/manual QA was done (no Electron app run) — only unit tests via vitest + jsdom.
- Note: this file previously contained a report for an unrelated, differently-numbered "Task 10" (StoryView genre dropdown) from an earlier planning pass; it has been overwritten with this VoicePicker report per the current brief's instructions.
