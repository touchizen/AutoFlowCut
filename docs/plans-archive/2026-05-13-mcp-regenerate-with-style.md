# MCP Regenerate-with-Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP 호출자가 스타일을 바꿔 **이미 완료된** reference/scene을 재생성할 수 있게 한다 (단건 + batch).

**Architecture:**
1. 단건 reference 재생성은 이미 동작 (`app_generate_reference(index, styleId)` — 이미지 있어도 재생성). 변경 없음. 도구 설명만 보강.
2. 단건 scene 재생성에 `styleId` 파라미터 추가 — 현재 `app_generate_scene(sceneId)`은 styleId override 못 받음.
3. batch 두 개 (`app_start_scene_batch`, `app_start_ref_batch`)에 `force: true` 옵션 추가 — 기본 false (현재 동작 유지: pending/error만), true면 done 포함 모든 대상 강제 재생성.
4. HTTP API (`/api/generate-scene`, `/api/start-scene-batch`, `/api/start-ref-batch`) 동시 갱신.
5. handler 시그니처 확장: `handleGenerateScene(sceneId, overrideStyleId)`, `handleStart(overrideStyleId, { force })`, `handleGenerateAllRefs(overrideStyleId, { force })`.

**Tech Stack:** React 18, vitest, Node http server (Electron main), MCP SDK

**호환성:** 기존 호출자가 이전 시그니처로 호출해도 동작 동일. 새 파라미터는 모두 optional + 기본값 = 현재 동작.

---

## File Structure

**Modify:**
- `src/hooks/useSceneGeneration.js` — `handleGenerateScene(sceneId, overrideStyleId)` 시그니처 확장 (확인 필요: 현재 위치)
- `src/hooks/useAutomation.js` — `runConcurrentQueue`에 `force` 옵션 추가, true면 모든 scene 포함 (filterPendingScenes 우회)
- `src/hooks/useReferenceGeneration.js` — `handleGenerateAllRefs`에 `force` 옵션, true면 `_executeBatchRefs` 필터에서 done/data/filePath 체크 우회
- `src/hooks/useMcpServer.js`:
  - `__mcpGenerateScene(sceneId, styleId)` 시그니처 확장 + handler에 styleId forward
  - `__mcpStartBatch(styleId, force)` + `__mcpStartRefBatch(styleId, force)` — force 받아서 handler에 전달
  - HTTP message handlers (`generate-scene`, `start-scene-batch`, `start-ref-batch`) — payload에서 force 추출
- `src/App.jsx` — handleStart/handleGenerateAllRefs가 옵션 객체 받을 수 있게. (기존 호출자: 변경 없음 — 옵션 안 넘기면 기존 동작)
- `electron/main.js`:
  - `/api/generate-scene` — body에서 styleId 파싱, IPC payload에 추가
  - `/api/start-scene-batch` — body에서 force 파싱, payload에 추가
  - `/api/start-ref-batch` — body에서 force 파싱, payload에 추가
- `electron/api-docs.js` — OpenAPI specs에 styleId/force 필드 추가
- `mcp-server/index.js` — tool inputSchema에 styleId/force 추가, description 갱신
- `mcp-server/README.md` — endpoint + tool 설명에 새 파라미터 표 보강

**Create:**
- `tests/hooks/useMcpServer.regenerate.test.js` — 새 케이스 (force flag, scene styleId, generate-reference re-run)

**Out of scope:**
- `force` 옵션의 UI 노출 — 이번 PR은 MCP 전용
- partial scene 선택 (예: ID 리스트로 강제 재생성) — `force` boolean만. 선택 재생성은 향후 sceneIds 배열 옵션 후보
- 'none' sentinel을 force와 결합한 동작 — sentinel 'none'은 그대로 (스타일 미적용 강제). force는 별개 (대상 선택 강제)

---

## Task 1: `app_generate_reference` 도구 설명 갱신 (도구는 이미 됨)

**Files:**
- Modify: `mcp-server/index.js` (`app_generate_reference` description)
- Modify: `electron/api-docs.js` (`/api/generate-reference` description)
- Modify: `mcp-server/README.md`

