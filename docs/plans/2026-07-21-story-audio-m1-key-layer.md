# Story Audio Key Layer (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend 키 레이어를 정비한다 — provider↔keyId registry, 표준 키 에러(Missing/Auth + Google 400 매핑), 2계층 키 계약(listVoices는 nullable, synthesize/generate는 throw), 폴백 무시 dev 스위치, keyStoreMulti의 genai split-brain 제거.

**Architecture:** 각 TTS/SFX 어댑터는 주입된 nullable `getKey`를 `listVoices`(시드 폴백)에 그대로 쓰고, `synthesize`/`generate` 진입점에서만 `requireKey()`로 승격해 `MissingProviderKeyError`를 던진다. HTTP 실패는 `isAuthResponse`로 분류해 `ProviderAuthError`(401/403 + Google 400 `API_KEY_INVALID`)로 감싼다. main의 `ttsKeyFor`/`sfxKeyFor` resolver는 전부 nullable로 통일(typecast의 throwing loader를 try/catch로 감쌈)하고 `AUTOFLOWCUT_DISABLE_KEY_FALLBACK`으로 env/credentials 폴백을 끈다.

**Tech Stack:** Electron main(ESM), vitest, node:fs/os. 키는 OS keychain(safeStorage) 암호화, 평문 저장·소스 삽입 금지.

## Global Constraints

- TDD 필수: 실패 테스트 → 최소 구현 → 통과 → 커밋. 테스트 위치는 `tests/`가 `src/`·`electron/` 구조를 미러링.
- 테스트 러너: `npx vitest run <path>` (단일), `npm run test:run` (전체).
- 커밋 메시지는 영어. 브랜치: `feature/story-audio-apikey-gate` (이미 체크아웃됨).
- API 키를 소스에 평문 삽입 금지. loader는 env → `~/.<svc>/credentials` 우선순위.
- 대상 spec: `docs/plans/2026-07-20-story-audio-apikey-gate-design.md` (§4.1/4.3/4.5/4.8/4.9).
- ESM(`import`/`export`) 사용. `electron/` 모듈은 `.js` ESM.

---

## File Structure

- `electron/api/keyErrors.js` (신규) — `MissingProviderKeyError`, `ProviderAuthError`, `isAuthResponse`. 순수, 의존 없음.
- `src/config/apiKeyRegistry.js` (신규) — storyProvider↔keyId↔메타 매핑. 순수, main+renderer 공용.
- `electron/api/tts/typecast.js` / `elevenlabs.js` / `gemini.js` / `googletts.js` (수정) — `requireKey` 경계 + auth 매핑. provider 주입.
- `electron/api/sfx/elevenlabs.js` (수정) — 동일 표준 에러.
- `electron/api/tts/index.js` (수정) — provider를 deps에 병합.
- `electron/api/keyStoreMulti.js` (수정) — `FILENAME_BY_PROVIDER`에서 `genai` 제거(split-brain).
- `electron/main.js` (수정) — `ttsKeyFor`/`sfxKeyFor` nullable 통일 + dev 스위치.

---

### Task 1: 표준 키 에러 (keyErrors.js)

**Files:**
- Create: `electron/api/keyErrors.js`
- Test: `tests/electron/api/keyErrors.test.js`

**Interfaces:**
- Produces:
  - `class MissingProviderKeyError extends Error` — `{ provider, errorKind: 'story-audio-no-tts-key' }`
  - `class ProviderAuthError extends Error` — `{ provider, status, detail, errorKind: 'story-audio-tts-auth' }`
  - `isAuthResponse(status: number, detail?: string): boolean` — 401/403, 또는 400+`API_KEY_INVALID`(Google).

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/api/keyErrors.test.js
import { describe, it, expect } from 'vitest'
import { MissingProviderKeyError, ProviderAuthError, isAuthResponse } from '../../../electron/api/keyErrors.js'

