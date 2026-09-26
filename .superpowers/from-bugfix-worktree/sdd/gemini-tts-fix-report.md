# Gemini TTS 400 Bug — Root Cause & Fix Report

## Addendum 2 (follow-up, after commit 7a6488b6)

New confirmed data point: `"짧은 한마디."` (a short sentence) fails **deterministically**, not
intermittently — every call. This time as a `400 "Model tried to generate text, but it should
only be used for TTS..."`; on a previous run of the same kind of segment it showed as the
`no audio data` (200) symptom from Addendum 1. Both are the *same underlying phenomenon* (Gemini's
TTS-mode classifier not triggering for this input) surfacing via two different response shapes.
Plain `no-audio` retry didn't catch the 400 variant, and blind retry-with-same-body doesn't help
a deterministic failure — the retry has to change the request.

### Research question 1: does wrapping the transcript in quotes have doc support?

**No.** Re-fetched the TTS guide and the `dev.to` prompting article and the third-party
`geminitts.net` prompting guide specifically for this. None mention quoting the transcript to
signal "this is a quote to read." The only place quotes appear in Google's own examples is
*inside* a `"Say in a [style]: '<text>'"` style-instruction template (i.e. quoting the spoken
line within a larger instruction) — not as a standalone technique for bare, prefix-less text.
**Not adopted** — no evidence it helps, and it isn't structurally applicable to the `normal`
(no-prefix) path where this deterministic failure occurs anyway.

### Research question 2: is retrying this specific 400 (non-auth) safe, and what should change on retry?

**Yes — and the docs name the exact fix.** Re-fetched
`https://ai.google.dev/gemini-api/docs/speech-generation` and pulled the **Limitations** section
verbatim:

> **Prompt classifier false rejections:** "Vague prompts may fail to trigger the speech synthesis
> classifier, resulting in a rejected request (`PROHIBITED_CONTENT`) or causing the model to read
> your style instructions and director's notes aloud. Validate your prompts by adding a clear
> preamble instructing the model to synthesize speech, and explicitly label where the actual
> spoken transcript begins."

This is Google's own named failure mode for exactly this symptom class (short/vague prompt →
classifier doesn't trigger TTS mode → request rejected or misbehaves), and it prescribes the fix:
add a clear preamble + explicitly label where the transcript begins. Our specific error text
("Model tried to generate text...") differs from the doc's cited `PROHIBITED_CONTENT` example
code, but it's the same classifier-not-triggering failure family, just a different concrete
manifestation/status than the one Google chose to name in the docs.

`isAuthResponse()` (in `electron/api/keyErrors.js`) already scopes Gemini/GoogleTTS auth 400s to
only `API_KEY_INVALID` — this specific "tried to generate text" 400 never matches that check, so
it was already falling through to the generic non-auth error path before this change. That
confirms it's safe to make retryable: it can never collide with a real auth failure, which is
checked and thrown *before* the new retry branch runs.

### Fix (`electron/api/tts/gemini.js`)

1. `isTextInsteadOfAudioError(detail)` — matches `/tried to generate text|should only be used for
   tts/i` on the error body. Checked strictly **after** `isAuthResponse()` in the `!res.ok`
   branch, so a real `API_KEY_INVALID` 400 is thrown immediately as `ProviderAuthError` and never
   reaches this check — auth retries remain categorically forbidden.
2. When this specific 400 fires and attempts remain, the loop `continue`s instead of throwing
   (same `MAX_ATTEMPTS = 2` budget already used for the no-audio-200 case from Addendum 1 — one
   retry, not unbounded).
3. `withSynthesisPreamble(promptText)` — the **only** prompt transformation used on retry, applied
   uniformly whether the first attempt failed via the 400 or via 200-with-no-audio (same root
   cause, same doc-prescribed remedy either way):
   ```
   Read the following text aloud as natural speech audio only. Do not reply, answer, or add any
   words of your own.

   Transcript: <original prompt text, incl. any emotion-style prefix from commit 9d6a3f35>
   ```
   This directly implements the doc's two named ingredients: "a clear preamble instructing the
   model to synthesize speech" (first line) and "explicitly label where the actual spoken
   transcript begins" (`Transcript:` label) — not a guess, not quote-wrapping.