이미 `_executeGenerateRef`는 image 있어도 재생성하지만 명시적 docs 없음. 사용자가 "재생성 가능"을 알게 보강.

- [ ] **Step 1: tool description에 "이미 완료된 reference도 새 styleId로 재생성 가능" 명시**

`mcp-server/index.js`의 `app_generate_reference` description 끝에 추가:

```
이미 이미지가 있는 reference라도 다시 호출하면 새 styleId로 재생성됩니다.
```

- [ ] **Step 2: OpenAPI spec 동일 갱신**

`electron/api-docs.js` `/api/generate-reference`의 description 갱신.

- [ ] **Step 3: README endpoint 표에 비고 컬럼 추가**

`mcp-server/README.md`의 generate-reference 행 근처:

```markdown
> 이미 완료된 reference도 다시 호출하면 새 styleId로 재생성됩니다.
```

- [ ] **Step 4: 회귀 + 커밋**

```bash
npm run test:run
git add mcp-server/index.js electron/api-docs.js mcp-server/README.md
git commit -m "docs(mcp): clarify generate-reference re-runs even if image exists"
```

---

## Task 2: `app_generate_scene` styleId 파라미터 추가 (TDD)

**Files:**
- Modify: `tests/hooks/useMcpServer.test.js` (테스트 추가)
- Modify: `src/hooks/useMcpServer.js` (handler 시그니처)
- Modify: `src/hooks/useSceneGeneration.js` (handleGenerateScene 확장)
- Modify: `electron/main.js` (HTTP body parse)
- Modify: `electron/api-docs.js` (OpenAPI)
- Modify: `mcp-server/index.js` (tool schema)
- Modify: `mcp-server/README.md`

- [ ] **Step 1: 실패 테스트 작성**

`tests/hooks/useMcpServer.test.js` 안 (기존 describe 블록에 추가):

```js
describe('generate-scene with styleId', () => {
  it('__mcpGenerateScene forwards styleId to handleGenerateScene', () => {
    const handleGenerateScene = vi.fn(() => Promise.resolve({ success: true }))
    renderHook(() => useMcpServer(makeProps({ handleGenerateScene })))

    window.__mcpGenerateScene('scene_42', 'preset:noir')
    expect(handleGenerateScene).toHaveBeenCalledWith('scene_42', 'preset:noir')
  })

  it("__mcpGenerateScene with styleId='none' passes 'none' through", () => {
    const handleGenerateScene = vi.fn(() => Promise.resolve({ success: true }))
    renderHook(() => useMcpServer(makeProps({ handleGenerateScene })))

    window.__mcpGenerateScene('scene_42', 'none')
    expect(handleGenerateScene).toHaveBeenCalledWith('scene_42', 'none')
  })

  it('__mcpGenerateScene without styleId passes undefined', () => {
    const handleGenerateScene = vi.fn(() => Promise.resolve({ success: true }))
    renderHook(() => useMcpServer(makeProps({ handleGenerateScene })))

    window.__mcpGenerateScene('scene_42')
    expect(handleGenerateScene).toHaveBeenCalledWith('scene_42', undefined)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/hooks/useMcpServer.test.js`
Expected: 3개 새 테스트 FAIL — handleGenerateScene이 styleId 받지 않음

- [ ] **Step 3: useMcpServer 핸들러 확장**

기존:
```jsx
window.__mcpGenerateScene = (sceneId) => handleGenerateScene(sceneId)
```
→
```jsx
window.__mcpGenerateScene = (sceneId, styleId) => handleGenerateScene(sceneId, styleId)
```

(normalizeStyleId/none/auto 처리는 handleGenerateScene 내부 또는 호출 측에서 — 단순 forward)

HTTP message handler (generate-scene type 분기) 갱신:

```jsx
} else if (data.type === 'generate-scene') {
  console.log('[MCP] Generate scene requested:', data.sceneId, 'style:', data.styleId)
  window.__mcpGenerateScene?.(data.sceneId, data.styleId)
}
```

