# Story Audio errorKind Locale (M3b-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** M2가 던지는 표준 키 에러(`MissingProviderKeyError`/`ProviderAuthError`)가 렌더러에서 raw 영어 대신 번역된 안내로 뜨게 한다 — 로케일 문구 추가 + 미리듣기 실패 분류를 정규식에서 `errorKind` 기반으로 교체.

**Architecture:** `resolveDisplayError`는 이미 `errorSection.kind.<errorKind>` 키를 번역한다(errorDisplay.js). 그래서 `story-audio-no-tts-key`/`story-audio-tts-auth` 문구를 ko/en 로케일의 `errorSection.kind`에 추가하면 Story 오디오 스텝 에러가 자동 번역된다. `voicePreviewService.getPreview`의 catch는 메시지 정규식 대신 `e.errorKind`를 우선 본다.

**Tech Stack:** React i18n(ko/en locale objects), vitest.

## Global Constraints

- TDD. 러너 `npx vitest run <path>`, 전체 `npm run test:run`.
- 커밋 영어. 브랜치 `feature/story-audio-apikey-gate`.
- spec §4.8(errorKind 표준화·로케일·resolveDisplayError). errorKind 값: `story-audio-no-tts-key`(from `MissingProviderKeyError`), `story-audio-tts-auth`(from `ProviderAuthError`) — M1 `electron/api/keyErrors.js`가 이 값을 세팅함.
- pre-existing `VideoDetailModal` 2 errors 무관.

## File Structure

- `src/locales/ko.js` / `src/locales/en.js` (수정) — `errorSection.kind`에 두 키 추가.
- `electron/api/tts/voicePreviewService.js` (수정) — catch 분류를 `errorKind` 우선으로.
- Tests: `tests/utils/errorDisplay.storyAudioKinds.test.js`, `tests/electron/api/tts/voicePreviewErrorKind.test.js`.

---

### Task 1: errorKind 로케일 문구 + resolveDisplayError 확인

**Files:**
- Modify: `src/locales/ko.js`, `src/locales/en.js`
- Test: `tests/utils/errorDisplay.storyAudioKinds.test.js`

**Interfaces:**
- Produces: `errorSection.kind['story-audio-no-tts-key']`, `errorSection.kind['story-audio-tts-auth']` in ko + en. `resolveDisplayError(t, 'story-audio-no-tts-key', rawEng)` returns the localized string (not the raw English).

- [ ] **Step 1: Locate the existing errorSection.kind block**

Run: `grep -n "story-audio-import\|errorSection" src/locales/ko.js | head` — find the nested `errorSection: { kind: { ... } }` object (existing keys like `story-audio-import-missing`). Add the two new keys there. Do the same in `src/locales/en.js`.

- [ ] **Step 2: Write the failing test**

```js
// tests/utils/errorDisplay.storyAudioKinds.test.js
import { describe, it, expect } from 'vitest'
import { resolveDisplayError } from '../../src/utils/errorDisplay'
import ko from '../../src/locales/ko'
import en from '../../src/locales/en'

// Minimal translator that reads a dotted key from a locale object (mirrors useI18n lookup:
// returns the value or the key itself when missing).
const makeT = (locale) => (key) => {
  const val = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), locale)
  return typeof val === 'string' ? val : key
}

describe('resolveDisplayError — story audio key errorKinds', () => {
  for (const [name, locale] of [['ko', ko], ['en', en]]) {
    const t = makeT(locale)
    it(`${name}: no-tts-key kind translates (not raw English)`, () => {
      const out = resolveDisplayError(t, 'story-audio-no-tts-key', 'audio failed: No typecast API key')
      expect(out).toBeTruthy()
      expect(out).not.toMatch(/No typecast API key/)
      expect(out).not.toBe('errorSection.kind.story-audio-no-tts-key')
    })
    it(`${name}: tts-auth kind translates`, () => {
      const out = resolveDisplayError(t, 'story-audio-tts-auth', 'Gemini TTS failed: 400')
      expect(out).toBeTruthy()
      expect(out).not.toBe('errorSection.kind.story-audio-tts-auth')
    })
  }
})
```

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run tests/utils/errorDisplay.storyAudioKinds.test.js`
Expected: FAIL — keys missing → t() returns the raw key string → assertions fail.

- [ ] **Step 4: Add locale strings**

In `src/locales/ko.js`, inside `errorSection.kind`:
```js
      'story-audio-no-tts-key': '음성 API 키가 없어 오디오를 만들 수 없습니다. 설정 › API 키에서 해당 음성 제공자의 키를 등록하세요.',
      'story-audio-tts-auth': '음성 API 키가 유효하지 않습니다(인증 실패). 설정 › API 키에서 키를 다시 확인하세요.',
```
In `src/locales/en.js`, inside `errorSection.kind`:
```js
      'story-audio-no-tts-key': 'Cannot generate audio — the voice API key is missing. Add it in Settings › API Keys for this voice provider.',
      'story-audio-tts-auth': 'The voice API key is invalid (authentication failed). Recheck it in Settings › API Keys.',
