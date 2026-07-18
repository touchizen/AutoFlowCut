# Story Pipeline M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 제목/대본 입력 → Gemini LLM으로 대본 생성·씬/화자 분리·씬별 프롬프트 생성 → 기존 씬 그리드에 push (오디오 제외 = 스펙 M1).

**Architecture:** Electron main process의 결정적 스텝 머신(`electron/story/`)이 파이프라인을 소유하고, 신규 LLM 어댑터(`electron/api/llm/`)가 Gemini 스트리밍/structured output을 호출한다. renderer는 IPC 이벤트를 구독하는 `useStoryPipeline` 훅 + Story 뷰로 표시하고, push는 `useScenes.importStoryScenes` + `saveCurrentProjectWithPayload` 트랜잭션 후 ack로 확정한다.

**Tech Stack:** Electron (main: ESM JS), React 18, vitest, Gemini API (`streamGenerateContent` SSE + `responseSchema`).

**스펙 (정본):** `docs/superpowers/specs/2026-07-02-story-pipeline-design.md` (v9). 이 플랜과 스펙이 충돌하면 스펙이 이긴다.

## Global Constraints

- **TDD 필수**: 모든 태스크는 실패 테스트 → 최소 구현 → 통과 순서. 테스트 없이 커밋 금지 (CLAUDE.md)
- 테스트 위치: `tests/`가 `src/`·`electron/` 구조를 미러 (예: `electron/story/timing.js` → `tests/electron/story/timing.test.js`)
- 테스트 러너: `npx vitest run <path>` (단일), `npm run test:run` (전체)
- 브랜치: `feature/story-pipeline` (이미 생성됨)
- **renderer에 평문 API 키 절대 노출 금지** — 키 사용은 main process 내부에서만
- IPC 채널·payload는 스펙 §6 표를 그대로 따른다: 모든 R→M 명령과 M→R 이벤트는 `{ projectToken, operationId, ... }` 객체형
- 씬 확장 필드는 `storyId, stalePrompt, stalePromptAt, staleVideo, staleVideoAt`만 허용 (additive, schemaVersion 불변)
- 기존 코드 스타일: 한국어 JSDoc 헤더 주석, ESM import, DI(테스트용 fetchImpl 주입) 패턴 준수
- 커밋 메시지 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: 낭독 시간 추정 + 폴백 타이밍 (`electron/story/timing.js`)

**Files:**
- Create: `electron/story/timing.js`
- Test: `tests/electron/story/timing.test.js`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces:
  - `estimateReadingSec(text, language) → number` — 언어별 초당 글자수 휴리스틱 (ko 5.5자/초, en 15자/초, 기타 en 값). 최소 1초
  - `buildFallbackTimeline(scenes) → [{ storyId, startTime, endTime, duration }]` — 씬별 세그먼트 text 합산 추정 길이로 순차 배치 (갭 없음, t=0부터)

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/story/timing.test.js
import { describe, it, expect } from 'vitest'
import { estimateReadingSec, buildFallbackTimeline } from '../../../electron/story/timing.js'

describe('estimateReadingSec', () => {
  it('한국어는 5.5자/초', () => {
    expect(estimateReadingSec('가'.repeat(55), 'ko')).toBeCloseTo(10, 1)
  })
  it('영어는 15자/초', () => {
    expect(estimateReadingSec('a'.repeat(150), 'en')).toBeCloseTo(10, 1)
  })
  it('알 수 없는 언어는 en 규칙', () => {
    expect(estimateReadingSec('a'.repeat(150), 'xx')).toBeCloseTo(10, 1)
  })
  it('빈 텍스트도 최소 1초', () => {
    expect(estimateReadingSec('', 'ko')).toBe(1)
  })
})