- [ ] **Step 4: handleGenerateScene이 styleId 받게 확장**

`src/hooks/useSceneGeneration.js`에서 `handleGenerateScene` 정의 찾아서 시그니처 확장:

```jsx
const handleGenerateScene = useCallback(async (sceneId, overrideStyleId = undefined) => {
  // ...기존 로직
  // styleId 결정 시 overrideStyleId !== undefined ? overrideStyleId : selectedStyleRefId 패턴
}, [...])
```

styleId 결정/전달은 `_resolveEffectiveStyleId` 또는 inline. 'none' sentinel도 자연 처리 (styleService.applyStyle/resolveSceneStyle이 'none' 인식).

- [ ] **Step 5: HTTP API 확장 (electron/main.js)**

`/api/generate-scene` POST handler:

기존:
```js
const data = JSON.parse(body)
const sceneId = data.sceneId
if (mainWindow && sceneId) {
  mainWindow.webContents.send('mcp-update', {
    type: 'generate-scene',
    sceneId: sceneId
  })
  ...
}
```
→
```js
const data = JSON.parse(body)
const sceneId = data.sceneId
const styleId = data.styleId  // 새 — undefined면 generation에서 selectedStyleRefId 사용
if (mainWindow && sceneId) {
  mainWindow.webContents.send('mcp-update', {
    type: 'generate-scene',
    sceneId: sceneId,
    styleId: styleId
  })
  ...
}
```

- [ ] **Step 6: OpenAPI spec 갱신 (electron/api-docs.js)**

`/api/generate-scene` requestBody schema에 styleId 추가:

```js
properties: {
  sceneId: { type: 'string', description: '씬 ID', example: 'scene_42' },
  styleId: { type: 'string', description: '스타일 ID. 형식: "ref:<id>" / "preset:<id>" / plain / "auto" / "none". 생략 시 UI 선택값 사용. 이미 이미지가 있는 씬이라도 새 styleId로 재생성됩니다.', example: 'preset:noir' },
},
```

- [ ] **Step 7: MCP tool schema 갱신 (mcp-server/index.js)**

`app_generate_scene` inputSchema에 styleId 추가 (위와 동일 description).

- [ ] **Step 8: README 갱신 (mcp-server/README.md)**

generate-scene endpoint 섹션 + tool 표에 styleId 비고 추가.

- [ ] **Step 9: 회귀 + 커밋**

```bash
npm run test:run  # 1125 + 3 = 1128+
git add tests/hooks/useMcpServer.test.js src/hooks/useMcpServer.js src/hooks/useSceneGeneration.js electron/main.js electron/api-docs.js mcp-server/index.js mcp-server/README.md
git commit -m "feat(mcp): app_generate_scene accepts styleId — re-generate completed scene with new style"
```

---

## Task 3: batch에 `force` 옵션 — scene batch (TDD)

**Files:**
- Modify: `tests/hooks/useMcpServer.test.js`
- Modify: `src/hooks/useMcpServer.js`
- Modify: `src/App.jsx` (handleStart 시그니처)
- Modify: `src/hooks/useAutomation.js` (runConcurrentQueue force 옵션)
- Modify: `electron/main.js`, `electron/api-docs.js`, `mcp-server/index.js`, `mcp-server/README.md`

- [ ] **Step 1: 실패 테스트 작성**

```js
describe('start-scene-batch with force', () => {
  it('__mcpStartBatch passes { force: true } as second arg to handleStart', () => {
    const handleStart = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleStart })))

    window.__mcpStartBatch(undefined, { force: true })
    // handleStart(overrideStyleId, options) — 호출 시그니처 새로 정의
    expect(handleStart).toHaveBeenCalledWith(null, { force: true })  // null은 첫 카드 fallback
  })

  it('__mcpStartBatch without force defaults to undefined options (backward compat)', () => {
    const handleStart = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleStart })))

    window.__mcpStartBatch('preset:noir')
    expect(handleStart).toHaveBeenCalledWith('preset:noir')  // 기존 시그니처 — 옵션 안 넘김
  })
})
```

