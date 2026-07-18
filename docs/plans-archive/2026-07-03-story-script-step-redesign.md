# Story 대본 스텝 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Story 대본 스텝을 2-phase 화면(설정→대본 작업)으로 재설계하고, 제목 자동생성·이어쓰기·편집 반영·씬분리 기준(5~10초)·언어 드롭다운을 추가한다.

**Architecture:** `scriptText`를 대본 단일 source of truth로 삼아 main(script.md)↔renderer를 동기화한다. StoryView는 `scriptPhase`('setup'|'editor')로 화면을 나누고 `displayStep`을 강제한다. 신규 LLM 동작(generateTitle 논스트리밍 / continueScript 스트리밍)은 llmClaude에, 제목 생성은 전용 IPC로 노출한다.

**Tech Stack:** Electron(main/preload/renderer), React, Claude Agent SDK, Vitest + @testing-library/react.

## Global Constraints

- 대본 단일 source `scriptText`. 완료 커밋은 main 저장값(`payload.scriptText`) — renderer delta 재조립 금지.
- llmClaude 계약: keyless(로컬 Claude 로그인), abort→`Error('Aborted')`, 기본 모델 `claude-opus-4-8`(`DEFAULT_MODEL`), `queryImpl` 주입 가능.
- 씬분리: "의미 단위로 나누되 각 씬은 낭독 시 5~10초"(ko 약 28~55자, en ~75~150 chars).
- 언어: `ko`/`en` 드롭다운. 길이 단위 옵션 연동(ko 분/자, en min/words).
- PromptInput 신규 prop `hideTip` 기본 `false`(기존 사용처 불변).
- `scriptPhase` 있는 동안 `displayStep`='script' 강제. '분리시작' 시 `scriptPhase=null`로 scenes 진행.
- 빈 대본 가드: `scriptText.trim()` 비면 editor 3버튼 비활성 + main `scenes` scriptOverride trim guard.
- TDD(vitest). 테스트는 `tests/`가 `electron/`·`src/` 미러링. 브랜치 `feature/story-pipeline`.

---

### Task 1: prompts — 제목/이어쓰기/씬분리(5~10초)

**Files:**
- Modify: `electron/api/llm/prompts.js`
- Test: `tests/electron/api/llm/prompts.test.js`

**Interfaces:**
- Produces: `buildTitlePrompt(scriptMd, opts) -> string`, `buildContinuePrompt(existingScript, opts) -> string`, `buildSplitPrompt`(5~10초로 변경).

- [ ] **Step 1: 실패 테스트 작성**

`tests/electron/api/llm/prompts.test.js`에 추가:
```js
import { buildTitlePrompt, buildContinuePrompt, buildSplitPrompt } from '../../../../electron/api/llm/prompts.js'

describe('buildTitlePrompt', () => {
  it('대본을 포함하고 한 줄 제목을 지시', () => {
    const p = buildTitlePrompt('대본 본문', { language: 'ko' })
    expect(p).toContain('대본 본문')
    expect(p).toContain('한 줄')
  })
})
describe('buildContinuePrompt', () => {
  it('기존 대본을 포함하고 이어쓰기를 지시', () => {
    const p = buildContinuePrompt('앞부분', { genre: 'yadam' })
    expect(p).toContain('앞부분')
    expect(p).toContain('이어서')
  })
})
describe('buildSplitPrompt 5~10초', () => {
  it('5~10초 기준을 포함', () => {
    expect(buildSplitPrompt('S', { language: 'ko' })).toContain('5~10초')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/electron/api/llm/prompts.test.js` → FAIL(미정의/6~10초).

- [ ] **Step 3: 구현**

