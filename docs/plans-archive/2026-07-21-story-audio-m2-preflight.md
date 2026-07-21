# Story Audio Pre-flight (M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 오디오 생성이 요구하는 provider 키가 실제로 해석되는지(폴백 포함) main에서 판정하는 pre-flight를 만든다 — 합성될 세그먼트의 required-provider 집합을 계산하고(reuse/import/SFX 반영), 런타임과 동일한 resolver로 `{key,source}`를 판정해 IPC로 반환.

**Architecture:** stepMachine의 오디오 세그먼트 선별 헬퍼(`canReuse`/`canReuseSfx`/`sfxSourceOf`)를 audio 함수 밖(machine 스코프)으로 hoist해 `audio`와 새 `audioPreflight`가 **같은 로직을 공유**(single source). `audioPreflight`는 합성 없이 required providers만 낸다. keyResolvers를 `{key,source}` 반환으로 확장. `story:audio-preflight` IPC가 둘을 엮는다.

**Tech Stack:** Electron main(ESM), vitest. M1 산출물(`electron/api/keyErrors.js`, `src/config/apiKeyRegistry.js`, `electron/main/keyResolvers.js`) 위에 쌓는다.

## Global Constraints

- TDD 필수. 러너 `npx vitest run <path>`, 전체 `npm run test:run`.
- 커밋 메시지 영어. 브랜치 `feature/story-audio-apikey-gate`.
- ESM. spec: `docs/plans/2026-07-20-story-audio-apikey-gate-design.md` §4.1/4.2/4.3/4.4.
- **동작 불변 회귀 게이트**: stepMachine 오디오 경로를 건드리는 태스크는 기존 `tests/electron/story/stepMachine.audio.test.js`(및 관련)가 전부 그린이어야 한다. 오디오는 핵심 경로 — 선별/reuse/합성 결과가 바뀌면 안 된다.
- pre-existing `VideoDetailModal` async-race 2 errors는 무관.

## Global Interfaces (M1 산출물 — 그대로 사용)

- `keyIdForProvider(storyProvider) → keyId` ('gemini'→'genai'), `API_KEY_REGISTRY` (src/config/apiKeyRegistry.js).
- `buildKeyResolvers({ multiKeyStore, genaiKeyStore, getTypecastKey, readCredentialsKey, disableFallback }) → { ttsKeyFor, sfxKeyFor }` (nullable). (electron/main/keyResolvers.js)

---

## File Structure

- `electron/story/stepMachine.js` (수정) — `canReuse`/`canReuseSfx`/`sfxSourceOf`/`sfxKeyOf`/`reusePathOf`를 `audio()` 밖 machine 스코프로 hoist(params/stat 인자화), 새 `audioPreflight(params)` 메서드 추가. `audio()`는 hoist된 헬퍼를 호출(동작 불변).
- `electron/main/keyResolvers.js` (수정) — `resolveKeyWithSource(keyId) → {key, source}` 추가.
- `electron/ipc/story-api.js` (수정) — `story:audio-preflight` IPC handler.
- Tests: `tests/electron/story/audioPreflight.test.js`, `tests/electron/main/resolveKeyWithSource.test.js`, `tests/electron/ipc/audioPreflightIpc.test.js`.

---

### Task 1: stepMachine 선별 헬퍼 hoist + audioPreflight 메서드

이 태스크는 **동작 불변 리팩터 + 신규 메서드**다. audio 함수의 지역 헬퍼를 machine 스코프로 올려 `audio`와 `audioPreflight`가 공유한다.

**Files:**
- Modify: `electron/story/stepMachine.js`
- Test: `tests/electron/story/audioPreflight.test.js`

**Interfaces:**
- Produces: machine 인스턴스에 `audioPreflight(params) → Promise<string[]>` (required storyProvider 목록, 중복 제거). 규칙:
  - narration 세그먼트: `voice = findSpeakerByRef(speakers, seg.speaker)?.voice || defaultVoice || null`. `voice` 없으면 skip(미배정은 별도 검증). `voice.provider === 'import'` skip. reuse(`canReuse(seg)`) skip(mode!=='segmentTest'). 그 외 `voice.provider || 'typecast'` 추가.
  - sfx 세그먼트: `source = sfxSourceOf(seg)`; `'library'` skip; reuse(`canReuseSfx(seg)`) skip; 그 외 `source` 추가.
  - `params.mode === 'segmentTest'`이면 `params.segmentIds`만 대상, reuse 미적용.
  - `params.speakers || state.speakers`, `defaultVoice`(주입) 사용.