(handleStart 시그니처는 `(override, options)` — options optional. 기존 호출자 그대로.)

- [ ] **Step 2: 테스트 실패 확인 + 구현**

`useMcpServer.js`의 `__mcpStartBatch` 시그니처 확장:

기존:
```jsx
window.__mcpStartBatch = (styleId) => {
  if (styleId === 'auto') { handleStart(null); return }
  if (styleId === 'none') { handleStart('none'); return }
  const effective = normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current)
  handleStart(effective)
}
```
→
```jsx
window.__mcpStartBatch = (styleId, options) => {
  // options = { force?: boolean } — 백워드 호환: 안 넘기면 undefined → handleStart도 1-arg 호출
  const callHandleStart = options
    ? (effective) => handleStart(effective, options)
    : (effective) => handleStart(effective)
  if (styleId === 'auto') { callHandleStart(null); return }
  if (styleId === 'none') { callHandleStart('none'); return }
  const effective = normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current)
  callHandleStart(effective)
}
```

- [ ] **Step 3: HTTP message handler 갱신**

```jsx
} else if (data.type === 'start-scene-batch') {
  console.log('[MCP] Scene batch start:', data.styleId, 'force:', data.force)
  window.__mcpStartBatch?.(data.styleId, data.force ? { force: true } : undefined)
}
```

- [ ] **Step 4: App.jsx handleStart 시그니처 확장**

`const handleStart = async (overrideStyleId = undefined, options = {}) => {`

내부에서 `const { force = false } = options`. `case 'text'/'list':` 분기에서 `start({...startOptions, force})` — useAutomation에 전달.

- [ ] **Step 5: useAutomation runConcurrentQueue + filterPendingScenes 우회**

`useAutomation.js`의 `runConcurrentQueue` 시그니처에 `force` 옵션 추가:

```jsx
const runConcurrentQueue = async (targetScenes, options, total) => {
  let { ..., force = false } = options
  ...
}
```

호출 위치 (useAutomation.start 또는 비슷):
- 기존: `targetScenes = filterPendingScenes(scenes)`
- 새: `targetScenes = force ? scenes : filterPendingScenes(scenes)`

(force=true면 모든 씬 — 완료/done 포함. resolveSceneStyle은 새 styleId로 styledPrompt 다시 합성)

- [ ] **Step 6: HTTP API 확장**

`/api/start-scene-batch` (electron/main.js):

기존 body parse에 `force` 추출:
```js
const styleId = parsed.styleId || null
const force = !!parsed.force
mainWindow.webContents.send('mcp-update', { type: 'start-scene-batch', styleId, force })
```

- [ ] **Step 7: 문서 갱신**

OpenAPI + tool schema + README — `force: boolean` 파라미터 추가:
```
force (선택, 기본 false): true면 이미 완료된 씬도 재생성 대상에 포함. 새 styleId로 다시 생성.
```

- [ ] **Step 8: 회귀 + 커밋**

```bash
npm run test:run  # 1128 + 2 = 1130+
git commit -m "feat(mcp): start-scene-batch accepts force flag — re-generate completed scenes with new style"
```

---

## Task 4: batch에 `force` 옵션 — ref batch (TDD)

**Files:** (Task 3과 동일 패턴)
- Modify: `tests/hooks/useMcpServer.test.js`
- Modify: `src/hooks/useMcpServer.js`
- Modify: `src/hooks/useReferenceGeneration.js` (`_executeBatchRefs` filter 우회)
- Modify: `electron/main.js`, `electron/api-docs.js`, `mcp-server/index.js`, `mcp-server/README.md`

- [ ] **Step 1: 실패 테스트**

```js
describe('start-ref-batch with force', () => {
  it('__mcpStartRefBatch passes force option through', () => {
    const handleGenerateAllRefs = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleGenerateAllRefs })))

    window.__mcpStartRefBatch(undefined, { force: true })
    expect(handleGenerateAllRefs).toHaveBeenCalledWith(null, { force: true })
  })
})
```

- [ ] **Step 2: useMcpServer.__mcpStartRefBatch 시그니처 확장**