`electron/api/llm/prompts.js`에 추가 + `buildSplitPrompt` 첫 줄 수정:
```js
export function buildTitlePrompt(scriptMd, opts = {}) {
  const lang = opts.language === 'en' ? '영어' : '한국어'
  return [
    `아래 나레이션 대본에 어울리는 유튜브 영상 제목을 ${lang}로 한 줄만 출력하라. 따옴표·설명·번호 없이 제목 텍스트만.`,
    `--- 대본 ---`,
    scriptMd,
  ].join('\n')
}

export function buildContinuePrompt(existingScript, opts = {}) {
  return [
    `아래는 지금까지 작성된 나레이션 대본이다. 이 대본의 톤·문체·흐름을 그대로 유지하며 자연스럽게 이어서 계속 써라.`,
    `이미 쓴 앞부분을 반복하지 말고, 이어지는 새 내용만 출력하라(전체 대본을 다시 출력하지 말 것).`,
    opts.genre ? `장르: ${opts.genre}` : '',
    `--- 지금까지의 대본 ---`,
    existingScript,
  ].filter(Boolean).join('\n')
}
```
`buildSplitPrompt`의 첫 지시 라인을 교체(기존 "6~10초..." 라인):
```js
    `아래 대본을 의미 단위로 나누되 각 씬은 낭독 시 5~10초(${opts.language === 'ko' ? '한국어 기준 약 28~55자' : 'about 75~150 chars in English'}) 분량이어야 한다. 의미가 바뀌거나 길이를 초과하면 씬을 분할하라.`,
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/electron/api/llm/prompts.test.js` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(story): buildTitlePrompt/buildContinuePrompt + 씬분리 5~10초"`

---

### Task 2: llmClaude — generateTitle / continueScript

**Files:**
- Modify: `electron/api/llm/llmClaude.js`
- Test: `tests/electron/api/llm/llmClaude.titleContinue.test.js`

**Interfaces:**
- Consumes: `buildTitlePrompt`/`buildContinuePrompt`(Task1), `claudeSdk`(buildClaudeSdkOptions/extractClaudeSdkResult/bridgeAbortSignal/extractTextDelta), `DEFAULT_MODEL`/`defaultQuery`(기존).
- Produces: `generateTitle(scriptMd, opts, {signal,queryImpl}) -> { title }`(논스트리밍), `continueScript(existingScript, opts, {onDelta,signal,queryImpl}) -> { scriptMd }`(스트리밍, 이어진 전체 반환).

- [ ] **Step 1: 실패 테스트**

`tests/electron/api/llm/llmClaude.titleContinue.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import { generateTitle, continueScript } from '../../../../electron/api/llm/llmClaude.js'

const resultMsg = (text) => ({ type: 'result', subtype: 'success', is_error: false, result: text })
function fakeQuery(msgs) { return async function* () { for (const m of msgs) yield m } }

describe('generateTitle', () => {
  it('result 첫 줄을 title로 반환', async () => {
    const { title } = await generateTitle('대본', {}, { queryImpl: fakeQuery([resultMsg('멋진 제목\n군더더기')]) })
    expect(title).toBe('멋진 제목')
  })
})
describe('continueScript', () => {
  it('기존 대본 뒤에 이어붙인 전체를 반환하고 델타를 흘린다', async () => {
    const onDelta = vi.fn()
    const stream = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '이어진' } } }
    const { scriptMd } = await continueScript('앞부분', {}, { onDelta, queryImpl: fakeQuery([stream, resultMsg('이어진 내용')]) })
    expect(onDelta).toHaveBeenCalledWith('이어진')
    expect(scriptMd).toBe('앞부분\n\n이어진 내용')
  })
  it('abort면 Aborted throw', async () => {
    const ac = new AbortController()
    const onDelta = vi.fn(() => ac.abort())
    const stream = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } }
    await expect(continueScript('앞', {}, { onDelta, signal: ac.signal, queryImpl: fakeQuery([stream, resultMsg('y')]) })).rejects.toThrow('Aborted')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/electron/api/llm/llmClaude.titleContinue.test.js` → FAIL.