- [ ] **Step 1: Study the current audio() selection logic**

Read `electron/story/stepMachine.js` around: `ttsVoiceKey`(:210), `sfxSourceOf`/`sfxKeyOf`/`reusePathOf`/`canReuse`/`canReuseSfx`(:1572-1588), the narration/sfx selection (:1668-1724), `voiceOf`(:1357), `findSpeakerByRef`(:419). Note which locals depend on `params`, `forceRegen`, `stat`, `segmentsDir`, `voiceOf`.

- [ ] **Step 2: Write the failing test for audioPreflight**

```js
// tests/electron/story/audioPreflight.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

// Minimal harness: a stepMachine with an in-memory store returning a scenes.json.
// Follow the SAME construction the existing stepMachine.audio.test.js uses (copy its
// store/deps mock shape) — reuse that harness so audioPreflight sees the same wiring.
function makeMachine(scenes, { speakers = [], defaultVoice = null } = {}) {
  // Build store.loadText('scenes.json') => JSON.stringify({ scenes })
  // and inject stat that resolves files as absent (nothing reusable) unless noted.
  // (Mirror tests/electron/story/stepMachine.audio.test.js setup.)
}

describe('audioPreflight — required providers', () => {
  it('narration with assigned gemini voice + typecast default → both when unassigned exists', async () => {
    const scenes = [{ segments: [
      { id: 's1', type: 'narration', speaker: 'A', text: 'hi' },
      { id: 's2', type: 'narration', speaker: 'B', text: 'yo' },
    ] }]
    const m = makeMachine(scenes, {
      speakers: [{ id: 'A', voice: { provider: 'gemini', voiceId: 'Kore' } }],
      defaultVoice: { provider: 'typecast', voiceId: 'tc_x' },
    })
    const providers = await m.audioPreflight({})
    expect(new Set(providers)).toEqual(new Set(['gemini', 'typecast'])) // B unassigned → default typecast
  })

  it('import-voice speaker is excluded (no key needed)', async () => {
    const scenes = [{ segments: [{ id: 's1', type: 'narration', speaker: 'A', text: 'hi' }] }]
    const m = makeMachine(scenes, { speakers: [{ id: 'A', voice: { provider: 'import', mp3Path: '/a.mp3', srtPath: '/a.srt' } }] })
    expect(await m.audioPreflight({})).toEqual([])
  })

  it('sfx segment contributes its source; library excluded', async () => {
    const scenes = [{ segments: [
      { id: 'f1', type: 'sfx', description: 'boom', sourceMode: 'elevenlabs' },
      { id: 'f2', type: 'sfx', description: 'wind', sourceMode: 'library' },
    ] }]
    const m = makeMachine(scenes, {})
    expect(await m.audioPreflight({})).toEqual(['elevenlabs'])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/electron/story/audioPreflight.test.js`
Expected: FAIL — `audioPreflight` is not a function.

- [ ] **Step 4: Hoist selection helpers to machine scope**

In `stepMachine.js`, move `reusePathOf`, `canReuse`, `canReuseSfx`, `sfxSourceOf`, `sfxKeyOf` out of `audio()` up to the machine scope (near `ttsVoiceKey`:210). Parameterize what was closed over: make them take `(seg, ctx)` where `ctx = { params, forceRegen, segmentsDir, voiceOf }` OR bind them inside a small `makeSelection(params)` factory that both `audio()` and `audioPreflight()` call. Keep `audio()`'s behavior byte-for-byte identical — it now calls the shared helpers instead of its inline versions.