(Task 3과 같은 패턴 — 두 번째 인자로 options forward)

- [ ] **Step 3: handleGenerateAllRefs + _executeBatchRefs 시그니처 확장**

`src/hooks/useReferenceGeneration.js`:

```jsx
const handleGenerateAllRefs = async (overrideStyleId = null, options = {}) => {
  const { force = false } = options
  if (!generationQueue) return _executeBatchRefs(overrideStyleId, force)
  // queue enqueue도 동일
}

const _executeBatchRefs = async (overrideStyleId = null, force = false) => {
  const generatableIndices = referencesRef.current
    .map((ref, index) => {
      if (!ref.prompt || ref.type === 'style') return -1
      if (force) return index  // 모든 (prompt 있는, non-style) ref 포함
      return (!ref.data && !ref.filePath && ref.status !== 'done') ? index : -1
    })
    .filter(i => i !== -1)
  ...
}
```

- [ ] **Step 4: HTTP message handler + endpoint 갱신**

```jsx
} else if (data.type === 'start-ref-batch') {
  window.__mcpStartRefBatch?.(data.styleId, data.force ? { force: true } : undefined)
}
```

`/api/start-ref-batch` body에 force 파싱.

- [ ] **Step 5: 문서 갱신**

(Task 3과 동일 패턴)

- [ ] **Step 6: 회귀 + 커밋**

---

## Task 5: 진행 중 자동 stop-restart (Phase 2 — TDD)

**Spec:** [docs/superpowers/specs/2026-05-13-mcp-regenerate-with-style-design.md](../specs/2026-05-13-mcp-regenerate-with-style-design.md)

**Files:**
- Modify: `src/hooks/useMcpServer.js` (running 감지 + stop-then-start orchestration)
- Modify: `src/App.jsx` (`isRunning`, `setSelectedStyleRefId`, `handleStop` 을 useMcpServer props로 전달)
- Create/Modify: `tests/hooks/useMcpServer.regenerate.test.js` (또는 기존 test에 describe 추가)

목표: MCP batch 호출(`__mcpStartBatch`/`__mcpStartRefBatch`) 받았을 때 isRunning이면 자동으로 stop → waitForStopped → start. 모달/확인 없음.

- [ ] **Step 1: 실패 테스트 작성**

`tests/hooks/useMcpServer.test.js` 또는 신규 `useMcpServer.regenerate.test.js`:

```js
describe('MCP batch — auto stop-restart when running', () => {
  it('isRunning=false: directly calls handleStart (no stop)', async () => {
    const handleStart = vi.fn()
    const handleStop = vi.fn()
    renderHook(() => useMcpServer(makeProps({ isRunning: false, handleStart, handleStop })))

    await window.__mcpStartBatch('preset:B', { force: true })

    expect(handleStop).not.toHaveBeenCalled()
    expect(handleStart).toHaveBeenCalledWith('preset:B', { force: true })
  })

  it('isRunning=true: calls handleStop, awaits, then handleStart', async () => {
    const handleStart = vi.fn()
    const handleStop = vi.fn()
    let isRunning = true
    const props = makeProps({ get isRunning() { return isRunning }, handleStart, handleStop })
    const { rerender } = renderHook(() => useMcpServer(props))

    const callPromise = window.__mcpStartBatch('preset:B', { force: true })
    // handleStop은 즉시 호출돼야 함
    expect(handleStop).toHaveBeenCalled()
    expect(handleStart).not.toHaveBeenCalled()

    // running이 false로 바뀌면 handleStart 호출
    isRunning = false
    rerender()
    await callPromise

    expect(handleStart).toHaveBeenCalledWith('preset:B', { force: true })
  })

  it('waitForStopped timeout: handleStart NOT called', async () => {
    vi.useFakeTimers()
    const handleStart = vi.fn()
    const handleStop = vi.fn()
    renderHook(() => useMcpServer(makeProps({ isRunning: true, handleStart, handleStop })))

    const callPromise = window.__mcpStartBatch('preset:B', { force: true })
    await vi.advanceTimersByTimeAsync(31000)  // > 30s timeout
    await callPromise

    expect(handleStart).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: useMcpServer 확장**

새 props: `isRunning`, `setSelectedStyleRefId`, `handleStop` (기존 props에 추가).

`isRunningRef = useRef(isRunning)` + `useEffect(() => { isRunningRef.current = isRunning }, [isRunning])`.

`waitForStopped()` helper:
```js
const waitForStopped = () => new Promise((resolve) => {
  const start = Date.now()
  const timer = setInterval(() => {
    if (!isRunningRef.current) { clearInterval(timer); resolve(true) }
    else if (Date.now() - start > 30000) { clearInterval(timer); resolve(false) }
  }, 50)
})
```

`__mcpStartBatch` 시그니처 + 로직 (기존 코드 위치에 stop-restart 분기 추가):
```js
window.__mcpStartBatch = async (styleId, options) => {
  const callHandleStart = options
    ? (effective) => handleStart(effective, options)
    : (effective) => handleStart(effective)

  const resolveEffective = () => {
    if (styleId === 'auto') return null
    if (styleId === 'none') return 'none'
    return normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current)
  }

  if (isRunningRef.current) {
    handleStop?.()
    const ok = await waitForStopped()
    if (!ok) {
      console.warn('[MCP] start-batch: stop timeout (30s), aborting restart')
      return
    }
  }
  callHandleStart(resolveEffective())
}
```

`__mcpStartRefBatch`도 동일 패턴.

- [ ] **Step 3: App.jsx에서 새 props 전달**

`useMcpServer({ ..., isRunning: anyRunning, setSelectedStyleRefId, handleStop })`.

`anyRunning`은 이미 App.jsx에 있는 변수 (isRunning || videoAutomation.isRunning).

- [ ] **Step 4: 회귀 + 커밋**

```bash
npm run test:run
git add src/hooks/useMcpServer.js src/App.jsx tests/hooks/useMcpServer.test.js  # 또는 regenerate.test.js
git commit -m "feat(mcp): auto stop-restart when batch called during running generation"
```

---

## Task 6: selectedStyleRefId sync — MCP가 명시 styleId 줬을 때 UI 갱신 (Phase 2 — TDD)

**Files:**
- Modify: `src/hooks/useMcpServer.js`
- Modify: `tests/hooks/useMcpServer.regenerate.test.js`

목표: MCP가 `'preset:*'` / `'ref:*'` / plain ID로 호출하면 UI의 selectedStyleRefId도 갱신해서 Start 버튼 라벨이 새 스타일을 표시.

- [ ] **Step 1: 실패 테스트**

```js
describe('MCP batch — selectedStyleRefId sync', () => {
  it("styleId='preset:noir' updates selectedStyleRefId", async () => {
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ isRunning: false, setSelectedStyleRefId })))

    await window.__mcpStartBatch('preset:noir')

    expect(setSelectedStyleRefId).toHaveBeenCalledWith('preset:noir')
  })

  it("styleId='auto' does NOT update selectedStyleRefId", async () => {
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ isRunning: false, setSelectedStyleRefId })))

    await window.__mcpStartBatch('auto')

    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  it("styleId='none' does NOT update selectedStyleRefId", async () => {
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ isRunning: false, setSelectedStyleRefId })))

    await window.__mcpStartBatch('none')

    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  it('undefined styleId does NOT update selectedStyleRefId', async () => {
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ isRunning: false, setSelectedStyleRefId })))

    await window.__mcpStartBatch(undefined)

    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })
})
```

ref batch도 동일.

- [ ] **Step 2: 구현**

`__mcpStartBatch` 안 (stop-restart 분기 전):
```js
const normalized = normalizeStyleId(styleId)
if (normalized && styleId !== 'auto' && styleId !== 'none') {
  setSelectedStyleRefId?.(normalized)
}
```

(`normalizeStyleId`가 'preset:noir' → 'preset:noir' 등 명시 ID는 통과시키고, undefined/null은 falsy 반환한다고 가정. 안 그러면 따로 분기.)

- [ ] **Step 3: App.jsx prop 추가**

`setSelectedStyleRefId`를 useMcpServer props에 추가 (Task 5에서 이미 했을 수 있음 — idempotent).

- [ ] **Step 4: 회귀 + 커밋**

```bash
npm run test:run
git commit -m "feat(mcp): sync selectedStyleRefId on explicit styleId — UI button reflects MCP style"
```

---

## Task 7: 통합 시각 확인 + spec status

- [ ] **Step 1: 전체 회귀**

Run: `npm run test:run`
Expected: 1130+ PASS (Phase 1) + Phase 2 테스트들 추가

- [ ] **Step 2: dev에서 MCP 호출 시각 확인**

```bash
# 단건 ref 재생성 (이미 이미지 있는 ref)
curl -X POST http://localhost:3210/api/generate-reference \
  -H "Content-Type: application/json" \
  -d '{"index": 0, "styleId": "preset:noir"}'