- [ ] **Step 3: 구현** — `electron/api/llm/llmClaude.js` 상단 import에 `buildTitlePrompt, buildContinuePrompt` 추가, 아래 함수 추가:
```js
export async function generateTitle(scriptMd, opts = {}, { signal, queryImpl = defaultQuery } = {}) {
  const prompt = buildTitlePrompt(scriptMd, opts)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  try {
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController)
    for await (const m of queryImpl({ prompt, options })) {
      if (m.type === 'result') return { title: extractClaudeSdkResult(m).split('\n')[0].trim() }
    }
    throw new Error('no result message returned')
  } catch (err) {
    if (signal?.aborted) throw new Error('Aborted')
    throw new Error(`Claude SDK failed: ${err.message}`)
  } finally { cleanup() }
}

export async function continueScript(existingScript, opts = {}, { onDelta, signal, queryImpl = defaultQuery } = {}) {
  const prompt = buildContinuePrompt(existingScript, opts)
  const { abortController, cleanup } = bridgeAbortSignal(signal)
  let added = ''
  try {
    const options = buildClaudeSdkOptions(opts.model || DEFAULT_MODEL, abortController, { includePartialMessages: true })
    for await (const m of queryImpl({ prompt, options })) {
      const delta = extractTextDelta(m)
      if (delta != null) { if (signal?.aborted) break; added += delta; onDelta?.(delta); continue }
      if (m.type === 'result') return { scriptMd: `${existingScript}\n\n${extractClaudeSdkResult(m)}` }
    }
    if (signal?.aborted) throw new Error('Aborted')
    return { scriptMd: `${existingScript}\n\n${added}` }
  } catch (err) {
    if (signal?.aborted) throw new Error('Aborted')
    throw new Error(`Claude SDK failed: ${err.message}`)
  } finally { cleanup() }
}
```
(상단 import에 `extractTextDelta`가 이미 있으면 재사용; 없으면 claudeSdk import에 추가.)

- [ ] **Step 4: 통과 + 회귀** — Run: `npx vitest run tests/electron/api/llm/` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(story): llmClaude.generateTitle/continueScript"`

---

### Task 3: stepMachine — scriptText payload / scenes override / continue / generateTitle

**Files:**
- Modify: `electron/story/stepMachine.js`
- Test: `tests/electron/story/stepMachine.scriptRedesign.test.js`

**Interfaces:**
- Consumes: `llm.generateTitle`/`llm.continueScript`(DI llm).
- Produces: `open()/getState()` payload에 `scriptText`. `steps.script` `params.continue` 분기. `steps.scenes` `params.scriptOverride`+`params.options` 처리(manual 초기화 + trim guard). 신규 `machine.generateTitle(scriptMd)` -> `{ title }`.

- [ ] **Step 1: 실패 테스트**

`tests/electron/story/stepMachine.scriptRedesign.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

async function tmp() { return mkdtemp(path.join(os.tmpdir(), 'proj-')) }
function mkLlm(over = {}) {
  return { generateScript: vi.fn(async () => ({ scriptMd: '# 생성' })), splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })), writePrompts: vi.fn(async () => ({ scenes: [] })), generateTitle: vi.fn(async () => ({ title: '자동제목' })), continueScript: vi.fn(async () => ({ scriptMd: '앞\n\n뒤' })), ...over }
}

describe('stepMachine 대본 재설계', () => {
  it('open payload에 scriptText(script.md 내용)를 싣는다', async () => {
    const projectPath = await tmp(); const llm = mkLlm()
    const m = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    await m.open()
    await m.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    const m2 = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    const { scriptText } = await m2.open()
    expect(scriptText).toContain('생성')
  })
  it('scenes scriptOverride가 script.md를 갱신하고 options로 state.input을 세운다', async () => {
    const projectPath = await tmp(); const llm = mkLlm()
    const m = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    await m.open()
    await m.start('scenes', { scriptOverride: '편집본 대본', options: { language: 'en', model: 'claude-sonnet-5' } })
    expect(await readFile(path.join(projectPath, 'story', 'script.md'), 'utf8')).toBe('편집본 대본')
    expect(llm.splitScenes.mock.calls[0][1].language).toBe('en')
  })
  it('scenes scriptOverride가 공백이면 저장 안 하고 throw', async () => {
    const projectPath = await tmp(); const llm = mkLlm()
    const m = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    await m.open()
    await m.start('script', { input: { type: 'title', title: 'T' }, options: {} }) // script.md='# 생성'
    await m.start('scenes', { scriptOverride: '   ', options: {} })
    const st = await m.getState()
    expect(st.steps.scenes.status).toBe('error')
    expect(await readFile(path.join(projectPath, 'story', 'script.md'), 'utf8')).toBe('# 생성') // 보존
  })
  it('script continue 분기는 continueScript를 부른다', async () => {
    const projectPath = await tmp(); const llm = mkLlm()
    const m = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    await m.open()
    await m.start('script', { continue: '앞', options: {} })
    expect(llm.continueScript).toHaveBeenCalled()
    expect(await readFile(path.join(projectPath, 'story', 'script.md'), 'utf8')).toBe('앞\n\n뒤')
  })
  it('generateTitle 액션이 title을 반환', async () => {
    const projectPath = await tmp(); const llm = mkLlm()
    const m = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    await m.open()
    expect(await m.generateTitle('대본')).toEqual({ title: '자동제목' })
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/electron/story/stepMachine.scriptRedesign.test.js` → FAIL.