describe('buildFallbackTimeline', () => {
  it('세그먼트 text 합산 길이로 순차 배치한다', () => {
    const scenes = [
      { storyId: 'u1', segments: [{ text: '가'.repeat(33) }] },           // 6s
      { storyId: 'u2', segments: [{ text: '가'.repeat(22) }, { text: '가'.repeat(22) }] }, // 8s
    ]
    const tl = buildFallbackTimeline(scenes, 'ko')
    expect(tl[0]).toEqual({ storyId: 'u1', startTime: 0, endTime: 6, duration: 6 })
    expect(tl[1].startTime).toBe(6)
    expect(tl[1].duration).toBeCloseTo(8, 1)
    expect(tl[1].endTime).toBeCloseTo(14, 1)
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/electron/story/timing.test.js` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현**

```js
// electron/story/timing.js
/**
 * Story 파이프라인 — 낭독 시간 추정 + 오디오 이전 폴백 타이밍 (스펙 §4-②, §4-④ M1 폴백).
 * 상수는 스펙 §4-② 휴리스틱: ko ≈ 5.5자/초, en ≈ 15자/초.
 */
const CHARS_PER_SEC = { ko: 5.5, en: 15 }

export function estimateReadingSec(text, language) {
  const cps = CHARS_PER_SEC[language] || CHARS_PER_SEC.en
  const sec = (text || '').length / cps
  return Math.max(1, sec)
}

export function buildFallbackTimeline(scenes, language) {
  let cursor = 0
  return scenes.map((scene) => {
    const text = (scene.segments || []).map((s) => s.text || '').join('')
    const duration = estimateReadingSec(text, language)
    const entry = { storyId: scene.storyId, startTime: cursor, endTime: cursor + duration, duration }
    cursor += duration
    return entry
  })
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/electron/story/timing.test.js` / Expected: PASS
- [ ] **Step 5: Commit** — `git add electron/story/timing.js tests/electron/story/timing.test.js && git commit -m "feat(story): 낭독 시간 추정 + M1 폴백 타이밍"`

---

### Task 2: 씬 identity 승계 (`electron/story/sceneIdentity.js`)

**Files:**
- Create: `electron/story/sceneIdentity.js`
- Test: `tests/electron/story/sceneIdentity.test.js`

**Interfaces:**
- Consumes: 없음 (`node:crypto`의 `randomUUID`)
- Produces:
  - `normalizeSceneText(scene) → string` — 세그먼트 text concat 후 공백/문장부호 제거·소문자화
  - `inheritStoryIds(prevScenes, nextScenes) → { scenes, unmatched: { prev: [], next: [] } }` — 스펙 §4-④ 1:1 보수 매칭. `scenes`는 nextScenes에 `storyId` 채워진 배열(미확정은 새 uuid). `unmatched.prev`는 삭제 후보, `unmatched.next`는 신규 취급된 새 씬의 인덱스
  - `assertUniqueStoryIds(scenes)` — 중복 시 throw (push 전 invariant)

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/story/sceneIdentity.test.js
import { describe, it, expect } from 'vitest'
import { normalizeSceneText, inheritStoryIds, assertUniqueStoryIds } from '../../../electron/story/sceneIdentity.js'

const scene = (storyId, ...texts) => ({ storyId, segments: texts.map((t) => ({ text: t })) })

describe('normalizeSceneText', () => {
  it('공백/문장부호 제거 + 소문자', () => {
    expect(normalizeSceneText(scene(null, 'Hello, World!', ' 안녕 하세요. '))).toBe('helloworld안녕하세요')
  })
})

describe('inheritStoryIds', () => {
  it('텍스트 동일 씬은 storyId 승계', () => {
    const prev = [scene('u1', '첫 장면'), scene('u2', '둘째 장면')]
    const next = [scene(null, '첫 장면'), scene(null, '둘째 장면')]
    const r = inheritStoryIds(prev, next)
    expect(r.scenes[0].storyId).toBe('u1')
    expect(r.scenes[1].storyId).toBe('u2')
    expect(r.unmatched.prev).toEqual([])
  })
  it('앞에 씬이 삽입돼도 뒤 씬 id가 밀리지 않는다', () => {
    const prev = [scene('u1', '기존 장면')]
    const next = [scene(null, '새 도입부'), scene(null, '기존 장면')]
    const r = inheritStoryIds(prev, next)
    expect(r.scenes[1].storyId).toBe('u1')
    expect(r.scenes[0].storyId).toMatch(/^[0-9a-f-]{36}$/)  // 새 uuid
    expect(r.unmatched.next).toEqual([0])
  })
  it('분할(다중 매칭)이면 자동 승계하지 않는다', () => {
    const prev = [scene('u1', '문장A 문장B')]
    const next = [scene(null, '문장A'), scene(null, '문장B')]  // 둘 다 u1에 포함됨
    const r = inheritStoryIds(prev, next)
    expect(r.scenes[0].storyId).not.toBe('u1')
    expect(r.scenes[1].storyId).not.toBe('u1')
    expect(r.unmatched.prev).toEqual(['u1'])
  })
  it('병합(역방향 다중 매칭)도 자동 승계하지 않는다', () => {
    const prev = [scene('u1', '문장A'), scene('u2', '문장B')]
    const next = [scene(null, '문장A 문장B')]
    const r = inheritStoryIds(prev, next)
    expect(['u1', 'u2']).not.toContain(r.scenes[0].storyId)
    expect(r.unmatched.prev.sort()).toEqual(['u1', 'u2'])
  })
})

describe('assertUniqueStoryIds', () => {
  it('중복 storyId면 throw', () => {
    expect(() => assertUniqueStoryIds([{ storyId: 'x' }, { storyId: 'x' }])).toThrow()
    expect(() => assertUniqueStoryIds([{ storyId: 'x' }, { storyId: 'y' }])).not.toThrow()
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/electron/story/sceneIdentity.test.js` / Expected: FAIL

- [ ] **Step 3: 최소 구현**

```js
// electron/story/sceneIdentity.js
/**
 * Story 씬 identity — 스펙 §4-④. identity는 storyId(uuid) 단 하나.
 * ② 재실행 시 이전 scenes.json과 보수적 1:1 매칭으로 승계:
 * 정규화 텍스트 완전/포함 일치 && 상호 유일 매칭일 때만 자동 승계.
 */
import { randomUUID } from 'node:crypto'

export function normalizeSceneText(scene) {
  return (scene.segments || [])
    .map((s) => s.text || '')
    .join('')
    .toLowerCase()
    .replace(/[\s.,!?'"…—–\-()[\]{}:;]/g, '')
}

export function inheritStoryIds(prevScenes, nextScenes) {
  const prevNorm = prevScenes.map((s) => ({ id: s.storyId, text: normalizeSceneText(s) }))
  const nextNorm = nextScenes.map((s) => normalizeSceneText(s))

  const matches = (a, b) => a === b || (a && b && (a.includes(b) || b.includes(a)))

  // 후보 수집: next[i] ↔ prev 후보들, prev[j] ↔ next 후보들
  const nextCandidates = nextNorm.map((nt) => prevNorm.filter((p) => matches(p.text, nt)).map((p) => p.id))
  const prevCandidateCount = new Map(prevNorm.map((p) => [p.id, 0]))
  nextCandidates.forEach((cands) => cands.forEach((id) => prevCandidateCount.set(id, prevCandidateCount.get(id) + 1)))

  const usedPrev = new Set()
  const scenes = nextScenes.map((s, i) => {
    const cands = nextCandidates[i]
    // 1:1 제약: 이 next의 후보가 정확히 1개 && 그 prev를 원하는 next도 정확히 1개
    if (cands.length === 1 && prevCandidateCount.get(cands[0]) === 1 && !usedPrev.has(cands[0])) {
      usedPrev.add(cands[0])
      return { ...s, storyId: cands[0] }
    }
    return { ...s, storyId: randomUUID() }
  })

  const unmatched = {
    prev: prevNorm.map((p) => p.id).filter((id) => !usedPrev.has(id)),
    next: scenes.map((s, i) => i).filter((i) => !usedPrev.has(nextCandidates[i]?.[0]) || nextCandidates[i].length !== 1),
  }
  // unmatched.next: 자동 승계되지 않은(=새 uuid 받은) 인덱스만
  unmatched.next = scenes.map((s, i) => i).filter((i) => !prevNorm.some((p) => p.id === scenes[i].storyId))
  return { scenes, unmatched }
}

export function assertUniqueStoryIds(scenes) {
  const seen = new Set()
  for (const s of scenes) {
    if (seen.has(s.storyId)) throw new Error(`duplicate storyId: ${s.storyId}`)
    seen.add(s.storyId)
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/electron/story/sceneIdentity.test.js` / Expected: PASS. 실패 시 unmatched 계산을 테스트 기대에 맞게 수정 (기대가 정본)
- [ ] **Step 5: Commit** — `git commit -m "feat(story): 씬 identity 승계 (1:1 보수 매칭 + uuid)"`

---

### Task 3: story.json 저장소 (`electron/story/storyStore.js`)

**Files:**
- Create: `electron/story/storyStore.js`
- Test: `tests/electron/story/storyStore.test.js`

**Interfaces:**
- Consumes: `node:fs/promises`, `node:path`
- Produces: `createStoryStore(projectPath)` →
  - `load() → storyState` (없으면 `defaultStoryState()` 반환)
  - `save(state)` — `story/story.json`에 **원자적 쓰기** (`.tmp` 쓰고 rename)
  - `saveText(relPath, text)` / `loadText(relPath)` — `story/script.md`, `story/scenes.json`용
  - `defaultStoryState()` — 스펙 §3 스키마 (steps 4개 pending, pendingPushRevision:0, lastPushedRevision:0, speakers:[])

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/story/storyStore.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStoryStore, defaultStoryState } from '../../../electron/story/storyStore.js'

let dir
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'story-')) })

