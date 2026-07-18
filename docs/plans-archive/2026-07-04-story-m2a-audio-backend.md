# Story M2a-1 — 오디오 백엔드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ffmpeg 없이 세그먼트별 TTS를 생성·실측하고, SRT를 단일 기준으로 씬을 재그룹·확정한 뒤 export용 manifest를 쓰는 audio 스텝의 **백엔드 파이프라인**을 만든다 (renderer UI·GCF 배포는 이후 서브페이즈).

**Architecture:** main process 스텝 머신에 `audio` 스텝을 `scenes`와 `prompts` 사이에 삽입한다. audio 스텝은 순수 함수 유닛(타임라인·SRT·재그룹·storyId·manifest)을 조립하고, TTS 어댑터(주입)와 `music-metadata` 실측을 사용한다. 모든 산출은 atomic write. LLM/TTS는 테스트에서 mock.

**Tech Stack:** Node ESM, Electron main, `music-metadata`(순수 JS), vitest. 기존 모듈 재사용: `electron/story/{stepMachine,storyStore,timing,sceneIdentity}.js`, `electron/api/keyStore.js`.

## Global Constraints

- **설계 스펙**: `docs/superpowers/specs/2026-07-04-story-m2-audio-design.md` — 이 플랜은 그 §3~§7을 구현. 충돌 시 스펙 우선.
- **TDD 필수** (CLAUDE.md): 실패 테스트 → 최소 구현 → 통과 → 리팩터. 테스트 없이 머지 금지.
- **테스트 위치**: `tests/`가 `src/`·`electron/` 구조를 미러. 러너 vitest. 단일: `npx vitest run <path>`, 전체: `npm run test:run`.
- **커밋만 사용자 요청 시** (CLAUDE.md): 각 task 끝의 커밋 스텝은 사용자가 커밋을 요청했을 때만 실행. 요청 전이면 커밋 스텝은 skip하고 다음 task 진행.
- **보안** (CLAUDE.md): API 키 평문 저장/소스 삽입 금지. keyStore는 safeStorage 암호화, renderer에 평문 미반환. provider는 enum allowlist.
- **원자적 쓰기**: 모든 story 산출 파일은 temp→rename (기존 `storyStore.writeAtomic` 패턴).
- **race 가드**: 모든 async 단계 후 `signal.aborted` 검사 후에만 commit (기존 stepMachine `isStale()` 패턴).
- **M2a-1 범위 밖(후속)**: 재TTS 정책·timing-only/full push 분기(M2a-2), 화자 매핑 UI·미리듣기(M2a-3), `prepareCloudRequest` manifest 분기·GCF 배포(M2a-4), SFX(M2b). M2a-1은 **narration 세그먼트의 최초 실행 경로**만.

---

## File Structure

**생성:**
- `electron/story/audioProbe.js` — `music-metadata`로 세그먼트 mp3 실측 (`probeDurationMs`).
- `electron/api/keyStoreMulti.js` — provider별 멀티 키 저장소(allowlist·경로 매핑). 기존 `keyStore.js` 팩토리 재사용.
- `electron/api/tts/typecast.js` — Typecast TTS 어댑터(fetch 주입).
- `electron/api/tts/index.js` — provider명 → 어댑터 팩토리 레지스트리.
- `electron/story/regroup.js` — 세그먼트 시퀀스 → 목표 6~10초 씬 그룹.
- `electron/story/manifest.js` — audio manifest 빌더/read/write.

**수정:**
- `electron/story/timing.js` — 세그먼트 타임라인·SRT·srtLineId 함수 추가(기존 폴백 함수 보존).
- `electron/story/sceneIdentity.js` — 멤버십(세그먼트 id 집합) 기반 storyId 발급 추가(기존 텍스트 매칭 보존).
- `electron/story/storyStore.js` — 바이너리 atomic write(`saveBinary`) 추가.
- `electron/story/stepMachine.js` — `audio` 스텝 삽입 + DOWNSTREAM/의존성 갱신.

**테스트:** 위 각 파일에 대응하는 `tests/electron/story/*.test.js`, `tests/electron/api/**/*.test.js`.

---

## Task 1: 세그먼트 실측 유틸 (`audioProbe`)

**Files:**
- Create: `electron/story/audioProbe.js`
- Test: `tests/electron/story/audioProbe.test.js`

**Interfaces:**
- Produces: `probeDurationMs(filePath: string, { parseFile? }) → Promise<number>` — mp3 실제 길이(ms, 반올림). `music-metadata`의 `parseFile` 주입 가능(테스트).

- [ ] **Step 1: 의존성 설치**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npm install music-metadata`
Expected: `music-metadata`가 dependencies에 추가.

- [ ] **Step 2: 실패 테스트 작성**

Create `tests/electron/story/audioProbe.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { probeDurationMs } from '../../../electron/story/audioProbe.js'