- [ ] **Step 3: 구현** — `electron/story/stepMachine.js`:
  1. `open()`/`getState()`가 payload에 `scriptText` 포함: `const scriptText = (await store.loadText('script.md')) || ''` 후 `send('story:state', { state, scenes, scriptText })` / `return { projectToken, state, scenes, scriptText }`(open), `return { ...state, scenes, scriptText }`(getState).
  2. `steps.script`에 continue 분기 추가(맨 위, pastedScript 분기 근처):
  ```js
  if (params.continue) {
    const opts = { apiKey: getApiKey(), model: state.engine.model, ...(params.options || {}) }
    const { scriptMd } = await llm.continueScript(params.continue, opts, {
      onDelta: (text) => send('story:delta', { text }, opId), signal,
    })
    if (signal?.aborted) return
    await store.saveText('script.md', scriptMd)
    return
  }
  ```
  3. `steps.scenes` 시작부에 override 처리:
  ```js
  if (typeof params.scriptOverride === 'string') {
    if (!params.scriptOverride.trim()) throw new Error('빈 대본으로 씬 분리할 수 없습니다')
    await store.saveText('script.md', params.scriptOverride)
    state.input = state.input
      ? { ...state.input, options: params.options || state.input.options }
      : { type: 'manual', options: params.options }
  }
  ```
  (이후 기존 `scriptMd = await store.loadText('script.md')` 흐름 그대로. opts는 `state.input?.options` 사용 유지.)
  4. 반환 객체에 `generateTitle` 액션 추가:
  ```js
  async generateTitle(scriptMd) {
    const opts = { apiKey: getApiKey(), model: state?.engine?.model, ...(state?.input?.options || {}) }
    return llm.generateTitle(scriptMd, opts, {})
  },
  ```

- [ ] **Step 4: 통과 + 회귀** — Run: `npx vitest run tests/electron/story/` → PASS(신규 + 기존 회귀).
- [ ] **Step 5: Commit** — `git commit -m "feat(story): stepMachine scriptText payload/scenes override/continue/generateTitle"`

---

### Task 4: story-api + preload — story:generate-title

**Files:**
- Modify: `electron/ipc/story-api.js`, `electron/preload.js`
- Test: `tests/electron/ipc/story-api.generateTitle.test.js`

**Interfaces:**
- Consumes: `machine.generateTitle`(Task3).
- Produces: IPC `story:generate-title` (guarded) → `{ title }`. preload `storyGenerateTitle(params)`.

- [ ] **Step 1: 실패 테스트**