describe('storyStore', () => {
  it('없으면 default 상태를 반환한다', async () => {
    const store = createStoryStore(dir)
    const s = await store.load()
    expect(s.steps.script.status).toBe('pending')
    expect(s.pendingPushRevision).toBe(0)
    expect(s.lastPushedRevision).toBe(0)
  })
  it('save 후 load 왕복', async () => {
    const store = createStoryStore(dir)
    const s = defaultStoryState()
    s.steps.script.status = 'done'
    await store.save(s)
    const loaded = await store.load()
    expect(loaded.steps.script.status).toBe('done')
  })
  it('원자적 쓰기 — tmp 파일이 남지 않는다', async () => {
    const store = createStoryStore(dir)
    await store.save(defaultStoryState())
    const files = await readdir(path.join(dir, 'story'))
    expect(files.filter((f) => f.includes('.tmp'))).toEqual([])
  })
  it('saveText/loadText 왕복 (script.md)', async () => {
    const store = createStoryStore(dir)
    await store.saveText('script.md', '# 대본')
    expect(await store.loadText('script.md')).toBe('# 대본')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/electron/story/storyStore.test.js` / Expected: FAIL

- [ ] **Step 3: 최소 구현**

```js
// electron/story/storyStore.js
/**
 * story.json / story 산출물 영속화 — 스펙 §2, §3.
 * 소유자는 main process 스텝 머신. temp 파일 + rename으로 원자적 쓰기.
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'

export function defaultStoryState() {
  return {
    version: 1,
    input: null,
    engine: { llm: 'gemini' },
    steps: {
      script: { status: 'pending' },
      scenes: { status: 'pending' },
      audio: { status: 'pending', registration: null },
      prompts: { status: 'pending' },
    },
    autoRun: false,
    pushedAt: null,
    pendingPushRevision: 0,
    lastPushedRevision: 0,
    speakers: [],
  }
}

export function createStoryStore(projectPath) {
  const storyDir = path.join(projectPath, 'story')

  async function writeAtomic(relPath, data) {
    await mkdir(path.dirname(path.join(storyDir, relPath)), { recursive: true })
    const target = path.join(storyDir, relPath)
    const tmp = `${target}.tmp-${process.pid}`
    await writeFile(tmp, data, 'utf-8')
    await rename(tmp, target)
  }

  return {
    async load() {
      try {
        return JSON.parse(await readFile(path.join(storyDir, 'story.json'), 'utf-8'))
      } catch {
        return defaultStoryState()
      }
    },
    async save(state) { await writeAtomic('story.json', JSON.stringify(state, null, 2)) },
    async saveText(relPath, text) { await writeAtomic(relPath, text) },
    async loadText(relPath) {
      try { return await readFile(path.join(storyDir, relPath), 'utf-8') } catch { return null }
    },
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/electron/story/storyStore.test.js` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(story): story.json 원자적 저장소"`

---

### Task 4: Gemini LLM 어댑터 (`electron/api/llm/llmGemini.js`)

**Files:**
- Create: `electron/api/llm/llmGemini.js`
- Create: `electron/api/llm/schemas.js`
- Test: `tests/electron/api/llm/llmGemini.test.js`

**Interfaces:**
- Consumes: keyStore가 아닌 **호출자가 주입한 `apiKey`** (스텝 머신이 keyStore에서 꺼내 전달), DI `fetchImpl`
- Produces (스펙 §5 공통 인터페이스):
  - `generateScript(input, opts, { onDelta, signal, fetchImpl }) → { scriptMd }` — `streamGenerateContent` SSE, 조각마다 `onDelta(text)`
  - `splitScenes(scriptMd, opts, { signal, fetchImpl }) → { scenes, speakers }` — `responseSchema` structured output, 파싱 실패 1회 재요청
  - `writePrompts(scenes, context, opts, { signal, fetchImpl }) → { scenes }` — 씬별 `imagePrompt`/`videoPrompt` 채워 반환
  - `opts = { apiKey, model, language, ... }`
- `schemas.js`: `SCENES_SCHEMA`(scenes[].sceneNo/summary/segments[].speaker,text,emotion + speakers[]), `PROMPTS_SCHEMA`(scenes[].sceneNo/imagePrompt/videoPrompt) — Gemini responseSchema 형식

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/api/llm/llmGemini.test.js
import { describe, it, expect, vi } from 'vitest'
import { generateScript, splitScenes, writePrompts } from '../../../../electron/api/llm/llmGemini.js'

// SSE 응답 mock: streamGenerateContent는 "data: {json}\n\n" 라인 스트림
function sseResponse(chunks) {
  const body = chunks
    .map((text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`)
    .join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
function jsonResponse(obj) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
    { status: 200 },
  )
}

const OPTS = { apiKey: 'test-key', model: 'gemini-2.5-pro', language: 'ko' }

describe('generateScript', () => {
  it('SSE 조각을 onDelta로 중계하고 전체를 반환한다', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['# 제목\n', '본문1', '본문2']))
    const deltas = []
    const r = await generateScript({ type: 'title', title: '운수 좋은 날' }, OPTS, {
      onDelta: (t) => deltas.push(t), fetchImpl,
    })
    expect(r.scriptMd).toBe('# 제목\n본문1본문2')
    expect(deltas).toEqual(['# 제목\n', '본문1', '본문2'])
    const url = fetchImpl.mock.calls[0][0]
    expect(url).toContain('streamGenerateContent')
    expect(url).not.toContain('test-key')  // 키는 헤더로 (URL 노출 금지)
    expect(fetchImpl.mock.calls[0][1].headers['x-goog-api-key']).toBe('test-key')
  })
})

describe('splitScenes', () => {
  it('structured output을 파싱해 scenes/speakers 반환', async () => {
    const payload = {
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '옛날에', emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '나레이션' }],
    }
    const fetchImpl = vi.fn(async () => jsonResponse(payload))
    const r = await splitScenes('# 대본', OPTS, { fetchImpl })
    expect(r.scenes).toHaveLength(1)
    expect(r.speakers[0].id).toBe('narrator')
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema).toBeTruthy()
  })
  it('파싱 실패 시 1회 재요청', async () => {
    const good = { scenes: [], speakers: [] }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not-json' }] } }] }), { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(good))
    const r = await splitScenes('# 대본', OPTS, { fetchImpl })
    expect(r.scenes).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('writePrompts', () => {
  it('sceneNo로 매칭해 프롬프트를 채운다', async () => {
    const scenes = [{ storyId: 'u1', sceneNo: 1, segments: [] }]
    const fetchImpl = vi.fn(async () => jsonResponse({ scenes: [{ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: 'VID' }] }))
    const r = await writePrompts(scenes, { scriptMd: '#', style: null }, OPTS, { fetchImpl })
    expect(r.scenes[0]).toMatchObject({ storyId: 'u1', imagePrompt: 'IMG', videoPrompt: 'VID' })
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/electron/api/llm/llmGemini.test.js` / Expected: FAIL

- [ ] **Step 3: 구현**

```js
// electron/api/llm/schemas.js
/** Gemini responseSchema 정의 — 스펙 §4-②/④ structured output. */
export const SCENES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sceneNo: { type: 'INTEGER' },
          summary: { type: 'STRING' },
          segments: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                speaker: { type: 'STRING' },
                text: { type: 'STRING' },
                emotion: { type: 'STRING' },
              },
              required: ['speaker', 'text'],
            },
          },
        },
        required: ['sceneNo', 'summary', 'segments'],
      },
    },
    speakers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, name: { type: 'STRING' } },
        required: ['id', 'name'],
      },
    },
  },
  required: ['scenes', 'speakers'],
}

export const PROMPTS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sceneNo: { type: 'INTEGER' },
          imagePrompt: { type: 'STRING' },
          videoPrompt: { type: 'STRING' },
        },
        required: ['sceneNo', 'imagePrompt', 'videoPrompt'],
      },
    },
  },
  required: ['scenes'],
}
```

```js
// electron/api/llm/llmGemini.js
/**
 * Gemini 텍스트 LLM 어댑터 — 스펙 §5. genai.js(이미지/비디오)와 별개 신규 모듈.
 * 스트리밍(generateScript)은 streamGenerateContent SSE, structured output은
 * responseSchema. 파싱 실패 시 1회 재요청. 키는 헤더(x-goog-api-key)로만 전달.
 */
import { SCENES_SCHEMA, PROMPTS_SCHEMA } from './schemas.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

function headers(apiKey) {
  return { 'content-type': 'application/json', 'x-goog-api-key': apiKey }
}

async function readSse(res, onDelta) {
  const text = await res.text()
  let full = ''
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    try {
      const chunk = JSON.parse(line.slice(6))
      const t = chunk?.candidates?.[0]?.content?.parts?.[0]?.text
      if (t) { full += t; onDelta?.(t) }
    } catch { /* keep-alive 등 무시 */ }
  }
  return full
}