describe('keyErrors', () => {
  it('MissingProviderKeyError carries provider + errorKind', () => {
    const e = new MissingProviderKeyError('typecast')
    expect(e).toBeInstanceOf(Error)
    expect(e.provider).toBe('typecast')
    expect(e.errorKind).toBe('story-audio-no-tts-key')
    expect(e.message).toMatch(/typecast/i)
  })

  it('ProviderAuthError carries status/detail + errorKind', () => {
    const e = new ProviderAuthError('gemini', { status: 400, detail: 'API_KEY_INVALID' })
    expect(e.provider).toBe('gemini')
    expect(e.status).toBe(400)
    expect(e.errorKind).toBe('story-audio-tts-auth')
  })

  it('isAuthResponse: 401/403 are auth', () => {
    expect(isAuthResponse(401)).toBe(true)
    expect(isAuthResponse(403)).toBe(true)
  })

  it('isAuthResponse: Google 400 API_KEY_INVALID is auth, other 400 is not', () => {
    expect(isAuthResponse(400, '{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}')).toBe(true)
    expect(isAuthResponse(400, 'quota exceeded')).toBe(false)
  })

  it('isAuthResponse: 5xx / 429 are not auth', () => {
    expect(isAuthResponse(500)).toBe(false)
    expect(isAuthResponse(429)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/api/keyErrors.test.js`
Expected: FAIL — cannot resolve `../../../electron/api/keyErrors.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// electron/api/keyErrors.js
/**
 * 표준 키 에러 — 어댑터/SFX가 missing/auth 실패를 raw 문자열 대신 errorKind 있는 타입으로 던진다.
 * errorKind 는 stepMachine 집계·resolveDisplayError 가 로케일 안내로 변환한다(spec §4.8).
 */
export class MissingProviderKeyError extends Error {
  constructor(provider) {
    super(`No ${provider} API key`)
    this.name = 'MissingProviderKeyError'
    this.provider = provider
    this.errorKind = 'story-audio-no-tts-key'
  }
}

export class ProviderAuthError extends Error {
  constructor(provider, { status, detail } = {}) {
    super(`${provider} auth failed: ${status}`)
    this.name = 'ProviderAuthError'
    this.provider = provider
    this.status = status
    this.detail = detail
    this.errorKind = 'story-audio-tts-auth'
  }
}

/**
 * HTTP 응답이 인증 실패인가. Typecast/ElevenLabs 는 401/403; Google 계열(Gemini/GoogleTTS)은
 * 무효 키에 400 + reason 'API_KEY_INVALID' 를 준다 — 모든 400 이 아니라 이 reason 만 auth.
 */
export function isAuthResponse(status, detail = '') {
  if (status === 401 || status === 403) return true
  if (status === 400 && /API_KEY_INVALID/i.test(String(detail))) return true
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/electron/api/keyErrors.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/api/keyErrors.js tests/electron/api/keyErrors.test.js
git commit -m "Add standard provider key errors (Missing/Auth + Google 400 mapping)"
```

---

### Task 2: provider↔keyId registry (apiKeyRegistry.js)

**Files:**
- Create: `src/config/apiKeyRegistry.js`
- Test: `tests/config/apiKeyRegistry.test.js`

**Interfaces:**
- Produces:
  - `API_KEY_REGISTRY` — `{ [storyProvider]: { keyId, store: 'genai'|'multi', validate: boolean, label } }`
  - `keyIdForProvider(storyProvider: string): string` — 'gemini'→'genai', 그 외 동일. unknown→그대로.
  - `storeForProvider(storyProvider: string): 'genai'|'multi'`

- [ ] **Step 1: Write the failing test**

```js
// tests/config/apiKeyRegistry.test.js
import { describe, it, expect } from 'vitest'
import { API_KEY_REGISTRY, keyIdForProvider, storeForProvider } from '../../src/config/apiKeyRegistry.js'

describe('apiKeyRegistry', () => {
  it('maps gemini story-provider to genai keyId', () => {
    expect(keyIdForProvider('gemini')).toBe('genai')
    expect(storeForProvider('gemini')).toBe('genai')
    expect(API_KEY_REGISTRY.gemini.validate).toBe(true)
  })

  it('tts providers keep their id and use multi store, no validation', () => {
    for (const p of ['typecast', 'elevenlabs', 'googletts']) {
      expect(keyIdForProvider(p)).toBe(p)
      expect(storeForProvider(p)).toBe('multi')
      expect(API_KEY_REGISTRY[p].validate).toBe(false)
    }
  })

  it('unknown provider falls through to itself', () => {
    expect(keyIdForProvider('mystery')).toBe('mystery')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config/apiKeyRegistry.test.js`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

```js
// src/config/apiKeyRegistry.js
/**
 * storyProvider ↔ keyId ↔ store 매핑(순수). Story 화자 provider 이름('gemini')과 키 store
 * 식별자('genai')가 다르다 — 이 테이블만이 별칭의 단일 진실이다(spec §4.3). main·renderer 공용.
 *   store 'genai': 단일 keyStore(genai-key.enc), useApiKey, 저장 전 검증.
 *   store 'multi': keyStoreMulti, useTtsKeys, 검증 없음.
 */
export const API_KEY_REGISTRY = {
  typecast:   { keyId: 'typecast',   store: 'multi', validate: false, label: 'Typecast' },
  elevenlabs: { keyId: 'elevenlabs', store: 'multi', validate: false, label: 'ElevenLabs' },
  gemini:     { keyId: 'genai',      store: 'genai', validate: true,  label: 'Google Gemini' },
  googletts:  { keyId: 'googletts',  store: 'multi', validate: false, label: 'Google Cloud TTS' },
}

export function keyIdForProvider(storyProvider) {
  return API_KEY_REGISTRY[storyProvider]?.keyId ?? storyProvider
}

export function storeForProvider(storyProvider) {
  return API_KEY_REGISTRY[storyProvider]?.store ?? 'multi'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config/apiKeyRegistry.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/apiKeyRegistry.js tests/config/apiKeyRegistry.test.js
git commit -m "Add provider-to-keyId registry (gemini->genai alias, store mapping)"
```

---

### Task 3: TTS 어댑터 2계층 키 계약 + auth 매핑

**Files:**
- Modify: `electron/api/tts/index.js` (provider를 deps에 병합)
- Modify: `electron/api/tts/typecast.js:72-96` (synthesize), `elevenlabs.js:138-...` (synthesize), `gemini.js:85-111` (synthesize), `googletts.js:67-85` (synthesize)
- Test: `tests/electron/api/tts/adapterKeyContract.test.js`

**Interfaces:**
- Consumes: `MissingProviderKeyError`, `ProviderAuthError`, `isAuthResponse` (Task 1); factory에 주입되는 `{ getKey, fetch, provider }`.
- Produces: 각 어댑터의 `synthesize()`가 키 없으면 `MissingProviderKeyError(provider)`, 인증 실패 시 `ProviderAuthError(provider,{status,detail})`. `listVoices()`는 **변경 없음**(nullable getKey로 시드 폴백 유지).

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/api/tts/adapterKeyContract.test.js
import { describe, it, expect } from 'vitest'
import { createTtsAdapter } from '../../../../electron/api/tts/index.js'
import { MissingProviderKeyError, ProviderAuthError } from '../../../../electron/api/keyErrors.js'

const okAudioFetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4), json: async () => ({}) })

describe('adapter 2-tier key contract', () => {
  for (const provider of ['typecast', 'elevenlabs', 'googletts']) {
    it(`${provider}: synthesize throws MissingProviderKeyError when key is null`, async () => {
      const a = createTtsAdapter(provider, { getKey: () => null, fetch: okAudioFetch, provider })
      await expect(a.synthesize({ text: 'hi', voiceId: 'v1' })).rejects.toBeInstanceOf(MissingProviderKeyError)
    })

    it(`${provider}: listVoices does NOT throw without key (seed fallback)`, async () => {
      const a = createTtsAdapter(provider, { getKey: () => null, fetch: okAudioFetch, provider })
      const voices = await a.listVoices({})
      expect(Array.isArray(voices)).toBe(true)
    })

    it(`${provider}: 401 maps to ProviderAuthError`, async () => {
      const authFetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })
      const a = createTtsAdapter(provider, { getKey: () => 'k', fetch: authFetch, provider })
      await expect(a.synthesize({ text: 'hi', voiceId: 'v1' })).rejects.toBeInstanceOf(ProviderAuthError)
    })
  }

  it('googletts: 400 API_KEY_INVALID maps to ProviderAuthError', async () => {
    const g400 = async () => ({ ok: false, status: 400, text: async () => '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}' })
    const a = createTtsAdapter('googletts', { getKey: () => 'bad', fetch: g400, provider: 'googletts' })
    await expect(a.synthesize({ text: 'hi', voiceId: 'ko-KR-A' })).rejects.toBeInstanceOf(ProviderAuthError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/api/tts/adapterKeyContract.test.js`
Expected: FAIL — synthesize throws generic `Error('No X API key')`, not `MissingProviderKeyError`; and factory ignores `provider`.

- [ ] **Step 3a: Merge provider into deps (index.js)**

```js
// electron/api/tts/index.js — createTtsAdapter 본문 교체
export function createTtsAdapter(provider, deps) {
  const make = FACTORIES[provider]
  if (!make) throw new Error(`Unsupported TTS provider: ${provider}`)
  return make({ ...deps, provider })
}
```

- [ ] **Step 3b: typecast.js — requireKey + auth**

`synthesize` 진입부와 `!res.ok` 분기를 교체(typecast.js:72-93). 파일 상단에 import 추가:

```js
import { MissingProviderKeyError, ProviderAuthError, isAuthResponse } from '../keyErrors.js'
```

factory 시그니처에 `provider` 추가하고 synthesize 수정:

```js
export function createTypecastAdapter({ getKey, fetch, provider = 'typecast' }) {
  // ...fetchAndCacheVoices 및 listVoices 는 변경 없음 (nullable getKey 유지)...
    async synthesize({ text, voiceId, emotion = 'normal', signal, model }) {
      const key = getKey()
      if (key == null) throw new MissingProviderKeyError(provider)
      if (!model && !voiceModelById.has(voiceId)) {
        try { await fetchAndCacheVoices() } catch { /* best-effort */ }
      }
      const useModel = model || voiceModelById.get(voiceId) || 'ssfm-v21'
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ text, voice_id: voiceId, model: useModel, emotion }),
        signal,
      })
      if (!res.ok) {
        const detail = await (res.text?.() ?? Promise.resolve(''))
        if (isAuthResponse(res.status, detail)) throw new ProviderAuthError(provider, { status: res.status, detail })
        throw new Error(`Typecast TTS failed: ${res.status} ${detail}`)
      }
      const buf = Buffer.from(await res.arrayBuffer())
      return { audio: buf, format: 'wav' }
    },
```

- [ ] **Step 3c: elevenlabs.js — requireKey + auth**

상단 import 추가(동일), factory에 `provider = 'elevenlabs'` 추가. synthesize의 `if (!key) throw new Error('No ElevenLabs API key')`를 `if (key == null) throw new MissingProviderKeyError(provider)`로, `!res.ok` 분기(현재 :147 이후)에 auth 매핑 추가:

```js
      if (!res.ok) {
        const detail = await (res.text?.() ?? Promise.resolve(''))
        if (isAuthResponse(res.status, detail)) throw new ProviderAuthError(provider, { status: res.status, detail })
        throw new Error(`ElevenLabs TTS failed: ${res.status} ${detail}`)
      }
```
(`listVoices`는 변경 없음 — `getKey()`가 null이면 헤더를 비우고 시드 반환.)

- [ ] **Step 3d: gemini.js — requireKey + auth**

상단 import, factory에 `provider = 'gemini'`. synthesize의 `if (!key) throw new Error('No Gemini API key')` → `if (key == null) throw new MissingProviderKeyError(provider)`. `!res.ok` 분기(gemini.js:102-105):

```js
      if (!res.ok) {
        const detail = await (res.text?.() ?? Promise.resolve(''))
        if (isAuthResponse(res.status, detail)) throw new ProviderAuthError(provider, { status: res.status, detail })
        throw new Error(`Gemini TTS failed: ${res.status} ${detail}`)
      }
```

- [ ] **Step 3e: googletts.js — requireKey + auth**

상단 import, factory에 `provider = 'googletts'`. `if (!key) throw new Error('No Google TTS API key')` → `if (key == null) throw new MissingProviderKeyError(provider)`. `!res.ok` 분기(googletts.js:78-81):

```js
      if (!res.ok) {
        const detail = await (res.text?.() ?? Promise.resolve(''))
        if (isAuthResponse(res.status, detail)) throw new ProviderAuthError(provider, { status: res.status, detail })
        throw new Error(`Google TTS failed: ${res.status} ${detail}`)
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/electron/api/tts/adapterKeyContract.test.js`
Expected: PASS. Then run existing adapter tests to catch regressions:
Run: `npx vitest run tests/electron/api/tts/`
Expected: PASS (existing listVoices/synthesize tests still green; if an existing test asserted the old `'No X API key'` message string, update it to `MissingProviderKeyError`).

- [ ] **Step 5: Commit**

```bash
git add electron/api/tts/index.js electron/api/tts/typecast.js electron/api/tts/elevenlabs.js electron/api/tts/gemini.js electron/api/tts/googletts.js tests/electron/api/tts/adapterKeyContract.test.js
git commit -m "TTS adapters: two-tier key contract (requireKey at synthesize) + auth mapping"
```

---

### Task 4: SFX 어댑터 동일 표준 에러

**Files:**
- Modify: `electron/api/sfx/elevenlabs.js:14-29`
- Test: `tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js`

**Interfaces:**
- Consumes: Task 1 errors; factory `{ getKey, fetch, provider }`.
- Produces: `generate()`가 키 없으면 `MissingProviderKeyError`, 인증 실패 시 `ProviderAuthError`.

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js
import { describe, it, expect } from 'vitest'
import { createElevenLabsSfxAdapter } from '../../../../electron/api/sfx/elevenlabs.js'
import { MissingProviderKeyError, ProviderAuthError } from '../../../../electron/api/keyErrors.js'

describe('sfx elevenlabs key contract', () => {
  it('generate throws MissingProviderKeyError without key', async () => {
    const a = createElevenLabsSfxAdapter({ getKey: () => null, fetch: async () => ({ ok: true }), provider: 'elevenlabs' })
    await expect(a.generate({ description: 'boom' })).rejects.toBeInstanceOf(MissingProviderKeyError)
  })

  it('generate maps 401 to ProviderAuthError', async () => {
    const a = createElevenLabsSfxAdapter({ getKey: () => 'k', fetch: async () => ({ ok: false, status: 401, text: async () => 'no' }), provider: 'elevenlabs' })
    await expect(a.generate({ description: 'boom' })).rejects.toBeInstanceOf(ProviderAuthError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js`
Expected: FAIL — generate throws generic `Error('No ElevenLabs API key')`.

- [ ] **Step 3: Implement**

`electron/api/sfx/elevenlabs.js` 상단에 import 추가, factory에 `provider = 'elevenlabs'`, generate 수정:

```js
import { MissingProviderKeyError, ProviderAuthError, isAuthResponse } from '../keyErrors.js'

export function createElevenLabsSfxAdapter({ getKey, fetch, provider = 'elevenlabs' }) {
  return {
    capabilities() { return { outputFormats: ['mp3'], durationRange: [0.5, 30], maxConcurrency: 2 } },
    async generate({ description, durationSeconds = null, signal } = {}) {
      const key = getKey()
      if (key == null) throw new MissingProviderKeyError(provider)
      const body = { text: description, model_id: 'eleven_text_to_sound_v2' }
      if (durationSeconds != null) body.duration_seconds = durationSeconds
      const res = await fetch(`${URL}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        const detail = await (res.text?.() ?? Promise.resolve(''))
        if (isAuthResponse(res.status, detail)) throw new ProviderAuthError(provider, { status: res.status, detail })
        throw new Error(`ElevenLabs SFX failed: ${res.status} ${detail}`)
      }
      return { audio: Buffer.from(await res.arrayBuffer()), format: 'mp3' }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js`
Expected: PASS. Regression: `npx vitest run tests/electron/api/sfx/` → PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/api/sfx/elevenlabs.js tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js
git commit -m "SFX ElevenLabs adapter: standard Missing/Auth key errors"
```

---

### Task 5: keyStoreMulti genai split-brain 제거

**Files:**
- Modify: `electron/api/keyStoreMulti.js:8-14`
- Test: `tests/electron/api/keyStoreMultiGenai.test.js`

**Interfaces:**
- Produces: `keyStoreMulti`가 `'genai'`를 allowlist에서 제외 — `setKey('genai')`/`getKey('genai')`/`hasKey('genai')`가 no-op(unknown provider). Gemini 키는 단일 `keyStore`(genai-key.enc)만 정본.

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/api/keyStoreMultiGenai.test.js
import { describe, it, expect } from 'vitest'
import { createMultiKeyStore, PROVIDERS } from '../../../electron/api/keyStoreMulti.js'

const fakeSafeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() }
const makeFs = () => {
  const files = new Map()
  return {
    mkdirSync: () => {},
    existsSync: (p) => files.has(p),
    readFileSync: (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p) },
    writeFileSync: (p, d) => files.set(p, d),
    unlinkSync: (p) => files.delete(p),
    chmodSync: () => {},
  }
}

describe('keyStoreMulti excludes genai (split-brain removed)', () => {
  it('genai is not in PROVIDERS allowlist', () => {
    expect(PROVIDERS).not.toContain('genai')
    expect(PROVIDERS).toEqual(expect.arrayContaining(['typecast', 'elevenlabs', 'googletts']))
  })

  it('setKey(genai) is rejected and writes no file', () => {
    const store = createMultiKeyStore({ safeStorage: fakeSafeStorage, keysDir: '/keys', fs: makeFs(), path: require('node:path') })
    const res = store.setKey('genai', 'secret')
    expect(res.success).toBe(false)
    expect(store.hasKey('genai')).toBe(false)
    expect(store.getKey('genai')).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/api/keyStoreMultiGenai.test.js`
Expected: FAIL — `PROVIDERS` still contains `'genai'`; `setKey('genai')` succeeds.

- [ ] **Step 3: Implement**

`electron/api/keyStoreMulti.js`의 `FILENAME_BY_PROVIDER`에서 `genai` 줄 삭제:

```js
const FILENAME_BY_PROVIDER = {
  elevenlabs: 'elevenlabs-key.enc',
  typecast: 'typecast-key.enc',
  googletts: 'googletts-key.enc',
  anthropic: 'anthropic-key.enc',
}
```
(`PROVIDERS`는 파생되므로 자동으로 `genai` 제외. 나머지 로직 변경 없음. Gemini 키는 `main.js`의 단일 `genaiKeyStore`가 계속 담당.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/electron/api/keyStoreMultiGenai.test.js`
Expected: PASS. Regression: `npx vitest run tests/electron/api/` → PASS (기존 keyStoreMulti 테스트가 genai를 안 쓰는지 확인; 쓰면 그 테스트를 typecast 등으로 교체).

- [ ] **Step 5: Commit**

```bash
git add electron/api/keyStoreMulti.js tests/electron/api/keyStoreMultiGenai.test.js
git commit -m "keyStoreMulti: drop genai from allowlist (remove split-brain path)"
```

---

### Task 6: main resolver nullable 통일 + 폴백 dev 스위치

**Files:**
- Modify: `electron/main.js:233-238` (`ttsKeyFor`), `:273-283` (`sfxKeyFor`)
- Test: `tests/electron/main/keyResolvers.test.js` (resolver 로직을 순수 함수로 추출해 테스트)

**Interfaces:**
- Consumes: `getTypecastKey`(throwing loader, 변경 안 함), `readCredentialsKey`(nullable), `multiKeyStore`, `genaiKeyStore`.
- Produces: `buildKeyResolvers({ multiKeyStore, genaiKeyStore, getTypecastKey, readCredentialsKey, disableFallback })` → `{ ttsKeyFor, sfxKeyFor }`, 모두 **nullable(throw 안 함)**. `disableFallback`이면 env/credentials 폴백을 건너뛴다.

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/main/keyResolvers.test.js
import { describe, it, expect } from 'vitest'
import { buildKeyResolvers } from '../../../electron/main/keyResolvers.js'

const store = (map) => ({ getKey: (p) => map[p] ?? null })

describe('buildKeyResolvers (nullable, dev switch)', () => {
  it('typecast: store hit wins, never throws', () => {
    const { ttsKeyFor } = buildKeyResolvers({
      multiKeyStore: store({ typecast: 'store-key' }), genaiKeyStore: store({}),
      getTypecastKey: () => { throw new Error('should not be called') },
      readCredentialsKey: () => null, disableFallback: false,
    })
    expect(ttsKeyFor.typecast()).toBe('store-key')
  })

  it('typecast: falls back to loader, returns null instead of throwing when absent', () => {
    const { ttsKeyFor } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({}),
      getTypecastKey: () => { throw new Error('not found') },
      readCredentialsKey: () => null, disableFallback: false,
    })
    expect(ttsKeyFor.typecast()).toBe(null)
  })

  it('disableFallback: ignores env/credentials, store-only', () => {
    const { ttsKeyFor } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({}),
      getTypecastKey: () => 'env-key', readCredentialsKey: () => 'cred-key', disableFallback: true,
    })
    expect(ttsKeyFor.typecast()).toBe(null)
    expect(ttsKeyFor.elevenlabs()).toBe(null)
  })

  it('gemini resolves from genaiKeyStore only', () => {
    const { ttsKeyFor } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({ genai: 'g' }),
      getTypecastKey: () => null, readCredentialsKey: () => null, disableFallback: false,
    })
    expect(ttsKeyFor.gemini()).toBe('g')
  })

  it('sfx elevenlabs mirrors tts elevenlabs resolution', () => {
    const { sfxKeyFor } = buildKeyResolvers({
      multiKeyStore: store({ elevenlabs: 'e' }), genaiKeyStore: store({}),
      getTypecastKey: () => null, readCredentialsKey: () => null, disableFallback: false,
    })
    expect(sfxKeyFor.elevenlabs()).toBe('e')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/main/keyResolvers.test.js`
Expected: FAIL — cannot resolve `electron/main/keyResolvers.js`.

- [ ] **Step 3: Extract pure resolver builder**

```js
// electron/main/keyResolvers.js
/**
 * 키 resolver 빌더(순수·주입) — 모든 provider 를 nullable 로 통일한다(어댑터의 requireKey 가
 * missing throw 를 담당, spec §4.1/4.8). typecast 의 throwing loader 만 try/catch 로 감싼다.
 * disableFallback(AUTOFLOWCUT_DISABLE_KEY_FALLBACK) 이면 env/credentials 폴백을 건너뛴다(§4.9).
 */
export function buildKeyResolvers({ multiKeyStore, genaiKeyStore, getTypecastKey, readCredentialsKey, disableFallback }) {
  const typecastFallback = () => {
    if (disableFallback) return null
    try { return getTypecastKey() ?? null } catch { return null }
  }
  const credFallback = (svc, envVar) => (disableFallback ? null : (readCredentialsKey(svc, envVar) ?? null))

  const ttsKeyFor = {
    typecast: () => multiKeyStore.getKey('typecast') || typecastFallback(),
    elevenlabs: () => multiKeyStore.getKey('elevenlabs') || credFallback('elevenlabs', 'ELEVENLABS_API_KEY'),
    googletts: () => multiKeyStore.getKey('googletts') || credFallback('googletts', 'GOOGLE_TTS_API_KEY'),
    gemini: () => genaiKeyStore.getKey() ?? null,
  }
  const sfxKeyFor = {
    elevenlabs: () => multiKeyStore.getKey('elevenlabs') || credFallback('elevenlabs', 'ELEVENLABS_API_KEY'),
  }
  return { ttsKeyFor, sfxKeyFor }
}
```

- [ ] **Step 4: Wire into main.js + run test**

`electron/main.js`에서 인라인 `ttsKeyFor`/`sfxKeyFor` 객체 정의(233-238, 273-283)를 삭제하고 빌더 호출로 교체:

```js
import { buildKeyResolvers } from './main/keyResolvers.js'
// ... genaiKeyStore/multiKeyStore 생성 이후 ...
const { ttsKeyFor, sfxKeyFor } = buildKeyResolvers({
  multiKeyStore,
  genaiKeyStore,
  getTypecastKey,
  readCredentialsKey,
  disableFallback: process.env.AUTOFLOWCUT_DISABLE_KEY_FALLBACK === '1',
})
```

Run: `npx vitest run tests/electron/main/keyResolvers.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Full suite + commit**

Run: `npm run test:run`
Expected: PASS (기존 6644+ 그린; 어댑터 에러 타입 변경으로 깨진 기존 테스트가 있으면 `MissingProviderKeyError`/`ProviderAuthError` 기준으로 갱신). 사전 존재하던 `VideoDetailModal` 2 errors(async race)는 무관.

```bash
git add electron/main/keyResolvers.js electron/main.js tests/electron/main/keyResolvers.test.js
git commit -m "main: nullable key resolvers + AUTOFLOWCUT_DISABLE_KEY_FALLBACK dev switch"
```

---

## Self-Review

**Spec coverage (M1 scope):**
- §4.3 registry → Task 2 ✓
- §4.8 표준 에러 Missing/Auth + Google 400 → Task 1, 어댑터 적용 Task 3/4 ✓
- §4.8 2계층(listVoices nullable / synthesize throw) → Task 3 (listVoices 미변경, synthesize requireKey) ✓
- §4.5 split-brain 하드닝 → Task 5 ✓
- §4.1/§4.9 nullable resolver + dev 스위치 → Task 6 ✓
- (M2/M3 범위 — planAudioWork, preflight IPC, ApiKeyField, 설정 통합 UI, refetch, errorKind 로케일/errorDisplay, preview attempt-first — 이 plan에 없음. 다음 마일스톤.)

**Placeholder scan:** 없음 — 모든 스텝에 실제 코드/명령/기대 출력.

**Type consistency:** `MissingProviderKeyError(provider)`, `ProviderAuthError(provider,{status,detail})`, `isAuthResponse(status,detail)`, `keyIdForProvider`, `buildKeyResolvers({...}) → {ttsKeyFor, sfxKeyFor}` — Task 간 시그니처 일치. 어댑터 factory는 `{getKey, fetch, provider}` 통일.

**주의(구현 중 확인):** 기존 어댑터 테스트가 raw `'No X API key'` 메시지 문자열을 assert하면 Task 3/4에서 `MissingProviderKeyError`로 갱신. main.js의 `getTypecastKey`/`readCredentialsKey` import 심볼명이 실제와 일치하는지 배선 시 확인.