`tests/electron/ipc/story-api.generateTitle.test.js` — 기존 story-api 테스트의 ipcMain/machine mock 패턴을 따르되, `story:generate-title` 핸들러가 등록되고 `machine.generateTitle`을 호출해 `{title}`을 반환하는지 검증. (기존 `tests/electron/ipc/story-api.test.js`의 setup 헬퍼 재사용.)
```js
// 핵심 단언
expect(handlers['story:generate-title']).toBeDefined()
const r = await handlers['story:generate-title'](null, { projectToken: TOKEN, scriptMd: '대본' })
expect(r).toEqual({ title: expect.any(String) })
```

- [ ] **Step 2: 실패 확인** — FAIL(핸들러 없음).

- [ ] **Step 3: 구현**
  - `electron/ipc/story-api.js` 핸들러 등록부에 추가:
  ```js
  ipcMain.handle('story:generate-title', guarded(({ scriptMd }) => machine.generateTitle(scriptMd)))
  ```
  - `electron/preload.js` story 노출부(storyAbort 근처)에 추가:
  ```js
  storyGenerateTitle: (params) => ipcRenderer.invoke('story:generate-title', params),
  ```

- [ ] **Step 4: 통과** — Run: `npx vitest run tests/electron/ipc/` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(story): story:generate-title IPC + preload"`

---

### Task 5: useStoryPipeline — scriptText / generateTitle

**Files:**
- Modify: `src/hooks/useStoryPipeline.js`
- Test: `tests/hooks/useStoryPipeline.scriptText.test.js`

**Interfaces:**
- Produces: 훅 반환에 `scriptText`(open/story:state 동기화), `generateTitle(scriptMd) -> Promise<{title}>`.

- [ ] **Step 1: 실패 테스트**

`tests/hooks/useStoryPipeline.scriptText.test.js`(기존 useStoryPipeline 테스트의 electronAPI mock 패턴 재사용):
```js
// open 응답/story:state의 scriptText가 훅 상태로 반영되는지
// storyOpen: async () => ({ projectToken:'TOK', state:{}, scenes:[], scriptText:'복원대본' })
// → result.current.scriptText === '복원대본'
// generateTitle 호출이 window.electronAPI.storyGenerateTitle을 부르고 {title} 반환
```

- [ ] **Step 2: 실패 확인** — FAIL.

- [ ] **Step 3: 구현** — `src/hooks/useStoryPipeline.js`:
  - `const [scriptText, setScriptText] = useState('')` 추가.
  - `story:state` 핸들러에 `if (p.scriptText !== undefined) setScriptText(p.scriptText)`.
  - `open()`의 `setState(r.state)` 근처 `if (r.scriptText !== undefined) setScriptText(r.scriptText)`, getState 결과에도 반영.
  - projectPath 전환 리셋 effect에 `setScriptText('')` 추가.
  - `const generateTitle = useCallback((scriptMd) => window.electronAPI.storyGenerateTitle({ projectToken: tokenRef.current, scriptMd }), [])`.
  - return에 `scriptText, generateTitle` 추가.

- [ ] **Step 4: 통과 + 회귀** — Run: `npx vitest run tests/hooks/` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(story): useStoryPipeline scriptText/generateTitle"`

---

### Task 6: PromptInput — hideTip

**Files:**
- Modify: `src/components/PromptInput.jsx`
- Test: `tests/components/PromptInput.hideTip.test.jsx`

**Interfaces:**
- Produces: `<PromptInput hideTip />` — footer의 tip span 미표시(줄 수·문자 수 유지). 기본 false.

- [ ] **Step 1: 실패 테스트**

`tests/components/PromptInput.hideTip.test.jsx`:
```js
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '../../src/hooks/useI18n'
import PromptInput from '../../src/components/PromptInput.jsx'
// hideTip=true면 tip 미표시, 기본은 표시
it('hideTip=true면 tip을 숨긴다', () => {
  const { container } = render(<I18nProvider><PromptInput value="x" onChange={()=>{}} hideTip /></I18nProvider>)
  expect(container.querySelector('.hint')).toBeNull()
})
it('기본은 tip 표시', () => {
  const { container } = render(<I18nProvider><PromptInput value="x" onChange={()=>{}} /></I18nProvider>)
  expect(container.querySelector('.hint')).not.toBeNull()
})
```