export async function generateScript(input, opts, { onDelta, signal, fetchImpl = fetch } = {}) {
  const prompt = buildScriptPrompt(input, opts)
  const res = await fetchImpl(`${BASE}/${opts.model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: headers(opts.apiKey),
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
    signal,
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const scriptMd = await readSse(res, onDelta)
  return { scriptMd }
}

async function structuredCall(prompt, schema, opts, { signal, fetchImpl = fetch }) {
  const call = async () => {
    const res = await fetchImpl(`${BASE}/${opts.model}:generateContent`, {
      method: 'POST',
      headers: headers(opts.apiKey),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
      }),
      signal,
    })
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
  }
  try { return await call() } catch (e) {
    if (signal?.aborted) throw e
    return await call() // 파싱/일시 오류 1회 재요청 (스펙 §7)
  }
}

export async function splitScenes(scriptMd, opts, ctx = {}) {
  const prompt = buildSplitPrompt(scriptMd, opts)
  const out = await structuredCall(prompt, SCENES_SCHEMA, opts, ctx)
  return { scenes: out.scenes || [], speakers: out.speakers || [] }
}

export async function writePrompts(scenes, context, opts, ctx = {}) {
  const prompt = buildPromptsPrompt(scenes, context, opts)
  const out = await structuredCall(prompt, PROMPTS_SCHEMA, opts, ctx)
  const byNo = new Map((out.scenes || []).map((s) => [s.sceneNo, s]))
  return {
    scenes: scenes.map((s) => ({
      ...s,
      imagePrompt: byNo.get(s.sceneNo)?.imagePrompt ?? s.imagePrompt ?? null,
      videoPrompt: byNo.get(s.sceneNo)?.videoPrompt ?? s.videoPrompt ?? null,
    })),
  }
}

// --- 프롬프트 빌더 (한국어/영어, 스펙 §4 지시 포함) ---
function buildScriptPrompt(input, opts) {
  return [
    `당신은 유튜브 스토리 채널 작가다. 아래 제목으로 ${opts.targetMinutes || 10}분 분량의 나레이션 대본을 ${opts.language === 'ko' ? '한국어' : '영어'}로 작성하라.`,
    opts.genre ? `장르: ${opts.genre}` : '',
    opts.tone ? `톤: ${opts.tone}` : '',
    `제목: ${input.title}`,
    `마크다운으로, 챕터 구분과 (대사가 있으면) 화자 표기를 포함하라.`,
  ].filter(Boolean).join('\n')
}

function buildSplitPrompt(scriptMd, opts) {
  return [
    `아래 대본을 씬으로 분리하라. 각 씬은 낭독 시 6~10초(${opts.language === 'ko' ? '한국어 기준 약 33~55자' : 'about 90~150 chars in English'}) 분량이어야 한다. 초과하면 씬을 분할하라.`,
    `각 씬의 세그먼트마다 speaker(나레이션은 "narrator", 대사는 인물 식별자)와 emotion(normal/happy/sad/angry)을 지정하라.`,
    `등장 화자 전체 목록을 speakers로 반환하라.`,
    `--- 대본 ---`,
    scriptMd,
  ].join('\n')
}

function buildPromptsPrompt(scenes, context, opts) {
  const sceneLines = scenes.map((s) => `${s.sceneNo}. ${s.summary} :: ${(s.segments || []).map((g) => g.text).join(' ')}`)
  return [
    `아래 씬들에 대해 이미지 생성 프롬프트(imagePrompt)와 비디오 생성 프롬프트(videoPrompt)를 영어로 작성하라.`,
    `캐릭터가 등장하면 외형 묘사를 프롬프트에 직접 포함해 씬 간 일관성을 유지하라 (레퍼런스 참조 문법 금지 — 플레인 텍스트).`,
    context.style ? `스타일: ${context.style}` : '',
    `--- 씬 목록 ---`,
    ...sceneLines,
  ].filter(Boolean).join('\n')
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/electron/api/llm/llmGemini.test.js` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(llm): Gemini 텍스트 어댑터 (스트리밍 + structured output)"`

---

### Task 5: 스텝 머신 (`electron/story/stepMachine.js`)

**Files:**
- Create: `electron/story/stepMachine.js`
- Test: `tests/electron/story/stepMachine.test.js`

**Interfaces:**
- Consumes: Task 1 `buildFallbackTimeline`, Task 2 `inheritStoryIds`/`assertUniqueStoryIds`, Task 3 `createStoryStore`, Task 4 LLM 함수들(DI로 주입)
- Produces: `createStepMachine({ projectPath, llm, emit, getApiKey })` →
  - `open() → { projectToken, state }` — 로드 + **재발신 검사**: `pendingPushRevision > lastPushedRevision`이면 push 재발신
  - `getState() → state` (재발신 검사 동일)
  - `start(step, params) → { operationId }` — `script | scenes | prompts` 실행. 하류 리셋 규칙: script→(scenes,prompts pending), scenes→(prompts pending). audio는 M1 미구현(§3 예외 규칙 주석만)
  - `abort()` — AbortController 중단 + 상태 flush
  - `ackPush({ pushRevision, ok })` — ok면 `lastPushedRevision`/`pushedAt` 갱신
  - `emit(channel, payload)`: 모든 payload에 `projectToken`, `operationId` 자동 포함
  - push payload 생성: prompts done 시 `story:pushScenes` — 씬 매핑(§4-④): `{ storyId, sceneNo, prompt: imagePrompt, videoT2VPrompt: videoPrompt, startTime, endTime, duration, srtLineIds: [], subtitle: 세그먼트 text 합침 }` + `pushRevision`

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/story/stepMachine.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

let dir, emitted, llm, machine
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sm-'))
  emitted = []
  llm = {
    generateScript: vi.fn(async (_i, _o, { onDelta }) => { onDelta?.('부분'); return { scriptMd: '# 대본' } }),
    splitScenes: vi.fn(async () => ({
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '나레이션' }],
    })),
    writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s) => ({ ...s, imagePrompt: 'IMG', videoPrompt: 'VID' })) })),
  }
  machine = createStepMachine({
    projectPath: dir, llm,
    emit: (ch, payload) => emitted.push({ ch, payload }),
    getApiKey: () => 'k',
  })
  await machine.open()
})