4. If attempt 2 still returns the same 400, the loop exits the retry branch (`attempt <
   MAX_ATTEMPTS` is false) and re-throws the **original** `Gemini TTS failed: 400 ...` error
   verbatim — no message swallowing.

### Tests (`tests/electron/api/tts/gemini.test.js`, new `describe` block)

1. 1st attempt = `"tried to generate text"` 400 → retried with the preamble+label prompt → 2nd
   attempt succeeds → audio returned, `fetch` called exactly twice; asserts attempt 1's body is
   the raw text, attempt 2's body differs, still contains the original text, and matches
   `/transcript|speak|aloud/i`.
2. Both attempts return the same 400 → throws the original `/tried to generate text/` error,
   `fetch` called exactly twice (not more — bounded retry).
3. A 400 whose body contains `API_KEY_INVALID` (auth) → thrown immediately as `ProviderAuthError`,
   `fetch` called exactly **once** — proves auth 400s never enter the new retry branch regardless
   of message overlap.

Confirmed **red** first: stashed the `gemini.js` retry-with-preamble change and reran — the two
new "tried to generate text" tests failed against the pre-change code (immediate throw on
attempt 1, `calls` was 1 not 2), exactly as expected. Restored the fix → **green**, 10/10 in
`gemini.test.js`. Pre-existing tests (no-audio retry, real-400-no-retry, auth-throw,
emotion-prefix wording) all remained green — no regressions in the earlier two fixes.

```
$ npx vitest run tests/electron/api/tts/gemini.test.js
 Test Files  1 passed (1)
      Tests  10 passed (10)

$ npx vitest run tests/electron/api/tts/ tests/electron/story/
 Test Files  59 passed (59)
      Tests  699 passed (699)

$ npm run test:run
 Test Files  657 passed (657)
      Tests  6751 passed (6751)
     Errors  2 errors   (pre-existing, unrelated VideoDetailModal.generateButton issue)
```

### What this fix cannot verify

Same caveat as before: mocked `fetch` only pins request/retry *shape* and control flow, not
whether Google's servers actually accept the preamble+label prompt for `"짧은 한마디."` — that
determinism (always-fails, not flaky) means if the preamble doesn't work, the fix will
consistently and visibly still throw after 2 attempts (no silent partial success), which is safe
to observe in-app.

### In-app verification (addendum 2) — the deterministic short-text segment

1. Reproduce the exact reported case: a segment with text `"짧은 한마디."` (or whichever segment
   was failing deterministically), Gemini voice, `normal` emotion.
2. Regenerate audio for that segment.
3. Expected: no `Gemini TTS failed: 400 ... tried to generate text` error; a playable WAV is
   produced. Because this failure was deterministic (not flaky), if the fix works you should see
   it succeed **every time** you retry this exact segment, not just occasionally.
4. If it still fails after this fix: capture the exact final error. Two sub-cases —
   - Still `400 tried to generate text` after 2 attempts → the preamble+label reinforcement
     didn't change the model's classification for this text; would need either a stronger/still
     doc-aligned rewording, or accepting this as a genuine per-content limitation of the preview
     model for very short inputs (Google's docs don't guarantee a 100% fix, only that it reduces
     "false rejections").
   - A *different* error than before → new failure mode, needs its own root-cause pass rather
     than assuming this fix's scope covers it.
5. Also spot-check that a normal-length segment that was already working (from Addendum 1's
   verification) still works — confirms the preamble/retry path didn't regress the common case
   (it only activates on failure, so should be a no-op for already-working segments, but worth
   a quick re-check since this is the third change to the same function).

## Addendum 1 (follow-up, after commit 9d6a3f35)