- [ ] **Step 2: 실패 확인** — FAIL.

- [ ] **Step 3: 구현** — `src/components/PromptInput.jsx`: 시그니처에 `hideTip = false` 추가. footer의 `<span className="hint">💡 {t('prompt.tip')}</span>`를 `{!hideTip && <span className="hint">💡 {t('prompt.tip')}</span>}`로.

- [ ] **Step 4: 통과 + 회귀** — Run: `npx vitest run tests/components/PromptInput.hideTip.test.jsx tests/components/PromptInput.mention.test.jsx` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: PromptInput hideTip"`

---

### Task 7: StoryView — scriptText 단일 상태 + scriptPhase + displayStep 강제 + hydrate

**Files:**
- Modify: `src/components/story/StoryView.jsx`
- Test: `tests/components/story/StoryView.phase.test.jsx`

**Interfaces:**
- Consumes: `pipeline.scriptText`(Task5).
- Produces: `scriptPhase` 상태, `displayStep` 강제, 폼 hydrate. (setup/editor 렌더는 Task 8·9.)

- [ ] **Step 1: 실패 테스트**

`tests/components/story/StoryView.phase.test.jsx`:
```js
// 1) pipeline.scriptText 있으면 초기 scriptPhase='editor'(대본 작업 화면 마커 노출)
// 2) 없으면 'setup'(설정 화면 마커)
// 3) script done + scriptPhase 유지 시 displayStep이 여전히 script (scenes 패널 아님)
```
(구체 단언은 Task 8·9의 화면 마커 `data-testid="story-setup"`/`"story-editor"`로 검증.)

- [ ] **Step 2~4**: RED → 구현 → GREEN. `StoryView.jsx`:
  - `pipeline`에서 `scriptText`를 구조분해. 로컬 편집 상태는 `scriptText`를 초기값으로 하는 controlled state로 통합(기존 `scriptDraft`/`pastedScript` 제거).
  - `const [scriptPhase, setScriptPhase] = useState(pipeline.scriptText?.trim() ? 'editor' : 'setup')`. pipeline.scriptText 변경 시 동기화(useEffect: 값이 생기고 phase가 setup이면 editor 승격은 명시 트리거에서만 — 재오픈 복원은 초기값으로).
  - `displayStep` 계산: `scriptPhase ? 'script' : computeCurrentStep(...)` 우선(scriptPhase가 있으면 'script').
  - 폼 hydrate: open/getState state.input.title/options에서 title/genre/model/language/length/lengthUnit 초기화(pipeline.state.input 참조, 없으면 기본값).
- [ ] **Step 5: Commit** — `git commit -m "feat(story): StoryView scriptText 단일 상태 + scriptPhase + hydrate"`

---

### Task 8: StoryView — 설정 화면(setup)

**Files:**
- Modify: `src/components/story/StoryView.jsx`, `src/components/story/StoryView.css`
- Test: `tests/components/story/StoryView.setup.test.jsx`

**Interfaces:**
- Consumes: `scriptPhase`(Task7), `pipeline.start`.
- Produces: setup 화면(세로 옵션+설명, 제목, drag&drop, [시작] 분기 → editor).

- [ ] **Step 1: 실패 테스트** — `data-testid="story-setup"` 렌더, 언어 select(ko/en), [시작]이 제목만 있으면 `start('script',{input:{type:'title',title},options})`, scriptText 있으면 `start('script',{pastedScript:scriptText,options})` 후 scriptPhase='editor'. drag&drop/붙여넣기로 scriptText 채움.
- [ ] **Step 2~4**: RED→구현→GREEN. 세로 옵션(장르/모델/언어 select + 길이 값/단위) 각 `.story-opt-row`에 라벨+설명. 제목 input. `.story-import-drop`(작은 drag&drop; `onDrop`으로 `.txt`/`.md` FileReader → scriptText; textarea 붙여넣기 겸용). [시작] onClick 분기. CSS: 세로 레이아웃 + 작은 drop 영역.
- [ ] **Step 5: Commit** — `git commit -m "feat(story): 설정 화면(세로 옵션+제목+drag&drop 임포트)"`