describe('stepMachine', () => {
  it('script 실행: delta 중계 + done + script.md 저장', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    const state = await machine.getState()
    expect(state.steps.script.status).toBe('done')
    expect(emitted.some((e) => e.ch === 'story:delta' && e.payload.text === '부분')).toBe(true)
    expect(emitted.every((e) => e.payload.projectToken && e.payload.operationId)).toBe(true)
  })

  it('scenes 실행: storyId 발급 + speakers 시드', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    const state = await machine.getState()
    expect(state.steps.scenes.status).toBe('done')
    expect(state.speakers[0].id).toBe('narrator')
  })

  it('prompts 실행: 폴백 타이밍 push 발신 + pendingPushRevision 증가', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})
    const push = emitted.find((e) => e.ch === 'story:pushScenes')
    expect(push).toBeTruthy()
    const scene = push.payload.scenes[0]
    expect(scene).toMatchObject({ prompt: 'IMG', videoT2VPrompt: 'VID', srtLineIds: [] })
    expect(scene.storyId).toMatch(/^[0-9a-f-]{36}$/)
    expect(scene.duration).toBeGreaterThan(0)   // 폴백 타이밍 (0~3 기본값 아님)
    const state = await machine.getState()
    expect(state.pendingPushRevision).toBe(1)
    expect(state.lastPushedRevision).toBe(0)
  })

  it('ackPush(ok)로 lastPushedRevision/pushedAt 갱신', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})
    const push = emitted.find((e) => e.ch === 'story:pushScenes')
    await machine.ackPush({ pushRevision: push.payload.pushRevision, ok: true })
    const state = await machine.getState()
    expect(state.lastPushedRevision).toBe(1)
    expect(state.pushedAt).toBeTruthy()
  })

  it('ack 유실 후 open()이 push를 재발신한다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})
    emitted.length = 0
    await machine.open()   // ack 없이 재시작 시뮬레이션
    expect(emitted.some((e) => e.ch === 'story:pushScenes')).toBe(true)
  })

  it('script 재실행은 scenes/prompts를 pending으로 리셋한다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('script', { input: { type: 'title', title: 'T2' }, options: { language: 'ko' } })
    const state = await machine.getState()
    expect(state.steps.scenes.status).toBe('pending')
    expect(state.steps.prompts.status).toBe('pending')
  })

  it('LLM 에러 시 스텝 status=error + 에러 메시지 보존', async () => {
    llm.generateScript.mockRejectedValueOnce(new Error('429'))
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    const state = await machine.getState()
    expect(state.steps.script.status).toBe('error')
    expect(state.steps.script.error).toContain('429')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/electron/story/stepMachine.test.js` / Expected: FAIL

- [ ] **Step 3: 구현**

```js
// electron/story/stepMachine.js
/**
 * Story 스텝 머신 — 스펙 §2/§3/§4. main process 소유, 결정적 순서 제어.
 * LLM 어댑터는 DI(테스트 mock). emit은 모든 payload에 projectToken/operationId 포함.
 */
import { randomUUID } from 'node:crypto'
import { createStoryStore } from './storyStore.js'
import { inheritStoryIds, assertUniqueStoryIds } from './sceneIdentity.js'
import { buildFallbackTimeline } from './timing.js'

const DOWNSTREAM = { script: ['scenes', 'prompts'], scenes: ['prompts'], prompts: [] }

export function createStepMachine({ projectPath, llm, emit, getApiKey }) {
  const store = createStoryStore(projectPath)
  const projectToken = randomUUID()
  let state = null
  let controller = null

  const send = (ch, payload, operationId) =>
    emit(ch, { projectToken, operationId: operationId || randomUUID(), ...payload })

  async function flush() { await store.save(state) }

  async function maybeResendPush(operationId) {
    if (state.pendingPushRevision > state.lastPushedRevision) {
      const scenesJson = JSON.parse((await store.loadText('scenes.json')) || '{"scenes":[]}')
      sendPush(scenesJson.scenes, operationId)
    }
  }

  function mapScene(s, timing) {
    return {
      storyId: s.storyId,
      sceneNo: s.sceneNo,
      prompt: s.imagePrompt || '',
      videoT2VPrompt: s.videoPrompt || '',
      startTime: timing.startTime,
      endTime: timing.endTime,
      duration: timing.duration,
      srtLineIds: [],                                  // M1: 오디오 없음 (스펙 §4-④ 폴백)
      subtitle: (s.segments || []).map((g) => g.text).join(' '),
    }
  }

  function sendPush(scenes, operationId) {
    assertUniqueStoryIds(scenes)
    const timeline = buildFallbackTimeline(scenes, state.input?.options?.language || 'ko')
    const byId = new Map(timeline.map((t) => [t.storyId, t]))
    send('story:pushScenes', {
      pushRevision: state.pendingPushRevision,
      scenes: scenes.map((s) => mapScene(s, byId.get(s.storyId))),
    }, operationId)
  }

  const steps = {
    async script(params, opId, signal) {
      state.input = params.input ? { ...params.input, options: params.options } : state.input
      const opts = { apiKey: getApiKey(), model: state.engine.model || 'gemini-2.5-pro', ...(params.options || {}) }
      const { scriptMd } = await llm.generateScript(state.input, opts, {
        onDelta: (text) => send('story:delta', { text }, opId), signal,
      })
      await store.saveText('script.md', scriptMd)
    },
    async scenes(params, opId, signal) {
      const scriptMd = await store.loadText('script.md')
      if (!scriptMd) throw new Error('script.md not found — run script step first')
      const opts = { apiKey: getApiKey(), model: state.engine.model || 'gemini-2.5-pro', ...(state.input?.options || {}) }
      const { scenes, speakers } = await llm.splitScenes(scriptMd, opts, { signal })
      const prev = JSON.parse((await store.loadText('scenes.json')) || '{"scenes":[]}').scenes
      const { scenes: withIds } = inheritStoryIds(prev, scenes)
      assertUniqueStoryIds(withIds)
      await store.saveText('scenes.json', JSON.stringify({ scenes: withIds }, null, 2))
      // speakers 병합 (스펙 §4-②): 정규화 이름 완전 일치만 voice 승계
      const norm = (n) => (n || '').replace(/\s/g, '')
      const prevSpeakers = new Map(state.speakers.map((sp) => [norm(sp.name), sp]))
      state.speakers = speakers.map((sp) => ({ ...sp, voice: prevSpeakers.get(norm(sp.name))?.voice ?? null }))
    },
    async prompts(params, opId, signal) {
      const scenesJson = JSON.parse((await store.loadText('scenes.json')) || 'null')
      if (!scenesJson) throw new Error('scenes.json not found — run scenes step first')
      const scriptMd = await store.loadText('script.md')
      const opts = { apiKey: getApiKey(), model: state.engine.model || 'gemini-2.5-pro', ...(state.input?.options || {}) }
      const { scenes } = await llm.writePrompts(scenesJson.scenes, { scriptMd, style: params.style || null }, opts, { signal })
      await store.saveText('scenes.json', JSON.stringify({ scenes }, null, 2))
      state.pendingPushRevision += 1
      sendPush(scenes, opId)
    },
  }

  return {
    projectToken,
    async open() {
      state = await store.load()
      await maybeResendPush()
      send('story:state', { state })
      return { projectToken, state }
    },
    async getState() {
      await maybeResendPush()
      return state
    },
    async start(step, params = {}) {
      if (!steps[step]) throw new Error(`unknown step: ${step}`)
      const operationId = randomUUID()
      controller = new AbortController()
      for (const d of DOWNSTREAM[step]) state.steps[d] = { status: 'pending' }
      state.steps[step] = { status: 'running', updatedAt: new Date().toISOString() }
      await flush(); send('story:state', { state }, operationId)
      try {
        await steps[step](params, operationId, controller.signal)
        state.steps[step] = { status: 'done', updatedAt: new Date().toISOString() }
      } catch (e) {
        state.steps[step] = { status: 'error', error: String(e.message || e), updatedAt: new Date().toISOString() }
      }
      await flush(); send('story:state', { state }, operationId)
      return { operationId }
    },
    async abort() {
      controller?.abort()
      await flush()
    },
    async ackPush({ pushRevision, ok }) {
      if (ok && pushRevision > state.lastPushedRevision) {
        state.lastPushedRevision = pushRevision
        state.pushedAt = new Date().toISOString()
        await flush()
      }
    },
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/electron/story/stepMachine.test.js` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(story): 스텝 머신 (①②④ + push revision + 재발신)"`

---

### Task 6: IPC 등록 + preload 브릿지

**Files:**
- Create: `electron/ipc/story-api.js`
- Modify: `electron/main.js` (registerGenaiIPC 등록부 근처에 registerStoryIPC 추가)
- Modify: `electron/preload.js` (genai 브릿지 아래에 story 브릿지 추가)
- Test: `tests/electron/ipc/story-api.test.js`

**Interfaces:**
- Consumes: Task 5 `createStepMachine`, 기존 `keyStore`
- Produces: `registerStoryIPC(ipcMain, { keyStore, getWindow, llm })` — 채널 (스펙 §6):
  - handle `story:open({ projectPath })` → `{ projectToken, state }` (프로젝트별 머신 생성/교체, 이전 머신 abort)
  - handle `story:get-state({ projectToken })` → state (토큰 불일치 시 `{ error: 'stale-token' }`)
  - handle `story:start({ projectToken, step, params })` → `{ operationId }`
  - handle `story:abort({ projectToken })`
  - handle `story:push-ack({ projectToken, operationId, pushRevision, ok, reason })`
  - M→R: `webContents.send('story:state' | 'story:delta' | 'story:progress' | 'story:pushScenes', payload)`
- preload: `storyOpen/storyGetState/storyStart/storyAbort/storyPushAck` invoke + `onStoryEvent(channel, cb)` 구독 헬퍼

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/ipc/story-api.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerStoryIPC } from '../../../electron/ipc/story-api.js'

function fakeIpcMain() {
  const handlers = new Map()
  return { handle: (ch, fn) => handlers.set(ch, fn), invoke: (ch, payload) => handlers.get(ch)(null, payload), handlers }
}

let ipc, sent, dir
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ipc-'))
  ipc = fakeIpcMain()
  sent = []
  const llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '#' })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (s) => ({ scenes: s })),
  }
  registerStoryIPC(ipc, {
    keyStore: { getKey: () => 'k' },
    getWindow: () => ({ webContents: { send: (ch, p) => sent.push({ ch, p }) }, isDestroyed: () => false }),
    llm,
  })
})

