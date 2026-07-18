# Voice Card Picker + Preview + F0 Gender Tagging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** story>audio 성우 선택을 모달 카드 피커로 교체 — Typecast 라이브 목록, 미리듣기(▶), Gemini/ElevenLabs 성별 + Typecast는 미리듣기 오디오 F0로 자동 태깅.

**Architecture:** 데이터는 어댑터(listVoices) → main의 순수 `genderOverlay` 래퍼가 성별 캐시 병합. 미리듣기는 main `voicePreviewService`(어댑터 synthesize/preview_url 래핑 + 디스크캐시 + SSRF 방어). F0 분석은 renderer 순수 함수. UI는 `VoicePicker` 모달 + `useVoicePreview` 훅.

**Tech Stack:** Electron(main/preload) + React(renderer) + vitest. 새 npm 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-07-06-voice-picker-design.md`

## Global Constraints

- 테스트 러너 vitest. 단위: `npx vitest run <path>`. 전체: `npm run test:run`.
- 테스트 위치는 `src/` 구조 미러(`tests/<mirror>`).
- 커밋 메시지 **영어**, 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- 성별 필드 계약: `gender:'male'|'female'|null`, `genderSource:'adapter'|'seed'|'manual'|'f0'|null`, `f0:number|null`, `confidence:'high'|'low'|null`.
- 오버레이 우선순위: `adapter|seed`(확정, 불변) > `manual` > `f0` > 미상.
- F0 분류: 유성프레임 부족→`null`(태깅 안 함), 그 외 `165Hz` 하드 이분(<165 male, ≥165 female); confidence `<150||>185`→high, `150~185`→low.
- 통합 커밋 원칙: 슬라이스 1~5 완성 전까지 옛 드롭다운에 라이브 대량 목록이 들어가지 않게(슬라이스 순서 준수).
- IPC 네이밍: `tts:preview-voice`, `tts:tag-voice-gender`; preload `ttsPreviewVoice`/`ttsTagVoiceGender`.

---

## File Structure

**Create:**
- `electron/api/tts/genderOverlay.js` — 순수: 성별 캐시 병합
- `electron/api/tts/voiceGenderCache.js` — userData json read/write(+corrupt degrade)
- `electron/api/tts/voicePreviewService.js` — 미리듣기 오케스트레이션(캐시/dedupe/synth/url/error)
- `electron/api/net/ssrfSafeFetch.js` — 순수 검증 + 안전 fetch
- `src/utils/voiceGender.js` — 순수: `estimateGenderFromPcm`
- `src/hooks/useVoicePreview.js` — 재생 + F0 + stale-drop
- `src/components/story/VoicePicker.jsx` + `.css`
- `tests/fixtures/typecast-voices.json`
- 각 대응 test

**Modify:**
- `electron/api/tts/typecast.js` — async 라이브 listVoices
- `electron/api/tts/gemini.js` — KNOWN_VOICES gender/genderSource
- `electron/api/tts/elevenlabs.js` — normalizer gender/genderSource
- `electron/main.js` — listVoices 래퍼에 overlay + voiceMetaCache, preview/tag IPC 배선
- `electron/ipc/tts-api.js` — `tts:preview-voice`, `tts:tag-voice-gender`
- `electron/preload.js` — `ttsPreviewVoice`, `ttsTagVoiceGender`
- `src/App.jsx` — onTagGender + optimistic mergeTtsVoices
- `src/components/story/StoryView.jsx` — 드롭다운 → 모달
- `src/locales/{ko,en}.js` — `story.voicePicker.*`

---

## SLICE 1 — 데이터 레이어 (어댑터 + 순수 모듈)

### Task 1: F0 성별 추정 순수 함수 (`src/utils/voiceGender.js`)

**Files:**
- Create: `src/utils/voiceGender.js`
- Test: `tests/utils/voiceGender.test.js`

**Interfaces:**
- Produces: `estimateGenderFromPcm(samples: Float32Array, sampleRate: number) → { gender:'male'|'female'|null, f0:number|null, confidence:'high'|'low'|null }`

- [ ] **Step 1: Write the failing test**

```js
// tests/utils/voiceGender.test.js
import { describe, it, expect } from 'vitest'
import { estimateGenderFromPcm } from '../../src/utils/voiceGender.js'

function sine(freq, sr = 16000, secs = 0.5) {
  const n = Math.floor(sr * secs)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = 0.8 * Math.sin((2 * Math.PI * freq * i) / sr)
  return out
}