After the style-prompt fix landed, a **different** failure surfaced on a segment with **no
emotion** (`normal`, 1 of 3 test segments): `Gemini TTS: no audio data in response`
(`gemini.js:108` at the time). The HTTP response was `200 OK` — the model returned `candidates`
with a text part instead of `inlineData` (audio). This is unrelated to `EMOTION_STYLE_PROMPTS`
(no prefix is sent for `normal`), so the style-prompt fix didn't and couldn't touch this path.

### Was `systemInstruction` verified as supported for this model before use?

**Checked, and the answer is: not confirmed supported — so it was not used.**

- Fetched `https://ai.google.dev/gemini-api/docs/speech-generation` again: no `systemInstruction`
  example anywhere in the TTS guide (Python/JS/REST), for single- or multi-speaker.
- Fetched the model card `https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-preview-tts`:
  the **Capabilities table lists only one supported capability: "Audio generation."**
  `systemInstruction` / "System instructions" does not appear anywhere in that table (not even in
  the "Not supported" list) — it's simply absent, meaning Google has not documented it as a
  parameter this specialized TTS model recognizes.
- What Google's docs *do* say about this exact symptom: **"The model occasionally returns text
  tokens instead of audio tokens, causing the server to fail the request with a `500` error...
  you should implement automated retry logic in your application to handle these."** This is
  Google's own named fix for "model returns text instead of audio" — retry, not a request-shape
  change. (Our manifestation is a clean `200` with a text part rather than a `500`, but it's the
  same underlying phenomenon the docs describe: the model chose text generation over audio.)

Given no doc evidence that `systemInstruction` is accepted by this model, and Google's explicit,
named remediation for this exact failure mode being retry logic, the fix implements **one retry
on "200 OK but no inlineData"** rather than adding an unverified field that could silently be
ignored (or, worse, rejected as an unexpected field) by a model whose only documented supported
capability is "Audio generation" alone.

### Fix (gemini.js `synthesize`)

Extracted the request into a loop (`MAX_ATTEMPTS = 2`): build the body once, POST it, and only if
`res.ok` is true but no `candidates[].content.parts[].inlineData.data` comes back, loop and POST
the identical body again. A true HTTP error (`!res.ok`, e.g. 4xx/5xx) still throws immediately —
no retry — since that's a distinct, non-flaky failure mode (matches the earlier 400 style-prompt
bug: real errors shouldn't be retried, only the "chose text over audio" flake documented by
Google). If both attempts come back audio-less, the original `Gemini TTS: no audio data in
response` error is still thrown, unchanged.

### Tests (`tests/electron/api/tts/gemini.test.js`, new `describe` block)

1. 1st response text-only, 2nd response has audio → `synthesize` succeeds, `fetch` called exactly
   twice.
2. Both responses text-only → still throws `/no audio/`, `fetch` called exactly twice (not
   infinite/more retries).
3. 1st response already has audio → `fetch` called exactly once (no regression on the already-
   working path).
4. A real HTTP error (400) → thrown immediately, `fetch` called exactly once (no retry on real
   errors).

Confirmed **red** by stashing the `gemini.js` change and re-running: 2 of the 4 new tests failed
against the pre-fix code (`no audio data in response` on the retry-success case; `calls` was 1
not 2 on the exhausted-retries case), exactly as expected. Restored the fix → **green**, 7/7 in
`gemini.test.js`.

```
$ npx vitest run tests/electron/api/tts/gemini.test.js
 Test Files  1 passed (1)
      Tests  7 passed (7)

$ npx vitest run tests/electron/api/tts/ tests/electron/story/
 Test Files  59 passed (59)
      Tests  696 passed (696)

$ npm run test:run
 Test Files  657 passed (657)
      Tests  6748 passed (6748)
     Errors  2 errors   (pre-existing, unrelated VideoDetailModal.generateButton issue)
```

### In-app verification (addendum) — the `sb-1-1`-style no-emotion segment

1. In the same Story project used before, find the segment that previously failed with
   `Gemini TTS: no audio data in response` (per the coordinator: 1 of 3 segments, no emotion
   tag / narrator-track `normal`).