describe('story IPC', () => {
  it('story:open → projectToken 발급 + state 반환', async () => {
    const r = await ipc.invoke('story:open', { projectPath: dir })
    expect(r.projectToken).toBeTruthy()
    expect(r.state.steps.script.status).toBe('pending')
  })
  it('stale token 명령 거부', async () => {
    await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:start', { projectToken: 'wrong', step: 'script', params: {} })
    expect(r.error).toBe('stale-token')
  })
  it('start 실행 시 story:state 이벤트가 window로 발신된다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:start', { projectToken, step: 'script', params: { input: { type: 'title', title: 'T' }, options: {} } })
    const stateEvents = sent.filter((e) => e.ch === 'story:state')
    expect(stateEvents.length).toBeGreaterThan(0)
    expect(stateEvents[0].p.projectToken).toBe(projectToken)
  })
  it('재open 시 새 토큰 발급 (이전 토큰 무효)', async () => {
    const a = await ipc.invoke('story:open', { projectPath: dir })
    const b = await ipc.invoke('story:open', { projectPath: dir })
    expect(a.projectToken).not.toBe(b.projectToken)
    const r = await ipc.invoke('story:get-state', { projectToken: a.projectToken })
    expect(r.error).toBe('stale-token')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/electron/ipc/story-api.test.js` / Expected: FAIL

- [ ] **Step 3: 구현**

```js
// electron/ipc/story-api.js
/**
 * Story 파이프라인 IPC — 스펙 §6. 프로젝트당 하나의 스텝 머신 인스턴스.
 * 모든 R→M 명령은 projectToken 검증, 불일치 시 { error: 'stale-token' }.
 */
import { createStepMachine } from '../story/stepMachine.js'
import * as llmGemini from '../api/llm/llmGemini.js'

export function registerStoryIPC(ipcMain, { keyStore, getWindow, llm = llmGemini }) {
  let machine = null

  const emit = (channel, payload) => {
    const win = getWindow?.()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  const guarded = (fn) => async (_e, payload = {}) => {
    if (!machine || payload.projectToken !== machine.projectToken) return { error: 'stale-token' }
    return fn(payload)
  }

  ipcMain.handle('story:open', async (_e, { projectPath } = {}) => {
    if (machine) await machine.abort()
    machine = createStepMachine({ projectPath, llm, emit, getApiKey: () => keyStore.getKey() })
    return machine.open()
  })

  ipcMain.handle('story:get-state', guarded(async () => machine.getState()))
  ipcMain.handle('story:start', guarded(({ step, params }) => machine.start(step, params)))
  ipcMain.handle('story:abort', guarded(() => machine.abort()))
  ipcMain.handle('story:push-ack', guarded(({ pushRevision, ok }) => machine.ackPush({ pushRevision, ok })))
}
```

`electron/main.js` 수정 (registerGenaiIPC 호출부 바로 아래):

```js
import { registerStoryIPC } from './ipc/story-api.js'
// ... registerGenaiIPC(...) 다음 줄:
registerStoryIPC(ipcMain, { keyStore, getWindow: () => mainWindow })
```

`electron/preload.js` 수정 (genai 브릿지 아래):

```js
  // --- Story pipeline ---
  storyOpen: (params) => ipcRenderer.invoke('story:open', params),
  storyGetState: (params) => ipcRenderer.invoke('story:get-state', params),
  storyStart: (params) => ipcRenderer.invoke('story:start', params),
  storyAbort: (params) => ipcRenderer.invoke('story:abort', params),
  storyPushAck: (params) => ipcRenderer.invoke('story:push-ack', params),
  onStoryEvent: (channel, cb) => {
    const valid = ['story:state', 'story:delta', 'story:progress', 'story:pushScenes']
    if (!valid.includes(channel)) return () => {}
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/electron/ipc/story-api.test.js` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(story): IPC 계층 + preload 브릿지"`

---

### Task 7: `useScenes.importStoryScenes` (push 수신 계약)

**Files:**
- Modify: `src/hooks/useScenes.js` (return 객체에 `importStoryScenes` 추가)
- Test: `tests/hooks/useScenes.importStoryScenes.test.js`

**Interfaces:**
- Consumes: 기존 `normalizeScene`, `scenesRef`, `_setScenes`, `_setSrtTrack` (파일 내부)
- Produces: `importStoryScenes({ scenes, srtTrack }) → { nextScenes, nextSrtTrack }` — 스펙 §4-④:
  - `storyId` 기준 upsert (기존 non-story 씬 보존)
  - 기존 story 씬과 프롬프트 다르면: 이미지 보존 + `stalePrompt: true, stalePromptAt: now`
  - `videoT2VPrompt`/`duration` 변경 + 기존 비디오 존재 시: `staleVideo: true, staleVideoAt: now`
  - payload에 없는 storyId 씬은 **유지** (삭제는 확인 다이얼로그 후 별도 — M1은 유지만)
  - `srtTrack` 인자가 있으면 wholesale 교체 + non-story 씬의 `srtLineIds` 비움; 없으면(M1) srtTrack 불변
  - subtitle 필드는 씬의 `subtitle`로 저장 (M1은 srtLineIds 빈 배열)

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/hooks/useScenes.importStoryScenes.test.js
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes.js'

const pushScene = (storyId, over = {}) => ({
  storyId, sceneNo: 1, prompt: 'IMG', videoT2VPrompt: 'VID',
  startTime: 0, endTime: 6, duration: 6, srtLineIds: [], subtitle: '자막', ...over,
})

describe('importStoryScenes', () => {
  it('신규 push: 씬이 그리드에 추가되고 매핑이 적용된다', () => {
    const { result } = renderHook(() => useScenes())
    let ret
    act(() => { ret = result.current.importStoryScenes({ scenes: [pushScene('u1')] }) })
    const s = result.current.scenes.find((x) => x.storyId === 'u1')
    expect(s).toMatchObject({ prompt: 'IMG', videoT2VPrompt: 'VID', duration: 6 })
    expect(s.id).toMatch(/^scene_/)
    expect(ret.nextScenes).toHaveLength(1)
  })

  it('재push: 프롬프트 변경 시 이미지 보존 + stalePrompt', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1')] }) })
    act(() => {
      // 이미지가 생성된 상태 시뮬레이션
      result.current.setScenes(result.current.scenes.map((s) => ({ ...s, image: 'file://img.png' })))
    })
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1', { prompt: 'IMG2' })] }) })
    const s = result.current.scenes.find((x) => x.storyId === 'u1')
    expect(s.prompt).toBe('IMG2')
    expect(s.image).toBe('file://img.png')
    expect(s.stalePrompt).toBe(true)
    expect(s.stalePromptAt).toBeTruthy()
  })

  it('non-story 씬은 보존된다', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.setScenes([{ id: 'scene_1', prompt: '기존' }]) })
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1')] }) })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.scenes[0].prompt).toBe('기존')
  })

  it('srtTrack 포함 push: wholesale 교체 + non-story 씬 srtLineIds 비움', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([{ id: 'scene_1', prompt: '기존', srtLineIds: ['sub_1'] }])
      result.current.setSrtTrack([{ id: 'sub_1', text: '옛 자막', startTime: 0, endTime: 1 }])
    })
    const newTrack = [{ id: 'story_1', text: '새 자막', startTime: 0, endTime: 6 }]
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1', { srtLineIds: ['story_1'] })], srtTrack: newTrack }) })
    expect(result.current.srtTrack).toEqual(newTrack)
    expect(result.current.scenes.find((s) => s.id === 'scene_1').srtLineIds).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/hooks/useScenes.importStoryScenes.test.js` / Expected: FAIL

- [ ] **Step 3: 구현** — `useScenes.js`의 return 객체 앞에 추가하고 return에 노출:

```js
  // Story 파이프라인 push 수신 (스펙 §4-④). storyId 기준 upsert, 트랜잭션의
  // 적용 결과를 동기 반환 — 호출자(App)는 이 반환값으로 명시 payload 저장 후 ack.
  const importStoryScenes = useCallback(({ scenes: pushScenes, srtTrack: newSrtTrack }) => {
    const now = new Date().toISOString()
    const current = scenesRef.current
    const byStoryId = new Map(current.filter((s) => s.storyId).map((s) => [s.storyId, s]))
    let nextIdNum = current.length

    const upserted = pushScenes.map((p) => {
      const prev = byStoryId.get(p.storyId)
      if (!prev) {
        nextIdNum += 1
        return normalizeScene({ ...p, id: `scene_${nextIdNum}` }, nextIdNum - 1)
      }
      const merged = { ...prev, ...p, id: prev.id }
      if (prev.prompt !== p.prompt && (prev.image || prev.imagePath)) {
        merged.stalePrompt = true
        merged.stalePromptAt = now
      }
      const hasVideo = prev.videoT2V || prev.videoT2VPath || prev.videoI2V || prev.videoI2VPath
      if (hasVideo && (prev.videoT2VPrompt !== p.videoT2VPrompt || Math.abs((prev.duration || 0) - p.duration) > 0.5)) {
        merged.staleVideo = true
        merged.staleVideoAt = now
      }
      return normalizeScene(merged, 0)
    })

    const pushedIds = new Set(pushScenes.map((p) => p.storyId))
    const kept = current.filter((s) => !s.storyId || !pushedIds.has(s.storyId))
    const keptAdjusted = newSrtTrack
      ? kept.map((s) => (!s.storyId && s.srtLineIds?.length ? { ...s, srtLineIds: [] } : s))
      : kept

    const nextScenes = [...keptAdjusted, ...upserted]
    // 함수형 호출 — plain array 호출은 wholesale-replacement 로 취급돼 ID 카운터가
    // reset 됨 (삭제 이력이 있으면 재발급 위험). advance-only 경로를 타도록 함수형 호출.
    setScenes(() => nextScenes)
    const nextSrtTrack = newSrtTrack ?? srtTrackRef.current
    if (newSrtTrack) setSrtTrack(newSrtTrack)
    return { nextScenes, nextSrtTrack }
  }, [])
```

주의: `setScenes`/`setSrtTrack`은 이 파일의 wrapper(ref 동기 갱신 포함)를 사용. `srtTrackRef`가 없다면 scenesRef와 같은 패턴으로 존재하는지 확인 후 사용 (이미 있음 — 파일 상단 주석 참조).

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/hooks/useScenes.importStoryScenes.test.js` / Expected: PASS
- [ ] **Step 5: 기존 useScenes 테스트 회귀 확인** — Run: `npx vitest run tests/hooks/` / Expected: 전부 PASS
- [ ] **Step 6: Commit** — `git commit -m "feat(scenes): importStoryScenes — storyId upsert + stale 플래그 + srtTrack 교체"`

---

### Task 8: `saveCurrentProjectWithPayload` (`src/hooks/useProjectData.js`)

**Files:**
- Modify: `src/hooks/useProjectData.js`
- Test: `tests/hooks/useProjectData.savePayload.test.js`

**Interfaces:**
- Consumes: 기존 `saveCurrentProject`가 쓰는 저장 함수(`fileSystemAPI.saveProject` 계열 — 파일 내 기존 구현 확인 후 동일 경로 사용)
- Produces: `saveCurrentProjectWithPayload({ scenes, srtTrack }) → Promise<{ ok }>` — **명시 payload로 저장** (render 클로저의 scenes/srtTrack 무시). 나머지 필드(references 등)는 기존 저장 로직과 동일하게 현재 값 사용

- [ ] **Step 1: 실패 테스트 작성** — 기존 `saveCurrentProject` 테스트 파일(tests/hooks/에서 grep으로 찾기)의 mock 패턴을 그대로 따라, payload로 준 scenes가 저장 호출에 실리는지 검증:

```js
// tests/hooks/useProjectData.savePayload.test.js
// (기존 useProjectData 테스트의 setup/mock을 복사해 사용 — fileSystemAPI mock 포함)
import { describe, it, expect, vi } from 'vitest'
// 핵심 단언:
// 1) saveCurrentProjectWithPayload({ scenes: [S], srtTrack: [T] }) 호출 시
//    저장 IPC/파일 쓰기 mock이 받은 데이터에 S와 T가 포함된다 (클로저의 옛 값이 아니라)
// 2) 반환 { ok: true }
```

구현 담당자 주의: `useProjectData.js`의 실제 `saveCurrentProject` 구현(약 1122행 부근)을 먼저 읽고, 그 저장 경로·직렬화 포맷을 **그대로 복사**하되 scenes/srtTrack만 인자로 치환한 함수를 추가하라. 공통 부분은 내부 함수 `buildProjectPayload({ scenes, srtTrack })`로 추출해 기존 `saveCurrentProject`도 이를 쓰도록 리팩터 (동작 불변, 기존 테스트로 검증).

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/hooks/useProjectData.savePayload.test.js` / Expected: FAIL
- [ ] **Step 3: 구현** — 위 지침대로 `buildProjectPayload` 추출 + `saveCurrentProjectWithPayload` 추가, return에 노출
- [ ] **Step 4: 통과 + 회귀 확인** — Run: `npx vitest run tests/hooks/` / Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(project): saveCurrentProjectWithPayload — 명시 payload 저장 (stale closure 방지)"`

---

### Task 9: `useStoryPipeline` 훅 + push 배선

**Files:**
- Create: `src/hooks/useStoryPipeline.js`
- Modify: `src/App.jsx` (훅 연결 + pushScenes 핸들러)
- Test: `tests/hooks/useStoryPipeline.test.js`

**Interfaces:**
- Consumes: preload 브릿지(`window.electronAPI.story*`, `onStoryEvent`), Task 7 `importStoryScenes`, Task 8 `saveCurrentProjectWithPayload`
- Produces: `useStoryPipeline({ projectPath, onPushScenes })` →
  - `{ state, streamingText, open, start, abort }`
  - 이벤트 수신 시 **projectToken 불일치 drop** (스펙 §6)
  - `story:pushScenes` 수신 → `onPushScenes(payload)` 호출 → 반환 Promise 성공 시 `storyPushAck({ ..., ok: true })`, 실패 시 `ok: false, reason`
- App.jsx 배선: `onPushScenes = async (payload) => { const { nextScenes, nextSrtTrack } = scenesHook.importStoryScenes(payload); await projectData.saveCurrentProjectWithPayload({ scenes: nextScenes, srtTrack: nextSrtTrack }) }`

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/hooks/useStoryPipeline.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useStoryPipeline } from '../../src/hooks/useStoryPipeline.js'

