# Story 파이프라인 Claude 엔진 (1단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AutoFlowCut의 Story 대본 파이프라인(대본→씬분리→프롬프트)을 Claude Agent SDK로 구동하고, 대본 생성에 story-engine 장르 메타프롬프트를 주입해 키 없이(로컬 Claude 로그인) 파이프라인을 끝까지 돌린다.

**Architecture:** `llmClaude`를 기존 `llmGemini`와 동일 시그니처로 신설하고, 순수 SDK 헬퍼(`claudeSdk.js`)·프롬프트 빌더(`prompts.js`)·스키마 변환(`toJsonSchema.js`)·메타프롬프트 로더(`metaPrompts.js`)로 분리한다. 대본은 partial-message 스트리밍, 씬분리/프롬프트는 `outputFormat`(json_schema) structured output + 폴백. stepMachine은 엔진 주입·기본값만 Claude로 바꾼다.

**Tech Stack:** Electron(main/renderer), React, Vitest, `@anthropic-ai/claude-agent-sdk` ^0.3.x.

## Global Constraints

- Claude 모델 기본값: `claude-opus-4-8` (opts.model로 오버라이드 가능).
- 인증: 로컬 Claude 로그인. API 키 입력 불필요 — 키 미설정에도 동작.
- SDK 격리 옵션 고정: `tools:[]`, `settingSources:[]`, `skills:[]`, `thinking:{type:'disabled'}`, `maxTurns:2`.
- `llmClaude`는 `llmGemini`와 **동일 시그니처**: `generateScript(input, opts, {onDelta,signal,queryImpl})`, `splitScenes(scriptMd, opts, {signal,queryImpl})`, `writePrompts(scenes, context, opts, {signal,queryImpl})`.
- TDD 필수(vitest). 테스트는 `tests/`가 `electron/`·`src/` 구조를 미러링. 단일 실행 `npx vitest run <path>`.
- 브랜치: `feature/story-pipeline` 위에 이어서 작업.
- 프롬프트 빌더·스키마는 두 엔진 공유(중복 금지, DRY).

---

### Task 1: 의존성 추가 + 패키징 언팩 설정

**Files:**
- Modify: `package.json` (dependencies, build.asarUnpack)
- Test: `tests/electron/api/llm/claudeSdkImport.test.js`

**Interfaces:**
- Produces: `@anthropic-ai/claude-agent-sdk` 런타임 로드 가능.

- [ ] **Step 1: 의존성 설치**

Run:
```bash
cd ~/workspace/AutoFlowCut && npm install --save @anthropic-ai/claude-agent-sdk@^0.3.178
```
Expected: `package.json` dependencies에 항목 추가, 설치 성공.

- [ ] **Step 2: 패키징 언팩 설정 추가**

`package.json`의 `build`에 `asarUnpack` 추가(SDK가 claude 바이너리 subprocess를 실행하므로 ASAR 밖으로 언팩):
```json
"build": {
  "asarUnpack": [
    "node_modules/@anthropic-ai/claude-agent-sdk/**"
  ]
}
```
(기존 `build`에 다른 키가 있으면 병합. `extraResources`/기타 키는 유지.)

- [ ] **Step 3: import 스모크 테스트 작성**

`tests/electron/api/llm/claudeSdkImport.test.js`:
```js
import { describe, it, expect } from 'vitest'

describe('claude-agent-sdk 로드', () => {
  it('query export가 존재한다', async () => {
    const mod = await import('@anthropic-ai/claude-agent-sdk')
    expect(typeof mod.query).toBe('function')
  })
})
```

- [ ] **Step 4: 테스트 실행**

Run: `npx vitest run tests/electron/api/llm/claudeSdkImport.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/electron/api/llm/claudeSdkImport.test.js
git commit -m "chore: add @anthropic-ai/claude-agent-sdk + asarUnpack"
```

---

### Task 2: `toJsonSchema` — Gemini 대문자 스키마 → JSON Schema 변환

**Files:**
- Create: `electron/api/llm/toJsonSchema.js`
- Test: `tests/electron/api/llm/toJsonSchema.test.js`

**Interfaces:**
- Produces: `toJsonSchema(geminiSchema) -> jsonSchema` (재귀; `OBJECT/ARRAY/INTEGER/STRING/NUMBER/BOOLEAN` → 소문자, `properties`/`items` 재귀, `required` 등은 보존).

- [ ] **Step 1: 실패 테스트 작성**

`tests/electron/api/llm/toJsonSchema.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { toJsonSchema } from '../../../../electron/api/llm/toJsonSchema.js'

describe('toJsonSchema', () => {
  it('중첩 properties/items/required를 재귀 변환한다', () => {
    const gemini = {
      type: 'OBJECT',
      properties: {
        scenes: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { sceneNo: { type: 'INTEGER' }, summary: { type: 'STRING' } },
            required: ['sceneNo', 'summary'],
          },
        },
      },
      required: ['scenes'],
    }
    expect(toJsonSchema(gemini)).toEqual({
      type: 'object',
      properties: {
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sceneNo: { type: 'integer' }, summary: { type: 'string' } },
            required: ['sceneNo', 'summary'],
          },
        },
      },
      required: ['scenes'],
    })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/llm/toJsonSchema.test.js`
Expected: FAIL ("toJsonSchema is not a function" 또는 파일 없음).

- [ ] **Step 3: 구현**

`electron/api/llm/toJsonSchema.js`:
```js
/** Gemini responseSchema(대문자 타입)를 JSON Schema(소문자)로 재귀 변환. */
const TYPE_MAP = {
  OBJECT: 'object', ARRAY: 'array', STRING: 'string',
  INTEGER: 'integer', NUMBER: 'number', BOOLEAN: 'boolean',
}

export function toJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema
  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') out.type = TYPE_MAP[v] || v.toLowerCase()
    else if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toJsonSchema(pv)]))
    } else if (k === 'items') out.items = toJsonSchema(v)
    else out[k] = v
  }
  return out
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/api/llm/toJsonSchema.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/api/llm/toJsonSchema.js tests/electron/api/llm/toJsonSchema.test.js
git commit -m "feat: add toJsonSchema (Gemini schema -> JSON Schema)"
```