2. Regenerate audio for just that segment (or the full batch) with the same Gemini voice.
3. Confirm: no `no audio data in response` error, and a playable WAV is produced.
4. Because the fix is a single silent retry, if the flake rate is higher than "very small
   percentage" (per Google's own wording) you may still see a failure occasionally — if it
   fails twice in a row on the same segment, capture the segment text; that would mean either
   the retry count needs to go beyond 1, or (as with the emotion case) something about that
   specific text content is reliably tripping Gemini's TTS classifier and needs its own root-
   cause pass.

## Original report (style-prompt 400 fix, commit 9d6a3f35)

## Symptom

Selecting a Gemini voice + an emotion (happy/sad/angry) for Story audio generation failed with:

```
Gemini TTS failed: 400 {"error":{"code":400,"message":"Model tried to generate text, but it
should only be used for TTS. Make sure your instructions are clear to only generate audio
from a given text transcript.","status":"INVALID_ARGUMENT"}}
```

Typecast voices worked fine. Gemini `normal` emotion (narrator segments — `effectiveEmotion()`
in `electron/story/stepMachine.js:261` forces narrator to `'normal'`) also worked fine, since no
style prefix is added in that path.

## Investigation (Phase 1–2, systematic-debugging)

Read `electron/api/tts/gemini.js` in full. `emotion` reaches `synthesize()` from
`electron/story/stepMachine.js` (`effectiveEmotion(seg)`, lines 261/1698/2041), where
`seg.emotion` is one of `normal|happy|sad|angry`, generated per-segment by the LLM script writer
(`electron/api/llm/prompts.js:209`). So the failure is **not narrator-only** — any non-narrator
segment (character dialogue) tagged happy/sad/angry against a Gemini voice hits it. This is a
real, reachable path in every Story episode with more than a narrator track.

Before the fix, `EMOTION_STYLE_PROMPTS` produced request text like:

```
"Say the following in a cheerful, happy tone: <narration text>"
```

### Doc evidence (fetched `https://ai.google.dev/gemini-api/docs/speech-generation` + Google AI
forum thread on the identical error message)

Google's **only two verified single-speaker style examples** in the docs are:

- `"Say cheerfully: Have a wonderful day!"`
- `"Say in an spooky whisper: 'By the pricking of my thumbs... Something wicked this way comes'"`

Multi-speaker example: `"Make Speaker1 sound tired and bored, and Speaker2 sound excited and
happy: Speaker1: ... Speaker2: ..."`.

None of Google's own examples contain the words **"the following"** or **"tone"**. All of them
use a short, direct adverb/manner clause immediately after "Say"/"sound", followed by a colon,
followed by the transcript — no filler, no abstract meta-noun like "tone".