describe('estimateGenderFromPcm', () => {
  it('classifies a 120Hz tone as male, high confidence', () => {
    const r = estimateGenderFromPcm(sine(120), 16000)
    expect(r.gender).toBe('male')
    expect(Math.abs(r.f0 - 120)).toBeLessThan(8)
    expect(r.confidence).toBe('high')
  })
  it('classifies a 210Hz tone as female, high confidence', () => {
    const r = estimateGenderFromPcm(sine(210), 16000)
    expect(r.gender).toBe('female')
    expect(r.confidence).toBe('high')
  })
  it('marks 170Hz (overlap band) as female, low confidence', () => {
    const r = estimateGenderFromPcm(sine(170), 16000)
    expect(r.gender).toBe('female')
    expect(r.confidence).toBe('low')
  })
  it('returns null gender for silence', () => {
    const r = estimateGenderFromPcm(new Float32Array(8000), 16000)
    expect(r.gender).toBeNull()
    expect(r.f0).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/voiceGender.test.js`
Expected: FAIL ("estimateGenderFromPcm is not a function" / module not found).

- [ ] **Step 3: Write minimal implementation**

```js
// src/utils/voiceGender.js
// F0(기본주파수) 기반 성별 추정. autocorrelation로 프레임별 F0 → 중앙값 → 165Hz 이분.
// 순수 함수(브라우저/노드 무관). Web Audio decodeAudioData 결과의 채널 데이터를 받는다.

function frameF0(frame, sampleRate) {
  // RMS 게이트: 무음/무성 프레임 스킵
  let rms = 0
  for (let i = 0; i < frame.length; i++) rms += frame[i] * frame[i]
  rms = Math.sqrt(rms / frame.length)
  if (rms < 0.04) return null

  // 평균 제거
  let mean = 0
  for (let i = 0; i < frame.length; i++) mean += frame[i]
  mean /= frame.length

  const minLag = Math.floor(sampleRate / 400) // 400Hz
  const maxLag = Math.floor(sampleRate / 80)  // 80Hz
  let ac0 = 0
  for (let i = 0; i < frame.length; i++) { const v = frame[i] - mean; ac0 += v * v }
  if (ac0 <= 0) return null

  let bestLag = -1
  let bestVal = 0
  for (let lag = minLag; lag <= maxLag && lag < frame.length; lag++) {
    let s = 0
    for (let i = 0; i + lag < frame.length; i++) s += (frame[i] - mean) * (frame[i + lag] - mean)
    if (s > bestVal) { bestVal = s; bestLag = lag }
  }
  if (bestLag < 0 || bestVal / ac0 < 0.3) return null // 약한 주기성 제외
  return sampleRate / bestLag
}

export function estimateGenderFromPcm(samples, sampleRate) {
  const frameLen = Math.floor(0.04 * sampleRate) // 40ms
  const hop = Math.floor(0.02 * sampleRate)      // 20ms
  const f0s = []
  for (let i = 0; i + frameLen <= samples.length; i += hop) {
    const f0 = frameF0(samples.subarray(i, i + frameLen), sampleRate)
    if (f0 != null) f0s.push(f0)
  }
  if (f0s.length < 3) return { gender: null, f0: null, confidence: null }
  f0s.sort((a, b) => a - b)
  const f0 = f0s[Math.floor(f0s.length / 2)] // 중앙값
  const gender = f0 < 165 ? 'male' : 'female'
  const confidence = (f0 < 150 || f0 > 185) ? 'high' : 'low'
  return { gender, f0: Math.round(f0), confidence }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/utils/voiceGender.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/voiceGender.js tests/utils/voiceGender.test.js
git commit -m "feat(story): F0-based gender estimation pure function

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 성별 오버레이 순수 모듈 (`electron/api/tts/genderOverlay.js`)

**Files:**
- Create: `electron/api/tts/genderOverlay.js`
- Test: `tests/electron/api/tts/genderOverlay.test.js`

**Interfaces:**
- Consumes: voices `[{ id, provider, gender, genderSource, ... }]`, cache `{ [provider:id]: { gender, f0, confidence, source } }`.
- Produces: `applyGenderOverlay(provider, voices, cache) → voices'` (순수, 원본 불변).

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/api/tts/genderOverlay.test.js
import { describe, it, expect } from 'vitest'
import { applyGenderOverlay } from '../../../../electron/api/tts/genderOverlay.js'

describe('applyGenderOverlay', () => {
  const cache = {
    'typecast:v_manual': { gender: 'female', source: 'manual' },
    'typecast:v_f0': { gender: 'male', f0: 132, confidence: 'high', source: 'f0' },
    'typecast:v_fixed': { gender: 'male', source: 'manual' }, // must NOT override adapter
  }
  it('fills unknown voice from f0 cache', () => {
    const out = applyGenderOverlay('typecast', [{ id: 'v_f0', gender: null, genderSource: null }], cache)
    expect(out[0].gender).toBe('male')
    expect(out[0].genderSource).toBe('f0')
    expect(out[0].f0).toBe(132)
  })
  it('manual outranks f0 but not adapter/seed', () => {
    const out = applyGenderOverlay('typecast', [{ id: 'v_fixed', gender: 'female', genderSource: 'adapter' }], cache)
    expect(out[0].gender).toBe('female') // adapter kept
    expect(out[0].genderSource).toBe('adapter')
  })
  it('manual overlay on unknown voice', () => {
    const out = applyGenderOverlay('typecast', [{ id: 'v_manual', gender: null, genderSource: null }], cache)
    expect(out[0].genderSource).toBe('manual')
    expect(out[0].gender).toBe('female')
  })
  it('leaves unknown voice unknown when no cache entry', () => {
    const out = applyGenderOverlay('typecast', [{ id: 'x', gender: null, genderSource: null }], cache)
    expect(out[0].gender).toBeNull()
  })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/electron/api/tts/genderOverlay.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// electron/api/tts/genderOverlay.js
// 순수: 어댑터 voice 배열에 app-global 성별 캐시를 병합. 확정(adapter/seed)은 불변.
export function applyGenderOverlay(provider, voices, cache = {}) {
  return (voices || []).map((v) => {
    if (v.genderSource === 'adapter' || v.genderSource === 'seed') return v // 확정 불변
    const hit = cache[`${provider}:${v.id}`]
    if (!hit || !hit.gender) return v
    return {
      ...v,
      gender: hit.gender,
      genderSource: hit.source, // 'manual' | 'f0'
      f0: hit.f0 ?? null,
      confidence: hit.confidence ?? null,
    }
  })
}
```

- [ ] **Step 4: Run** → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/api/tts/genderOverlay.js tests/electron/api/tts/genderOverlay.test.js
git commit -m "feat(story): pure gender overlay merge for voice lists

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 성별 캐시 저장소 (`electron/api/tts/voiceGenderCache.js`)

**Files:**
- Create: `electron/api/tts/voiceGenderCache.js`
- Test: `tests/electron/api/tts/voiceGenderCache.test.js`

**Interfaces:**
- Produces: `createVoiceGenderCache({ filePath, fs }) → { get(): object, tag({provider, voiceId, gender, f0, confidence, source}): void }`.
- `get()` reads json; corrupt/missing → `{}` (degrade, never throw).

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/api/tts/voiceGenderCache.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { createVoiceGenderCache } from '../../../../electron/api/tts/voiceGenderCache.js'

function memFs(initial = {}) {
  const files = { ...initial }
  return {
    files,
    existsSync: (p) => p in files,
    readFileSync: (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p] },
    writeFileSync: (p, data) => { files[p] = data },
    mkdirSync: () => {},
  }
}

describe('voiceGenderCache', () => {
  it('tag then get round-trips', () => {
    const fs = memFs()
    const c = createVoiceGenderCache({ filePath: '/x/gender.json', fs })
    c.tag({ provider: 'typecast', voiceId: 'v1', gender: 'male', f0: 132, confidence: 'high', source: 'f0' })
    expect(c.get()['typecast:v1']).toMatchObject({ gender: 'male', source: 'f0' })
  })
  it('degrades to {} on corrupt json', () => {
    const fs = memFs({ '/x/gender.json': '{not json' })
    const c = createVoiceGenderCache({ filePath: '/x/gender.json', fs })
    expect(c.get()).toEqual({})
  })
  it('manual overrides existing f0 entry', () => {
    const fs = memFs()
    const c = createVoiceGenderCache({ filePath: '/x/gender.json', fs })
    c.tag({ provider: 'typecast', voiceId: 'v1', gender: 'male', source: 'f0' })
    c.tag({ provider: 'typecast', voiceId: 'v1', gender: 'female', source: 'manual' })
    expect(c.get()['typecast:v1']).toMatchObject({ gender: 'female', source: 'manual' })
  })
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
// electron/api/tts/voiceGenderCache.js
import nodeFs from 'node:fs'
import path from 'node:path'

// app-global 성별 캐시. 프로젝트 무관. corrupt/missing → {} degrade.
export function createVoiceGenderCache({ filePath, fs = nodeFs }) {
  function get() {
    try {
      if (!fs.existsSync(filePath)) return {}
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) || {}
    } catch { return {} }
  }
  function tag({ provider, voiceId, gender, f0 = null, confidence = null, source }) {
    const data = get()
    data[`${provider}:${voiceId}`] = { gender, f0, confidence, source }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf8')
    } catch { /* best-effort persist */ }
  }
  return { get, tag }
}
```

Note: memFs test passes `readFileSync(p)` — impl calls with `'utf8'`; memFs ignores extra arg (fine).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/api/tts/voiceGenderCache.js tests/electron/api/tts/voiceGenderCache.test.js
git commit -m "feat(story): app-global voice gender cache with corrupt-degrade

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Typecast 라이브 listVoices (`electron/api/tts/typecast.js`)

**Files:**
- Modify: `electron/api/tts/typecast.js:26` (listVoices)
- Create: `tests/fixtures/typecast-voices.json`
- Test: `tests/electron/api/tts/typecast.test.js:34` (update sync→await + add live cases)

**Interfaces:**
- Produces: `adapter.listVoices() → Promise<Voice[]>`, Voice `{ id, name, language, previewUrl:null, traits, model, emotions, gender, genderSource, source }`.

- [ ] **Step 1: Create fixture** (abridged real response — 3 items enough for tests)

```json
// tests/fixtures/typecast-voices.json
[
  { "voice_id": "tc_seed_joonkyu", "voice_name": "Joonkyu", "model": "ssfm-v21", "emotions": ["normal","happy","sad","angry"], "voice_type": "original" },
  { "voice_id": "tc_69fc0cff784968297fb45daa", "voice_name": "Sanghyun", "model": "ssfm-v30", "emotions": ["normal","happy","sad","angry","whisper","toneup","tonedown"], "voice_type": "original" },
  { "voice_id": "tc_69f2e455ea79fd197aa0476f", "voice_name": "Seohyeon", "model": "ssfm-v30", "emotions": ["normal","happy"], "voice_type": "original" }
]
```

Note: keep the real seed id for Joonkyu so seed overlay is testable — set the KNOWN_VOICES Joonkyu id to `tc_seed_joonkyu` in the fixture OR add a fixture item whose id matches an existing KNOWN_VOICES id. (Implementer: align fixture id with one KNOWN_VOICES id.)

- [ ] **Step 2: Write the failing test**

```js
// add to tests/electron/api/tts/typecast.test.js
import fixture from '../../../fixtures/typecast-voices.json'

it('listVoices fetches live list and normalizes', async () => {
  const fetch = async () => ({ ok: true, json: async () => fixture })
  const a = createTypecastAdapter({ getKey: () => 'k', fetch })
  const voices = await a.listVoices()
  expect(voices.length).toBe(fixture.length)
  const s = voices.find((v) => v.id === 'tc_69fc0cff784968297fb45daa')
  expect(s).toMatchObject({ name: 'Sanghyun', language: 'ko', gender: null, source: 'live' })
})

it('listVoices overlays seed gender for known ids', async () => {
  const fetch = async () => ({ ok: true, json: async () => fixture })
  const a = createTypecastAdapter({ getKey: () => 'k', fetch })
  const voices = await a.listVoices()
  const seed = voices.find((v) => v.id === 'tc_seed_joonkyu')
  expect(seed).toMatchObject({ gender: 'male', genderSource: 'seed' })
})

it('listVoices falls back to seeds when no key', async () => {
  const a = createTypecastAdapter({ getKey: () => null, fetch: async () => { throw new Error('nope') } })
  const voices = await a.listVoices()
  expect(voices.length).toBeGreaterThan(0)
  expect(voices.every((v) => v.source === 'seed')).toBe(true)
})
```

Also: update the existing sync test at line 34 `a.listVoices()` → `await a.listVoices()`.

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement** — replace `KNOWN_VOICES` entries to carry `gender/genderSource:'seed'`, and rewrite `listVoices`:

```js
// KNOWN_VOICES: add gender + genderSource:'seed' to each; example:
// { id: 'tc_seed_joonkyu', name: 'Joonkyu', language: 'ko', previewUrl: null, traits: [], gender: 'male', genderSource: 'seed', source: 'seed' },
// (keep the 9 real ids; set correct gender per current traits male/female)

const VOICES_ENDPOINT = 'https://api.typecast.ai/v1/voices'

function normalizeTypecastVoice(v) {
  return {
    id: v.voice_id,
    name: v.voice_name || v.voice_id,
    language: 'ko',
    previewUrl: null,
    traits: [],
    model: v.model,
    emotions: v.emotions || [],
    gender: null,
    genderSource: null,
    source: 'live',
  }
}

// inside createTypecastAdapter:
async listVoices() {
  const key = getKey()
  if (!key) return KNOWN_VOICES.map((v) => ({ ...v }))
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(VOICES_ENDPOINT, { headers: { 'x-api-key': key }, signal: ctrl.signal }).finally(() => clearTimeout(t))
    if (!res.ok) return KNOWN_VOICES.map((v) => ({ ...v }))
    const json = await res.json()
    if (!Array.isArray(json)) return KNOWN_VOICES.map((v) => ({ ...v }))
    const seedById = new Map(KNOWN_VOICES.map((v) => [v.id, v]))
    return json.map((raw) => {
      const nv = normalizeTypecastVoice(raw)
      const seed = seedById.get(nv.id)
      if (seed) return { ...nv, gender: seed.gender, genderSource: 'seed', source: 'seed' }
      return nv
    })
  } catch {
    return KNOWN_VOICES.map((v) => ({ ...v }))
  }
}
```

- [ ] **Step 5: Run** → PASS. Then `npx vitest run tests/electron/api/tts/typecast.test.js`.

- [ ] **Step 6: Commit**

```bash
git add electron/api/tts/typecast.js tests/electron/api/tts/typecast.test.js tests/fixtures/typecast-voices.json
git commit -m "feat(story): Typecast live voice list with seed gender overlay

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Gemini + ElevenLabs gender 필드

**Files:**
- Modify: `electron/api/tts/gemini.js:11-42` (KNOWN_VOICES)
- Modify: `electron/api/tts/elevenlabs.js:40-58` (normalizers)
- Test: `tests/electron/api/tts/gemini.test.js`, `tests/electron/api/tts/elevenlabs.test.js`

**Interfaces:**
- Produces: gemini/elevenlabs voices carry `gender/genderSource:'adapter'` (null for unknowns).

- [ ] **Step 1: Write failing tests**

```js
// gemini.test.js
it('KNOWN_VOICES carry adapter gender; Pulcherrima unknown', () => {
  const a = createGeminiAdapter({ getKey: () => 'k', fetch: async () => ({}) })
  const voices = a.listVoices()
  const kore = voices.find((v) => v.id === 'Kore')
  expect(kore).toMatchObject({ gender: 'female', genderSource: 'adapter' })
  const puck = voices.find((v) => v.id === 'Puck')
  expect(puck).toMatchObject({ gender: 'male', genderSource: 'adapter' })
  const pul = voices.find((v) => v.id === 'Pulcherrima')
  expect(pul.gender).toBeNull()
  expect(pul.genderSource).toBeNull()
})
```

```js
// elevenlabs.test.js — extend normalizer test
it('normalizes account voice gender to structured field', async () => {
  const voice = { voice_id: 'e1', name: 'Rachel', labels: { gender: 'female' } }
  const fetch = async () => ({ ok: true, json: async () => ({ voices: [voice] }) })
  const a = createElevenLabsAdapter({ getKey: () => 'k', fetch })
  const voices = await a.listVoices({ includeShared: false })
  const r = voices.find((v) => v.id === 'e1')
  expect(r).toMatchObject({ gender: 'female', genderSource: 'adapter' })
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**
  - Gemini: each `KNOWN_VOICES` item gets `gender` + `genderSource:'adapter'` per §4.2 list (여13/남16). Pulcherrima → `gender:null, genderSource:null`.
  - ElevenLabs `normalizeAccountVoice`/`normalizeSharedVoice`: add `gender: (labels?.gender || voice.gender || null)?.toLowerCase() ∈ {male,female} ? that : null`, `genderSource: gender ? 'adapter' : null`. Keep traits.

- [ ] **Step 4: Run** → PASS both.

- [ ] **Step 5: Commit**

```bash
git add electron/api/tts/gemini.js electron/api/tts/elevenlabs.js tests/electron/api/tts/gemini.test.js tests/electron/api/tts/elevenlabs.test.js
git commit -m "feat(story): structured gender field for Gemini/ElevenLabs voices

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## SLICE 2 — SSRF-safe fetch + 미리듣기 service + IPC

### Task 6: SSRF-safe fetch (`electron/api/net/ssrfSafeFetch.js`)

**Files:**
- Create: `electron/api/net/ssrfSafeFetch.js`
- Test: `tests/electron/api/net/ssrfSafeFetch.test.js`

**Interfaces:**
- Produces: `isPreviewUrlAllowed(url) → boolean` (pure), `ssrfSafeFetch(url, { fetch, lookup }) → { audio: Buffer, mimeType }` (https-only, allowlist host, manual redirect re-check, private-IP block, 5MB cap, audio/* MIME).

- [ ] **Step 1: Write failing test** (pure guard is the priority)

```js
// tests/electron/api/net/ssrfSafeFetch.test.js
import { describe, it, expect } from 'vitest'
import { isPreviewUrlAllowed } from '../../../../electron/api/net/ssrfSafeFetch.js'

describe('isPreviewUrlAllowed', () => {
  it('allows elevenlabs cdn https', () => {
    expect(isPreviewUrlAllowed('https://storage.googleapis.com/eleven-public-prod/x.mp3')).toBe(true)
    expect(isPreviewUrlAllowed('https://api.elevenlabs.io/v1/voices/x/preview')).toBe(true)
  })
  it('rejects http, non-allowlisted host, and ip literals', () => {
    expect(isPreviewUrlAllowed('http://api.elevenlabs.io/x')).toBe(false)
    expect(isPreviewUrlAllowed('https://evil.example.com/x.mp3')).toBe(false)
    expect(isPreviewUrlAllowed('https://127.0.0.1/x')).toBe(false)
    expect(isPreviewUrlAllowed('https://169.254.169.254/latest')).toBe(false)
  })
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
// electron/api/net/ssrfSafeFetch.js
const ALLOW_HOSTS = [
  'api.elevenlabs.io',
  'storage.googleapis.com', // ElevenLabs public preview CDN
]
const PRIVATE_RE = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i

export function isPreviewUrlAllowed(rawUrl) {
  let u
  try { u = new URL(rawUrl) } catch { return false }
  if (u.protocol !== 'https:') return false
  if (PRIVATE_RE.test(u.hostname)) return false
  return ALLOW_HOSTS.includes(u.hostname)
}

const MAX_BYTES = 5 * 1024 * 1024

export async function ssrfSafeFetch(url, { fetch, timeoutMs = 15000 } = {}) {
  if (!isPreviewUrlAllowed(url)) throw new Error('preview url not allowed')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { redirect: 'manual', signal: ctrl.signal })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc || !isPreviewUrlAllowed(loc)) throw new Error('redirect not allowed')
      return ssrfSafeFetch(loc, { fetch, timeoutMs })
    }
    if (!res.ok) throw new Error(`preview fetch ${res.status}`)
    const mimeType = res.headers.get('content-type') || 'audio/mpeg'
    if (!/^audio\//.test(mimeType)) throw new Error('unexpected content-type')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) throw new Error('preview too large')
    return { audio: buf, mimeType }
  } finally { clearTimeout(t) }
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/api/net/ssrfSafeFetch.js tests/electron/api/net/ssrfSafeFetch.test.js
git commit -m "feat(net): SSRF-safe fetch guard for voice preview urls

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 미리듣기 service (`electron/api/tts/voicePreviewService.js`)

**Files:**
- Create: `electron/api/tts/voicePreviewService.js`
- Test: `tests/electron/api/tts/voicePreviewService.test.js`

**Interfaces:**
- Consumes: `ttsFor(provider) → adapter{ synthesize }`, `voiceMeta(provider, voiceId) → { previewUrl, language }`, `ssrfSafeFetch`, `fs`, `cacheDir`.
- Produces: `createVoicePreviewService(deps) → { getPreview({ provider, voiceId, language }) → { audioBase64, mimeType } | { error } }`.

- [ ] **Step 1: Write failing test**

```js
// tests/electron/api/tts/voicePreviewService.test.js
import { describe, it, expect, vi } from 'vitest'
import { createVoicePreviewService } from '../../../../electron/api/tts/voicePreviewService.js'

function deps(over = {}) {
  const files = {}
  const fs = {
    existsSync: (p) => p in files,
    readFileSync: (p) => files[p],
    writeFileSync: (p, d) => { files[p] = d },
    renameSync: (a, b) => { files[b] = files[a]; delete files[a] },
    mkdirSync: () => {},
  }
  return {
    cacheDir: '/cache',
    fs,
    files,
    ttsFor: () => ({ synthesize: vi.fn(async () => ({ audio: Buffer.from('WAVDATA'), format: 'wav' })) }),
    voiceMeta: () => ({ previewUrl: null, language: 'ko' }),
    ssrfSafeFetch: vi.fn(async () => ({ audio: Buffer.from('MP3'), mimeType: 'audio/mpeg' })),
    ...over,
  }
}

describe('voicePreviewService', () => {
  it('synthesizes Typecast preview and caches to disk', async () => {
    const d = deps()
    const svc = createVoicePreviewService(d)
    const r = await svc.getPreview({ provider: 'typecast', voiceId: 'v1', language: 'ko' })
    expect(r.mimeType).toBe('audio/wav')
    expect(Buffer.from(r.audioBase64, 'base64').toString()).toBe('WAVDATA')
    // second call hits disk cache (synthesize not called again)
    const spy = d.ttsFor().synthesize
    await svc.getPreview({ provider: 'typecast', voiceId: 'v1', language: 'ko' })
    // cached file exists
    expect(Object.keys(d.files).length).toBeGreaterThan(0)
  })
  it('uses ssrfSafeFetch when previewUrl present (elevenlabs)', async () => {
    const d = deps({ voiceMeta: () => ({ previewUrl: 'https://api.elevenlabs.io/x', language: 'en' }) })
    const svc = createVoicePreviewService(d)
    const r = await svc.getPreview({ provider: 'elevenlabs', voiceId: 'e1', language: 'en' })
    expect(d.ssrfSafeFetch).toHaveBeenCalled()
    expect(r.mimeType).toBe('audio/mpeg')
  })
  it('returns error object when no key (synthesize throws no-key)', async () => {
    const d = deps({ ttsFor: () => ({ synthesize: async () => { throw new Error('No Typecast API key') } }) })
    const svc = createVoicePreviewService(d)
    const r = await svc.getPreview({ provider: 'typecast', voiceId: 'v1', language: 'ko' })
    expect(r.error).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
// electron/api/tts/voicePreviewService.js
import nodeFs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const SAMPLE = { ko: '안녕하세요, 반갑습니다.', en: 'Hello, nice to meet you.' }
const EXT = { 'audio/wav': 'wav', 'audio/mpeg': 'mp3' }
const MIME = { wav: 'audio/wav', mp3: 'audio/mpeg' }

export function createVoicePreviewService({ cacheDir, fs = nodeFs, ttsFor, voiceMeta, ssrfSafeFetch, fetch }) {
  const inflight = new Map()

  function cachePath(provider, voiceId, language, ext) {
    const h = crypto.createHash('sha256').update(`${provider}:${voiceId}:${language}`).digest('hex')
    return path.join(cacheDir, `${h}.${ext}`)
  }

  async function produce({ provider, voiceId, language }) {
    const meta = voiceMeta(provider, voiceId) || {}
    const lang = language || meta.language || 'ko'
    // 1) disk cache (both ext)
    for (const ext of ['wav', 'mp3']) {
      const p = cachePath(provider, voiceId, lang, ext)
      if (fs.existsSync(p)) return { audioBase64: fs.readFileSync(p).toString('base64'), mimeType: MIME[ext] }
    }
    // 2) elevenlabs preview_url
    let audio, mimeType
    if (provider === 'elevenlabs' && meta.previewUrl) {
      const r = await ssrfSafeFetch(meta.previewUrl, { fetch })
      audio = r.audio; mimeType = r.mimeType
    } else {
      const r = await ttsFor(provider).synthesize({ text: SAMPLE[lang] || SAMPLE.ko, voiceId, emotion: 'normal' })
      audio = r.audio; mimeType = MIME[r.format] || 'audio/wav'
    }
    // 3) atomic write cache
    const ext = EXT[mimeType] || 'wav'
    const p = cachePath(provider, voiceId, lang, ext)
    try {
      fs.mkdirSync(cacheDir, { recursive: true })
      const tmp = p + '.tmp'
      fs.writeFileSync(tmp, audio)
      fs.renameSync(tmp, p)
    } catch { /* best-effort */ }
    return { audioBase64: audio.toString('base64'), mimeType }
  }

  async function getPreview({ provider, voiceId, language }) {
    const key = `${provider}:${voiceId}:${language}`
    if (inflight.has(key)) return inflight.get(key)
    const promise = produce({ provider, voiceId, language })
      .catch((e) => {
        const msg = String(e?.message || e)
        const error = /no .* key|No .* API key/i.test(msg) ? 'no-key' : /401|unauth/i.test(msg) ? 'unauthorized' : 'failed'
        return { error, provider }
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, promise)
    return promise
  }

  return { getPreview }
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/api/tts/voicePreviewService.js tests/electron/api/tts/voicePreviewService.test.js
git commit -m "feat(story): main-side voice preview service (cache, dedupe, ssrf, errors)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: IPC + main 배선 (listVoices overlay, voiceMetaCache, preview/tag)

**Files:**
- Modify: `electron/ipc/tts-api.js` (add `tts:preview-voice`, `tts:tag-voice-gender`; accept new deps)
- Modify: `electron/main.js:224-242` (overlay wrapper, voiceMetaCache, service, cache, pass to registerTtsIPC)
- Modify: `electron/preload.js:115` (add `ttsPreviewVoice`, `ttsTagVoiceGender`)
- Test: `tests/electron/ipc/tts-api.test.js` (extend)

**Interfaces:**
- Consumes: `previewVoice({provider, voiceId, language})`, `tagVoiceGender({provider, voiceId, gender, f0, confidence, source})` injected into `registerTtsIPC`.
- Produces: renderer `window.electronAPI.ttsPreviewVoice(params)`, `ttsTagVoiceGender(params)`.

- [ ] **Step 1: Write failing test** (IPC handler wiring + input validation)

```js
// extend tests/electron/ipc/tts-api.test.js
it('tts:preview-voice validates provider and delegates', async () => {
  const handlers = {}
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn } }
  const previewVoice = vi.fn(async () => ({ audioBase64: 'AAA', mimeType: 'audio/wav' }))
  registerTtsIPC(ipcMain, { keyStore: stubKeyStore, safeStorage: {}, listVoices: async () => [], previewVoice, tagVoiceGender: vi.fn() })
  const ok = await handlers['tts:preview-voice']({}, { provider: 'typecast', voiceId: 'v1', language: 'ko' })
  expect(ok.audioBase64).toBe('AAA')
  const bad = await handlers['tts:preview-voice']({}, { provider: 'evil', voiceId: 'v1' })
  expect(bad.error).toBeTruthy()
  expect(previewVoice).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**
  - `tts-api.js registerTtsIPC(..., { previewVoice, tagVoiceGender })`:

```js
import { STORY_TTS_PROVIDERS } from '../../src/config/storyTtsProviders.js'
// ...
ipcMain.handle('tts:preview-voice', async (_e, payload) => {
  const p = payload || {}
  if (!STORY_TTS_PROVIDERS.includes(p.provider)) return { error: 'bad-provider' }
  if (!p.voiceId || typeof p.voiceId !== 'string' || p.voiceId.length > 128) return { error: 'bad-voice' }
  const language = p.language === 'en' ? 'en' : 'ko'
  return previewVoice({ provider: p.provider, voiceId: p.voiceId, language })
})
ipcMain.handle('tts:tag-voice-gender', async (_e, payload) => {
  const p = payload || {}
  if (!STORY_TTS_PROVIDERS.includes(p.provider)) return { ok: false }
  if (!['male', 'female'].includes(p.gender)) return { ok: false }
  if (!['f0', 'manual'].includes(p.source)) return { ok: false }
  tagVoiceGender({ provider: p.provider, voiceId: p.voiceId, gender: p.gender, f0: p.f0 ?? null, confidence: p.confidence ?? null, source: p.source })
  return { ok: true }
})
```

  - `main.js`: build cache + service + overlay wrapper:

```js
import { app } from 'electron'
import { createVoiceGenderCache } from './api/tts/voiceGenderCache.js'
import { applyGenderOverlay } from './api/tts/genderOverlay.js'
import { createVoicePreviewService } from './api/tts/voicePreviewService.js'
import { ssrfSafeFetch } from './api/net/ssrfSafeFetch.js'
import path from 'node:path'

const genderCache = createVoiceGenderCache({ filePath: path.join(app.getPath('userData'), 'voice-gender.json') })
const voiceMetaCache = new Map() // 'provider:voiceId' -> { previewUrl, language }

const previewService = createVoicePreviewService({
  cacheDir: path.join(app.getPath('userData'), 'voice-preview'),
  ttsFor,
  voiceMeta: (provider, voiceId) => voiceMetaCache.get(`${provider}:${voiceId}`) || {},
  ssrfSafeFetch,
  fetch: globalThis.fetch,
})

// replace existing listVoices dep:
listVoices: async (provider, options) => {
  let raw
  try { raw = await ttsFor(provider).listVoices(options) } catch { return [] }
  // fill voiceMetaCache
  for (const v of raw) voiceMetaCache.set(`${provider}:${v.id}`, { previewUrl: v.previewUrl || null, language: v.language || 'ko' })
  try { return applyGenderOverlay(provider, raw, genderCache.get()) } catch { return raw }
},
previewVoice: (args) => previewService.getPreview(args),
tagVoiceGender: (args) => genderCache.tag(args),
```

  - `preload.js`: `ttsPreviewVoice: (p) => ipcRenderer.invoke('tts:preview-voice', p)`, `ttsTagVoiceGender: (p) => ipcRenderer.invoke('tts:tag-voice-gender', p)`.

- [ ] **Step 4: Run** → PASS. Then `npm run test:run` on tts-api.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/tts-api.js electron/main.js electron/preload.js tests/electron/ipc/tts-api.test.js
git commit -m "feat(story): wire voice preview + gender tag IPC with overlay in main

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## SLICE 3 — Renderer: hook + VoicePicker

### Task 9: useVoicePreview hook (`src/hooks/useVoicePreview.js`)

**Files:**
- Create: `src/hooks/useVoicePreview.js`
- Test: `tests/hooks/useVoicePreview.test.js`

**Interfaces:**
- Produces: `useVoicePreview() → { play(voice) → Promise<void>, state: { voiceId, status:'idle'|'loading'|'playing'|'error' }, lastGender: { voiceId, gender, f0, confidence } | null }`.
- `play` calls `window.electronAPI.ttsPreviewVoice`, plays audio, and for non-fixed voices runs `estimateGenderFromPcm` (via AudioContext.decodeAudioData) → sets `lastGender`. Uses seq counter for stale-drop.

- [ ] **Step 1: Write failing test** (mock electronAPI + Audio + AudioContext)

```js
// tests/hooks/useVoicePreview.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useVoicePreview } from '../../src/hooks/useVoicePreview.js'

beforeEach(() => {
  globalThis.window = globalThis.window || {}
  window.electronAPI = { ttsPreviewVoice: vi.fn(async () => ({ audioBase64: btoa('x'), mimeType: 'audio/wav' })), ttsTagVoiceGender: vi.fn() }
  globalThis.Audio = class { play() { return Promise.resolve() } pause() {} set onended(fn) { this._e = fn } get onended() { return this._e } }
  globalThis.AudioContext = class { decodeAudioData() { const ch = new Float32Array(16000); return Promise.resolve({ numberOfChannels: 1, sampleRate: 16000, getChannelData: () => ch }) } close() {} }
})

it('play sets loading then playing', async () => {
  const { result } = renderHook(() => useVoicePreview())
  await act(async () => { result.current.play({ provider: 'typecast', voiceId: 'v1', language: 'ko', genderSource: null }) })
  await waitFor(() => expect(['playing', 'idle']).toContain(result.current.state.status))
  expect(window.electronAPI.ttsPreviewVoice).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** (core logic; implementer wires refs)

```js
// src/hooks/useVoicePreview.js
import { useState, useRef, useCallback } from 'react'
import { estimateGenderFromPcm } from '../utils/voiceGender.js'

export function useVoicePreview() {
  const [state, setState] = useState({ voiceId: null, status: 'idle' })
  const [lastGender, setLastGender] = useState(null)
  const seqRef = useRef(0)
  const audioRef = useRef(null)
  const ctxRef = useRef(null)

  const play = useCallback(async (voice) => {
    const seq = ++seqRef.current
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    setState({ voiceId: voice.voiceId, status: 'loading' })
    let res
    try {
      res = await window.electronAPI.ttsPreviewVoice({ provider: voice.provider, voiceId: voice.voiceId, language: voice.language || 'ko' })
    } catch { if (seq === seqRef.current) setState({ voiceId: voice.voiceId, status: 'error' }); return }
    if (seq !== seqRef.current) return // stale
    if (!res || res.error) { setState({ voiceId: voice.voiceId, status: 'error' }); return }

    const bytes = Uint8Array.from(atob(res.audioBase64), (c) => c.charCodeAt(0))
    const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: res.mimeType })))
    audioRef.current = audio
    audio.onended = () => { if (seq === seqRef.current) setState({ voiceId: voice.voiceId, status: 'idle' }) }
    setState({ voiceId: voice.voiceId, status: 'playing' })
    audio.play().catch(() => {})

    // F0 gender only for non-fixed voices
    if (voice.genderSource !== 'adapter' && voice.genderSource !== 'seed') {
      try {
        if (!ctxRef.current) ctxRef.current = new AudioContext()
        const buf = await ctxRef.current.decodeAudioData(bytes.buffer.slice(0))
        const ch = buf.getChannelData(0)
        const g = estimateGenderFromPcm(ch, buf.sampleRate)
        if (seq === seqRef.current && g.gender) {
          setLastGender({ voiceId: voice.voiceId, ...g })
          window.electronAPI.ttsTagVoiceGender?.({ provider: voice.provider, voiceId: voice.voiceId, gender: g.gender, f0: g.f0, confidence: g.confidence, source: 'f0' })
        }
      } catch { /* decode failed — skip tagging */ }
    }
  }, [])

  return { play, state, lastGender }
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useVoicePreview.js tests/hooks/useVoicePreview.test.js
git commit -m "feat(story): useVoicePreview hook (playback + F0 tagging + stale-drop)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: VoicePicker 컴포넌트 (`src/components/story/VoicePicker.jsx`)

**Files:**
- Create: `src/components/story/VoicePicker.jsx`, `src/components/story/VoicePicker.css`
- Modify: `src/locales/{ko,en}.js` (`story.voicePicker.*`)
- Test: `tests/components/story/VoicePicker.test.jsx`

**Interfaces:**
- Consumes: `voices[]`, `selected:{provider,voiceId}`, `onSelect({provider,voiceId})`, `onPreview(voice)`, `onOverrideGender({provider,voiceId,gender})`, `previewState`, `t`, `isKo`.
- Produces: modal with provider chips, gender segment, search, render-capped grid, default card, per-card preview button + gender label + manual override.

- [ ] **Step 1: Write failing test**

```jsx
// tests/components/story/VoicePicker.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VoicePicker from '../../../src/components/story/VoicePicker.jsx'

const t = (k, d) => d || k
const voices = [
  { provider: 'gemini', id: 'Kore', name: 'Kore', gender: 'female', genderSource: 'adapter', language: 'multi', traits: ['firm'] },
  { provider: 'typecast', id: 'v1', name: 'Sanghyun', gender: null, genderSource: null, language: 'ko', traits: [] },
]

it('filters by gender segment', () => {
  render(<VoicePicker voices={voices} selected={{}} onSelect={vi.fn()} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} t={t} isKo />)
  fireEvent.click(screen.getByRole('button', { name: /여성|female/i }))
  expect(screen.getByText('Kore')).toBeInTheDocument()
  expect(screen.queryByText('Sanghyun')).not.toBeInTheDocument()
})

it('calls onSelect with provider+voiceId on card click', () => {
  const onSelect = vi.fn()
  render(<VoicePicker voices={voices} selected={{}} onSelect={onSelect} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} t={t} isKo />)
  fireEvent.click(screen.getByText('Kore'))
  expect(onSelect).toHaveBeenCalledWith({ provider: 'gemini', voiceId: 'Kore' })
})

it('calls onPreview when play clicked', () => {
  const onPreview = vi.fn()
  render(<VoicePicker voices={voices} selected={{}} onSelect={vi.fn()} onPreview={onPreview} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} t={t} isKo />)
  fireEvent.click(screen.getAllByRole('button', { name: /preview|미리듣기/i })[0])
  expect(onPreview).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — build the component modeled on the approved mockup (`scratchpad/voice-picker-mockup.html`) and StylePicker.jsx. Structure: provider chips, gender `<button>` segment (전체/여성/남성), search input, grid capped at `RENDER_CAP=120` with "더 보기", a leading [기본 성우] card (`onSelect({provider:selected.provider||'typecast', voiceId:''})`), per-voice card with preview `<button aria-label="미리듣기">`, gender label (♀/♂/— using `gender`), traits, provider badge; manual override menu shown only when `genderSource` ∈ {null,'f0','manual'}. Wire CSS from mockup palette (`#a855f7` accent, gender colors `#f472b6`/`#38bdf8`).

- [ ] **Step 4: Run** → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/story/VoicePicker.jsx src/components/story/VoicePicker.css src/locales/ko.js src/locales/en.js tests/components/story/VoicePicker.test.jsx
git commit -m "feat(story): VoicePicker modal card component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## SLICE 4 — 통합 (StoryView + App)

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

### Task 12: 전체 회귀 + i18n + 문서

**Files:**
- Modify: `src/locales/{ko,en}.js` (ensure all `story.voicePicker.*` keys present ko+en)
- Verify: `npm run test:run` 전체 green

- [ ] **Step 1:** Run `npm run test:run` — 전체 스위트 통과 확인 (기존 4305+ pass + 신규).
- [ ] **Step 2:** i18n 키 누락 스캔: VoicePicker에서 쓰는 모든 `t('story.voicePicker.X')`가 ko+en에 존재하는지 확인.
- [ ] **Step 3:** ElevenLabs 키 권한 안내: spec §4.8을 README 또는 설정 UI 툴팁에 반영(코드 변경 없음, 문서만).
- [ ] **Step 4: Commit**

```bash
git add src/locales/ko.js src/locales/en.js
git commit -m "chore(story): voice picker i18n keys + ElevenLabs voices_read note

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review 결과 (spec 커버리지)

- §4.1 Typecast 라이브 → Task 4 ✅ · §4.1b shape → Task 4/5 ✅
- §4.2 Gemini/EL gender → Task 5 ✅
- §4.3 preview service/IPC/SSRF/캐시/error/stale → Task 6,7,8,9 ✅
- §4.4 F0(estimateGenderFromPcm, 스코프, AudioContext) → Task 1,9 ✅
- §4.5 voiceGenderCache + overlay + tag IPC → Task 2,3,8 ✅
- §4.6 VoicePicker(필터/render cap/기본카드/error/override) → Task 10 ✅
- §4.7 StoryView 통합 + App sync → Task 11 ✅
- §4.8 EL 키 권한(문서) → Task 12 ✅
- §5 TDD 슬라이스 순서 = Slice 1~5 ✅ (통합 커밋으로 옛 드롭다운 대량 렌더 회피 — Task 11에서 교체)

## Codex 코드 리뷰 게이트

각 슬라이스 완료 후 `mcp__codex__codex`(model gpt-5.5, reasoning xhigh)로 코드 리뷰 → findings 0까지 loop. 특히 Slice 2(SSRF/service) Slice 3(hook stale/AudioContext leak) 집중.