---

### Task 3: `claudeSdk.js` — 순수 SDK 헬퍼

**Files:**
- Create: `electron/api/llm/claudeSdk.js`
- Test: `tests/electron/api/llm/claudeSdk.test.js`

**Interfaces:**
- Produces:
  - `buildClaudeSdkOptions(model, abortController, extra?) -> options` (격리 옵션 + extra 병합)
  - `extractClaudeSdkResult(message) -> string` (success면 `result` trim, 아니면 throw)
  - `bridgeAbortSignal(signal) -> { abortController, cleanup }`
  - `extractTextDelta(message) -> string|null` (stream_event의 text_delta만)
  - `readStructuredResult(message) -> { kind:'structured', data } | { kind:'text', text } | { kind:'retry' } | { kind:'skip' }` (아닌 에러 subtype은 throw)

- [ ] **Step 1: 실패 테스트 작성**

`tests/electron/api/llm/claudeSdk.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import {
  buildClaudeSdkOptions, extractClaudeSdkResult, bridgeAbortSignal,
  extractTextDelta, readStructuredResult,
} from '../../../../electron/api/llm/claudeSdk.js'

describe('buildClaudeSdkOptions', () => {
  it('격리 옵션을 고정하고 model/extra를 병합한다', () => {
    const o = buildClaudeSdkOptions('claude-opus-4-8', undefined, { includePartialMessages: true })
    expect(o).toMatchObject({
      model: 'claude-opus-4-8', tools: [], settingSources: [], skills: [],
      thinking: { type: 'disabled' }, maxTurns: 2, includePartialMessages: true,
    })
  })
  it('model 없으면 model 키를 넣지 않는다', () => {
    expect('model' in buildClaudeSdkOptions()).toBe(false)
  })
})

describe('extractClaudeSdkResult', () => {
  it('success면 result를 trim해 반환', () => {
    expect(extractClaudeSdkResult({ subtype: 'success', is_error: false, result: '  hi ' })).toBe('hi')
  })
  it('에러 result면 throw', () => {
    expect(() => extractClaudeSdkResult({ subtype: 'error_during_execution', errors: ['boom'] })).toThrow('boom')
  })
})

describe('bridgeAbortSignal', () => {
  it('signal abort 시 controller가 abort된다', () => {
    const ac = new AbortController()
    const { abortController, cleanup } = bridgeAbortSignal(ac.signal)
    ac.abort()
    expect(abortController.signal.aborted).toBe(true)
    cleanup()
  })
})

describe('extractTextDelta', () => {
  it('text_delta면 텍스트, 아니면 null', () => {
    expect(extractTextDelta({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ab' } } })).toBe('ab')
    expect(extractTextDelta({ type: 'stream_event', event: { type: 'content_block_start' } })).toBeNull()
    expect(extractTextDelta({ type: 'result' })).toBeNull()
  })
})

describe('readStructuredResult', () => {
  it('success + structured_output', () => {
    expect(readStructuredResult({ type: 'result', subtype: 'success', structured_output: { a: 1 } })).toEqual({ kind: 'structured', data: { a: 1 } })
  })
  it('success + structured_output 없음 → text', () => {
    expect(readStructuredResult({ type: 'result', subtype: 'success', result: '{"a":1}' })).toEqual({ kind: 'text', text: '{"a":1}' })
  })
  it('retries 에러 → retry', () => {
    expect(readStructuredResult({ type: 'result', subtype: 'error_max_structured_output_retries', errors: [] })).toEqual({ kind: 'retry' })
  })
  it('그 외 에러 → throw', () => {
    expect(() => readStructuredResult({ type: 'result', subtype: 'error_during_execution', errors: ['x'] })).toThrow('x')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/llm/claudeSdk.test.js`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현**

`electron/api/llm/claudeSdk.js`:
```js
/**
 * Claude Agent SDK 순수 헬퍼 — query 결과/스트림/취소 처리. (AutoMovie vision.mjs 이식 + 확장)
 * SDK 자체는 llmClaude가 동적 import — 여기는 SDK에 의존하지 않는 순수 함수만 둔다(테스트 용이).
 */
export function buildClaudeSdkOptions(model, abortController, extra = {}) {
  return {
    ...(model ? { model } : {}),
    ...(abortController ? { abortController } : {}),
    maxTurns: 2,
    thinking: { type: 'disabled' },
    tools: [],
    settingSources: [],
    skills: [], // 빈 배열 = 활성 skill 없음(오염 차단). string[]|'all' 중 [] 유효.
    ...extra,
  }
}

export function extractClaudeSdkResult(message) {
  if (message.subtype === 'success' && !message.is_error) return (message.result || '').trim()
  throw new Error(message.errors?.join('; ') || `result ${message.subtype || 'error'}`)
}

export function bridgeAbortSignal(signal) {
  const abortController = new AbortController()
  if (!signal) return { abortController, cleanup: () => {} }
  if (signal.aborted) { abortController.abort(); return { abortController, cleanup: () => {} } }
  const onAbort = () => abortController.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  return { abortController, cleanup: () => signal.removeEventListener('abort', onAbort) }
}

export function extractTextDelta(message) {
  if (message?.type !== 'stream_event') return null
  const ev = message.event
  if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') return ev.delta.text
  return null
}

/** structured call result 메시지 분기. success 외 error subtype은 retry 신호 or throw. */
export function readStructuredResult(message) {
  if (message?.type !== 'result') return { kind: 'skip' }
  if (message.subtype === 'success' && !message.is_error) {
    if (message.structured_output != null) return { kind: 'structured', data: message.structured_output }
    return { kind: 'text', text: (message.result || '').trim() }
  }
  if (message.subtype === 'error_max_structured_output_retries') return { kind: 'retry' }
  throw new Error(message.errors?.join('; ') || `result ${message.subtype || 'error'}`)
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/api/llm/claudeSdk.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/api/llm/claudeSdk.js tests/electron/api/llm/claudeSdk.test.js
git commit -m "feat: add claudeSdk pure helpers (options/result/abort/delta/structured)"
```

---

### Task 4: `prompts.js` 추출 + 대본 메타프롬프트 슬롯