```
(Match the surrounding key's exact indentation/quote style in each file.)

- [ ] **Step 5: Run + commit**

Run: `npx vitest run tests/utils/errorDisplay.storyAudioKinds.test.js` → PASS (4).
```bash
git add src/locales/ko.js src/locales/en.js tests/utils/errorDisplay.storyAudioKinds.test.js
git commit -m "Add locale strings for story-audio missing-key / auth errorKinds"
```

---

### Task 2: voicePreviewService errorKind-based classification

**Files:**
- Modify: `electron/api/tts/voicePreviewService.js:79-83`
- Test: `tests/electron/api/tts/voicePreviewErrorKind.test.js`

**Interfaces:**
- Consumes: `MissingProviderKeyError`/`ProviderAuthError` from `electron/api/keyErrors.js` (thrown by adapters in preview's synthesize path).
- Produces: `getPreview` catch returns `{ error: 'no-key', provider }` when the thrown error has `errorKind === 'story-audio-no-tts-key'`, `{ error: 'unauthorized', provider }` for `story-audio-tts-auth`, else `{ error: 'failed', provider }`. errorKind takes precedence over the message regex (regex kept only as a fallback for untyped errors).

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/api/tts/voicePreviewErrorKind.test.js
import { describe, it, expect } from 'vitest'
import { createVoicePreviewService } from '../../../../electron/api/tts/voicePreviewService.js'
import { MissingProviderKeyError, ProviderAuthError } from '../../../../electron/api/keyErrors.js'

function makeService(throwErr) {
  return createVoicePreviewService({
    cacheDir: '/tmp/nope-cache',
    ttsFor: () => ({ synthesize: async () => { throw throwErr } }),
    voiceMeta: () => ({}),
    ssrfSafeFetch: async () => ({ audio: Buffer.alloc(0), mimeType: 'audio/mpeg' }),
    fetch: async () => ({}),
    fs: { existsSync: () => false, readFileSync: () => Buffer.alloc(0), mkdirSync: () => {}, writeFileSync: () => {}, renameSync: () => {} },
  })
}

describe('voicePreviewService getPreview — errorKind classification', () => {
  it('MissingProviderKeyError → {error:"no-key", provider}', async () => {
    const svc = makeService(new MissingProviderKeyError('typecast'))
    const res = await svc.getPreview({ provider: 'typecast', voiceId: 'v1', language: 'ko' })
    expect(res).toEqual({ error: 'no-key', provider: 'typecast' })
  })
  it('ProviderAuthError → {error:"unauthorized", provider}', async () => {
    const svc = makeService(new ProviderAuthError('gemini', { status: 400 }))
    const res = await svc.getPreview({ provider: 'gemini', voiceId: 'Kore', language: 'ko' })
    expect(res).toEqual({ error: 'unauthorized', provider: 'gemini' })
  })
  it('generic error → {error:"failed", provider}', async () => {
    const svc = makeService(new Error('network boom'))
    const res = await svc.getPreview({ provider: 'elevenlabs', voiceId: 'x', language: 'ko' })
    expect(res).toEqual({ error: 'failed', provider: 'elevenlabs' })
  })
})
```
(If `createVoicePreviewService`'s dep shape differs — e.g. it doesn't accept an injected `fs` — read the actual signature at the top of `voicePreviewService.js` and adapt the harness so `produce` throws through `ttsFor(provider).synthesize`. The disk-cache branch must miss so it reaches synthesize.)

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/electron/api/tts/voicePreviewErrorKind.test.js`
Expected: FAIL — current regex on `MissingProviderKeyError('typecast')` message "No typecast API key" happens to match `no-key`, but `ProviderAuthError('gemini',{status:400})` message "gemini auth failed: 400" does NOT match `/401|unauth/i` → returns 'failed' not 'unauthorized'. So the auth case fails.

- [ ] **Step 3: Implement errorKind-first classification**

Replace the catch body (voicePreviewService.js:79-83):
```js
      .catch((e) => {
        const kind = e?.errorKind
        let error
        if (kind === 'story-audio-no-tts-key') error = 'no-key'
        else if (kind === 'story-audio-tts-auth') error = 'unauthorized'
        else {
          const msg = String(e?.message || e)
          error = /no .* key|No .* API key/i.test(msg) ? 'no-key' : /401|unauth/i.test(msg) ? 'unauthorized' : 'failed'
        }
        return { error, provider: e?.provider || provider }
      })
```
(`provider` is in scope from `getPreview`'s destructured arg; `e?.provider` from the typed error takes precedence.)

- [ ] **Step 4: Run + full suite + commit**

Run: `npx vitest run tests/electron/api/tts/voicePreviewErrorKind.test.js` → PASS (3).
Run: `npx vitest run tests/electron/api/tts/` → existing voicePreviewService tests still green (if one asserted the old regex-only path with a typed error, update it).
Run: `npm run test:run` → green (VideoDetailModal 2 errors unrelated).
```bash
git add electron/api/tts/voicePreviewService.js tests/electron/api/tts/voicePreviewErrorKind.test.js
git commit -m "voicePreviewService: classify preview failures by errorKind (fallback to regex)"
```

---

## Self-Review

**Spec coverage:** §4.8 로케일 문구(ko/en) → Task 1 ✓; 미리듣기 정규식→errorKind → Task 2 ✓. resolveDisplayError 매핑은 기존 로직이 kind 번역을 이미 처리(변경 불필요). (게이트/VoicePicker UI가 이 분류를 소비하는 건 M3b-2/3.)

**Placeholder scan:** 없음.

**Type consistency:** errorKind 값 `story-audio-no-tts-key`/`story-audio-tts-auth`가 M1 keyErrors.js와 일치. getPreview 반환 `{error, provider}` 형태 기존과 동일(값만 정확해짐).
