# TTS Voice Catalog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Load as many TTS voices as each provider exposes, show useful voice metadata, and make large voice lists searchable in Story > Audio.

**Architecture:** Keep provider credentials in the Electron main process and expand the existing `tts:list-voices` IPC into an async catalog API. Provider adapters normalize live API responses into one renderer-safe shape, then the Story UI presents provider-specific searchable selection without exposing API keys.

**Tech Stack:** Electron IPC, React, Vitest, provider REST APIs (`fetch` injected into adapters).

---

### Task 1: Normalize Voice Metadata

**Files:**
- Modify: `electron/api/tts/elevenlabs.js`
- Modify: `electron/api/tts/googletts.js`
- Modify: `electron/api/tts/gemini.js`
- Test: `tests/electron/api/tts/adapters.test.js`

**Step 1: Write failing adapter tests**

Add tests that assert each adapter returns voices with:

```js
{
  id: 'voice id',
  name: 'display name',
  language: 'ko-KR or multi',
  previewUrl: null,
  traits: ['male', 'energetic'],
  source: 'seed|account|shared|google|gemini',
}
```

For ElevenLabs, assert the seed list includes Liam `TX3LPaxmHKxFdv7VOQHJ` and Adam `pNInz6obpgDQGcFmaJgB`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/api/tts/adapters.test.js tests/electron/api/tts/typecast.test.js`

Expected: FAIL because current lists do not include Liam/Adam and do not expose `traits/source` consistently.

**Step 3: Implement normalized seed catalogs**

Update static fallback catalogs:

```js
{ id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', language: 'en', traits: ['male', 'energetic creator'], source: 'seed', previewUrl: null }
{ id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', language: 'multi', traits: ['male'], source: 'seed', previewUrl: null }
```

Expand Gemini to all 30 documented voice options and add trait labels from the official list.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/electron/api/tts/adapters.test.js tests/electron/api/tts/typecast.test.js`

Expected: PASS.

---

### Task 2: Add Live Provider Voice Fetching

**Files:**
- Modify: `electron/api/tts/elevenlabs.js`
- Modify: `electron/api/tts/googletts.js`
- Modify: `electron/api/tts/index.js` if needed
- Modify: `electron/main.js`
- Modify: `electron/ipc/tts-api.js`
- Test: `tests/electron/api/tts/adapters.test.js`
- Test: `tests/electron/ipc/tts-api.test.js`

**Step 1: Write failing tests**

Add adapter tests for:

```js
await adapter.listVoices({ query: 'Liam', includeShared: true, limit: 100 })
```

ElevenLabs expectations:
- Uses `GET https://api.elevenlabs.io/v2/voices` for account/workspace voices when a key exists.
- Uses `GET https://api.elevenlabs.io/v1/shared-voices?page_size=100&search=Liam` when `includeShared` or `query` is present.
- Normalizes `voice_id`, `name`, `language`, `preview_url`, `gender`, `age`, `accent`, `descriptive`, and `use_case`.
- Falls back to seed voices when no key exists or fetch fails.

Google expectations:
- Uses `GET https://texttospeech.googleapis.com/v1/voices` with `x-goog-api-key`.
- Passes optional `languageCode`.
- Normalizes `name`, `languageCodes`, `ssmlGender`, and `naturalSampleRateHertz`.

IPC expectations:
- `tts:list-voices` awaits async adapters and forwards safe options `{ provider, query, language, includeShared, page, limit }`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/api/tts/adapters.test.js tests/electron/ipc/tts-api.test.js`

Expected: FAIL because `listVoices` is currently sync and does not call live endpoints.

**Step 3: Implement live fetching**

Change `listVoices` to async in relevant adapters. Keep renderer-safe data only.

ElevenLabs:
- Fetch account voices first when an API key exists.
- Fetch shared voices when `includeShared` or `query` is provided.
- De-duplicate by `id`.
- Return seed voices if live calls fail or return empty.

Google:
- Fetch `/v1/voices`, optional `languageCode`.
- Return existing Korean seed voices if no key or request failure.

Gemini:
- Return full documented static catalog.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/electron/api/tts/adapters.test.js tests/electron/ipc/tts-api.test.js`

Expected: PASS.

---

### Task 3: Searchable Story Voice Picker

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/story/StoryView.jsx`
- Modify: `src/components/story/StoryView.css`
- Test: `tests/components/story/StoryView.test.jsx`

**Step 1: Write failing UI tests**

Add tests that render many ElevenLabs voices and assert:
- The current voice can be selected by ID.
- A search input filters by name, language, or trait.
- Voice options display name plus metadata.
- Changing provider resets the voice selection.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/story/StoryView.test.jsx`

Expected: FAIL because the UI is a plain `<select>` with no search metadata.

**Step 3: Implement the picker**

Keep the provider `<select>`, replace voice `<select>` with:
- A compact search input per speaker.
- A scrollable option list for the selected provider.
- Rows displaying `name`, `language`, and `traits`.
- A preview button only when `previewUrl` is present.

In `src/App.jsx`, load initial provider voices as before but support async metadata. For ElevenLabs shared search, call `ttsListVoices({ provider: 'elevenlabs', query, includeShared: true })` when the user searches.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/story/StoryView.test.jsx`

Expected: PASS.

---

### Task 4: Verification

**Files:**
- No new files.

**Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/electron/api/tts/adapters.test.js tests/electron/api/tts/typecast.test.js tests/electron/ipc/tts-api.test.js tests/components/story/StoryView.test.jsx
```

Expected: PASS.

**Step 2: Run whitespace check**

Run: `git diff --check`

Expected: no output.

**Step 3: Commit**

Run:

```bash
git add electron/api/tts/elevenlabs.js electron/api/tts/googletts.js electron/api/tts/gemini.js electron/ipc/tts-api.js electron/main.js src/App.jsx src/components/story/StoryView.jsx src/components/story/StoryView.css tests/electron/api/tts/adapters.test.js tests/electron/ipc/tts-api.test.js tests/components/story/StoryView.test.jsx docs/plans/2026-07-05-tts-voice-catalog.md
git commit -m "feat(story): add searchable TTS voice catalog"
```

Expected: commit succeeds.