**Files:**
- Create: `electron/api/llm/prompts.js`
- Modify: `electron/api/llm/llmGemini.js` (내부 빌더 제거 → import)
- Test: `tests/electron/api/llm/prompts.test.js`

**Interfaces:**
- Produces:
  - `buildScriptPrompt(input, opts) -> string` (opts.metaPrompt 있으면 `## CUSTOM INSTRUCTIONS` 블록을 앞에 삽입)
  - `buildSplitPrompt(scriptMd, opts) -> string`
  - `buildPromptsPrompt(scenes, context, opts) -> string`
- Consumes(llmGemini/llmClaude): 위 3개.

- [ ] **Step 1: 실패 테스트 작성**

`tests/electron/api/llm/prompts.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { buildScriptPrompt, buildSplitPrompt, buildPromptsPrompt } from '../../../../electron/api/llm/prompts.js'

describe('buildScriptPrompt', () => {
  it('제목/장르/언어를 템플릿에 채운다', () => {
    const p = buildScriptPrompt({ title: 'T' }, { targetMinutes: 8, language: 'ko', genre: 'yadam' })
    expect(p).toContain('8분')
    expect(p).toContain('제목: T')
    expect(p).toContain('한국어')
  })
  it('metaPrompt가 있으면 CUSTOM INSTRUCTIONS 블록을 앞에 넣는다', () => {
    const p = buildScriptPrompt({ title: 'T' }, { language: 'ko', metaPrompt: 'META-XYZ' })
    expect(p).toContain('## CUSTOM INSTRUCTIONS')
    expect(p).toContain('META-XYZ')
    expect(p.indexOf('META-XYZ')).toBeLessThan(p.indexOf('제목: T'))
  })
  it('metaPrompt가 없으면 CUSTOM INSTRUCTIONS 블록이 없다', () => {
    expect(buildScriptPrompt({ title: 'T' }, { language: 'ko' })).not.toContain('CUSTOM INSTRUCTIONS')
  })
})

describe('buildSplitPrompt / buildPromptsPrompt', () => {
  it('split은 대본 본문을 포함', () => {
    expect(buildSplitPrompt('SCRIPT-BODY', { language: 'ko' })).toContain('SCRIPT-BODY')
  })
  it('prompts는 씬 요약을 포함', () => {
    const p = buildPromptsPrompt([{ sceneNo: 1, summary: 'S1', segments: [{ text: 'hi' }] }], {}, { language: 'en' })
    expect(p).toContain('1. S1')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/llm/prompts.test.js`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현 — prompts.js 생성**

`electron/api/llm/prompts.js` (기존 llmGemini 빌더를 이동 + 메타 슬롯):
```js
/** 프롬프트 빌더 — Gemini/Claude 두 엔진 공유. (구 llmGemini.js 내부 빌더 이관) */

export function buildScriptPrompt(input, opts) {
  const meta = opts.metaPrompt ? `## CUSTOM INSTRUCTIONS\n${opts.metaPrompt}\n` : ''
  return [
    meta,
    `당신은 유튜브 스토리 채널 작가다. 아래 제목으로 ${opts.targetMinutes || 10}분 분량의 나레이션 대본을 ${opts.language === 'ko' ? '한국어' : '영어'}로 작성하라.`,
    opts.genre ? `장르: ${opts.genre}` : '',
    opts.tone ? `톤: ${opts.tone}` : '',
    `제목: ${input.title}`,
    `마크다운으로, 챕터 구분과 (대사가 있으면) 화자 표기를 포함하라.`,
  ].filter(Boolean).join('\n')
}

export function buildSplitPrompt(scriptMd, opts) {
  return [
    `아래 대본을 씬으로 분리하라. 각 씬은 낭독 시 6~10초(${opts.language === 'ko' ? '한국어 기준 약 33~55자' : 'about 90~150 chars in English'}) 분량이어야 한다. 초과하면 씬을 분할하라.`,
    `각 씬의 세그먼트마다 speaker(나레이션은 "narrator", 대사는 인물 식별자)와 emotion(normal/happy/sad/angry)을 지정하라.`,
    `등장 화자 전체 목록을 speakers로 반환하라.`,
    `--- 대본 ---`,
    scriptMd,
  ].join('\n')
}