let listeners
beforeEach(() => {
  listeners = {}
  window.electronAPI = {
    storyOpen: vi.fn(async () => ({ projectToken: 'tok1', state: { steps: {} } })),
    storyStart: vi.fn(async () => ({ operationId: 'op1' })),
    storyAbort: vi.fn(async () => ({})),
    storyPushAck: vi.fn(async () => ({})),
    onStoryEvent: vi.fn((ch, cb) => { listeners[ch] = cb; return () => delete listeners[ch] }),
  }
})

describe('useStoryPipeline', () => {
  it('open 후 state 이벤트를 반영한다', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    act(() => listeners['story:state']({ projectToken: 'tok1', state: { steps: { script: { status: 'done' } } } }))
    expect(result.current.state.steps.script.status).toBe('done')
  })
  it('토큰 불일치 이벤트는 drop', async () => {
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: vi.fn() }))
    await act(() => result.current.open())
    act(() => listeners['story:state']({ projectToken: 'OTHER', state: { steps: { script: { status: 'done' } } } }))
    expect(result.current.state?.steps?.script?.status).not.toBe('done')
  })
  it('pushScenes 수신 → onPushScenes 성공 → ack(ok:true)', async () => {
    const onPushScenes = vi.fn(async () => {})
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes }))
    await act(() => result.current.open())
    await act(() => listeners['story:pushScenes']({ projectToken: 'tok1', operationId: 'op2', pushRevision: 1, scenes: [] }))
    await waitFor(() => expect(window.electronAPI.storyPushAck).toHaveBeenCalledWith(
      expect.objectContaining({ projectToken: 'tok1', pushRevision: 1, ok: true }),
    ))
  })
  it('onPushScenes 실패 → ack(ok:false)', async () => {
    const onPushScenes = vi.fn(async () => { throw new Error('save fail') })
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes }))
    await act(() => result.current.open())
    await act(() => listeners['story:pushScenes']({ projectToken: 'tok1', operationId: 'op2', pushRevision: 1, scenes: [] }))
    await waitFor(() => expect(window.electronAPI.storyPushAck).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, reason: expect.stringContaining('save fail') }),
    ))
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/hooks/useStoryPipeline.test.js` / Expected: FAIL

- [ ] **Step 3: 구현**

```js
// src/hooks/useStoryPipeline.js
/**
 * Story 파이프라인 renderer 훅 — 스펙 §6. main 스텝 머신의 이벤트를 구독하고
 * projectToken 불일치 이벤트를 drop. push 수신 시 onPushScenes 트랜잭션 후 ack.
 */
import { useState, useCallback, useRef, useEffect } from 'react'

export function useStoryPipeline({ projectPath, onPushScenes }) {
  const [state, setState] = useState(null)
  const [streamingText, setStreamingText] = useState('')
  const tokenRef = useRef(null)
  const onPushRef = useRef(onPushScenes)
  onPushRef.current = onPushScenes

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onStoryEvent) return
    const offs = [
      api.onStoryEvent('story:state', (p) => {
        if (p.projectToken !== tokenRef.current) return
        setState(p.state)
      }),
      api.onStoryEvent('story:delta', (p) => {
        if (p.projectToken !== tokenRef.current) return
        setStreamingText((t) => t + p.text)
      }),
      api.onStoryEvent('story:pushScenes', async (p) => {
        if (p.projectToken !== tokenRef.current) return
        try {
          await onPushRef.current(p)
          await api.storyPushAck({ projectToken: p.projectToken, operationId: p.operationId, pushRevision: p.pushRevision, ok: true })
        } catch (e) {
          await api.storyPushAck({ projectToken: p.projectToken, operationId: p.operationId, pushRevision: p.pushRevision, ok: false, reason: String(e.message || e) })
        }
      }),
    ]
    return () => offs.forEach((off) => off?.())
  }, [])

  const open = useCallback(async () => {
    const r = await window.electronAPI.storyOpen({ projectPath })
    tokenRef.current = r.projectToken
    setState(r.state)
    return r
  }, [projectPath])

  const start = useCallback(async (step, params) => {
    setStreamingText('')
    return window.electronAPI.storyStart({ projectToken: tokenRef.current, step, params })
  }, [])

  const abort = useCallback(() => window.electronAPI.storyAbort({ projectToken: tokenRef.current }), [])

  return { state, streamingText, open, start, abort }
}
```

App.jsx 배선 (scenesHook·projectData가 이미 있는 위치에):

```jsx
const storyPipeline = useStoryPipeline({
  projectPath: currentProjectPath,   // 기존 프로젝트 경로 상태 사용
  onPushScenes: async (payload) => {
    const { nextScenes, nextSrtTrack } = scenesHook.importStoryScenes(payload)
    await projectData.saveCurrentProjectWithPayload({ scenes: nextScenes, srtTrack: nextSrtTrack })
  },
})
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/hooks/useStoryPipeline.test.js` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(story): useStoryPipeline 훅 + push ack 트랜잭션 배선"`

---

### Task 10: Story 뷰 UI 골격

**Files:**
- Create: `src/components/story/StoryView.jsx`, `src/components/story/StoryStepper.jsx`, `src/components/story/StoryView.css`
- Modify: `src/Shell.jsx` 또는 `src/App.jsx` (뷰 전환 상태 + Header 진입 버튼 — 기존 뷰 전환 패턴 확인 후 동일하게)
- Test: `tests/components/story/StoryView.test.jsx`

