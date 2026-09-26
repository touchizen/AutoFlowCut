# M3b-1 Task 1 Report — errorKind locale strings for Story-audio key gate

## Status: DONE

## Commit
`bb0a01ba` — "Add locale strings for story-audio missing-key / auth errorKinds"

## Files changed
- `src/locales/ko.js` — added 2 keys inside the existing `errorSection.kind` object (line ~1327 opens `kind: {`, block closes at old line 1378 / new line 1380).
- `src/locales/en.js` — added 2 keys inside the existing `errorSection.kind` object (mirrors ko.js structure).
- `tests/utils/errorDisplay.storyAudioKinds.test.js` — new test file (added, per brief Step 2, verbatim).

## Where in errorSection.kind

Both files: appended as the **last two entries** of the `kind: { ... }` map, immediately before the closing `},\n  },` that ends the `errorSection` block. Chosen because the block wasn't alphabetically sorted (existing keys interleave freely, e.g. ko.js has `story-audio-state-corrupt` between `story-audio-import-invalid-path` and `story-audio-import-no-audio`), so appending at the end kept the diff minimal and didn't require reordering existing lines.

ko.js (after `'story-srt-longer-than-audio'`):
```js
      'story-audio-no-tts-key': '음성 API 키가 없어 오디오를 만들 수 없습니다. 설정 › API 키에서 해당 음성 제공자의 키를 등록하세요.',
      'story-audio-tts-auth': '음성 API 키가 유효하지 않습니다(인증 실패). 설정 › API 키에서 키를 다시 확인하세요.',
```

en.js (after `'story-sfx-library-unavailable'`, which is en.js's last kind entry — en.js has a slightly different tail ordering than ko.js but same key set):
```js
      'story-audio-no-tts-key': 'Cannot generate audio — the voice API key is missing. Add it in Settings › API Keys for this voice provider.',
      'story-audio-tts-auth': 'The voice API key is invalid (authentication failed). Recheck it in Settings › API Keys.',
```

Indentation (6 spaces) and single-quote style match every surrounding entry in both files exactly — verified by diffing against neighboring lines before editing.

## TDD sequence actually run

1. Wrote `tests/utils/errorDisplay.storyAudioKinds.test.js` verbatim from the brief (Step 2).
2. Ran it against the codebase *before* touching locale files to confirm a real fail:

```
$ npx vitest run tests/utils/errorDisplay.storyAudioKinds.test.js
 ❯ tests/utils/errorDisplay.storyAudioKinds.test.js (4 tests | 2 failed) 5ms
     × ko: no-tts-key kind translates (not raw English) 3ms
     × en: no-tts-key kind translates (not raw English) 0ms

 FAIL  ... > ko: no-tts-key kind translates (not raw English)
 FAIL  ... > en: no-tts-key kind translates (not raw English)
AssertionError: expected 'audio failed: No typecast API key' not to match /No typecast API key/
 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
```

   Only 2 of 4 assertions failed pre-fix, not all 4 — this is expected and not a discrepancy from the brief. Reason: `resolveDisplayError` falls back to the raw `error` string when the errorKind key is missing from the locale (by design, per its docstring — "번역 실패를 감지해 free-form error 로 graceful fallback"). For the `no-tts-key` test the raw error text itself contains "No typecast API key", so the `not.toMatch(/No typecast API key/)` assertion fails. For the `tts-auth` test the raw error ("Gemini TTS failed: 400") never equals the dotted key string, so `not.toBe(key)` trivially passes even without the translation — that assertion alone doesn't distinguish "translated" from "fell back to raw error". The brief's own test only checks `not.toBe(rawKeyString)` for that case, not `not.toMatch(rawError)`, so this is consistent with the test as specified, not a gap I introduced.

3. Added the two keys to `ko.js` and `en.js` (Step 4, exact strings from the brief, verified quote/indent style against neighbors first).
4. Re-ran:

```
$ npx vitest run tests/utils/errorDisplay.storyAudioKinds.test.js
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  642ms
```

5. `git add src/locales/ko.js src/locales/en.js tests/utils/errorDisplay.storyAudioKinds.test.js` then committed with the exact message from the brief. Left `package.json` (pre-existing unrelated modification in the working tree) unstaged — not part of this task's scope.

## Concerns

- None blocking. Two minor notes for the record:
  1. The pre-fix "2 of 4 fail" (rather than "4 of 4 fail") is a property of how `resolveDisplayError`'s fallback interacts with the specific raw-error strings chosen in the brief's test, not a defect — explained above so it isn't mistaken for a flaky/wrong test.
  2. `en.js`'s `errorSection.kind` block has a slightly different insertion-order tail than `ko.js` (its last pre-existing entry is `story-sfx-library-unavailable`, not `story-srt-longer-than-audio` as in ko.js) — both are internally consistent with their own file's existing (non-alphabetical) ordering, so no action needed, just noting the asymmetry in case a later task assumes the two files are ordered identically.
- Did not touch `electron/api/keyErrors.js` or any producer of these errorKinds — out of scope per the brief (M1 already wired `story-audio-no-tts-key` / `story-audio-tts-auth` as errorKind values).