export function buildPromptsPrompt(scenes, context, opts) {
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

- [ ] **Step 4: 구현 — llmGemini.js 수정(빌더 제거 → import)**

`electron/api/llm/llmGemini.js`:
- 상단 import에 추가: `import { buildScriptPrompt, buildSplitPrompt, buildPromptsPrompt } from './prompts.js'`
- 파일 하단의 `// --- 프롬프트 빌더 ...` 주석과 `buildScriptPrompt`/`buildSplitPrompt`/`buildPromptsPrompt` 3개 함수 정의(현재 118~148행)를 **삭제**한다. (호출부는 그대로 — 이제 import된 함수를 씀.)

- [ ] **Step 5: 테스트 실행(신규 + 기존 회귀)**

Run: `npx vitest run tests/electron/api/llm/prompts.test.js tests/electron/api/llm/`
Expected: PASS. 기존 llmGemini 테스트가 있으면 함께 통과(빌더는 동작 불변, 순수 이동).

- [ ] **Step 6: Commit**

```bash
git add electron/api/llm/prompts.js electron/api/llm/llmGemini.js tests/electron/api/llm/prompts.test.js
git commit -m "refactor: extract prompt builders to prompts.js + metaPrompt slot"
```

---

### Task 5: `metaPrompts.js` — 장르 메타프롬프트 로더

**Files:**
- Create: `electron/api/llm/metaPrompts.js`
- Test: `tests/electron/api/llm/metaPrompts.test.js`

**Interfaces:**
- Produces:
  - `resolveSkillsDir() -> string` (dev: 프로젝트 `skills/`, prod: `process.resourcesPath/skills`)
  - `loadMetaPrompt({ genre, wave, language, skillsDir? }) -> Promise<string>` (wave!=='script'이거나 genre 없으면 `''`)

- [ ] **Step 1: 실패 테스트 작성**

`tests/electron/api/llm/metaPrompts.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadMetaPrompt } from '../../../../electron/api/llm/metaPrompts.js'

async function fixtureSkillsDir() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skills-'))
  const base = path.join(root, 'story-engine', 'meta-prompts')
  await mkdir(path.join(base, 'yadam'), { recursive: true })
  await mkdir(path.join(base, '_common'), { recursive: true })
  await writeFile(path.join(base, 'yadam', 'yadam-scenario-guide.md'), 'SCENARIO')
  await writeFile(path.join(base, 'yadam', 'yadam-narrative-guide.md'), 'NARRATIVE')
  await writeFile(path.join(base, 'yadam', 'yadam-suspense-techniques.md'), 'SUSPENSE')
  await writeFile(path.join(base, '_common', 'hook_principles.md'), 'HOOK')
  return root
}

describe('loadMetaPrompt', () => {
  it('yadam script 웨이브: 3파일 + hook을 합친다', async () => {
    const skillsDir = await fixtureSkillsDir()
    const out = await loadMetaPrompt({ genre: 'yadam', wave: 'script', language: 'ko', skillsDir })
    expect(out).toContain('SCENARIO')
    expect(out).toContain('NARRATIVE')
    expect(out).toContain('SUSPENSE')
    expect(out).toContain('HOOK')
  })
  it('wave가 script가 아니면 빈 문자열', async () => {
    const skillsDir = await fixtureSkillsDir()
    expect(await loadMetaPrompt({ genre: 'yadam', wave: 'scenes', language: 'ko', skillsDir })).toBe('')
  })
  it('genre 없으면 빈 문자열', async () => {
    expect(await loadMetaPrompt({ wave: 'script', language: 'ko', skillsDir: '/nope' })).toBe('')
  })
  it('누락 파일은 경고 후 건너뛴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await loadMetaPrompt({ genre: 'dark-history', wave: 'script', language: 'en', skillsDir: '/nonexistent' })
    expect(out).toBe('')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/llm/metaPrompts.test.js`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현**

`electron/api/llm/metaPrompts.js`:
```js
/**
 * story-engine 장르 메타프롬프트 로더 (main process). 대본(W3) 웨이브만 주입한다.
 * 파일명은 story-engine SKILL.md W3 표 기준 + 공통 hook_principles(표 외 추가).
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

export function resolveSkillsDir() {
  if (app?.isPackaged) return path.join(process.resourcesPath, 'skills')
  return path.join(app?.getAppPath?.() ?? process.cwd(), 'skills')
}

// 장르 → 대본(W3) 파일 (리터럴 고정). bespoke는 language 서브폴더.
const W3_FILES = {
  yadam: () => ['yadam/yadam-scenario-guide.md', 'yadam/yadam-narrative-guide.md', 'yadam/yadam-suspense-techniques.md'],
  'dark-history': () => ['dark-history/screenplay_guidelines.md', 'dark-history/narrative_techniques.md', 'dark-history/suspense_techniques.md'],
  bespoke: (lang) => [`bespoke/${lang}/screenplay_guidelines.md`, `bespoke/${lang}/narrative_techniques.md`, `bespoke/${lang}/suspense_techniques.md`],
}
const COMMON_FILES = ['_common/hook_principles.md']

export async function loadMetaPrompt({ genre, wave, language = 'ko', skillsDir } = {}) {
  if (wave !== 'script' || !genre || !W3_FILES[genre]) return ''
  const dir = skillsDir ?? resolveSkillsDir()
  const lang = language === 'en' ? 'en' : 'ko'
  const rels = [...W3_FILES[genre](lang), ...COMMON_FILES]
  const base = path.join(dir, 'story-engine', 'meta-prompts')
  const parts = []
  for (const rel of rels) {
    try {
      parts.push((await readFile(path.join(base, rel), 'utf8')).trim())
    } catch {
      console.warn(`[metaPrompts] missing meta file: ${rel}`)
    }
  }
  return parts.join('\n\n---\n\n')
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/api/llm/metaPrompts.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/api/llm/metaPrompts.js tests/electron/api/llm/metaPrompts.test.js
git commit -m "feat: add metaPrompts loader (genre W3 meta + hook)"
```

---

### Task 6: `llmClaude.generateScript` — 스트리밍 대본 생성

**Files:**
- Create: `electron/api/llm/llmClaude.js`
- Test: `tests/electron/api/llm/llmClaude.generateScript.test.js`

**Interfaces:**
- Consumes: `claudeSdk.js`(buildClaudeSdkOptions/extractClaudeSdkResult/bridgeAbortSignal/extractTextDelta), `prompts.js`(buildScriptPrompt).
- Produces: `generateScript(input, opts, { onDelta, signal, queryImpl }) -> { scriptMd }`. `queryImpl`은 `async function*` (미주입 시 SDK query). `DEFAULT_MODEL = 'claude-opus-4-8'` export.

- [ ] **Step 1: 실패 테스트 작성**

`tests/electron/api/llm/llmClaude.generateScript.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import { generateScript } from '../../../../electron/api/llm/llmClaude.js'

// stream_event 델타 2개 + 최종 result를 흘리는 가짜 query
function fakeQuery(deltas, resultText) {
  return async function* () {
    for (const t of deltas) yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } }
    yield { type: 'result', subtype: 'success', is_error: false, result: resultText }
  }
}

describe('llmClaude.generateScript', () => {
  it('델타를 onDelta로 흘리고 최종 result를 반환', async () => {
    const onDelta = vi.fn()
    const queryImpl = fakeQuery(['A', 'B'], 'ABC')
    const { scriptMd } = await generateScript({ title: 'T' }, { language: 'ko' }, { onDelta, signal: undefined, queryImpl })
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual(['A', 'B'])
    expect(scriptMd).toBe('ABC')
  })

  it('signal.aborted면 onDelta 방출을 멈추고 Aborted throw', async () => {
    const ac = new AbortController()
    const onDelta = vi.fn((t) => { if (t === 'A') ac.abort() })
    const queryImpl = fakeQuery(['A', 'B'], 'ABC')
    await expect(generateScript({ title: 'T' }, {}, { onDelta, signal: ac.signal, queryImpl })).rejects.toThrow('Aborted')
    expect(onDelta).toHaveBeenCalledTimes(1) // 'A'만, 'B'는 abort로 차단
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/llm/llmClaude.generateScript.test.js`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현 (llmClaude.js 생성 — generateScript 부분)**

`electron/api/llm/llmClaude.js`:
```js
/**
 * Claude Agent SDK 대본 엔진 — llmGemini와 동일 시그니처. 대본은 스트리밍,
 * 씬분리/프롬프트는 outputFormat structured(다음 Task). 인증은 로컬 Claude 로그인.
 */
import { buildScriptPrompt } from './prompts.js'
import { buildClaudeSdkOptions, extractClaudeSdkResult, bridgeAbortSignal, extractTextDelta } from './claudeSdk.js'

export const DEFAULT_MODEL = 'claude-opus-4-8'

async function* defaultQuery(args) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  yield* query(args)
}

export async function generateScript(input, opts = {}, { onDelta, signal, queryImpl = defaultQuery } = {}) {
  const prompt = buildScriptPrompt(input, opts)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  let full = ''
  try {
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, { includePartialMessages: true })
    for await (const m of queryImpl({ prompt, options })) {
      const delta = extractTextDelta(m)
      if (delta != null) {
        if (signal?.aborted) break
        full += delta
        onDelta?.(delta)
        continue
      }
      if (m.type === 'result') return { scriptMd: extractClaudeSdkResult(m) }
    }
    if (signal?.aborted) throw new Error('Aborted')
    return { scriptMd: full } // result 없이 스트림 종료 시 누적 델타 반환
  } catch (err) {
    if (signal?.aborted) throw new Error('Aborted')
    throw new Error(`Claude SDK failed: ${err.message}`)
  } finally {
    cleanup()
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/api/llm/llmClaude.generateScript.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/api/llm/llmClaude.js tests/electron/api/llm/llmClaude.generateScript.test.js
git commit -m "feat: llmClaude.generateScript (streaming + abort guard)"
```

---

### Task 7: `llmClaude.splitScenes` / `writePrompts` — structured output

**Files:**
- Modify: `electron/api/llm/llmClaude.js`
- Test: `tests/electron/api/llm/llmClaude.structured.test.js`

**Interfaces:**
- Consumes: `claudeSdk.js`(buildClaudeSdkOptions/bridgeAbortSignal/readStructuredResult/extractClaudeSdkResult), `prompts.js`(buildSplitPrompt/buildPromptsPrompt), `toJsonSchema.js`, `schemas.js`(SCENES_SCHEMA/PROMPTS_SCHEMA).
- Produces: `splitScenes(scriptMd, opts, {signal,queryImpl}) -> { scenes, speakers }`, `writePrompts(scenes, context, opts, {signal,queryImpl}) -> { scenes }` (llmGemini와 동일 병합 규칙).

- [ ] **Step 1: 실패 테스트 작성**

`tests/electron/api/llm/llmClaude.structured.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { splitScenes, writePrompts } from '../../../../electron/api/llm/llmClaude.js'

const SCENES = { scenes: [{ sceneNo: 1, summary: 'S', segments: [{ speaker: 'narrator', text: 'hi' }] }], speakers: [{ id: 'narrator', name: '내레이터' }] }

function resultOf(msg) { return async function* () { yield msg } }

describe('llmClaude.splitScenes', () => {
  it('structured_output을 그대로 사용', async () => {
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: SCENES })
    const out = await splitScenes('SCRIPT', { language: 'ko' }, { queryImpl })
    expect(out.scenes[0].sceneNo).toBe(1)
    expect(out.speakers[0].id).toBe('narrator')
  })
  it('structured 없으면 result 텍스트(코드펜스 포함)를 파싱', async () => {
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, result: '```json\n' + JSON.stringify(SCENES) + '\n```' })
    const out = await splitScenes('SCRIPT', { language: 'ko' }, { queryImpl })
    expect(out.scenes[0].summary).toBe('S')
  })
  it('retries 에러면 outputFormat 없는 재요청으로 폴백', async () => {
    let call = 0
    const queryImpl = async function* (args) {
      call += 1
      if (call === 1) { yield { type: 'result', subtype: 'error_max_structured_output_retries', errors: [] }; return }
      yield { type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(SCENES) }
    }
    const out = await splitScenes('SCRIPT', {}, { queryImpl })
    expect(call).toBe(2)
    expect(out.scenes.length).toBe(1)
  })
})

describe('llmClaude.writePrompts', () => {
  it('sceneNo로 image/videoPrompt를 병합', async () => {
    const scenes = [{ sceneNo: 1, storyId: 'a', summary: 'S' }]
    const structured = { scenes: [{ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: 'VID' }] }
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: structured })
    const out = await writePrompts(scenes, {}, {}, { queryImpl })
    expect(out.scenes[0].imagePrompt).toBe('IMG')
    expect(out.scenes[0].videoPrompt).toBe('VID')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/llm/llmClaude.structured.test.js`
Expected: FAIL (splitScenes/writePrompts 미export).

- [ ] **Step 3: 구현 (llmClaude.js에 추가)**

`electron/api/llm/llmClaude.js`에 아래를 추가(상단 import 보강 포함):
```js
// 상단 import에 추가:
import { buildSplitPrompt, buildPromptsPrompt } from './prompts.js'
import { readStructuredResult } from './claudeSdk.js'
import { toJsonSchema } from './toJsonSchema.js'
import { SCENES_SCHEMA, PROMPTS_SCHEMA } from './schemas.js'
```
```js
function parseJsonLoose(text) {
  let t = (text || '').trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fence) t = fence[1].trim()
  const s = t.indexOf('{'); const e = t.lastIndexOf('}')
  if (s >= 0 && e > s) t = t.slice(s, e + 1)
  return JSON.parse(t)
}

async function structuredClaudeCall(prompt, geminiSchema, opts, { signal, queryImpl = defaultQuery }) {
  const schema = toJsonSchema(geminiSchema)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  try {
    // 1차: outputFormat(json_schema) 강제
    const opt1 = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, { outputFormat: { type: 'json_schema', schema } })
    let needFallback = false
    for await (const m of queryImpl({ prompt, options: opt1 })) {
      if (m.type !== 'result') continue
      const r = readStructuredResult(m)
      if (r.kind === 'structured') return r.data
      if (r.kind === 'text') return parseJsonLoose(r.text)
      if (r.kind === 'retry') { needFallback = true; break }
    }
    if (signal?.aborted) throw new Error('Aborted')
    // 2차 폴백: outputFormat 없이 JSON-only 재요청
    const jsonPrompt = `${prompt}\n\n반드시 아래 JSON 스키마에 맞는 JSON만 출력하라(설명/코드펜스 금지):\n${JSON.stringify(schema)}`
    const opt2 = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController)
    for await (const m of queryImpl({ prompt: jsonPrompt, options: opt2 })) {
      if (m.type === 'result') return parseJsonLoose(extractClaudeSdkResult(m))
    }
    throw new Error('no result message returned')
  } catch (err) {
    if (signal?.aborted) throw new Error('Aborted')
    throw err
  } finally {
    cleanup()
  }
}

export async function splitScenes(scriptMd, opts = {}, { signal, queryImpl } = {}) {
  const prompt = buildSplitPrompt(scriptMd, opts)
  const out = await structuredClaudeCall(prompt, SCENES_SCHEMA, opts, { signal, queryImpl })
  return { scenes: out.scenes || [], speakers: out.speakers || [] }
}

export async function writePrompts(scenes, context, opts = {}, { signal, queryImpl } = {}) {
  const prompt = buildPromptsPrompt(scenes, context, opts)
  const out = await structuredClaudeCall(prompt, PROMPTS_SCHEMA, opts, { signal, queryImpl })
  const byNo = new Map((out.scenes || []).map((s) => [s.sceneNo, s]))
  return {
    scenes: scenes.map((s) => ({
      ...s,
      imagePrompt: byNo.get(s.sceneNo)?.imagePrompt ?? s.imagePrompt ?? null,
      videoPrompt: byNo.get(s.sceneNo)?.videoPrompt ?? s.videoPrompt ?? null,
    })),
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/api/llm/llmClaude.structured.test.js tests/electron/api/llm/llmClaude.generateScript.test.js`
Expected: PASS (두 파일 모두).

- [ ] **Step 5: Commit**

```bash
git add electron/api/llm/llmClaude.js tests/electron/api/llm/llmClaude.structured.test.js
git commit -m "feat: llmClaude.splitScenes/writePrompts (outputFormat structured + fallback)"
```

---

### Task 8: 엔진 전환 — main 주입 / 기본값 / 모델 fallback / 메타프롬프트 주입

**Files:**
- Modify: `electron/story/storyStore.js` (defaultStoryState engine)
- Modify: `electron/story/stepMachine.js` (모델 fallback 제거 + metaPrompt 주입 + loadMetaPrompt DI)
- Modify: `electron/ipc/story-api.js` (loadMetaPrompt 파라미터 전달)
- Modify: `electron/main.js` (llm: llmClaude + loadMetaPrompt 주입)
- Test: `tests/electron/story/stepMachine.claude.test.js`

**Interfaces:**
- Consumes: `llmClaude`(generateScript/splitScenes/writePrompts), `metaPrompts`(loadMetaPrompt).
- `createStepMachine({ projectPath, llm, emit, getApiKey, loadMetaPrompt })` — loadMetaPrompt 옵셔널(미주입 시 메타 없음).

- [ ] **Step 1: 실패 테스트 작성**

`tests/electron/story/stepMachine.claude.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

async function tmpProject() { return mkdtemp(path.join(os.tmpdir(), 'proj-')) }

describe('stepMachine + Claude 엔진', () => {
  it('script 스텝이 loadMetaPrompt 결과를 opts.metaPrompt로 llm에 넘긴다', async () => {
    const projectPath = await tmpProject()
    const llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '# 대본' })),
      splitScenes: vi.fn(), writePrompts: vi.fn(),
    }
    const loadMetaPrompt = vi.fn(async () => 'META')
    const machine = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null, loadMetaPrompt })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { genre: 'yadam', language: 'ko' } })
    expect(loadMetaPrompt).toHaveBeenCalledWith({ genre: 'yadam', wave: 'script', language: 'ko' })
    expect(llm.generateScript.mock.calls[0][1].metaPrompt).toBe('META')
    // 모델 fallback 'gemini-2.5-pro'가 새지 않음(엔진 미지정 → undefined)
    expect(llm.generateScript.mock.calls[0][1].model).toBeUndefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/story/stepMachine.claude.test.js`
Expected: FAIL (metaPrompt 미전달 / 모델이 'gemini-2.5-pro').

- [ ] **Step 3: 구현 — storyStore.js**

`electron/story/storyStore.js`의 `defaultStoryState()` 안 `engine: { llm: 'gemini' }` → `engine: { llm: 'claude' }`.

- [ ] **Step 4: 구현 — stepMachine.js**

`electron/story/stepMachine.js`:
- 시그니처: `export function createStepMachine({ projectPath, llm, emit, getApiKey, loadMetaPrompt })`
- `script` 스텝의 opts 구성부(현재 77행)를 교체:
```js
state.input = params.input ? { ...params.input, options: params.options } : state.input
const language = params.options?.language || state.input?.options?.language || 'ko'
const metaPrompt = loadMetaPrompt
  ? await loadMetaPrompt({ genre: params.options?.genre, wave: 'script', language })
  : ''
const opts = { apiKey: getApiKey(), model: state.engine.model, metaPrompt, ...(params.options || {}) }
const { scriptMd } = await llm.generateScript(state.input, opts, {
  onDelta: (text) => send('story:delta', { text }, opId), signal,
})
```
- `scenes` 스텝(현재 87행)과 `prompts` 스텝(현재 103행)의 `model: state.engine.model || 'gemini-2.5-pro'` → `model: state.engine.model` (fallback 문자열 제거).

- [ ] **Step 5: 구현 — story-api.js**

`electron/ipc/story-api.js`:
- `registerStoryIPC(ipcMain, { keyStore, getWindow, llm = llmGemini, loadMetaPrompt, getActiveWorkFolder = () => null })` — `loadMetaPrompt` 파라미터 추가.
- machine 생성부(현재 64행): `machine = createStepMachine({ projectPath, llm, emit, getApiKey: () => keyStore.getKey(), loadMetaPrompt })`

- [ ] **Step 6: 구현 — main.js**

`electron/main.js`:
- import 추가: `import * as llmClaude from './api/llm/llmClaude.js'` 와 `import { loadMetaPrompt } from './api/llm/metaPrompts.js'`
- `registerStoryIPC(ipcMain, { keyStore: genaiKeyStore, getWindow: () => mainWindow, getActiveWorkFolder: () => activeWorkFolder })` 호출에 `llm: llmClaude, loadMetaPrompt` 추가.

- [ ] **Step 7: 테스트 실행(신규 + 스텝머신 회귀)**

Run: `npx vitest run tests/electron/story/`
Expected: PASS. 기존 stepMachine 테스트가 `engine.llm`/모델 fallback을 하드체크했다면 그에 맞게 수정(엔진 기본이 'claude', 모델 undefined 허용).

- [ ] **Step 8: Commit**

```bash
git add electron/story/storyStore.js electron/story/stepMachine.js electron/ipc/story-api.js electron/main.js tests/electron/story/stepMachine.claude.test.js
git commit -m "feat: switch story engine to Claude (inject llm/meta, drop gemini fallback)"
```

---

### Task 9: renderer stale-delta 필터 (operationId)

**Files:**
- Modify: `src/hooks/useStoryPipeline.js`
- Test: `tests/hooks/useStoryPipeline.delta.test.js` (또는 기존 useStoryPipeline 테스트에 추가)

**Interfaces:**
- Consumes: `story:state`/`story:delta` payload의 `operationId`.
- 동작: running 스텝을 실은 `story:state`의 `operationId`를 활성 op로 저장 → 그와 다른 `operationId`의 `story:delta`는 drop.

- [ ] **Step 1: 실패 테스트 작성**

`tests/hooks/useStoryPipeline.delta.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStoryPipeline } from '../../src/hooks/useStoryPipeline.js'

// electronAPI onStoryEvent 목: 핸들러를 캡처해 수동 발화
function installApi() {
  const handlers = {}
  window.electronAPI = {
    onStoryEvent: (ch, fn) => { handlers[ch] = fn; return () => {} },
    storyOpen: async () => ({ projectToken: 'TOK', state: {}, scenes: [] }),
    storyGetState: async () => ({}),
    storyStart: async () => ({ operationId: 'op2' }),
    storyAbort: async () => {},
  }
  return handlers
}

describe('useStoryPipeline delta 필터', () => {
  beforeEach(() => installApi())

  it('활성 op와 다른 operationId의 delta는 무시한다', async () => {
    const handlers = installApi()
    const { result } = renderHook(() => useStoryPipeline({ projectPath: '/p', onPushScenes: async () => {} }))
    await act(async () => { await result.current.open() })
    // running 스텝 story:state로 활성 op = 'op2' 설정
    act(() => handlers['story:state']({ projectToken: 'TOK', operationId: 'op2', state: { steps: { script: { status: 'running' } } } }))
    // 옛 op 'op1' 델타 → 무시
    act(() => handlers['story:delta']({ projectToken: 'TOK', operationId: 'op1', text: 'STALE' }))
    // 현재 op 'op2' 델타 → 반영
    act(() => handlers['story:delta']({ projectToken: 'TOK', operationId: 'op2', text: 'LIVE' }))
    expect(result.current.streamingText).toBe('LIVE')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/hooks/useStoryPipeline.delta.test.js`
Expected: FAIL (STALE가 섞여 'STALELIVE').

- [ ] **Step 3: 구현**

`src/hooks/useStoryPipeline.js`:
- refs에 추가(다른 ref 선언 근처): `const activeOpRef = useRef(null)`
- `story:state` 핸들러에 활성 op 갱신 추가:
```js
api.onStoryEvent('story:state', (p) => {
  if (p.projectToken !== tokenRef.current) return
  const anyRunning = p.state?.steps && Object.values(p.state.steps).some((s) => s?.status === 'running')
  if (anyRunning && p.operationId) activeOpRef.current = p.operationId
  setState(p.state)
  if (p.scenes !== undefined) setScenes(p.scenes)
}),
```
- `story:delta` 핸들러에 op 필터 추가:
```js
api.onStoryEvent('story:delta', (p) => {
  if (p.projectToken !== tokenRef.current) return
  if (activeOpRef.current && p.operationId !== activeOpRef.current) return
  setStreamingText((t) => t + p.text)
}),
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/hooks/useStoryPipeline.delta.test.js`
Expected: PASS (streamingText === 'LIVE').

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useStoryPipeline.js tests/hooks/useStoryPipeline.delta.test.js
git commit -m "fix: drop stale story:delta by operationId in renderer"
```

---

### Task 10: StoryView 장르 드롭다운

**Files:**
- Modify: `src/components/story/StoryView.jsx`
- Test: `tests/components/story/StoryView.genre.test.jsx`

**Interfaces:**
- Consumes: `pipeline.start('script', { input, options: { genre, ... } })`.
- 동작: 기존 "장르" 텍스트 input을 `<select>`(yadam/dark-history/bespoke)로 교체, 선택값이 start의 `options.genre`로 전달.

- [ ] **Step 1: 실패 테스트 작성**

`tests/components/story/StoryView.genre.test.jsx`:
```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StoryView from '../../../src/components/story/StoryView.jsx'

function makePipeline(start) {
  return { state: { steps: {} }, streamingText: '', start, abort: () => {}, scenes: [], openError: null }
}

describe('StoryView 장르 드롭다운', () => {
  it('장르 select에서 고른 값이 start options.genre로 전달된다', () => {
    const start = vi.fn()
    render(<StoryView pipeline={makePipeline(start)} />)
    fireEvent.change(screen.getByLabelText('장르'), { target: { value: 'dark-history' } })
    fireEvent.change(screen.getByPlaceholderText('제목'), { target: { value: 'T' } })
    fireEvent.click(screen.getByRole('button', { name: '대본 생성' }))
    expect(start).toHaveBeenCalledWith('script', expect.objectContaining({
      options: expect.objectContaining({ genre: 'dark-history' }),
    }))
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/story/StoryView.genre.test.jsx`
Expected: FAIL (장르 select 없음 / label 'genre' 없음).

- [ ] **Step 3: 구현**

`src/components/story/StoryView.jsx`:
- 장르 상태는 그대로 `const [genre, setGenre] = useState('')` 유지.
- 제목 폼(`story-title-form`)의 "장르" **텍스트 input**을 아래 `<select>`로 교체:
```jsx
<select
  className="story-input"
  aria-label={t('story.form.genreLabel', '장르')}
  value={genre}
  onChange={(e) => setGenre(e.target.value)}
  disabled={isRunning}
>
  <option value="">{t('story.form.genrePlaceholder', '장르')}</option>
  <option value="yadam">yadam (야담)</option>
  <option value="dark-history">dark-history</option>
  <option value="bespoke">bespoke</option>
</select>
```
- `handlePrimaryAction`의 script 분기는 이미 `options: { genre: genre || undefined, ... }`를 넘기므로(기존 코드) 그대로. language도 기존대로 전달됨.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/story/StoryView.genre.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/story/StoryView.jsx tests/components/story/StoryView.genre.test.jsx
git commit -m "feat: genre dropdown in StoryView"
```

---

### Task 11: 통합 테스트 + 패키징 스모크

**Files:**
- Test: `tests/integration/storyClaudePipeline.test.js`
- (검증) 빌드 스모크는 수동 절차

**Interfaces:**
- Consumes: `createStepMachine` + mock `llmClaude`(queryImpl 주입) + `loadMetaPrompt`.

- [ ] **Step 1: 통합 테스트 작성**

`tests/integration/storyClaudePipeline.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../electron/story/stepMachine.js'
import * as llmClaude from '../../electron/api/llm/llmClaude.js'

// SDK query만 목킹 — llmClaude 실제 로직(스트리밍/structured) 경유
function fakeQueryFactory() {
  return async function* (args) {
    if (args.options?.includePartialMessages) {
      yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '# 대본' } } }
      yield { type: 'result', subtype: 'success', is_error: false, result: '# 대본' }
      return
    }
    if (args.options?.outputFormat) {
      // splitScenes 또는 writePrompts 스키마에 따라 최소 유효 데이터 반환
      const isPrompts = /imagePrompt/.test(JSON.stringify(args.options.outputFormat.schema))
      const data = isPrompts
        ? { scenes: [{ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: 'VID' }] }
        : { scenes: [{ sceneNo: 1, summary: 'S', segments: [{ speaker: 'narrator', text: 'hi' }] }], speakers: [{ id: 'narrator', name: 'N' }] }
      yield { type: 'result', subtype: 'success', is_error: false, structured_output: data }
      return
    }
    yield { type: 'result', subtype: 'success', is_error: false, result: '{}' }
  }
}

describe('Story Claude 파이프라인 (통합)', () => {
  it('대본→씬분리→프롬프트가 Claude 엔진으로 끝까지 돈다', async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), 'proj-'))
    const queryImpl = fakeQueryFactory()
    // llmClaude 함수들을 queryImpl 주입 버전으로 래핑
    const llm = {
      generateScript: (i, o, ctx) => llmClaude.generateScript(i, o, { ...ctx, queryImpl }),
      splitScenes: (s, o, ctx) => llmClaude.splitScenes(s, o, { ...ctx, queryImpl }),
      writePrompts: (s, c, o, ctx) => llmClaude.writePrompts(s, c, o, { ...ctx, queryImpl }),
    }
    const loadMetaPrompt = async () => 'META'
    const machine = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null, loadMetaPrompt })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { genre: 'yadam', language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})

    const scenes = JSON.parse(await readFile(path.join(projectPath, 'story', 'scenes.json'), 'utf8')).scenes
    expect(scenes[0].imagePrompt).toBe('IMG')
    expect(scenes[0].videoPrompt).toBe('VID')
    const script = await readFile(path.join(projectPath, 'story', 'script.md'), 'utf8')
    expect(script).toContain('대본')
  })
})
```

- [ ] **Step 2: 실행**

Run: `npx vitest run tests/integration/storyClaudePipeline.test.js`
Expected: PASS.

- [ ] **Step 3: 전체 테스트 회귀**

Run: `npm run test:run`
Expected: 신규 테스트 포함 PASS(사전존재 실패 `tests/packaging/appxAssets.test.js` 1건은 이 작업과 무관 — 핸드오프 문서 참조).

- [ ] **Step 4: 패키징 스모크(수동)**

Run:
```bash
cd ~/workspace/AutoFlowCut && npx vite build && npx electron-builder --dir
```
그런 다음 언팩된 앱을 실행해 Story 뷰에서 장르 선택 → 대본 생성이 **로컬 Claude 로그인만으로** 동작하는지 확인.
Expected: `query()`가 ASAR 언팩 경로에서 정상 실행(대본 스트리밍 표시). 실패 시 Task 1의 `asarUnpack`에 SDK 실행 바이너리 경로 누락 여부 점검 또는 `pathToClaudeCodeExecutable` 지정.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/storyClaudePipeline.test.js
git commit -m "test: story Claude pipeline integration"
```

---

## Self-Review 체크 (작성자 확인 완료)

- **Spec 커버리지**: llmClaude(스트리밍/structured) T6·T7 / prompts 추출+메타슬롯 T4 / metaPrompts 로더 T5 / toJsonSchema T2 / claudeSdk 헬퍼 T3 / 엔진 전환(주입·기본값·fallback·메타 주입) T8 / stale delta T9 / 장르 UI T10 / 의존성·패키징 T1·T11. → 스펙 §컴포넌트 1~6 + 에러처리 전부 매핑.
- **모델 기본값**: `DEFAULT_MODEL='claude-opus-4-8'`(T6) — opts.model 오버라이드 유지.
- **타입 일관성**: `queryImpl`(async generator), `readStructuredResult`의 kind 리터럴, `loadMetaPrompt({genre,wave,language})` 시그니처가 T5·T8에서 동일.
- **비목표 준수**: 씬분리/프롬프트 메타 미주입(T7 프롬프트에 metaPrompt 없음), W1/W2·게이트 없음.