Concretely, add a machine-scope helper:
```js
// segmentsDir/forceRegen/voiceOf derived from params; returns the selection predicates
function makeAudioSelection(params, speakers, defaultVoiceCfg) {
  const forceRegen = new Set(params.regenerate || [])
  const segmentsDir = path.join(projectPath, 'story', 'audio', 'segments')
  const reusePathOf = (seg) => path.join(segmentsDir, path.basename(seg.audioPath))
  const voiceOf = (spk) => findSpeakerByRef(speakers, spk)?.voice || defaultVoiceCfg || null
  const canReuse = async (seg) => { /* exact current body from :1573-1580 */ }
  const canReuseSfx = async (seg) => { /* exact current body from :1584-1588 */ }
  const sfxSourceOf = (seg) => params.sfxSources?.[seg.id] || seg.sourceMode || 'elevenlabs'
  const sfxKeyOf = (seg) => `${sfxSourceOf(seg)}:${seg.description || ''}:${seg.durationHint ?? 'auto'}`
  return { forceRegen, segmentsDir, reusePathOf, voiceOf, canReuse, canReuseSfx, sfxSourceOf, sfxKeyOf }
}
```
Then `audio()` builds `const sel = makeAudioSelection(params, speakers, defaultVoiceCfg)` and uses `sel.canReuse` etc. in place of its inline locals.

- [ ] **Step 5: Implement audioPreflight using the shared selection**

```js
async audioPreflight(params = {}) {
  const scenesJson = JSON.parse((await store.loadText('scenes.json')) || 'null')
  if (!scenesJson) return []
  const speakers = params.speakers || state.speakers || []
  const sel = makeAudioSelection(params, speakers, defaultVoice || null)
  const segments = scenesJson.scenes.flatMap((sc) => sc.segments || [])
  const isTest = params.mode === 'segmentTest'
  const ids = isTest ? new Set(params.segmentIds || []) : null
  const required = new Set()
  for (const seg of segments) {
    const type = seg.type || 'narration'
    if (isTest && !ids.has(seg.id)) continue
    if (type === 'sfx') {
      const source = sel.sfxSourceOf(seg)
      if (source === 'library') continue
      if (!isTest && await sel.canReuseSfx(seg)) continue
      required.add(source)
    } else {
      const voice = sel.voiceOf(seg.speaker)
      if (!voice || voice.provider === 'import') continue
      if (!isTest && await sel.canReuse(seg)) continue
      required.add(voice.provider || 'typecast')
    }
  }
  return [...required]
}
```
Add `audioPreflight` to the machine's returned object (next to `start`/step methods).

- [ ] **Step 6: Run new test + full regression**

Run: `npx vitest run tests/electron/story/audioPreflight.test.js` → PASS.
Run: `npx vitest run tests/electron/story/` → the existing `stepMachine.audio.test.js` MUST stay green (behavior unchanged by the hoist).
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add electron/story/stepMachine.js tests/electron/story/audioPreflight.test.js
git commit -m "stepMachine: hoist audio selection helpers + add audioPreflight (required providers)"
```

---

### Task 2: resolveKeyWithSource in keyResolvers

**Files:**
- Modify: `electron/main/keyResolvers.js`
- Test: `tests/electron/main/resolveKeyWithSource.test.js`

**Interfaces:**
- Consumes: same deps as `buildKeyResolvers`.
- Produces: `buildKeyResolvers(...)` additionally returns `resolveKeyWithSource(keyId) → { key: string|null, source: 'store'|'fallback'|null }`. `keyId ∈ {typecast, elevenlabs, googletts, genai}`. store hit(`multiKeyStore.getKey(keyId)` truthy, or genai→`genaiKeyStore.getKey()`) → `{key, source:'store'}`; else fallback loader hit → `{key, source:'fallback'}`; else `{key:null, source:null}`. Honors `disableFallback`.

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/main/resolveKeyWithSource.test.js
import { describe, it, expect } from 'vitest'
import { buildKeyResolvers } from '../../../electron/main/keyResolvers.js'

const store = (map) => ({ getKey: (p) => map[p] ?? null })

describe('resolveKeyWithSource', () => {
  it('store hit → source store', () => {
    const { resolveKeyWithSource } = buildKeyResolvers({
      multiKeyStore: store({ typecast: 'k' }), genaiKeyStore: store({}),
      getTypecastKey: () => 'env', readCredentialsKey: () => null, disableFallback: false,
    })
    expect(resolveKeyWithSource('typecast')).toEqual({ key: 'k', source: 'store' })
  })
  it('fallback hit → source fallback', () => {
    const { resolveKeyWithSource } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({}),
      getTypecastKey: () => 'env', readCredentialsKey: () => null, disableFallback: false,
    })
    expect(resolveKeyWithSource('typecast')).toEqual({ key: 'env', source: 'fallback' })
  })
  it('missing → null/null', () => {
    const { resolveKeyWithSource } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({}),
      getTypecastKey: () => { throw new Error('none') }, readCredentialsKey: () => null, disableFallback: false,
    })
    expect(resolveKeyWithSource('typecast')).toEqual({ key: null, source: null })
  })
  it('genai resolves from genaiKeyStore as store', () => {
    const { resolveKeyWithSource } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: { getKey: () => 'g' },
      getTypecastKey: () => null, readCredentialsKey: () => null, disableFallback: false,
    })
    expect(resolveKeyWithSource('genai')).toEqual({ key: 'g', source: 'store' })
  })
  it('disableFallback: fallback ignored → null', () => {
    const { resolveKeyWithSource } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({}),
      getTypecastKey: () => 'env', readCredentialsKey: () => 'cred', disableFallback: true,
    })
    expect(resolveKeyWithSource('typecast')).toEqual({ key: null, source: null })
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/electron/main/resolveKeyWithSource.test.js`
Expected: FAIL — `resolveKeyWithSource` undefined.