# 단건 scene 재생성
curl -X POST http://localhost:3210/api/generate-scene \
  -H "Content-Type: application/json" \
  -d '{"sceneId": "scene_1", "styleId": "preset:cinematic"}'

# 모든 씬 강제 재생성 (완료 포함)
curl -X POST http://localhost:3210/api/start-scene-batch \
  -H "Content-Type: application/json" \
  -d '{"styleId": "preset:noir", "force": true}'

# 모든 ref 강제 재생성
curl -X POST http://localhost:3210/api/start-ref-batch \
  -H "Content-Type: application/json" \
  -d '{"styleId": "preset:cinematic", "force": true}'

# Phase 2: 실행 중에 위 batch 호출 — 자동 stop → restart, 버튼 라벨 새 스타일로 갱신 확인
```

각 호출 후 앱에서 generate progress 확인. 완료된 항목도 다시 generating → done으로 가야. 실행 중 호출 시: 자동 stop, 잠시 후 restart, "✨ Start ▸ 🎨 새스타일" → "⏹️ Stop ▸ 🎨 새스타일" 라벨 확인.

- [ ] **Step 3: plan archive (CLAUDE.md 룰)**

```bash
git mv docs/superpowers/plans/2026-05-13-mcp-regenerate-with-style.md docs/plans-archive/
git mv docs/superpowers/specs/2026-05-13-mcp-regenerate-with-style-design.md docs/plans-archive/  # spec도 함께
git commit -m "docs: archive mcp-regenerate-with-style plan + spec (completed)"
```

---

## 최종 체크리스트

- [ ] 7개 Task 완료 (Phase 1: Task 1-4, Phase 2: Task 5-6, Verify: Task 7)
- [ ] `npm run test:run` 1130+ PASS
- [ ] `app_generate_reference(index, styleId)` 이미지 있어도 재생성 — 동작 + 문서
- [ ] `app_generate_scene(sceneId, styleId)` 신규 styleId 파라미터
- [ ] `app_start_scene_batch(styleId, force)` 신규 force
- [ ] `app_start_ref_batch(styleId, force)` 신규 force
- [ ] **Phase 2:** 진행 중 MCP batch 호출 시 자동 stop → restart (no modal)
- [ ] **Phase 2:** 명시 styleId면 UI selectedStyleRefId 동기화 → Start 버튼 라벨 자동 갱신
- [ ] HTTP API/OpenAPI/README 동기화
- [ ] 백워드 호환성: 기존 호출자 변경 없이 동작
- [ ] CLAUDE.md 룰 — 완료 후 archive

## Out of scope (defer)

- UI에서 "강제 재생성" 버튼 — 이번 PR은 MCP 전용
- `force`와 `sceneIds` 배열 (선택 재생성) — 향후
- 'none' sentinel + force 조합 — 자연 동작 (force=true + styleId='none' = 모든 대상에 무스타일 강제 재생성)
- Stop 버튼 동적 라벨 ("Stop & Restart with B" 같은) — Start 버튼 라벨 갱신으로 충분
- confirm 모달 — 사용자 의도 명확하므로 자동