**Interfaces:**
- Consumes: Task 9 `useStoryPipeline` 반환값을 props로 받음 (`{ state, streamingText, start, abort }`)
- Produces: `<StoryView pipeline={...} />` — 스펙 §6 레이아웃:
  - 상단 `<StoryStepper steps={state.steps} />`: ① 대본 → ② 씬 분리 → ③ 오디오(M1: "M2 예정" 비활성) → ④ 프롬프트, 상태 뱃지 (pending/running/done/error)
  - 중앙: 현재 단계 콘텐츠 — ① 제목 입력 폼(제목/장르/길이/언어) + 스트리밍 대본 표시(textarea, 편집 가능) / ② 씬·세그먼트 테이블(읽기 전용 M1) / ④ 프롬프트 테이블(읽기 전용 M1)
  - 하단: `다음 단계` 버튼(현재 단계 done일 때 활성), `이 단계 재실행`, `대본으로 시작` 진입 시 ① 스킵
  - 인라인 편집·autoRun 토글은 M1 범위 밖 (다음 마일스톤) — 버튼 자리만

- [ ] **Step 1: 실패 테스트 작성**

```jsx
// tests/components/story/StoryView.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

const pipeline = (over = {}) => ({
  state: {
    steps: {
      script: { status: 'pending' }, scenes: { status: 'pending' },
      audio: { status: 'pending' }, prompts: { status: 'pending' },
    },
    speakers: [],
  },
  streamingText: '',
  start: vi.fn(), abort: vi.fn(),
  ...over,
})

describe('StoryView', () => {
  it('스텝퍼에 4단계와 상태 뱃지를 렌더한다', () => {
    render(<StoryView pipeline={pipeline()} />)
    expect(screen.getByText(/대본/)).toBeTruthy()
    expect(screen.getByText(/씬 분리/)).toBeTruthy()
    expect(screen.getByText(/오디오/)).toBeTruthy()
    expect(screen.getByText(/프롬프트/)).toBeTruthy()
  })
  it('제목 입력 후 시작하면 start("script")가 호출된다', () => {
    const p = pipeline()
    render(<StoryView pipeline={p} />)
    fireEvent.change(screen.getByPlaceholderText(/제목/), { target: { value: '운수 좋은 날' } })
    fireEvent.click(screen.getByRole('button', { name: /대본 생성/ }))
    expect(p.start).toHaveBeenCalledWith('script', expect.objectContaining({
      input: expect.objectContaining({ title: '운수 좋은 날' }),
    }))
  })
  it('script running이면 스트리밍 텍스트를 표시한다', () => {
    const p = pipeline({ streamingText: '옛날 옛적에...' })
    p.state.steps.script.status = 'running'
    render(<StoryView pipeline={p} />)
    expect(screen.getByText(/옛날 옛적에/)).toBeTruthy()
  })
  it('script done이면 다음 단계(씬 분리) 버튼이 활성화된다', () => {
    const p = pipeline()
    p.state.steps.script.status = 'done'
    render(<StoryView pipeline={p} />)
    const btn = screen.getByRole('button', { name: /씬 분리 실행/ })
    fireEvent.click(btn)
    expect(p.start).toHaveBeenCalledWith('scenes', expect.anything())
  })
  it('에러 단계는 error 뱃지 + 재실행 버튼', () => {
    const p = pipeline()
    p.state.steps.script.status = 'error'
    p.state.steps.script.error = '429'
    render(<StoryView pipeline={p} />)
    expect(screen.getByText(/429/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /재실행/ })).toBeTruthy()
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/components/story/StoryView.test.jsx` / Expected: FAIL
- [ ] **Step 3: 구현** — StoryStepper(단계 뱃지 pill, 기존 QAProgressBanner의 클래스 스타일 참고), StoryView(단계별 패널 switch + 하단 컨트롤). 테스트의 role/name·placeholder 문자열이 정본. i18n은 기존 `useI18n` 패턴 사용하되 테스트에서 한국어 기본값이 보이도록 fallback 문자열 유지
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/components/story/StoryView.test.jsx` / Expected: PASS
- [ ] **Step 5: Shell/App 배선** — 기존 뷰 전환 상태(예: activeView)에 `'story'` 추가, Header에 "Story" 진입 버튼(기존 버튼 스타일). 빌드 확인: `npx vite build` / Expected: 성공
- [ ] **Step 6: Commit** — `git commit -m "feat(story): Story 뷰 골격 (스텝퍼 + 단계 패널 + 진입점)"`

---

### Task 11: 통합 테스트 — 제목→프롬프트→그리드 push 전체 흐름

**Files:**
- Test: `tests/integration/storyPipelineM1.test.js`

**Interfaces:**
- Consumes: Task 5 stepMachine(mock LLM), Task 7 importStoryScenes — main 로직과 renderer 로직을 한 테스트에서 연결

- [ ] **Step 1: 테스트 작성**

```js
// tests/integration/storyPipelineM1.test.js
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { renderHook, act } from '@testing-library/react'
import { createStepMachine } from '../../electron/story/stepMachine.js'
import { useScenes } from '../../src/hooks/useScenes.js'

describe('M1 통합: 제목 → 대본 → 씬 → 프롬프트 → 그리드 push', () => {
  it('push payload가 그리드에 반영되고 ack로 revision이 확정된다', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'int-'))
    const llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '# 운수 좋은 날\n김첨지는...' })),
      splitScenes: vi.fn(async () => ({
        scenes: [
          { sceneNo: 1, summary: '비 오는 아침', segments: [{ speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' }] },
          { sceneNo: 2, summary: '인력거', segments: [{ speaker: 'kim', text: '가'.repeat(35), emotion: 'happy' }] },
        ],
        speakers: [{ id: 'narrator', name: '나레이션' }, { id: 'kim', name: '김첨지' }],
      })),
      writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s) => ({ ...s, imagePrompt: `IMG${s.sceneNo}`, videoPrompt: `VID${s.sceneNo}` })) })),
    }
    const emitted = []
    const machine = createStepMachine({ projectPath: dir, llm, emit: (ch, p) => emitted.push({ ch, p }), getApiKey: () => 'k' })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: '운수 좋은 날' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})

    const push = emitted.find((e) => e.ch === 'story:pushScenes')
    expect(push.p.scenes).toHaveLength(2)

    // renderer 측 적용
    const { result } = renderHook(() => useScenes())
    let ret
    act(() => { ret = result.current.importStoryScenes({ scenes: push.p.scenes }) })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.scenes[0].prompt).toBe('IMG1')
    expect(result.current.scenes[1].startTime).toBeGreaterThan(0)  // 폴백 타이밍 순차 배치

    // ack → revision 확정
    await machine.ackPush({ pushRevision: push.p.pushRevision, ok: true })
    const state = await machine.getState()
    expect(state.lastPushedRevision).toBe(state.pendingPushRevision)

    // 재open 시 재발신 없음
    const before = emitted.length
    await machine.open()
    expect(emitted.slice(before).filter((e) => e.ch === 'story:pushScenes')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 통과 확인** — Run: `npx vitest run tests/integration/storyPipelineM1.test.js` / Expected: PASS (선행 태스크가 전부 완료됐다면 새 코드 없이 통과해야 정상. 실패하면 해당 모듈 버그 수정)
- [ ] **Step 3: 전체 테스트** — Run: `npm run test:run` / Expected: 전부 PASS
- [ ] **Step 4: Commit** — `git commit -m "test(story): M1 통합 테스트 (제목→프롬프트→push→ack)"`

---

## Self-Review 결과

- **스펙 커버리지 (M1 범위)**: §2 상태 소유권/토큰(T5·T6), §3 스키마/리셋 규칙(T3·T5), §4-①②④(T4·T5), M1 폴백 타이밍(T1·T5), 씬 identity(T2), push 계약·ack·재발신(T5·T7·T8·T9), §6 IPC/뷰(T6·T9·T10), §8 테스트(전 태스크+T11). §4-③·speakers voice 배정 UI·autoRun·M2/M3 항목은 의도적 제외 (마일스톤 분할)
- **잔여 리스크**: T8은 기존 `saveCurrentProject` 내부 구조 의존이라 코드 스케치 대신 리팩터 지침으로 명시 (구현자가 실제 코드 확인 필수)
- **타입 일관성**: push payload 필드(`storyId/sceneNo/prompt/videoT2VPrompt/startTime/endTime/duration/srtLineIds/subtitle`)가 T5 생산 ↔ T7 소비 ↔ T11 검증에서 동일함 확인