- [ ] **Step 3: Implement**

Add to `buildKeyResolvers` (before `return`):
```js
  const STORE_KEY = { typecast: 'typecast', elevenlabs: 'elevenlabs', googletts: 'googletts' }
  const FALLBACK = {
    typecast: typecastFallback,
    elevenlabs: () => credFallback('elevenlabs', 'ELEVENLABS_API_KEY'),
    googletts: () => credFallback('googletts', 'GOOGLE_TTS_API_KEY'),
  }
  function resolveKeyWithSource(keyId) {
    if (keyId === 'genai') {
      const k = genaiKeyStore.getKey() ?? null
      return k ? { key: k, source: 'store' } : { key: null, source: null }
    }
    const storeId = STORE_KEY[keyId]
    const stored = storeId ? (multiKeyStore.getKey(storeId) || null) : null
    if (stored) return { key: stored, source: 'store' }
    const fb = FALLBACK[keyId] ? FALLBACK[keyId]() : null
    return fb ? { key: fb, source: 'fallback' } : { key: null, source: null }
  }
```
Add `resolveKeyWithSource` to the returned object.

- [ ] **Step 4: Run + commit**

Run: `npx vitest run tests/electron/main/resolveKeyWithSource.test.js` → PASS (5).
Run: `npx vitest run tests/electron/main/keyResolvers.test.js` → still PASS.
```bash
git add electron/main/keyResolvers.js tests/electron/main/resolveKeyWithSource.test.js
git commit -m "keyResolvers: add resolveKeyWithSource returning {key, source}"
```

---

### Task 3: story:audio-preflight IPC

**Files:**
- Modify: `electron/ipc/story-api.js` (register handler), `electron/main.js` (pass `resolveKeyWithSource` + `safeStorage` into registerStoryIPC if not already available)
- Test: `tests/electron/ipc/audioPreflightIpc.test.js`

**Interfaces:**
- Consumes: `machine.audioPreflight` (Task 1), `resolveKeyWithSource` (Task 2), `keyIdForProvider` (M1 registry), `safeStorage.isEncryptionAvailable`.
- Produces: IPC `story:audio-preflight` handler `(params) → { providers: [{ provider, keyId, status: 'resolved-store'|'resolved-fallback'|'missing', encryptionAvailable }], encryptionAvailable }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/ipc/audioPreflightIpc.test.js
import { describe, it, expect } from 'vitest'
import { buildAudioPreflightResult } from '../../../electron/ipc/story-api.js'

describe('buildAudioPreflightResult', () => {
  const reg = (keyId, status) => ({ keyId, status })
  it('maps providers to keyId + status via resolveKeyWithSource', () => {
    const resolveKeyWithSource = (keyId) => ({
      genai: { key: 'g', source: 'store' },
      typecast: { key: 'e', source: 'fallback' },
      elevenlabs: { key: null, source: null },
    }[keyId])
    const res = buildAudioPreflightResult(['gemini', 'typecast', 'elevenlabs'], {
      resolveKeyWithSource, encryptionAvailable: true,
    })
    expect(res.providers).toEqual([
      { provider: 'gemini', keyId: 'genai', status: 'resolved-store', encryptionAvailable: true },
      { provider: 'typecast', keyId: 'typecast', status: 'resolved-fallback', encryptionAvailable: true },
      { provider: 'elevenlabs', keyId: 'elevenlabs', status: 'missing', encryptionAvailable: true },
    ])
    expect(res.encryptionAvailable).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/electron/ipc/audioPreflightIpc.test.js`