---

### Task 9: StoryView — 대본 작업 화면(editor) + 버튼 핸들러

**Files:**
- Modify: `src/components/story/StoryView.jsx`, `src/components/story/StoryView.css`
- Test: `tests/components/story/StoryView.editor.test.jsx`

**Interfaces:**
- Consumes: `scriptPhase`(Task7), `pipeline.start`/`abort`/`generateTitle`, `PromptInput`(hideTip).
- Produces: editor 화면(대본칸 + 버튼 상태 + 핸들러).

- [ ] **Step 1: 실패 테스트**

`tests/components/story/StoryView.editor.test.jsx`:
```js
// - scriptPhase editor + 대기: [다시쓰기][이어쓰기][분리시작][설정으로]
// - 생성 중(isRunning): [중단]만
// - scriptText 공백이면 3버튼 disabled
// - 분리시작: 제목 비면 generateTitle(scriptText) 먼저 부르고, start('scenes',{scriptOverride:scriptText,options}) 호출
// - 이어쓰기: start('script',{continue:scriptText,options})
// - 다시쓰기: start('script',{input:{type:'title',title},options})
```
generateTitle mock이 `{title:'자동'}` 반환하도록 pipeline mock 구성.

- [ ] **Step 2~4**: RED→구현→GREEN. editor 블록(`data-testid="story-editor"`): 생성 중 `story-script-stream`(이어쓰기면 `baseScript + streamingText`) / 대기 `PromptInput`(value=scriptText, disableMentions showCharCount hideTip, onChange=setScriptText). 버튼:
  - 생성 중: `[⏹ 중단]`(abort).
  - 대기: `[다시쓰기]`(재생성) `[이어쓰기]`(continue) `[분리시작]`(scenes) `[⚙ 설정으로]`(setScriptPhase('setup')). `scriptText.trim()` 비면 앞 3개 disabled.
  - 분리시작/다시쓰기 핸들러: 제목 비고 scriptText 있으면 `const { title } = await pipeline.generateTitle(scriptText); setTitle(title)` 후 그 `title`로 start payload 구성(로컬 변수 사용). 실패 시 toast + 중단.
  - 이어쓰기 시작 시 `baseScript = scriptText` 스냅샷(로컬 state), 표시용.
- [ ] **Step 5: Commit** — `git commit -m "feat(story): 대본 작업 화면(3버튼+제목자동생성+이어쓰기+분리시작)"`

---

## Self-Review (작성자 확인)

- **Spec 커버리지**: 데이터모델(T3 payload/T5 훅/T7 상태) / 화면분리(T7 phase·T8 setup·T9 editor) / 제목자동생성(T2·T3·T4·T9) / 이어쓰기(T2·T3·T9 base+delta) / 편집반영(T3 scriptOverride·T9 분리시작) / 씬분리 5~10초(T1) / 언어드롭다운(T8) / hideTip(T6). 스펙 §0~6 전부 매핑.
- **타입 일관성**: `scriptText`/`scriptPhase`/`scriptOverride`/`continue`/`generateTitle`/`hideTip`이 정의(T2/T3/T5/T6/T7)와 사용(T8/T9)에서 동일.
- **빈 대본 가드**: T3(main throw) + T9(버튼 disabled) 양쪽.
- **완료 커밋**: main payload.scriptText(T3) → 훅 scriptText(T5) → StoryView(T7). renderer delta 재조립 없음.
- **회귀 주의**: PromptInput/StoryView 기존 테스트 중 pastedScript/scriptDraft/옛 폼 참조분은 각 태스크에서 수정. prompts 기존 테스트 유지.