The Google AI Developer forum thread on this exact error
(https://discuss.ai.google.dev/t/using-tts-as-translator/99078) confirms the message fires when
the model decides the prompt is asking it to *do* something (translate, etc.) rather than simply
*read* the transcript — i.e. when the prompt reads more like an instruction-to-a-chat-model than
a direct TTS style cue. Google's own guidance elsewhere on the page: vague/indirect phrasing
"may otherwise cause the system to read your style instructions... aloud" or get rejected —
i.e. directness matters, not verbosity for its own sake.

### Root cause

`"Say the following in a cheerful, happy tone: <text>"` deviates from every doc-verified
template in two ways: (1) the filler clause **"the following"** inserted between the imperative
"Say" and the style clause, and (2) the abstract meta-noun **"tone"**, which appears nowhere in
Google's shown-working examples. This is exactly the kind of "compound instruction that doesn't
read as a direct style cue" pattern the forum thread shows triggers Gemini's TTS-mode classifier
to fall through to a text-generation response, which the API then rejects with 400 since
`responseModalities: ['AUDIO']` was requested. `normal` (no prefix at all) never hits this
because it sends the bare transcript, which is unambiguously TTS input.

This is a **pattern-match root cause** (Phase 2 comparison against reference), not a guess: the
fix removes exactly the two structural elements ("the following", "tone") that differ from every
verified doc example, and nothing else changes about capability wiring (Gemini's
`supportsEmotion: true` is left intact — style control is real and documented, just needed to
match Google's verified phrasing).

## Fix

`electron/api/tts/gemini.js` — `EMOTION_STYLE_PROMPTS`:

```diff
- happy: 'Say the following in a cheerful, happy tone:',
- sad: 'Say the following in a sad, somber tone:',
- angry: 'Say the following in an angry, intense tone:',
+ happy: 'Say cheerfully:',
+ sad: 'Say sadly:',
+ angry: 'Say angrily:',
```

`happy` now matches Google's doc example **verbatim** (`"Say cheerfully: <text>"`). `sad`/`angry`
follow the identical adverbial pattern for consistency, since Google shows this same "Say
[adverb]:" shape as safe.

### Before/after request body (happy, text="hello")

Before:
```json
{"contents":[{"parts":[{"text":"Say the following in a cheerful, happy tone: hello"}]}], "generationConfig": {...}}
```

After:
```json
{"contents":[{"parts":[{"text":"Say cheerfully: hello"}]}], "generationConfig": {...}}
```

`normal`/unspecified emotion path is untouched (still sends bare `text`, no prefix) — confirmed
by existing passing test `synthesize: emotion=normal 또는 미지정이면 기존과 동일한 body`.

## Tests (TDD: red → green)

Added to `tests/electron/api/tts/gemini.test.js`:

1. `emotion별 프롬프트에 400을 유발했던 "the following"/"tone" 문구가 더 이상 없다` — asserts
   the sent `contents[0].parts[0].text` for happy/sad/angry no longer contains `"the following"`
   or `"tone"`, and still contains the original transcript.
2. `happy emotion은 문서에 검증된 그대로 "Say cheerfully:" 접두사를 쓴다` — pins the exact
   doc-verified string `"Say cheerfully: hello"`.

Confirmed both **failed** against the pre-fix code (red — captured original error output showing
`"say the following in a cheerful, happy tone: ..."`), then implemented the two-line fix in
`gemini.js`, then confirmed **green**.

### Test run output

```
$ npx vitest run tests/electron/api/tts/
 Test Files  11 passed (11)
      Tests  82 passed (82)

$ npm run test:run
 Test Files  657 passed (657)
      Tests  6744 passed (6744)
     Errors  2 errors   (pre-existing, unrelated: VideoDetailModal.generateButton.test.jsx
                          unhandled rejection on `meta.seed` when meta is null — not touched
                          by this change, exists on the branch before this fix)
```

No new failures introduced. The 2 unhandled-rejection errors are the pre-existing
`VideoDetailModal` issue called out in the task brief as unrelated.

## What this fix cannot verify

Vitest mocks `fetch` — it can only pin the **request shape**, not confirm the live Gemini API
accepts it. The doc-example match gives high confidence, but only a real API call proves it.

## In-app verification steps for the human

1. Open a Story project with a Gemini API key configured (BYOK), with a script that has both
   narrator and at least one character/dialogue segment (so both `normal` and a non-normal
   emotion get exercised).
2. In voice assignment, pick a **Gemini voice** (e.g. `Kore`, `Puck`, `Zephyr`) for a
   non-narrator speaker.
3. Generate/regenerate Story audio for that speaker's segments, covering all three emotions:
   - a segment (or forced test) with emotion **happy**
   - a segment with emotion **sad**
   - a segment with emotion **angry**
   - a normal/narrator segment (regression check — should still work as before)
4. Confirm: no `Gemini TTS failed: 400 ... Model tried to generate text` error for any of the
   four cases, and each produces a playable WAV with audibly different delivery for
   happy/sad/angry vs. normal (style control still functions, just via the corrected prompt).
5. If any emotion still 400s, capture the exact segment text + emotion — that would mean Google's
   classifier is also sensitive to specific *content* (e.g. Korean text combined with an English
   style cue, or specific narrative content), which would need a follow-up investigation beyond
   what could be confirmed without live API access.