Expected: FAIL — `buildAudioPreflightResult` not exported.

- [ ] **Step 3: Implement pure result builder + handler**

Export a pure helper from `story-api.js` (top-level, testable):
```js
import { keyIdForProvider } from '../../src/config/apiKeyRegistry.js'

export function buildAudioPreflightResult(requiredProviders, { resolveKeyWithSource, encryptionAvailable }) {
  const providers = requiredProviders.map((provider) => {
    const keyId = keyIdForProvider(provider)
    const { source } = resolveKeyWithSource(keyId)
    const status = source === 'store' ? 'resolved-store' : source === 'fallback' ? 'resolved-fallback' : 'missing'
    return { provider, keyId, status, encryptionAvailable }
  })
  return { providers, encryptionAvailable }
}
```
Register the handler inside `registerStoryIPC` (where the machine + deps are in scope). Add `resolveKeyWithSource` and `safeStorage` to the deps destructured by `registerStoryIPC`, and wire them from `main.js` (they already exist there from Task 2 / existing safeStorage):
```js
ipcMain.handle('story:audio-preflight', async (_e, params) => {
  const required = await machine.audioPreflight(params || {})
  const encryptionAvailable = safeStorage?.isEncryptionAvailable?.() ?? false
  return buildAudioPreflightResult(required, { resolveKeyWithSource, encryptionAvailable })
})
```
Verify `machine` is the object Task 1 added `audioPreflight` to. Verify `registerStoryIPC`'s existing signature and add the two deps without breaking current callers (main.js call site).

- [ ] **Step 4: Run + full suite + commit**

Run: `npx vitest run tests/electron/ipc/audioPreflightIpc.test.js` → PASS.
Run: `npm run test:run` → all green (VideoDetailModal 2 errors unrelated).
```bash
git add electron/ipc/story-api.js electron/main.js tests/electron/ipc/audioPreflightIpc.test.js
git commit -m "Add story:audio-preflight IPC (required providers -> per-provider key status)"
```

---

## Self-Review

**Spec coverage (M2):**
- §4.2 required-provider 계산(narration voiceOf/import 제외/null→typecast, sfx source/library 제외, reuse 제외, segmentTest 순수) → Task 1 ✓
- §4.2 single source(audio·audioPreflight 공유 헬퍼) → Task 1 makeAudioSelection ✓
- §4.1 resolver {key,source}, 폴백 포함, dev 스위치 → Task 2 ✓
- §4.1/§4.3 per-provider status + keyId 별칭 → Task 3 ✓
- (M3 범위 — runAudioWithPreflight/ApiKeyField/설정/미리듣기·main 재검사 배치 — 없음. 다음.)

**주의(구현 중):** Task 1의 hoist는 동작 불변이 절대 조건 — 기존 stepMachine.audio 테스트가 그린이어야 하고, `audio()`가 hoist된 헬퍼를 쓰도록 바뀌었는지 확인. `regenerate`는 부분 스코프가 아님(forceRegen만) — audioPreflight는 full-set 계산에 forceRegen만 reuse 제외에 반영(스펙 R1). registerStoryIPC 시그니처 변경 시 main.js 호출부 동기화.

**Type consistency:** `audioPreflight(params)→string[]`, `resolveKeyWithSource(keyId)→{key,source}`, `buildAudioPreflightResult(providers,{resolveKeyWithSource,encryptionAvailable})→{providers,encryptionAvailable}`, status 리터럴 `resolved-store|resolved-fallback|missing`. Task 간 일치.