describe('probeDurationMs', () => {
  it('주입한 parseFile의 format.duration(초)을 ms로 반올림 반환', async () => {
    const fakeParse = async (p) => {
      expect(p).toBe('/x/s001-1.mp3')
      return { format: { duration: 2.3812 } }
    }
    const ms = await probeDurationMs('/x/s001-1.mp3', { parseFile: fakeParse })
    expect(ms).toBe(2381)
  })

  it('duration 누락 시 0 반환(측정 실패 안전값)', async () => {
    const ms = await probeDurationMs('/x/y.mp3', { parseFile: async () => ({ format: {} }) })
    expect(ms).toBe(0)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/electron/story/audioProbe.test.js`
Expected: FAIL — `probeDurationMs` not exported.

- [ ] **Step 4: 최소 구현**

Create `electron/story/audioProbe.js`:
```js
/**
 * 세그먼트 mp3 실제 길이 측정 — music-metadata(순수 JS). ffmpeg 불필요.
 * parseFile 주입으로 단위 테스트 가능.
 */
export async function probeDurationMs(filePath, { parseFile } = {}) {
  const parse = parseFile || (await import('music-metadata')).parseFile
  const meta = await parse(filePath)
  const sec = meta?.format?.duration
  if (typeof sec !== 'number' || !isFinite(sec) || sec <= 0) return 0
  return Math.round(sec * 1000)
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/electron/story/audioProbe.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: 커밋** (사용자가 커밋 요청한 경우만)

```bash
git add electron/story/audioProbe.js tests/electron/story/audioProbe.test.js package.json package-lock.json
git commit -m "feat(story-m2a): add segment audio duration probe (music-metadata)"
```

---

## Task 2: 멀티 provider 키 저장소 (`keyStoreMulti`)

**Files:**
- Create: `electron/api/keyStoreMulti.js`
- Test: `tests/electron/api/keyStoreMulti.test.js`

**Interfaces:**
- Consumes: `createKeyStore` from `electron/api/keyStore.js` (기존 팩토리, 단일 filePath).
- Produces: `createMultiKeyStore({ safeStorage, keysDir, fs, path }) → { setKey(provider, plain), getKey(provider), hasKey(provider), clearKey(provider), PROVIDERS }`. provider는 allowlist(`genai|elevenlabs|typecast|anthropic`) 외엔 `{success:false, error}` 반환(getKey/hasKey는 null/false). 파일명은 매핑 테이블로만 생성(문자열 직접 join 금지).

- [ ] **Step 1: 실패 테스트 작성**

Create `tests/electron/api/keyStoreMulti.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import { createMultiKeyStore } from '../../../electron/api/keyStoreMulti.js'

// safeStorage/fs mock — 메모리 저장
function makeDeps() {
  const files = new Map()
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s),
    decryptString: (b) => b.toString().replace(/^enc:/, ''),
  }
  const fs = {
    existsSync: (p) => files.has(p),
    readFileSync: (p) => files.get(p),
    writeFileSync: (p, data) => files.set(p, Buffer.from(data)),
    unlinkSync: (p) => files.delete(p),
    mkdirSync: () => {},
  }
  const path = { join: (...xs) => xs.join('/') }
  return { safeStorage, keysDir: '/keys', fs, path, files }
}

describe('createMultiKeyStore', () => {
  let deps
  beforeEach(() => { deps = makeDeps() })

  it('허용 provider 키를 저장/조회/삭제', () => {
    const ks = createMultiKeyStore(deps)
    expect(ks.setKey('typecast', 'tc-123')).toEqual({ success: true })
    expect(ks.hasKey('typecast')).toBe(true)
    expect(ks.getKey('typecast')).toBe('tc-123')
    expect(deps.files.has('/keys/typecast-key.enc')).toBe(true)
    ks.clearKey('typecast')
    expect(ks.hasKey('typecast')).toBe(false)
  })

  it('allowlist 밖 provider는 거부(경로 생성 안 함)', () => {
    const ks = createMultiKeyStore(deps)
    expect(ks.setKey('../evil', 'x').success).toBe(false)
    expect(ks.getKey('../evil')).toBe(null)
    expect(ks.hasKey('../evil')).toBe(false)
    expect(deps.files.size).toBe(0)
  })

  it('provider별로 키가 격리', () => {
    const ks = createMultiKeyStore(deps)
    ks.setKey('typecast', 'tc'); ks.setKey('elevenlabs', 'el')
    expect(ks.getKey('typecast')).toBe('tc')
    expect(ks.getKey('elevenlabs')).toBe('el')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/keyStoreMulti.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: 최소 구현**

Create `electron/api/keyStoreMulti.js`:
```js
/**
 * provider별 멀티 키 저장소 — 스펙 §6. enum allowlist + 경로 매핑 테이블(path traversal 방어).
 * 각 provider는 기존 createKeyStore(단일 파일) 인스턴스로 위임.
 */
import { createKeyStore } from './keyStore.js'

// allowlist → 파일명 (provider 문자열을 직접 path join 하지 않는다)
const FILENAME_BY_PROVIDER = {
  genai: 'genai-key.enc',
  elevenlabs: 'elevenlabs-key.enc',
  typecast: 'typecast-key.enc',
  anthropic: 'anthropic-key.enc',
}
export const PROVIDERS = Object.keys(FILENAME_BY_PROVIDER)

export function createMultiKeyStore({ safeStorage, keysDir, fs, path }) {
  fs.mkdirSync?.(keysDir, { recursive: true })
  const cache = new Map()
  function storeFor(provider) {
    const filename = FILENAME_BY_PROVIDER[provider]
    if (!filename) return null // allowlist 밖 → 경로 생성 안 함
    if (!cache.has(provider)) {
      cache.set(provider, createKeyStore({ safeStorage, filePath: path.join(keysDir, filename), fs }))
    }
    return cache.get(provider)
  }
  return {
    PROVIDERS,
    setKey(provider, plain) {
      const s = storeFor(provider)
      return s ? s.setKey(plain) : { success: false, error: `unknown provider: ${provider}` }
    },
    getKey(provider) { return storeFor(provider)?.getKey() ?? null },
    hasKey(provider) { return storeFor(provider)?.hasKey() ?? false },
    clearKey(provider) {
      const s = storeFor(provider)
      return s ? s.clearKey() : { success: false, error: `unknown provider: ${provider}` }
    },
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/api/keyStoreMulti.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋** (사용자 요청 시만)

```bash
git add electron/api/keyStoreMulti.js tests/electron/api/keyStoreMulti.test.js
git commit -m "feat(story-m2a): multi-provider key store with enum allowlist"
```

---

## Task 3: Typecast TTS 어댑터

**Files:**
- Create: `electron/api/tts/typecast.js`, `electron/api/tts/index.js`
- Test: `tests/electron/api/tts/typecast.test.js`

**Interfaces:**
- Consumes: multiKeyStore `getKey('typecast')` (주입), `fetch`(주입).
- Produces:
  - `createTypecastAdapter({ getKey, fetch }) → { capabilities(), synthesize({ text, voiceId, emotion, signal }) }`.
  - `capabilities() → { supportsEmotion: true, maxCharsPerRequest: 2000, outputFormats: ['wav'], supportsPreview: true, maxConcurrency: 2 }`.
  - `synthesize(...) → { audio: Buffer, format: 'wav' }`. 키 없으면 throw `Error('No Typecast API key')`. HTTP 실패 시 throw.
  - `index.js`: `createTtsAdapter(provider, deps)` — provider명으로 어댑터 반환, 미지원 provider throw.

- [ ] **Step 1: 실패 테스트 작성**

Create `tests/electron/api/tts/typecast.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { createTypecastAdapter } from '../../../../electron/api/tts/typecast.js'

describe('createTypecastAdapter', () => {
  it('capabilities: 감정 지원·wav', () => {
    const a = createTypecastAdapter({ getKey: () => 'tc', fetch: async () => {} })
    expect(a.capabilities().supportsEmotion).toBe(true)
    expect(a.capabilities().outputFormats).toContain('wav')
  })

  it('synthesize: 키·voiceId·text·emotion을 요청에 싣고 오디오 Buffer 반환', async () => {
    let captured
    const fetch = async (url, opts) => {
      captured = { url, opts }
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
    }
    const a = createTypecastAdapter({ getKey: () => 'tc-key', fetch })
    const { audio, format } = await a.synthesize({ text: '안녕', voiceId: 'tc_abc', emotion: 'happy' })
    expect(format).toBe('wav')
    expect(Buffer.isBuffer(audio)).toBe(true)
    expect([...audio]).toEqual([1, 2, 3])
    expect(captured.opts.headers.Authorization).toContain('tc-key')
    const body = JSON.parse(captured.opts.body)
    expect(body.voice_id).toBe('tc_abc')
    expect(body.text).toBe('안녕')
    expect(body.emotion).toBe('happy')
    expect(body.model).toBe('ssfm-v21')
  })

  it('키 없으면 throw', async () => {
    const a = createTypecastAdapter({ getKey: () => null, fetch: async () => {} })
    await expect(a.synthesize({ text: 'x', voiceId: 'v' })).rejects.toThrow(/Typecast API key/)
  })

  it('HTTP 실패 시 throw', async () => {
    const fetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })
    const a = createTypecastAdapter({ getKey: () => 'k', fetch })
    await expect(a.synthesize({ text: 'x', voiceId: 'v' })).rejects.toThrow(/401/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/tts/typecast.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: 최소 구현**

Create `electron/api/tts/typecast.js`:
```js
/**
 * Typecast TTS 어댑터 — 스펙 §6. 실호출은 CLAUDE.md 값(api.typecast.ai, ssfm-v21).
 * getKey/fetch 주입으로 단위 테스트. 세그먼트=단일 요청(어댑터는 이어붙이지 않음).
 */
const ENDPOINT = 'https://api.typecast.ai/v1/text-to-speech'

export function createTypecastAdapter({ getKey, fetch }) {
  return {
    capabilities() {
      return { supportsEmotion: true, maxCharsPerRequest: 2000, outputFormats: ['wav'], supportsPreview: true, maxConcurrency: 2 }
    },
    async synthesize({ text, voiceId, emotion = 'normal', signal }) {
      const key = getKey()
      if (!key) throw new Error('No Typecast API key')
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ text, model: 'ssfm-v21', voice_id: voiceId, emotion, language: 'ko' }),
        signal,
      })
      if (!res.ok) {
        const detail = await (res.text?.() ?? Promise.resolve(''))
        throw new Error(`Typecast TTS failed: ${res.status} ${detail}`)
      }
      const buf = Buffer.from(await res.arrayBuffer())
      return { audio: buf, format: 'wav' }
    },
  }
}
```

Create `electron/api/tts/index.js`:
```js
/** provider명 → TTS 어댑터. M2a-1은 typecast만; elevenlabs/gemini는 후속. */
import { createTypecastAdapter } from './typecast.js'

const FACTORIES = { typecast: createTypecastAdapter }

export function createTtsAdapter(provider, deps) {
  const make = FACTORIES[provider]
  if (!make) throw new Error(`Unsupported TTS provider: ${provider}`)
  return make(deps)
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/api/tts/typecast.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋** (사용자 요청 시만)

```bash
git add electron/api/tts/ tests/electron/api/tts/
git commit -m "feat(story-m2a): Typecast TTS adapter (injected fetch/key)"
```

---

## Task 4: 세그먼트 타임라인 + SRT (`timing.js` 확장)

**Files:**
- Modify: `electron/story/timing.js` (기존 `estimateReadingSec`/`buildFallbackTimeline` 보존, 함수 추가)
- Test: `tests/electron/story/timing.segments.test.js`

**Interfaces:**
- Consumes: 세그먼트 배열 `[{ id, type, text, durationMs }]` (durationMs는 Task 1 실측으로 이미 채워진 상태).
- Produces:
  - `buildSegmentTimeline(segments, { gapMs = 150 }) → segments'` — 각 원소에 `startMs`(순서 누적, 앞 세그먼트 endMs + gapMs) 추가. 원본 불변(새 배열).
  - `srtLineId(segmentId) → string` = `sub_<segmentId>` (결정론적).
  - `buildSrt(segments) → string` — `type==='narration'`만, `startMs`~`startMs+durationMs`로 SRT. sfx 제외. 빈 텍스트 제외.

- [ ] **Step 1: 실패 테스트 작성**

Create `tests/electron/story/timing.segments.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { buildSegmentTimeline, buildSrt, srtLineId } from '../../../electron/story/timing.js'

const segs = [
  { id: 's1', type: 'narration', text: '첫 문장', durationMs: 2000 },
  { id: 's2', type: 'sfx', text: '', durationMs: 800 },
  { id: 's3', type: 'narration', text: '둘째 문장', durationMs: 1500 },
]

describe('buildSegmentTimeline', () => {
  it('gap 포함 누적 startMs (0, 2150, 3750)', () => {
    const out = buildSegmentTimeline(segs, { gapMs: 150 })
    expect(out.map((s) => s.startMs)).toEqual([0, 2150, 3750])
    expect(segs[0].startMs).toBeUndefined() // 원본 불변
  })
})

describe('srtLineId', () => {
  it('sub_<id>', () => { expect(srtLineId('s3')).toBe('sub_s3') })
})

describe('buildSrt', () => {
  it('narration만 자막화, sfx 제외, 인덱스 1..N 순차', () => {
    const timed = buildSegmentTimeline(segs, { gapMs: 150 })
    const srt = buildSrt(timed)
    // s1: 0~2000, s3: 3750~5250 (s2 sfx 제외)
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,000\n첫 문장')
    expect(srt).toContain('2\n00:00:03,750 --> 00:00:05,250\n둘째 문장')
    expect(srt).not.toContain('800')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/story/timing.segments.test.js`
Expected: FAIL — exports not defined.

- [ ] **Step 3: 최소 구현 — `timing.js`에 추가**

Append to `electron/story/timing.js` (기존 내용 아래):
```js
/** 세그먼트 순서대로 gap 포함 누적 startMs 부여 (원본 불변). 스펙 §5-3. */
export function buildSegmentTimeline(segments, { gapMs = 150 } = {}) {
  let cursor = 0
  return segments.map((s) => {
    const startMs = cursor
    cursor = startMs + (s.durationMs || 0) + gapMs
    return { ...s, startMs }
  })
}

/** 세그먼트 id → SRT 라인 id (결정론적, 스펙 §7 흐름 A). */
export function srtLineId(segmentId) {
  return `sub_${segmentId}`
}

function fmtSrtTime(ms) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const x = ms % 1000
  const p2 = (n) => String(n).padStart(2, '0')
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(x).padStart(3, '0')}`
}

/** narration 세그먼트만 SRT 라인화 (sfx 제외). startMs 필요(buildSegmentTimeline 선행). 스펙 §5-4. */
export function buildSrt(segments) {
  let out = ''
  let idx = 1
  for (const s of segments) {
    if (s.type && s.type !== 'narration') continue
    const text = (s.text || '').trim()
    if (!text) continue
    const start = s.startMs || 0
    const end = start + (s.durationMs || 0)
    out += `${idx}\n${fmtSrtTime(start)} --> ${fmtSrtTime(end)}\n${text}\n\n`
    idx++
  }
  return out.trim()
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/story/timing.segments.test.js`
Expected: PASS (3 tests). 기존 `timing` 테스트도 여전히 통과(`npx vitest run tests/electron/story/`).

- [ ] **Step 5: 커밋** (사용자 요청 시만)

```bash
git add electron/story/timing.js tests/electron/story/timing.segments.test.js
git commit -m "feat(story-m2a): segment timeline + SRT from measured durations"
```

---

## Task 5: 씬 재그룹 (`regroup.js`)

**Files:**
- Create: `electron/story/regroup.js`
- Test: `tests/electron/story/regroup.test.js`

**Interfaces:**
- Consumes: 타임라인 부여된 세그먼트 `[{ id, type, startMs, durationMs }]`.
- Produces: `regroupScenes(segments, { minMs = 6000, maxMs = 10000 }) → [{ segmentIds: string[], startMs, endMs, durationMs }]`. 규칙(스펙 §4): 순서 보존, 세그먼트 안 쪼갬, 누적이 minMs 도달하면 씬 마감(다음 세그먼트로 maxMs 초과 예상이면 즉시 마감), 단일 세그먼트가 maxMs 초과면 단독 씬. sfx 세그먼트도 그룹에 포함(자막은 아니지만 타임라인 원자).

- [ ] **Step 1: 실패 테스트 작성**

Create `tests/electron/story/regroup.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { regroupScenes } from '../../../electron/story/regroup.js'

// startMs는 무시하고 durationMs 누적으로 그룹 판정 (startMs는 결과 계산용)
function seg(id, durationMs, startMs) { return { id, type: 'narration', durationMs, startMs } }

describe('regroupScenes', () => {
  it('누적 6초 도달 시 씬 마감', () => {
    const segs = [seg('a', 3000, 0), seg('b', 3500, 3150), seg('c', 3000, 6800)]
    const scenes = regroupScenes(segs, { minMs: 6000, maxMs: 10000 })
    // a+b = 6500ms >= 6000 → 씬1 [a,b]; c → 씬2 [c]
    expect(scenes.map((s) => s.segmentIds)).toEqual([['a', 'b'], ['c']])
    expect(scenes[0].startMs).toBe(0)
  })

  it('다음 세그먼트가 maxMs 초과 유발하면 현재 씬 먼저 마감', () => {
    const segs = [seg('a', 5000, 0), seg('b', 6000, 5150)]
    const scenes = regroupScenes(segs, { minMs: 6000, maxMs: 10000 })
    // a=5000(<6000) 이지만 a+b=11000 > 10000 → a 단독 마감, b 단독
    expect(scenes.map((s) => s.segmentIds)).toEqual([['a'], ['b']])
  })

  it('단일 세그먼트가 maxMs 초과면 단독 씬', () => {
    const segs = [seg('a', 12000, 0)]
    const scenes = regroupScenes(segs, { minMs: 6000, maxMs: 10000 })
    expect(scenes).toHaveLength(1)
    expect(scenes[0].segmentIds).toEqual(['a'])
    expect(scenes[0].durationMs).toBe(12000)
  })

  it('endMs = 마지막 세그먼트 startMs + durationMs', () => {
    const segs = [seg('a', 3000, 0), seg('b', 4000, 3150)]
    const scenes = regroupScenes(segs, { minMs: 6000, maxMs: 10000 })
    expect(scenes[0].endMs).toBe(7150)
    expect(scenes[0].durationMs).toBe(7150) // startMs 0 기준
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/story/regroup.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: 최소 구현**

Create `electron/story/regroup.js`:
```js
/**
 * 세그먼트 시퀀스 → 목표 6~10초 씬 그룹. 스펙 §4.
 * 순서 보존, 세그먼트 안 쪼갬. 누적 minMs 도달 시 마감. 다음 추가가 maxMs 초과면 먼저 마감.
 * 단일 세그먼트가 maxMs 초과면 단독 씬.
 */
export function regroupScenes(segments, { minMs = 6000, maxMs = 10000 } = {}) {
  const scenes = []
  let cur = []
  let curMs = 0

  const flush = () => {
    if (!cur.length) return
    const first = cur[0]
    const last = cur[cur.length - 1]
    const startMs = first.startMs || 0
    const endMs = (last.startMs || 0) + (last.durationMs || 0)
    scenes.push({ segmentIds: cur.map((s) => s.id), startMs, endMs, durationMs: endMs - startMs })
    cur = []
    curMs = 0
  }

  for (const s of segments) {
    const dur = s.durationMs || 0
    // 현재 씬에 이미 세그먼트가 있고, 추가 시 maxMs 초과 예상이면 먼저 마감
    if (cur.length && curMs + dur > maxMs) flush()
    cur.push(s)
    curMs += dur
    // 목표 하한 도달 → 마감
    if (curMs >= minMs) flush()
  }
  flush()
  return scenes
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/story/regroup.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋** (사용자 요청 시만)

```bash
git add electron/story/regroup.js tests/electron/story/regroup.test.js
git commit -m "feat(story-m2a): scene regrouping by measured 6-10s target"
```

---

## Task 6: 멤버십 기반 storyId 발급 (`sceneIdentity` 확장)

**Files:**
- Modify: `electron/story/sceneIdentity.js` (기존 `inheritStoryIds`/`assertUniqueStoryIds`/`normalizeSceneText` 보존)
- Test: `tests/electron/story/sceneIdentity.membership.test.js`

**Interfaces:**
- Consumes: `regroupScenes` 결과 `[{ segmentIds, startMs, endMs, durationMs }]`, 이전 확정 씬 `[{ storyId, segmentIds }]`.
- Produces: `assignStoryIdsByMembership(prevScenes, nextGroups) → [{ ...group, storyId }]`. 규칙(스펙 §4): 세그먼트 id 집합이 이전 씬과 **완전 동일**하면 storyId 승계, 아니면 신규 uuid. 결과 storyId 유일(중복 시 신규 재발급으로 보장). `randomUUID` 주입 가능(테스트).

- [ ] **Step 1: 실패 테스트 작성**

Create `tests/electron/story/sceneIdentity.membership.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { assignStoryIdsByMembership } from '../../../electron/story/sceneIdentity.js'

describe('assignStoryIdsByMembership', () => {
  it('세그먼트 집합 동일 → storyId 승계', () => {
    const prev = [{ storyId: 'old-1', segmentIds: ['a', 'b'] }]
    const next = [{ segmentIds: ['a', 'b'], startMs: 0, endMs: 6000, durationMs: 6000 }]
    let n = 0
    const out = assignStoryIdsByMembership(prev, next, { randomUUID: () => `new-${++n}` })
    expect(out[0].storyId).toBe('old-1')
  })

  it('멤버십 변화(재그룹 경계 이동) → 신규 storyId', () => {
    const prev = [{ storyId: 'old-1', segmentIds: ['a', 'b'] }]
    const next = [
      { segmentIds: ['a'], startMs: 0, endMs: 3000, durationMs: 3000 },
      { segmentIds: ['b'], startMs: 3150, endMs: 6000, durationMs: 2850 },
    ]
    let n = 0
    const out = assignStoryIdsByMembership(prev, next, { randomUUID: () => `new-${++n}` })
    expect(out.map((s) => s.storyId)).toEqual(['new-1', 'new-2'])
  })

  it('결과 storyId 유일성 보장', () => {
    const prev = [
      { storyId: 'dup', segmentIds: ['a'] },
      { storyId: 'dup', segmentIds: ['b'] }, // 비정상 중복 입력
    ]
    const next = [{ segmentIds: ['a'] }, { segmentIds: ['b'] }]
    let n = 0
    const out = assignStoryIdsByMembership(prev, next, { randomUUID: () => `new-${++n}` })
    const ids = out.map((s) => s.storyId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/story/sceneIdentity.membership.test.js`
Expected: FAIL — export not defined.

- [ ] **Step 3: 최소 구현 — `sceneIdentity.js`에 추가**

Append to `electron/story/sceneIdentity.js`:
```js
/**
 * 멤버십(세그먼트 id 집합) 기반 storyId 발급 — 스펙 §4.
 * 이전 씬과 집합 완전 동일 → 승계, 아니면 신규 uuid. 결과 유일성 보장.
 */
export function assignStoryIdsByMembership(prevScenes, nextGroups, { randomUUID: uuid = randomUUID } = {}) {
  const keyOf = (ids) => [...ids].sort().join('|')
  const prevByKey = new Map((prevScenes || []).map((s) => [keyOf(s.segmentIds || []), s.storyId]))
  const used = new Set()
  return nextGroups.map((g) => {
    let storyId = prevByKey.get(keyOf(g.segmentIds || []))
    if (!storyId || used.has(storyId)) storyId = uuid()
    while (used.has(storyId)) storyId = uuid() // 유일성 보장
    used.add(storyId)
    return { ...g, storyId }
  })
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/story/sceneIdentity.membership.test.js`
Expected: PASS (3 tests). 기존 sceneIdentity 테스트도 통과 확인.

- [ ] **Step 5: 커밋** (사용자 요청 시만)

```bash
git add electron/story/sceneIdentity.js tests/electron/story/sceneIdentity.membership.test.js
git commit -m "feat(story-m2a): membership-based storyId assignment after regroup"
```

---

## Task 7: audio manifest 빌더 (`manifest.js`) + 바이너리 atomic write

**Files:**
- Create: `electron/story/manifest.js`
- Modify: `electron/story/storyStore.js` (바이너리 `saveBinary` 추가)
- Test: `tests/electron/story/manifest.test.js`

**Interfaces:**
- Consumes: 타임라인·씬 확정 결과 세그먼트 `[{ id, type, speaker, audioPath, startMs, durationMs }]`.
- Produces:
  - `buildManifest(segments, { pushRevision = null }) → { version: 1, pushRevision, segments: [{ id, type, speaker, trackIndex, audioPath, startMs, durationMs }] }`. narration은 `trackIndex: 0`(M2a 단일 트랙), sfx는 trackIndex 생략.
  - `storyStore.saveBinary(relPath, buffer)` — temp→rename 바이너리 원자 쓰기.

- [ ] **Step 1: 실패 테스트 작성**

Create `tests/electron/story/manifest.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { buildManifest } from '../../../electron/story/manifest.js'

const segs = [
  { id: 's1', type: 'narration', speaker: 'narrator', audioPath: '/a/s1.wav', startMs: 0, durationMs: 2000 },
  { id: 's2', type: 'sfx', audioPath: '/a/s2.wav', startMs: 2150, durationMs: 800 },
]

describe('buildManifest', () => {
  it('narration은 trackIndex 0, pushRevision 기본 null', () => {
    const m = buildManifest(segs)
    expect(m.version).toBe(1)
    expect(m.pushRevision).toBe(null)
    expect(m.segments[0]).toMatchObject({ id: 's1', type: 'narration', trackIndex: 0, startMs: 0, durationMs: 2000 })
  })

  it('pushRevision 주입', () => {
    expect(buildManifest(segs, { pushRevision: 7 }).pushRevision).toBe(7)
  })

  it('sfx 세그먼트도 포함(trackIndex 없음)', () => {
    const m = buildManifest(segs)
    const sfx = m.segments.find((s) => s.id === 's2')
    expect(sfx.type).toBe('sfx')
    expect(sfx.trackIndex).toBeUndefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/story/manifest.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: 최소 구현**

Create `electron/story/manifest.js`:
```js
/**
 * audio manifest — 스펙 §7 흐름 B. export가 읽는 계약.
 * pushRevision은 §7 revision 소유 프로토콜: 최초 정밀은 null(prompts가 재스탬프), 재TTS는 audio가 확정.
 */
export function buildManifest(segments, { pushRevision = null } = {}) {
  return {
    version: 1,
    pushRevision,
    segments: segments.map((s) => {
      const base = {
        id: s.id,
        type: s.type || 'narration',
        speaker: s.speaker,
        audioPath: s.audioPath,
        startMs: s.startMs,
        durationMs: s.durationMs,
      }
      if ((s.type || 'narration') === 'narration') base.trackIndex = 0 // M2a 단일 트랙
      return base
    }),
  }
}
```

Modify `electron/story/storyStore.js` — `writeAtomic`를 바이너리 지원하도록 확장하고 `saveBinary` 노출. 기존 `writeAtomic`은 문자열 `writeFile(tmp, data, 'utf-8')`을 사용하므로 인코딩 인자를 옵션화:

기존:
```js
async function writeAtomic(relPath, data) {
    await mkdir(path.dirname(path.join(storyDir, relPath)), { recursive: true })
    const target = path.join(storyDir, relPath)
    const tmp = `${target}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
    await writeFile(tmp, data, 'utf-8')
    await rename(tmp, target)
  }
```
로 교체:
```js
async function writeAtomic(relPath, data, encoding = 'utf-8') {
    await mkdir(path.dirname(path.join(storyDir, relPath)), { recursive: true })
    const target = path.join(storyDir, relPath)
    const tmp = `${target}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
    await writeFile(tmp, data, encoding)
    await rename(tmp, target)
  }
```
그리고 return 객체에 추가:
```js
    async saveBinary(relPath, buffer) { return enqueueWrite(() => writeAtomic(relPath, buffer, null)) },
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/story/manifest.test.js`
Expected: PASS (3 tests). 기존 storyStore 사용처(문자열 save)는 인코딩 기본값 유지로 무영향 — `npx vitest run tests/electron/story/` 전체 통과 확인.

- [ ] **Step 5: 커밋** (사용자 요청 시만)

```bash
git add electron/story/manifest.js electron/story/storyStore.js tests/electron/story/manifest.test.js
git commit -m "feat(story-m2a): audio manifest builder + binary atomic write"
```

---

## Task 8: audio 스텝 조립 (`stepMachine` 통합)

**Files:**
- Modify: `electron/story/stepMachine.js` (audio 스텝 추가, `DOWNSTREAM`·의존성 갱신)
- Test: `tests/electron/story/stepMachine.audio.test.js`

**Interfaces:**
- Consumes: Task 1·3·4·5·6·7의 함수 + 주입 TTS 어댑터(`createStepMachine`에 `tts` 팩토리 주입).
- Produces: `stepMachine.start('audio', params)` — scenes.json의 세그먼트에 대해 TTS 생성 → 실측 → 타임라인 → SRT → 재그룹 → storyId 발급 → manifest 저장. `steps.audio.status` 전이. abort 안전. 세그먼트 파일은 `story/audio/segments/<id>.wav`, `story/audio/final.srt`, `story/audio/manifest.json`.

**설계 노트 (구현자 필독):**
- `createStepMachine`의 DI에 `tts` 추가: `createStepMachine({ projectPath, llm, emit, getApiKey, loadMetaPrompt, tts, probe })`. `tts`는 `{ synthesize({text,voiceId,emotion,signal}) }` (Task 3 어댑터), `probe`는 `probeDurationMs`(Task 1). 화자→voice 매핑은 `state.speakers`(스펙 §6, voiceId)에서 조회.
- `DOWNSTREAM`을 `{ script: ['scenes','audio','prompts'], scenes: ['audio','prompts'], audio: ['prompts'], prompts: [] }`로 갱신 — audio 재실행은 prompts만 리셋(멤버십 변화 대응은 M2a-2).
- audio 스텝은 세그먼트 병렬 생성(동시성 제한은 `tts.capabilities().maxConcurrency`), 매 async 후 `signal.aborted` 검사(기존 `if (signal?.aborted) return` 패턴).
- **M2a-1 범위**: 최초 실행 경로(storyId 발급·manifest.pushRevision=null·prompts 리셋). 재TTS 정책(timing-only/full·멤버십 변화 전이)은 M2a-2.

- [ ] **Step 1: 실패 테스트 작성**

Create `tests/electron/story/stepMachine.audio.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

async function tmpProject() { return await mkdtemp(path.join(tmpdir(), 'story-audio-')) }

function makeMachine(projectPath) {
  // scenes.json 세그먼트를 미리 심어두기 위해 store 경유 대신 llm.splitScenes mock 사용은
  // 이 테스트 범위 밖 — audio 스텝만 검증하려 scenes.json을 직접 배치한다.
  const emitted = []
  const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => ({ audio: Buffer.from('AUDIO:' + text), format: 'wav' }) }
  const probe = async () => 2000 // 모든 세그먼트 2초로 실측 가정
  const machine = createStepMachine({
    projectPath,
    llm: {},
    emit: (ch, payload) => emitted.push({ ch, payload }),
    getApiKey: () => 'k',
    tts,
    probe,
  })
  return { machine, emitted }
}

describe('audio 스텝', () => {
  let projectPath
  beforeEach(async () => { projectPath = await tmpProject() })

  it('세그먼트 TTS 생성 → 실측 → SRT → 재그룹 → manifest 저장', async () => {
    // scenes.json 준비: narrator 화자 2 세그먼트
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [
        { id: 's1', type: 'narration', speaker: 'narrator', text: '첫 문장' },
        { id: 's2', type: 'narration', speaker: 'narrator', text: '둘째 문장' },
      ] }],
    }))
    const { machine } = makeMachine(projectPath)
    // 화자 voice 배정
    await machine.open()
    // state.speakers에 narrator voiceId 주입 경로가 필요 — start의 params로 전달
    const res = await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    expect(res.operationId).toBeTruthy()

    // 세그먼트 오디오 파일
    const s1 = await readFile(path.join(projectPath, 'story', 'audio', 'segments', 's1.wav'))
    expect(s1.toString()).toBe('AUDIO:첫 문장')
    // SRT
    const srt = await readFile(path.join(projectPath, 'story', 'audio', 'final.srt'), 'utf-8')
    expect(srt).toContain('첫 문장')
    // manifest: pushRevision null(최초), 세그먼트 startMs 부여
    const manifest = JSON.parse(await readFile(path.join(projectPath, 'story', 'audio', 'manifest.json'), 'utf-8'))
    expect(manifest.pushRevision).toBe(null)
    expect(manifest.segments[0].startMs).toBe(0)
    expect(manifest.segments[1].startMs).toBe(2150) // 2000 + 150 gap
  })

  it('audio 완료 시 steps.audio.status=done, prompts는 pending 리셋', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [{ id: 's1', type: 'narration', speaker: 'narrator', text: 'x' }] }],
    }))
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('done')
    expect(state.steps.prompts.status).toBe('pending')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/story/stepMachine.audio.test.js`
Expected: FAIL — audio 스텝 미구현(`unknown step: audio`).

- [ ] **Step 3: 구현 — `stepMachine.js` 수정**

3a. DI 시그니처에 `tts`, `probe` 추가:
```js
export function createStepMachine({ projectPath, llm, emit, getApiKey, loadMetaPrompt, tts, probe }) {
```

3b. `DOWNSTREAM` 갱신:
```js
const DOWNSTREAM = { script: ['scenes', 'audio', 'prompts'], scenes: ['audio', 'prompts'], audio: ['prompts'], prompts: [] }
```

3c. `steps` 객체에 `audio` 추가 (import 상단에 추가: `import { buildSegmentTimeline, buildSrt } from './timing.js'`, `import { regroupScenes } from './regroup.js'`, `import { assignStoryIdsByMembership } from './sceneIdentity.js'`, `import { buildManifest } from './manifest.js'`):
```js
    async audio(params, opId, signal) {
      const scenesJson = JSON.parse((await store.loadText('scenes.json')) || 'null')
      if (!scenesJson) throw new Error('scenes.json not found — run scenes step first')
      // 화자 voice 배정 (params.speakers 우선, 없으면 state.speakers)
      const speakers = params.speakers || state.speakers || []
      const voiceOf = (spk) => (speakers.find((s) => s.id === spk)?.voice) || null
      // 모든 씬의 세그먼트를 순서대로 평탄화
      const segments = scenesJson.scenes.flatMap((sc) => sc.segments || [])
      const narration = segments.filter((s) => (s.type || 'narration') === 'narration')

      // 1) 세그먼트별 TTS 생성 + 실측 (동시성 제한)
      const conc = tts.capabilities?.().maxConcurrency || 2
      const results = new Map()
      for (let i = 0; i < narration.length; i += conc) {
        const batch = narration.slice(i, i + conc)
        await Promise.all(batch.map(async (seg) => {
          const voice = voiceOf(seg.speaker)
          if (!voice) throw new Error(`voice not assigned for speaker: ${seg.speaker}`)
          const { audio } = await tts.synthesize({ text: seg.text, voiceId: voice.voiceId, emotion: seg.emotion, signal })
          const rel = `audio/segments/${seg.id}.wav`
          await store.saveBinary(rel, audio)
          const durationMs = await probe(path.join(projectPath, 'story', rel))
          results.set(seg.id, { audioPath: path.join(projectPath, 'story', rel), durationMs })
        }))
        if (signal?.aborted) return
      }
      if (signal?.aborted) return

      // 2) 세그먼트에 실측 durationMs·audioPath 병합 (원 순서 보존)
      const measured = segments.map((s) => {
        const r = results.get(s.id)
        return { ...s, durationMs: r?.durationMs || 0, audioPath: r?.audioPath || null }
      })
      // 3) 타임라인(startMs) + 4) SRT
      const timed = buildSegmentTimeline(measured, { gapMs: 150 })
      const srt = buildSrt(timed)
      // 5) 재그룹 + 6) storyId 발급 (이전 확정 씬은 scenes.json에 segmentIds 있으면 사용)
      const prevScenes = (scenesJson.scenes || []).filter((s) => s.storyId).map((s) => ({ storyId: s.storyId, segmentIds: (s.segments || []).map((g) => g.id) }))
      const groups = regroupScenes(timed, { minMs: 6000, maxMs: 10000 })
      const withIds = assignStoryIdsByMembership(prevScenes, groups)
      // 7) 확정 씬 재구성 (그룹의 segmentIds로 timed 세그먼트를 묶음)
      const byId = new Map(timed.map((s) => [s.id, s]))
      const finalScenes = withIds.map((g) => ({
        storyId: g.storyId,
        startSec: g.startMs / 1000,
        endSec: g.endMs / 1000,
        segments: g.segmentIds.map((id) => byId.get(id)),
        // 프롬프트는 audio 단계에서 건드리지 않음 (M2a-2/prompts 소유)
      }))
      if (signal?.aborted) return
      // 8) 산출 저장: 세그먼트 파일은 이미 저장됨 → SRT, scenes.json, manifest 순서 원자 쓰기
      await store.saveText('audio/final.srt', srt)
      await store.saveText('scenes.json', JSON.stringify({ scenes: finalScenes }, null, 2))
      const manifest = buildManifest(timed, { pushRevision: null }) // 최초 정밀: null (prompts가 재스탬프)
      await store.saveText('audio/manifest.json', JSON.stringify(manifest, null, 2))
    },
```

3d. `params.speakers`를 state에 반영 (start 래퍼에서 audio 시작 시 speakers 저장) — `start` 안 audio 처리엔 별도 필요 없음(위에서 params 우선 사용). 단 재오픈 대비 저장하려면 audio 성공 후 `state.speakers = params.speakers || state.speakers`를 audio 함수 마지막에 추가:
```js
      if (params.speakers) state.speakers = params.speakers
```
(audio 함수 `if (signal?.aborted) return` 직후, manifest 저장 전에 배치.)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/story/stepMachine.audio.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: 전체 회귀**

Run: `npm run test:run`
Expected: 기존 전체 통과 + 신규 통과. 실패 시 audio 삽입이 기존 push/DOWNSTREAM 테스트에 준 영향 확인·수정.

- [ ] **Step 6: 커밋** (사용자 요청 시만)

```bash
git add electron/story/stepMachine.js tests/electron/story/stepMachine.audio.test.js
git commit -m "feat(story-m2a): audio step — TTS gen, measure, SRT, regroup, manifest"
```

---

## Self-Review (플랜 작성자 체크 완료)

- **스펙 커버리지**: §5 audio 절차(TTS·실측·타임라인·SRT·재그룹·manifest) = Task 1/3/4/5/7/8. §6 keyStore/TTS = Task 2/3. §4 재그룹·storyId·세그먼트 모델 = Task 5/6/8. §7 manifest·trackIndex·pushRevision=null 최초 정밀 = Task 7/8. **M2a-2로 미룬 것**(재TTS 정책·timing-only push·멤버십 변화 전이) 명시. §7 export 분기·GCF = M2a-4. 화자 UI·미리듣기 = M2a-3.
- **Placeholder 스캔**: 모든 코드 스텝에 완전 코드. "적절히 처리" 류 없음.
- **타입 일관성**: `probeDurationMs`(Task1)→audio(Task8), `createTypecastAdapter`(Task3)→`tts`(Task8), `buildSegmentTimeline`/`buildSrt`(Task4)→Task8, `regroupScenes`(Task5)→Task8, `assignStoryIdsByMembership`(Task6)→Task8, `buildManifest`/`saveBinary`(Task7)→Task8 — 시그니처 일치 확인.
- **알려진 리스크(구현 시 확인)**: Typecast 실제 응답 포맷(wav/mp3·바이너리 vs base64)은 어댑터 경계 뒤 격리 — 실호출 검증은 M2a-3 화자 미리듣기에서 실키로. `start` 래퍼가 audio 스텝 결과를 push하지 않도록(prompts만 push) 기존 `pushScenes` 반환 규약과 audio가 충돌하지 않는지 Step 5 회귀로 확인.
