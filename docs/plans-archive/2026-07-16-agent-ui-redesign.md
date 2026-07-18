# 인앱 에이전트 UI 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax.

**Goal:** 진행 중인 세션의 다음 턴 모델을 바꿀 수 있고, 컨테이너 안에서 FAB·floating·slide 표시를 안전하게 전환하는 접근 가능한 인앱 에이전트 UI를 만든다.
**Architecture:** renderer는 App이 소유한 표시 상태와 저장된 패널 모드에서 `effectiveMode`를 파생하고, ChatPanel은 마운트를 유지한 채 모델 선택·대화·bridge 상태를 보존한다. 모델은 submit 순간 `{text, model}`로 고정되어 preload→IPC→session manager→persistent Codex orchestrator로 전달되며, Codex app-server의 같은 thread에서 새 `turn/start`에만 per-turn model을 싣는다. 모델 카탈로그는 별도 단명 app-server 호출을 앱 수명 캐시로 감싸고 실패를 빈 배열로 격리한다.
**Tech Stack:** Electron + React, vitest, Codex app-server (0.142.5)

## Global Constraints

- TDD required (unit+integration): 각 기능은 테스트를 먼저 RED로 만들고 최소 구현으로 GREEN을 만든다.
- Tests mirror `src/` under `tests/`; `electron/`도 같은 상대 경로를 `tests/electron/` 아래에 mirror한다.
- Run full suite: `cd /Users/tuxxon/workspace/AutoFlowCut && npm run test:run`.
- Codex `0.142.5` pinned: `@openai/codex` 버전을 바꾸지 않는다.
- No new state machine: React state, 기존 session manager, 작은 순수 helper만 사용한다.
- B tool inventory unchanged: `agent:list-models`는 renderer IPC일 뿐 Tool Core 도구가 아니다.
- `aria-label` preserves existing button-name test queries: `Send`, `Steer`, `Stop`, `Close session`을 유지한다.
- Flow bounds와 `electron/ipc/layout.js`는 수정하지 않는다. `appMode === 'flow'`이면 저장값을 덮지 않고 effective mode만 `floating`으로 파생한다.
- dismiss는 CSS 표시만 숨긴다. ChatPanel을 unmount하거나 `agentSessionClose`·video cleanup을 호출하지 않는다.
- 모델 목록 실패·빈 응답은 선택값 없음으로 처리하고 Send를 막지 않는다. 모델 필드가 없으면 `thread/start`와 `turn/start`에서 필드를 생략한다.
- `turn/steer` payload에는 model을 추가하지 않는다. 모델 변경은 다음 새 `turn/start`부터만 적용한다.

---

## File Structure

### Production

- `electron/agent/codexOrchestrator.js` — 초기 model을 `thread/start`에, submit snapshot model을 새 `turn/start`에 싣는다.
- `electron/agent/sessionManager.js` — `open(model)`과 `send(text, model)`을 persistent orchestrator에 전달한다.
- `electron/ipc/agent-api.js` — open/send model payload를 보존하고, visible-model 캐시·1회 retry가 있는 `agent:list-models` handler를 등록한다.
- `electron/preload.js` — `agentListModels()`를 노출하고 기존 open/send payload 전달 surface를 유지한다.
- `src/components/agent/AgentModelSelector.jsx` — ARIA combobox/listbox/option, 키보드 탐색, outside-click, disabled Claude badge를 소유한다.
- `src/components/agent/AgentIconButton.jsx` — 아이콘 버튼과 document.body portal tooltip의 edge-aware 위치 계산을 소유한다.
- `src/components/agent/agentPanelLayout.js` — 저장 모드 정규화, Flow effective mode, 컨테이너 기준 drag clamp를 제공한다.
- `src/components/agent/ChatPanel.jsx` — 모델 로드·snapshot submit, FAB/dismiss, mode toggle, floating drag, icon action bar를 통합하되 session/bridge 수명은 유지한다.
- `src/components/agent/ChatPanel.css` — selector, FAB, floating/slide, 좁은 컨테이너 flex 축소, portal tooltip, icon action bar 스타일을 소유한다.
- `src/App.jsx` — `agentPanelOpen`을 소유하고 `mode`, 저장된 `agentPanelMode`, update callback을 ChatPanel에 주입한다.
- `src/hooks/useAppSettings.js` — `agentPanelMode: 'floating' | 'slide'` 기본값과 저장값 보존·invalid fallback을 소유한다.
- `src/locales/en.js` — 모델, FAB, dismiss, mode, Flow 안내, tooltip의 영어 문자열을 제공한다.
- `src/locales/ko.js` — 같은 키의 한국어 문자열을 제공한다.
- `src/assets/Robot.svg` — 원형 FAB 안에 표시할 코드 기반 Robot 자산이다.

### Tests

- `tests/electron/agent/agentModelWiring.integration.test.js` — preload→IPC→real session manager→real orchestrator→fake app-server runtime chain에서 thread/turn model을 검증한다.
- `tests/electron/ipc/agent-api.test.js` — model args, hidden filtering, retry, successful cache, failure `[]`, handler cleanup을 검증한다.
- `tests/electron/agent-preload.test.js` — `agentListModels`, model-bearing open/send payload의 invoke 효과를 검증한다.
- `tests/components/agent/AgentModelSelector.test.jsx` — combobox ARIA와 모든 키보드·포커스·disabled 동작을 검증한다.
- `tests/components/agent/AgentIconButton.test.jsx` — tooltip이 body portal에 렌더되고 viewport 가장자리에서 clamp되는지 검증한다.
- `tests/components/agent/agentPanelLayout.test.js` — effective mode 전환과 컨테이너 drag clamp를 순수 함수로 검증한다.
- `tests/components/agent/ChatPanel.test.jsx` — model snapshot, running Send/Steer, FAB dismiss 수명, mode/drag/layout, icon labels를 통합 검증한다.
- `tests/components/agent/ChatPanel.appMount.test.js` — App이 ChatPanel을 한 번만 mount하고 open/mode props를 주입하는 구조를 고정한다.
- `tests/components/agent/agentI18n.test.jsx` — ko/en key parity와 새 UI chrome에 raw key·한글 누출이 없는지 검증한다.
- `tests/hooks/useAppSettings.test.js` — `agentPanelMode` 기본값·저장값 보존·invalid fallback을 검증한다.
- `tests/components/agent/ApprovalDialog.stacking.test.js` — 기존 최상위 stacking 불변식이 새 panel/FAB/tooltip보다 여전히 높은지 회귀 검증한다.
- `tests/components/AppFlowSplitLayout.test.jsx` — 네 방향 split의 App 영역 계산을 새 panel geometry 검증에 재사용한다.

---

### Task 1: Codex per-turn model runtime wiring

**Files:**
- Modify: `electron/agent/codexOrchestrator.js:66` (`createCodexOrchestrator` model destructure), `:272` (`thread/start`), `:293` (`send`)
- Modify: `electron/agent/sessionManager.js:117` (`open`), `:159` (orchestrator creation), `:225` (`send`)
- Modify: `electron/ipc/agent-api.js:114` (`registerAgentIPC`), `:120` (command arg mapping)
- Test: Create `tests/electron/agent/agentModelWiring.integration.test.js:1`

**Interfaces:**
- Consumes: preload의 기존 `agentSessionOpen(params?: {model?: string}) => Promise<unknown>`, `agentSend(params: {text: string, model?: string}) => Promise<unknown>` passthrough
- Produces: `sessionManager.open(model?: string): Promise<{sessionId: string, threadId: string}>`; `sessionManager.send(text: string, model?: string): Promise<unknown>`; `codexOrchestrator.send(text: string, model?: string): Promise<unknown>`

- [ ] `tests/electron/agent/agentModelWiring.integration.test.js`를 다음 완전한 runtime-chain 테스트로 생성한다.

```js
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createAgentSessionManager } from '../../../electron/agent/sessionManager.js'
import { registerAgentIPC } from '../../../electron/ipc/agent-api.js'

const electronDouble = vi.hoisted(() => ({
  exposed: null,
  contextBridge: {
    exposeInMainWorld: vi.fn((_name, api) => { electronDouble.exposed = api }),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
  webUtils: { getPathForFile: vi.fn((file) => file?.path) },
}))

vi.mock('electron', () => ({
  contextBridge: electronDouble.contextBridge,
  ipcRenderer: electronDouble.ipcRenderer,
  webUtils: electronDouble.webUtils,
}))

function fakeIpcMain() {
  const handlers = new Map()
  return {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel) => handlers.delete(channel)),
    invoke(channel, payload) {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`missing handler: ${channel}`)
      return handler({}, payload)
    },
  }
}

function createHarness() {
  const sent = []
  const client = {
    request: vi.fn(async (method, params) => {
      sent.push({ method, params })
      if (method === 'initialize') return {}
      if (method === 'thread/start') return { thread: { id: 'thread-model-wire' } }
      if (method === 'turn/start') return { turn: { id: 'turn-model-wire', status: 'inProgress' } }
      throw new Error(`unexpected method: ${method}`)
    }),
    respond: vi.fn(),
  }
  const ipcMain = fakeIpcMain()
  const manager = createAgentSessionManager({
    grantLedger: { closeSession: vi.fn() },
    approvalPrompt: { ask: vi.fn(), closeSession: vi.fn() },
    toolBridge: { clearOperations: vi.fn() },
    storyCommands: { projectToken: 'project-model-wire' },
    createToolCoreImpl: vi.fn(() => ({ use: vi.fn(), list: vi.fn(() => []) })),
    createPrivateRpcImpl: vi.fn(() => ({
      start: vi.fn(async () => ({ host: '127.0.0.1', port: 43123, token: 'token' })),
      close: vi.fn(async () => {}),
    })),
    createElicitationResponderImpl: vi.fn(() => ({ handle: vi.fn(async () => ({ action: 'decline' })) })),
    orchestratorOptions: {
      adapterPath: '/fake/codex-adapter.mjs',
      existsSyncImpl: () => true,
      env: {},
      authCheck: async () => 'Logged in using ChatGPT',
      runtimeHomeFactory: async () => ({ env: {}, cleanup: vi.fn(async () => {}) }),
      workingDirectoryFactory: async () => ({ workingDirectory: '/tmp/work', cleanup: vi.fn(async () => {}) }),
      appServerFactory: () => ({ client, close: vi.fn(async () => {}) }),
    },
  })
  registerAgentIPC(ipcMain, {
    sessionManager: manager,
    getWindow: () => null,
  })
  electronDouble.ipcRenderer.invoke.mockImplementation((channel, payload) => ipcMain.invoke(channel, payload))
  return { manager, sent }
}

beforeAll(async () => {
  await import('../../../electron/preload.js?agent-model-wiring-runtime')
})

describe('agent model runtime wiring', () => {
  it('preload open/send model이 실제 thread/start와 turn/start에 도달한다', async () => {
    const { manager, sent } = createHarness()

    await electronDouble.exposed.agentSessionOpen({ model: 'gpt-thread' })
    await electronDouble.exposed.agentSend({ text: '다음 턴', model: 'gpt-turn' })

    expect(sent.find(({ method }) => method === 'thread/start')?.params.model).toBe('gpt-thread')
    expect(sent.find(({ method }) => method === 'turn/start')?.params).toMatchObject({
      threadId: 'thread-model-wire',
      model: 'gpt-turn',
      input: [{ type: 'text', text: '다음 턴' }],
    })
    await manager.close()
  })

  it('선택 모델이 없으면 thread/start와 turn/start에서 model 필드를 생략한다', async () => {
    const { manager, sent } = createHarness()

    await electronDouble.exposed.agentSessionOpen()
    await electronDouble.exposed.agentSend({ text: '기본 모델' })

    expect(sent.find(({ method }) => method === 'thread/start')?.params).not.toHaveProperty('model')
    expect(sent.find(({ method }) => method === 'turn/start')?.params).not.toHaveProperty('model')
    await manager.close()
  })
})
```

- [ ] 새 runtime-chain 테스트를 실행해 model이 아직 유실되는 RED를 확인한다.

Run: `npx vitest run tests/electron/agent/agentModelWiring.integration.test.js`

Expected: FAIL — 첫 테스트의 `thread/start.params.model` 또는 `turn/start.params.model`이 `undefined`다.

- [ ] 세 production 파일에 다음 정확한 변경을 적용한다.

```diff
diff --git a/electron/agent/codexOrchestrator.js b/electron/agent/codexOrchestrator.js
@@
-  model,
+  model: initialModel,
@@
       const started = await session.client.request('thread/start', buildOrchestratorThreadParams({
-        model,
+        model: initialModel,
         workingDirectory: work.workingDirectory,
         config: clientOptions.config,
       }))
@@
-  async function send(text) {
+  async function send(text, model) {
     await open()
     if (turnStartPending) {
       throw new Error('Codex orchestrator turn start is already in flight; use steer instead')
@@
       const result = await session.client.request('turn/start', {
         threadId,
+        ...(model ? { model } : {}),
         input: [{ type: 'text', text }],
       })
diff --git a/electron/agent/sessionManager.js b/electron/agent/sessionManager.js
@@
-  async function open() {
+  async function open(model) {
@@
     const orchestrator = createCodexOrchestratorImpl({
       ...orchestratorOptions,
+      ...(model ? { model } : {}),
       elicitationResponder,
@@
-  function send(text) {
+  function send(text, model) {
     return withOpenSession((session) => {
       const refusal = admitTurn(session)
-      return refusal || session.orchestrator.send(text)
+      if (refusal) return refusal
+      return model ? session.orchestrator.send(text, model) : session.orchestrator.send(text)
     })
   }
diff --git a/electron/ipc/agent-api.js b/electron/ipc/agent-api.js
@@
   const emit = createEmitter(getWindow)
   const registrations = [
-    ['agent:session-open', 'open', () => []],
-    ['agent:send', 'send', (payload) => [payload?.text]],
+    ['agent:session-open', 'open', (payload) => (payload?.model ? [payload.model] : [])],
+    ['agent:send', 'send', (payload) => (payload?.model
+      ? [payload?.text, payload.model]
+      : [payload?.text])],
     ['agent:steer', 'steer', (payload) => [payload?.text]],
```

- [ ] runtime-chain 테스트를 다시 실행해 두 경우가 모두 GREEN인지 확인한다.

Run: `npx vitest run tests/electron/agent/agentModelWiring.integration.test.js`

Expected: PASS — `2 passed`; model 지정/생략 wire payload가 모두 일치한다.

- [ ] Task 1 변경만 커밋한다.

```bash
git add electron/agent/codexOrchestrator.js electron/agent/sessionManager.js electron/ipc/agent-api.js tests/electron/agent/agentModelWiring.integration.test.js
git commit -m "feat(agent): wire per-turn Codex model"
```

### Task 2: `agent:list-models` catalog IPC and preload surface

**Files:**
- Modify: `electron/ipc/agent-api.js:8` (import), `:109` (catalog factory), `:114` (handler registration/cleanup)
- Modify: `electron/preload.js:160` (agent surface)
- Test: Modify `tests/electron/ipc/agent-api.test.js:36` (double), append catalog cases after `:106`
- Test: Modify `tests/electron/agent-preload.test.js:37` (surface invoke test)

**Interfaces:**
- Consumes: `listCodexModels(deps?): Promise<Array<{id: string, displayName?: string, hidden?: boolean}>>` from `electron/api/llm/codexAppServer.js:109`
- Produces: `createAgentModelCatalog({listModels?}): {list(): Promise<CodexModel[]>}`; IPC `agent:list-models`; preload `agentListModels(): Promise<CodexModel[]>`

- [ ] `tests/electron/ipc/agent-api.test.js`의 double과 session-command describe 뒤에 다음 테스트를 추가한다.

```js
function fullModelCatalogDouble() {
  return {
    list: vi.fn(async () => [{ id: 'gpt-visible', displayName: 'GPT Visible', hidden: false }]),
  }
}

describe('agent:list-models catalog', () => {
  it('첫 실패를 한 번 재시도하고 hidden을 제외한 성공 결과를 앱 수명 동안 캐시한다', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listModels = vi.fn()
      .mockRejectedValueOnce(new Error('auth not ready'))
      .mockResolvedValueOnce([
        { id: 'gpt-hidden', displayName: 'Hidden', hidden: true },
        { id: 'gpt-visible', displayName: 'Visible', hidden: false },
      ])
    const catalog = createAgentModelCatalog({ listModels })

    await expect(catalog.list()).resolves.toEqual([
      { id: 'gpt-visible', displayName: 'Visible', hidden: false },
    ])
    await expect(catalog.list()).resolves.toEqual([
      { id: 'gpt-visible', displayName: 'Visible', hidden: false },
    ])
    expect(listModels).toHaveBeenCalledTimes(2)
  })

  it('두 시도 모두 실패하거나 visible 결과가 없으면 []를 반환하고 실패를 캐시하지 않는다', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listModels = vi.fn()
      .mockResolvedValueOnce([{ id: 'hidden-a', hidden: true }])
      .mockRejectedValueOnce(new Error('spawn failed'))
      .mockResolvedValueOnce([{ id: 'visible-b', displayName: 'Visible B' }])
    const catalog = createAgentModelCatalog({ listModels })

    await expect(catalog.list()).resolves.toEqual([])
    await expect(catalog.list()).resolves.toEqual([{ id: 'visible-b', displayName: 'Visible B' }])
    expect(listModels).toHaveBeenCalledTimes(3)
  })

  it('agent:list-models handler가 catalog 값을 그대로 renderer에 돌려준다', async () => {
    const { registerAgentIPC } = await loadSubject()
    const ipcMain = fakeIpcMain()
    const win = fakeWindow()
    const sessionManager = fullSessionManagerDouble()
    const modelCatalog = fullModelCatalogDouble()
    registerAgentIPC(ipcMain, { sessionManager, modelCatalog, getWindow: () => win })

    await expect(ipcMain.invoke('agent:list-models')).resolves.toEqual([
      { id: 'gpt-visible', displayName: 'GPT Visible', hidden: false },
    ])
    expect(modelCatalog.list).toHaveBeenCalledOnce()
  })
})
```

- [ ] catalog 테스트를 실행해 export/handler 부재 RED를 확인한다.

Run: `npx vitest run tests/electron/ipc/agent-api.test.js`

Expected: FAIL — `createAgentModelCatalog is not a function` 또는 `missing handler: agent:list-models`.

- [ ] `tests/electron/agent-preload.test.js`의 첫 테스트를 다음 완전한 테스트로 교체한다.

```js
it('session command와 model catalog가 각각 전용 agent IPC를 invoke한다', async () => {
  const api = electronDouble.exposed

  await api.agentSessionOpen({ model: 'gpt-thread' })
  await api.agentSend({ text: '계속', model: 'gpt-turn' })
  await api.agentSteer({ text: '영상은 빼' })
  await api.agentAbort()
  await api.agentSessionClose()
  await api.agentListModels()

  expect(electronDouble.ipcRenderer.invoke.mock.calls).toEqual([
    ['agent:session-open', { model: 'gpt-thread' }],
    ['agent:send', { text: '계속', model: 'gpt-turn' }],
    ['agent:steer', { text: '영상은 빼' }],
    ['agent:abort', undefined],
    ['agent:session-close', undefined],
    ['agent:list-models'],
  ])
})
```

- [ ] preload 테스트를 실행해 `agentListModels` 부재 RED를 확인한다.

Run: `npx vitest run tests/electron/agent-preload.test.js`

Expected: FAIL — `api.agentListModels is not a function`.

- [ ] `electron/ipc/agent-api.js`에 다음 catalog factory와 handler 배선을 구현한다.

```diff
diff --git a/electron/ipc/agent-api.js b/electron/ipc/agent-api.js
@@
+import { listCodexModels } from '../api/llm/codexAppServer.js'
+
+export function createAgentModelCatalog({ listModels = listCodexModels } = {}) {
+  let cached = null
+  let inFlight = null
+
+  const visibleModels = async () => {
+    try {
+      const models = await listModels()
+      if (!Array.isArray(models)) return []
+      return models.filter((model) => model && typeof model.id === 'string' && model.hidden !== true)
+    } catch {
+      return []
+    }
+  }
+
+  return {
+    list() {
+      if (cached) return Promise.resolve(cached.map((model) => ({ ...model })))
+      if (inFlight) return inFlight
+      inFlight = (async () => {
+        const first = await visibleModels()
+        const models = first.length > 0 ? first : await visibleModels()
+        if (models.length > 0) cached = models.map((model) => ({ ...model }))
+        return models.map((model) => ({ ...model }))
+      })().finally(() => { inFlight = null })
+      return inFlight
+    },
+  }
+}
+
+const defaultModelCatalog = createAgentModelCatalog()
@@
-export function registerAgentIPC(ipcMain, { sessionManager, getWindow } = {}) {
+export function registerAgentIPC(ipcMain, {
+  sessionManager,
+  modelCatalog = defaultModelCatalog,
+  getWindow,
+} = {}) {
@@
   if (!sessionManager) throw new TypeError('sessionManager is required')
+  if (typeof modelCatalog?.list !== 'function') throw new TypeError('modelCatalog.list is required')
   if (typeof getWindow !== 'function') throw new TypeError('getWindow must be a function')
@@
   const registrations = [
@@
   ]
+  const channels = registrations.map(([channel]) => channel)
+  channels.push('agent:list-models')
+
+  ipcMain.handle('agent:list-models', async () => modelCatalog.list())
@@
-    for (const [channel] of registrations) ipcMain.removeHandler(channel)
+    for (const channel of channels) ipcMain.removeHandler(channel)
   }
 }
```

- [ ] `electron/preload.js` agent surface에 다음 한 줄을 추가한다.

```diff
diff --git a/electron/preload.js b/electron/preload.js
@@
   agentSessionClose: (params) => ipcRenderer.invoke('agent:session-close', params),
+  agentListModels: () => ipcRenderer.invoke('agent:list-models'),
   onAgentEvent: (channel, cb) => {
```

- [ ] catalog IPC 테스트를 다시 실행해 retry/filter/cache/fallback이 GREEN인지 확인한다.

Run: `npx vitest run tests/electron/ipc/agent-api.test.js`

Expected: PASS — 기존 event 테스트와 새 catalog 테스트가 모두 통과한다.

- [ ] preload surface 테스트를 다시 실행해 여섯 invoke가 GREEN인지 확인한다.

Run: `npx vitest run tests/electron/agent-preload.test.js`

Expected: PASS — `agent:list-models`가 payload 없이 정확히 한 번 invoke된다.

- [ ] Task 2 변경만 커밋한다.

```bash
git add electron/ipc/agent-api.js electron/preload.js tests/electron/ipc/agent-api.test.js tests/electron/agent-preload.test.js
git commit -m "feat(agent): expose cached Codex model catalog"
```

### Task 3: Accessible custom agent model selector

**Files:**
- Create: `src/components/agent/AgentModelSelector.jsx:1`
- Modify: `src/components/agent/ChatPanel.css:52` (selector-only styles; integration은 Task 5)
- Test: Create `tests/components/agent/AgentModelSelector.test.jsx:1`

**Interfaces:**
- Consumes: `models: Array<{id: string, displayName?: string, hidden?: boolean}>`, `value: string | null`, localized label props
- Produces: `AgentModelSelector({id?: string, models, value, loading, onChange, label, defaultLabel, codexLabel, claudeLabel, comingSoonLabel})`; `onChange(model: string | null): void`

- [ ] `tests/components/agent/AgentModelSelector.test.jsx`를 다음 완전한 component test로 생성한다.

```jsx
// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentModelSelector from '../../../src/components/agent/AgentModelSelector.jsx'

const models = [
  { id: 'gpt-a', displayName: 'GPT A', hidden: false },
  { id: 'gpt-b', displayName: 'GPT B', hidden: false },
]

function renderSelector(props = {}) {
  const onChange = vi.fn()
  const result = render(
    <div>
      <AgentModelSelector
        models={models}
        value={null}
        loading={false}
        onChange={onChange}
        label="Agent model"
        defaultLabel="Default"
        codexLabel="Codex"
        claudeLabel="Claude"
        comingSoonLabel="Coming soon"
        {...props}
      />
      <button type="button">Outside</button>
    </div>,
  )
  return { ...result, onChange }
}

afterEach(cleanup)

describe('AgentModelSelector', () => {
  it('combobox/listbox/option ARIA와 Claude disabled badge를 완전하게 노출한다', async () => {
    const user = userEvent.setup()
    renderSelector()
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(combo).toHaveAttribute('aria-controls', 'agent-model-listbox')
    await user.click(combo)

    const listbox = screen.getByRole('listbox', { name: 'Agent model' })
    const defaultOption = screen.getByRole('option', { name: 'Default' })
    const claude = screen.getByRole('option', { name: /Claude.*Coming soon/ })
    expect(combo).toHaveAttribute('aria-expanded', 'true')
    expect(listbox.id).toBe('agent-model-listbox')
    expect(defaultOption).toHaveAttribute('aria-selected', 'true')
    expect(claude).toHaveAttribute('aria-disabled', 'true')
    expect(claude).toHaveTextContent('Coming soon')
    expect(combo).toHaveAttribute('aria-activedescendant', defaultOption.id)
  })

  it('Arrow/Enter로 이동·선택하고 disabled Claude를 건너뛴다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector({ value: 'gpt-b' })
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    combo.focus()
    await user.keyboard('{ArrowDown}')
    expect(combo).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'GPT B' }).id)
    await user.keyboard('{ArrowDown}')
    expect(combo).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Default' }).id)
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('gpt-a')
    expect(combo).toHaveFocus()
    expect(combo).toHaveAttribute('aria-expanded', 'false')
  })

  it('Escape는 선택을 바꾸지 않고 닫은 뒤 combobox로 focus를 돌린다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector()
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    await user.click(combo)
    await user.keyboard('{ArrowDown}{Escape}')

    expect(onChange).not.toHaveBeenCalled()
    expect(combo).toHaveFocus()
    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(combo).not.toHaveAttribute('aria-activedescendant')
  })

  it('option click은 값을 반영하고 outside pointerdown은 listbox를 닫는다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector()
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    await user.click(combo)
    await user.click(screen.getByRole('option', { name: 'GPT A' }))
    expect(onChange).toHaveBeenCalledWith('gpt-a')
    expect(combo).toHaveFocus()

    await user.click(combo)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox', { name: 'Agent model' })).toBeNull()
  })

  it('loading/빈 목록도 Default 선택과 disabled Claude를 제공한다', async () => {
    const user = userEvent.setup()
    renderSelector({ models: [], loading: true })
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    expect(combo).toHaveTextContent('Default')
    await user.click(combo)
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('option', { name: /Claude.*Coming soon/ })).toHaveAttribute('aria-disabled', 'true')
  })
})
```

- [ ] selector 테스트를 실행해 component 부재 RED를 확인한다.

Run: `npx vitest run tests/components/agent/AgentModelSelector.test.jsx`

Expected: FAIL — `Failed to resolve import "../../../src/components/agent/AgentModelSelector.jsx"`.

- [ ] `src/components/agent/AgentModelSelector.jsx`를 다음 완전한 코드로 생성한다.

```jsx
import { useEffect, useMemo, useRef, useState } from 'react'

const DEFAULT_OPTION = Object.freeze({ id: 'default', value: null, labelKey: 'default' })
const CLAUDE_OPTION = Object.freeze({ id: 'claude-coming-soon', value: 'claude', disabled: true })

function optionId(listboxId, option) {
  return `${listboxId}-option-${option.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function nextEnabled(options, start, step) {
  for (let distance = 1; distance <= options.length; distance += 1) {
    const index = (start + (distance * step) + options.length) % options.length
    if (!options[index].disabled) return index
  }
  return start
}

export default function AgentModelSelector({
  id = 'agent-model',
  models = [],
  value = null,
  loading = false,
  onChange,
  label,
  defaultLabel,
  codexLabel,
  claudeLabel,
  comingSoonLabel,
}) {
  const listboxId = `${id}-listbox`
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const options = useMemo(() => [
    { ...DEFAULT_OPTION, label: defaultLabel },
    ...models
      .filter((model) => model && typeof model.id === 'string' && model.hidden !== true)
      .map((model) => ({ id: model.id, value: model.id, label: model.displayName || model.id })),
    { ...CLAUDE_OPTION, label: claudeLabel },
  ], [claudeLabel, defaultLabel, models])

  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selected = options[selectedIndex]
  const active = options[activeIndex] || options[selectedIndex]

  useEffect(() => {
    if (!open) return undefined
    setActiveIndex(selectedIndex)
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, selectedIndex])

  const closeAndFocus = () => {
    setOpen(false)
    queueMicrotask(() => triggerRef.current?.focus())
  }

  const selectIndex = (index) => {
    const option = options[index]
    if (!option || option.disabled) return
    onChange?.(option.value)
    closeAndFocus()
  }

  const move = (step) => {
    setActiveIndex((current) => nextEnabled(options, current, step))
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setActiveIndex(selectedIndex)
        setOpen(true)
      } else {
        move(event.key === 'ArrowDown' ? 1 : -1)
      }
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) selectIndex(activeIndex)
      else setOpen(true)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      closeAndFocus()
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  return (
    <div className="agent-model-selector" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="agent-model-combobox"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && active ? optionId(listboxId, active) : undefined}
        aria-haspopup="listbox"
        data-loading={loading ? 'true' : 'false'}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label || defaultLabel}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="agent-model-listbox" id={listboxId} role="listbox" aria-label={label}>
          <div className="agent-model-provider" role="presentation">{codexLabel}</div>
          {options.slice(0, -1).map((option, index) => (
            <div
              key={option.id}
              id={optionId(listboxId, option)}
              className={`agent-model-option ${activeIndex === index ? 'is-active' : ''}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled="false"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectIndex(index)}
            >
              {option.label}
            </div>
          ))}
          <div className="agent-model-provider" role="presentation">{claudeLabel}</div>
          <div
            id={optionId(listboxId, CLAUDE_OPTION)}
            className="agent-model-option is-disabled"
            role="option"
            aria-selected="false"
            aria-disabled="true"
          >
            <span>{claudeLabel}</span>
            <span className="agent-model-badge">{comingSoonLabel}</span>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] `src/components/agent/ChatPanel.css` 끝에 다음 selector 스타일을 추가한다.

```css
.agent-model-selector { position: relative; min-width: 132px; }
.agent-model-combobox {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; min-height: 28px; padding: 4px 8px;
  color: inherit; background: var(--code-bg, #131316);
  border: 1px solid var(--border, #3a3a42); border-radius: 7px; cursor: pointer;
}
.agent-model-listbox {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 3;
  width: max(100%, 220px); max-height: 240px; overflow-y: auto;
  padding: 5px; color: var(--text, #eee); background: var(--panel-bg, #1e1e22);
  border: 1px solid var(--border, #3a3a42); border-radius: 8px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
}
.agent-model-provider { padding: 5px 7px 3px; font-size: 10px; font-weight: 700; opacity: 0.58; text-transform: uppercase; }
.agent-model-option { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px; border-radius: 6px; cursor: pointer; }
.agent-model-option.is-active { background: rgba(76, 141, 255, 0.2); outline: 1px solid rgba(76, 141, 255, 0.55); }
.agent-model-option.is-disabled { cursor: not-allowed; opacity: 0.48; }
.agent-model-badge { padding: 2px 5px; border: 1px solid currentColor; border-radius: 999px; font-size: 9px; }
```

- [ ] selector 테스트를 다시 실행해 다섯 접근성 시나리오가 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/AgentModelSelector.test.jsx`

Expected: PASS — `5 passed`; `aria-activedescendant`, disabled-skip, focus return, outside-click가 모두 통과한다.

- [ ] Task 3 변경만 커밋한다.

```bash
git add src/components/agent/AgentModelSelector.jsx src/components/agent/ChatPanel.css tests/components/agent/AgentModelSelector.test.jsx
git commit -m "feat(agent): add accessible model combobox"
```

### Task 4: Locale contract for the redesigned agent chrome

**Files:**
- Modify: `src/locales/en.js:1601` (`agent` object)
- Modify: `src/locales/ko.js:1600` (`agent` object)
- Test: Modify `tests/components/agent/agentI18n.test.jsx:13` (locale imports), append after `:150`

**Interfaces:**
- Consumes: `useSafeT(key)` / `useI18n().t(key)` existing translation contract
- Produces: `agent.openPanel`, `dismissPanel`, `modelLabel`, `modelDefault`, `codexProvider`, `claudeProvider`, `comingSoon`, `slideMode`, `floatingMode`, `modeToggle`, `switchToSlide`, `switchToFloating`, `flowFloatingOnly`, `sendTooltip`, `steerTooltip`, `stopTooltip`, `closeSessionTooltip`

- [ ] `tests/components/agent/agentI18n.test.jsx`에 locale imports와 다음 parity test를 추가한다.

```diff
diff --git a/tests/components/agent/agentI18n.test.jsx b/tests/components/agent/agentI18n.test.jsx
@@
 import ApprovalDialog from '../../../src/components/agent/ApprovalDialog.jsx'
+import en from '../../../src/locales/en.js'
+import ko from '../../../src/locales/ko.js'
@@
+const REDESIGN_KEYS = [
+  'openPanel', 'dismissPanel', 'modelLabel', 'modelDefault', 'codexProvider',
+  'claudeProvider', 'comingSoon', 'slideMode', 'floatingMode', 'modeToggle',
+  'switchToSlide', 'switchToFloating', 'flowFloatingOnly', 'sendTooltip',
+  'steerTooltip', 'stopTooltip', 'closeSessionTooltip',
+]
+
+describe('에이전트 UI 재설계 locale 계약', () => {
+  it('ko/en에 같은 새 키가 있고 빈 문자열이나 raw key가 없다', () => {
+    for (const key of REDESIGN_KEYS) {
+      expect(en.agent[key], `en.agent.${key}`).toBeTypeOf('string')
+      expect(ko.agent[key], `ko.agent.${key}`).toBeTypeOf('string')
+      expect(en.agent[key].trim()).not.toBe('')
+      expect(ko.agent[key].trim()).not.toBe('')
+      expect(en.agent[key]).not.toBe(`agent.${key}`)
+      expect(ko.agent[key]).not.toBe(`agent.${key}`)
+    }
+  })
+})
```

- [ ] locale test를 실행해 새 키 부재 RED를 확인한다.

Run: `npx vitest run tests/components/agent/agentI18n.test.jsx`

Expected: FAIL — 첫 누락 키 `en.agent.openPanel`이 string이 아니다.

- [ ] `src/locales/en.js`의 `agent` object에 다음 문자열을 `panelLabel` 바로 뒤에 추가한다.

```js
openPanel: 'Open agent',
dismissPanel: 'Dismiss agent',
modelLabel: 'Agent model',
modelDefault: 'Default',
codexProvider: 'Codex',
claudeProvider: 'Claude',
comingSoon: 'Coming soon',
slideMode: 'Slide',
floatingMode: 'Floating',
modeToggle: 'Slide panel mode',
switchToSlide: 'Switch to slide panel',
switchToFloating: 'Switch to floating panel',
flowFloatingOnly: 'The agent stays floating while Flow is active.',
sendTooltip: 'Send a new turn',
steerTooltip: 'Add guidance to the active turn',
stopTooltip: 'Stop the active turn',
closeSessionTooltip: 'Close the agent session',
```

- [ ] `src/locales/ko.js`의 `agent` object에 다음 문자열을 `panelLabel` 바로 뒤에 추가한다.

```js
openPanel: '에이전트 열기',
dismissPanel: '에이전트 숨기기',
modelLabel: '에이전트 모델',
modelDefault: '기본',
codexProvider: 'Codex',
claudeProvider: 'Claude',
comingSoon: '구현 예정',
slideMode: '슬라이드',
floatingMode: '플로팅',
modeToggle: '슬라이드 패널 모드',
switchToSlide: '슬라이드 패널로 전환',
switchToFloating: '플로팅 패널로 전환',
flowFloatingOnly: 'Flow 사용 중에는 에이전트가 플로팅으로 표시됩니다.',
sendTooltip: '새 턴 보내기',
steerTooltip: '진행 중인 턴에 지시 추가',
stopTooltip: '진행 중인 턴 중지',
closeSessionTooltip: '에이전트 세션 종료',
```

- [ ] 같은 `ko.agent` object의 기존 close label을 종료 의미로 정확히 맞춘다.

```diff
diff --git a/src/locales/ko.js b/src/locales/ko.js
@@
-    closeSession: '세션 닫기',
+    closeSession: '세션 종료',
```

- [ ] locale test를 다시 실행해 ko/en parity가 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/agentI18n.test.jsx`

Expected: PASS — 기존 영어/한국어 UI 테스트와 새 17-key parity 테스트가 통과한다.

- [ ] Task 4 변경만 커밋한다.

```bash
git add src/locales/en.js src/locales/ko.js tests/components/agent/agentI18n.test.jsx
git commit -m "feat(agent): localize redesigned panel controls"
```

### Task 5: ChatPanel model loading, submit snapshot, and running controls

**Files:**
- Modify: `src/components/agent/ChatPanel.jsx:1` (selector import), `:124` (state), `:304` (`ensureSession`), `:334` (`send`), `:401` (header), `:466` (Send disabled)
- Modify: `src/components/agent/ChatPanel.css:19` (header title layout)
- Test: Modify `tests/components/agent/ChatPanel.test.jsx:9` (full API double), append after `:111`

**Interfaces:**
- Consumes: `window.electronAPI.agentListModels(): Promise<CodexModel[]>`; Task 3 `AgentModelSelector`; Task 1 preload open/send model contracts
- Produces: submit snapshot `{text: string, model?: string}`; `ensureSession(model?: string): Promise<boolean>`; selected model state used by Task 7/8 without owning panel visibility

- [ ] `createFullAgentApi()`에 `agentListModels`를 추가하고 다음 model-contract tests를 `ChatPanel.test.jsx`에 추가한다.

```diff
diff --git a/tests/components/agent/ChatPanel.test.jsx b/tests/components/agent/ChatPanel.test.jsx
@@
     agentSessionClose: vi.fn(async () => ({ sessionId: 'session-1' })),
+    agentListModels: vi.fn(async () => [
+      { id: 'gpt-a', displayName: 'GPT A', hidden: false },
+      { id: 'gpt-b', displayName: 'GPT B', hidden: false },
+    ]),
@@
+describe('ChatPanel — model 적용 시점 계약', () => {
+  it('session open 전 모델을 로드하고 선택값을 초기 thread와 새 turn에 함께 보낸다', async () => {
+    const user = userEvent.setup()
+    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
+
+    await waitFor(() => expect(window.electronAPI.agentListModels).toHaveBeenCalledOnce())
+    expect(window.electronAPI.agentSessionOpen).not.toHaveBeenCalled()
+    await user.click(screen.getByRole('combobox', { name: 'Agent model' }))
+    await user.click(screen.getByRole('option', { name: 'GPT A' }))
+    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), '첫 요청')
+    await user.click(screen.getByRole('button', { name: 'Send' }))
+
+    expect(window.electronAPI.agentSessionOpen).toHaveBeenCalledWith({ model: 'gpt-a' })
+    expect(window.electronAPI.agentSend).toHaveBeenCalledWith({ text: '첫 요청', model: 'gpt-a' })
+  })
+
+  it('ensureSession await 중 selector가 바뀌어도 submit 순간 model을 쓰고 다음 turn부터 새 model을 쓴다', async () => {
+    let resolveOpen
+    window.electronAPI.agentSessionOpen.mockReturnValueOnce(new Promise((resolve) => { resolveOpen = resolve }))
+    const user = userEvent.setup()
+    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
+    await waitFor(() => expect(window.electronAPI.agentListModels).toHaveBeenCalledOnce())
+
+    await user.click(screen.getByRole('combobox', { name: 'Agent model' }))
+    await user.click(screen.getByRole('option', { name: 'GPT A' }))
+    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), 'A snapshot')
+    await user.click(screen.getByRole('button', { name: 'Send' }))
+    await waitFor(() => expect(window.electronAPI.agentSessionOpen).toHaveBeenCalledWith({ model: 'gpt-a' }))
+
+    await user.click(screen.getByRole('combobox', { name: 'Agent model' }))
+    await user.click(screen.getByRole('option', { name: 'GPT B' }))
+    await act(async () => resolveOpen({ sessionId: 'session-1' }))
+    await waitFor(() => expect(window.electronAPI.agentSend)
+      .toHaveBeenNthCalledWith(1, { text: 'A snapshot', model: 'gpt-a' }))
+
+    window.electronAPI.emitAgent('agent:done', { turnId: 'turn-1', status: 'completed' })
+    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), 'B next turn')
+    await user.click(screen.getByRole('button', { name: 'Send' }))
+    expect(window.electronAPI.agentSend)
+      .toHaveBeenNthCalledWith(2, { text: 'B next turn', model: 'gpt-b' })
+  })
+
+  it('running 중 Send는 disabled지만 Steer는 입력이 있으면 유지되고 model을 싣지 않는다', async () => {
+    const user = userEvent.setup()
+    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
+    const input = screen.getByRole('textbox', { name: 'Message to the agent' })
+
+    await user.type(input, '새 turn')
+    await user.click(screen.getByRole('button', { name: 'Send' }))
+    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
+
+    await user.click(screen.getByRole('combobox', { name: 'Agent model' }))
+    await user.click(screen.getByRole('option', { name: 'GPT B' }))
+    await user.type(input, '진행 방향 수정')
+    const steer = screen.getByRole('button', { name: 'Steer' })
+    expect(steer).toBeEnabled()
+    await user.click(steer)
+    expect(window.electronAPI.agentSteer).toHaveBeenCalledWith({ text: '진행 방향 수정' })
+  })
+
+  it('목록 실패 fallback []에서는 Default로 보내며 model을 생략하고 Send를 막지 않는다', async () => {
+    window.electronAPI.agentListModels.mockResolvedValueOnce([])
+    const user = userEvent.setup()
+    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
+
+    await waitFor(() => expect(window.electronAPI.agentListModels).toHaveBeenCalledOnce())
+    expect(screen.getByRole('combobox', { name: 'Agent model' })).toHaveTextContent('Default')
+    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), '기본으로 실행')
+    await user.click(screen.getByRole('button', { name: 'Send' }))
+
+    expect(window.electronAPI.agentSessionOpen).toHaveBeenCalledWith({})
+    expect(window.electronAPI.agentSend).toHaveBeenCalledWith({ text: '기본으로 실행' })
+  })
+})
```

- [ ] ChatPanel test를 실행해 `agentListModels`/combobox/snapshot 부재 RED를 확인한다.

Run: `npx vitest run tests/components/agent/ChatPanel.test.jsx`

Expected: FAIL — `Unable to find role="combobox" and name "Agent model"`.

- [ ] `ChatPanel.jsx`에 다음 정확한 model state/load/submit 변경을 적용한다.

```diff
diff --git a/src/components/agent/ChatPanel.jsx b/src/components/agent/ChatPanel.jsx
@@
 import en from '../../locales/en'
+import AgentModelSelector from './AgentModelSelector.jsx'
 import './ChatPanel.css'
@@
   const [running, setRunning] = useState(false)
+  const [models, setModels] = useState([])
+  const [modelsLoading, setModelsLoading] = useState(true)
+  const [selectedModel, setSelectedModel] = useState(null)
@@
+  useEffect(() => {
+    let cancelled = false
+    setModelsLoading(true)
+    Promise.resolve(api.agentListModels?.() ?? [])
+      .then((result) => {
+        if (!cancelled) setModels(Array.isArray(result) ? result : [])
+      })
+      .catch(() => {
+        if (!cancelled) setModels([])
+      })
+      .finally(() => {
+        if (!cancelled) setModelsLoading(false)
+      })
+    return () => { cancelled = true }
+  }, [api])
+
-  const ensureSession = useCallback(async () => {
+  const ensureSession = useCallback(async (model) => {
@@
-      trackedOpen = Promise.resolve(api.agentSessionOpen())
+      trackedOpen = Promise.resolve(api.agentSessionOpen(model ? { model } : {}))
@@
   const send = async (event) => {
     event.preventDefault()
-    const text = input.trim()
-    if (!text) return
+    const snapshot = { text: input.trim(), model: selectedModel || undefined }
+    if (!snapshot.text || running) return
     messageIdRef.current += 1
     setMessages((current) => [...current, {
-      id: `user-${messageIdRef.current}`, role: 'user', text, streaming: false,
+      id: `user-${messageIdRef.current}`, role: 'user', text: snapshot.text, streaming: false,
     }])
     setInput('')
-    if (!(await ensureSession())) return
     setRunning(true)
+    if (!(await ensureSession(snapshot.model))) {
+      setRunning(false)
+      return
+    }
     try {
-      const result = await api.agentSend({ text })
+      const payload = snapshot.model
+        ? { text: snapshot.text, model: snapshot.model }
+        : { text: snapshot.text }
+      const result = await api.agentSend(payload)
@@
       <div
         className={`agent-chat-header ${collapsed ? 'is-draggable' : ''}`}
         onPointerDown={onPointerDown}
       >
-        <strong>{t('agent.title')}</strong>
+        <div className="agent-chat-heading">
+          <strong>{t('agent.title')}</strong>
+          <AgentModelSelector
+            models={models}
+            value={selectedModel}
+            loading={modelsLoading}
+            onChange={setSelectedModel}
+            label={t('agent.modelLabel')}
+            defaultLabel={t('agent.modelDefault')}
+            codexLabel={t('agent.codexProvider')}
+            claudeLabel={t('agent.claudeProvider')}
+            comingSoonLabel={t('agent.comingSoon')}
+          />
+        </div>
@@
-              <button type="submit" disabled={!input.trim()}>{t('agent.send')}</button>
+              <button type="submit" disabled={running || !input.trim()}>{t('agent.send')}</button>
```

- [ ] `ChatPanel.css`에 header/selector flex 축소 규칙을 추가한다.

```css
.agent-chat-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
.agent-chat-heading strong { flex: 0 0 auto; }
.agent-chat-heading .agent-model-selector { flex: 1 1 160px; min-width: 112px; }
```

- [ ] ChatPanel test를 다시 실행해 snapshot과 running 계약이 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/ChatPanel.test.jsx`

Expected: PASS — 기존 session/bridge 테스트와 새 model 4개 테스트가 모두 통과한다.

- [ ] 영어 locale 누출 회귀 테스트의 API double에도 model catalog surface를 추가한다.

```diff
diff --git a/tests/components/agent/agentI18n.test.jsx b/tests/components/agent/agentI18n.test.jsx
@@
     agentSessionClose: vi.fn(async () => ({})),
+    agentListModels: vi.fn(async () => []),
     onAgentEvent: vi.fn((channel, cb) => { listeners.set(channel, cb); return () => listeners.delete(channel) }),
```

- [ ] 영어/한국어 UI 테스트를 실행해 새 selector chrome에 raw key가 없는지 확인한다.

Run: `npx vitest run tests/components/agent/agentI18n.test.jsx`

Expected: PASS — English DOM에 한글과 `agent.modelLabel` 같은 raw key가 없다.

- [ ] Task 5 변경만 커밋한다.

```bash
git add src/components/agent/ChatPanel.jsx src/components/agent/ChatPanel.css tests/components/agent/ChatPanel.test.jsx tests/components/agent/agentI18n.test.jsx
git commit -m "feat(agent): snapshot model at submit"
```

### Task 6: Persisted `agentPanelMode` setting

**Files:**
- Modify: `src/hooks/useAppSettings.js:12` (`createDefaults`), `:49` (`loadSettings` validation)
- Test: Modify `tests/hooks/useAppSettings.test.js:97` (new describe before videoConcurrency)

**Interfaces:**
- Consumes: existing `useAppSettings(): {settings, setSettings, updateSetting}` and `autoflowcut_settings` localStorage record
- Produces: `settings.agentPanelMode: 'floating' | 'slide'`; `updateSetting('agentPanelMode', mode)` used by App in Task 7

- [ ] `tests/hooks/useAppSettings.test.js`에 다음 setting contract tests를 추가한다.

```js
describe('useAppSettings — agentPanelMode', () => {
  it('fresh install 기본값은 floating', () => {
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentPanelMode).toBe('floating')
  })

  it('저장된 slide 선호를 그대로 보존한다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agentPanelMode: 'slide' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentPanelMode).toBe('slide')
  })

  it('알 수 없는 저장값만 floating으로 정규화한다', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agentPanelMode: 'drawer' }))
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.agentPanelMode).toBe('floating')
  })
})
```

- [ ] hook test를 실행해 기본값 부재 RED를 확인한다.

Run: `npx vitest run tests/hooks/useAppSettings.test.js`

Expected: FAIL — fresh install의 `settings.agentPanelMode`이 `undefined`다.

- [ ] `useAppSettings.js`에 다음 기본값과 validation을 추가한다.

```diff
diff --git a/src/hooks/useAppSettings.js b/src/hooks/useAppSettings.js
@@
     mcpHttpEnabled: false,
-    mcpHttpPort: 3210
+    mcpHttpPort: 3210,
+    agentPanelMode: 'floating',
@@
     const merged = { ...defaults, ...parsed }
+    if (!['floating', 'slide'].includes(merged.agentPanelMode)) {
+      merged.agentPanelMode = 'floating'
+    }
```

- [ ] hook test를 다시 실행해 default/preserve/fallback이 GREEN인지 확인한다.

Run: `npx vitest run tests/hooks/useAppSettings.test.js`

Expected: PASS — 기존 settings 테스트와 새 `agentPanelMode` 3개 테스트가 통과한다.

- [ ] Task 6 변경만 커밋한다.

```bash
git add src/hooks/useAppSettings.js tests/hooks/useAppSettings.test.js
git commit -m "feat(agent): persist panel display mode"
```

### Task 7: Robot FAB and dismiss-without-close lifecycle

**Files:**
- Create: `src/assets/Robot.svg:1`
- Modify: `src/components/agent/ChatPanel.jsx:10` (asset import), `:124` (visibility props), `:393` (FAB/aside), `:406` (dismiss button)
- Modify: `src/components/agent/ChatPanel.css:1` (container-relative FAB and hidden classes)
- Modify: `src/App.jsx:718` (`agentPanelOpen`), `:2687` (visibility props)
- Test: Modify `tests/components/agent/ChatPanel.test.jsx:343` (persistent lifecycle describe)
- Test: Modify `tests/components/agent/ChatPanel.appMount.test.js:8` (App ownership wiring)

**Interfaces:**
- Consumes: Task 4 `agent.openPanel`/`agent.dismissPanel`; `Robot.svg`; existing always-mounted ChatPanel bridge effects
- Produces: `ChatPanel({open?: boolean, onOpen?: () => void, onDismiss?: () => void})`; App-owned `agentPanelOpen: boolean` default `false`

- [ ] `ChatPanel.test.jsx` persistent describe에 다음 runtime regression test를 추가한다.

```jsx
it('dismiss/FAB 왕복은 같은 panel과 bridge를 유지하고 session close를 호출하지 않는다', async () => {
  const user = userEvent.setup()
  function VisibilityHarness() {
    const [open, setOpen] = React.useState(false)
    return (
      <ChatPanel
        open={open}
        onOpen={() => setOpen(true)}
        onDismiss={() => setOpen(false)}
        projectKey="same-project"
        batchStatusSources={batchSources()}
      />
    )
  }

  const { container } = render(<VisibilityHarness />)
  const panel = container.querySelector('.agent-chat-panel')
  expect(panel).toHaveClass('is-dismissed')
  expect(screen.getByRole('button', { name: 'Open agent' })).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Open agent' }))
  expect(panel).toHaveClass('is-open')
  window.electronAPI.emitAgent('agent:delta', { delta: '숨겨도 보존할 메시지' })
  await user.click(screen.getByRole('button', { name: 'Dismiss agent' }))

  expect(container.querySelector('.agent-chat-panel')).toBe(panel)
  expect(panel).toHaveClass('is-dismissed')
  expect(panel).toHaveTextContent('숨겨도 보존할 메시지')
  expect(window.electronAPI.agentSessionClose).not.toHaveBeenCalled()
  expect(window.electronAPI.onToolBridgeRequest).toHaveBeenCalledOnce()

  await window.electronAPI.requestToolBridge({
    requestId: 'hidden-bridge', name: 'batch.status', args: { type: 'scene' },
  })
  expect(window.electronAPI.respondToolBridge).toHaveBeenCalledWith({
    requestId: 'hidden-bridge',
    result: { type: 'scene', status: 'complete', done: 0, total: 0, error: 0 },
  })

  await user.click(screen.getByRole('button', { name: 'Open agent' }))
  expect(container.querySelector('.agent-chat-panel')).toBe(panel)
  expect(screen.getByText('숨겨도 보존할 메시지')).toBeTruthy()
})
```

- [ ] ChatPanel test를 실행해 FAB 부재 RED를 확인한다.

Run: `npx vitest run tests/components/agent/ChatPanel.test.jsx`

Expected: FAIL — `Unable to find role="button" and name "Open agent"`.

- [ ] `src/assets/Robot.svg`를 다음 완전한 자산으로 생성한다.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect x="13" y="17" width="38" height="34" rx="12" fill="#F7FAFF"/>
  <rect x="17" y="21" width="30" height="22" rx="8" fill="#172033"/>
  <circle cx="26" cy="32" r="4" fill="#79B4FF"/>
  <circle cx="38" cy="32" r="4" fill="#79B4FF"/>
  <path d="M25 40c2.2 1.8 4.5 2.7 7 2.7s4.8-.9 7-2.7" stroke="#79B4FF" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M32 17V10" stroke="#F7FAFF" stroke-width="4" stroke-linecap="round"/>
  <circle cx="32" cy="8" r="4" fill="#79B4FF"/>
  <path d="M13 29H8v12h5M51 29h5v12h-5" stroke="#F7FAFF" stroke-width="4" stroke-linejoin="round"/>
</svg>
```

- [ ] `ChatPanel.jsx`에 다음 visibility props, FAB, persistent aside class, dismiss button을 적용한다.

```diff
diff --git a/src/components/agent/ChatPanel.jsx b/src/components/agent/ChatPanel.jsx
@@
 import AgentModelSelector from './AgentModelSelector.jsx'
+import robotUrl from '../../assets/Robot.svg'
 import './ChatPanel.css'
@@
 export default function ChatPanel({
+  open = true,
+  onOpen = () => {},
+  onDismiss = () => {},
   projectKey = null,
@@
-  return (
-    <aside
+  return (
+    <>
+      <button
+        type="button"
+        className={`agent-chat-fab ${open ? 'is-hidden' : ''}`}
+        aria-label={t('agent.openPanel')}
+        aria-hidden={open}
+        tabIndex={open ? -1 : 0}
+        title={t('agent.openPanel')}
+        onClick={onOpen}
+      >
+        <img src={robotUrl} alt="" aria-hidden="true" />
+      </button>
+      <aside
       ref={panelRef}
-      className={`agent-chat-panel ${collapsed ? 'is-collapsed' : ''}`}
+      className={`agent-chat-panel ${open ? 'is-open' : 'is-dismissed'} ${collapsed ? 'is-collapsed' : ''}`}
       aria-label={t('agent.panelLabel')}
+      aria-hidden={!open}
@@
         <div className="agent-chat-header-actions">
           {running && <span className="agent-chat-running">{t('agent.running')}</span>}
+          <button
+            type="button"
+            className="agent-chat-dismiss"
+            aria-label={t('agent.dismissPanel')}
+            title={t('agent.dismissPanel')}
+            onClick={onDismiss}
+          >
+            <span aria-hidden="true">×</span>
+          </button>
@@
-    </aside>
+      </aside>
+    </>
   )
 }
```

- [ ] `ChatPanel.css`에서 panel을 App 컨테이너 기준 absolute로 바꾸고 FAB/숨김 규칙을 추가한다.

```diff
diff --git a/src/components/agent/ChatPanel.css b/src/components/agent/ChatPanel.css
@@
 .agent-chat-panel {
-  position: fixed;
+  position: absolute;
@@
 }
+
+.agent-chat-panel.is-dismissed {
+  visibility: hidden;
+  opacity: 0;
+  pointer-events: none;
+}
+.agent-chat-panel.is-open { visibility: visible; opacity: 1; }
+.agent-chat-fab {
+  position: absolute; right: 18px; bottom: 18px; z-index: 3200;
+  display: grid; place-items: center; width: 72px; height: 72px; padding: 12px;
+  border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 50%;
+  background: linear-gradient(145deg, #4c8dff, #7758db);
+  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.42); cursor: pointer;
+  transition: transform 0.16s ease, opacity 0.16s ease, visibility 0.16s ease;
+}
+.agent-chat-fab:hover { transform: translateY(-2px) scale(1.03); }
+.agent-chat-fab:focus-visible { outline: 3px solid #b9d5ff; outline-offset: 3px; }
+.agent-chat-fab.is-hidden { visibility: hidden; opacity: 0; pointer-events: none; }
+.agent-chat-fab img { display: block; width: 100%; height: 100%; }
```

- [ ] `App.jsx`에서 open state를 소유하고 ChatPanel에 주입한다.

```diff
diff --git a/src/App.jsx b/src/App.jsx
@@
   const [showImport, setShowImport] = useState(false)
+  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
@@
       <ChatPanel
+        open={agentPanelOpen}
+        onOpen={() => setAgentPanelOpen(true)}
+        onDismiss={() => setAgentPanelOpen(false)}
         projectKey={`${settings.saveMode}:${workFolder ?? ''}:${settings.projectName ?? ''}`}
```

- [ ] `ChatPanel.appMount.test.js`의 첫 테스트 끝에 App-owned visibility wiring assertions를 추가한다.

```js
expect(source).toContain('const [agentPanelOpen, setAgentPanelOpen] = useState(false)')
const panelProps = source.slice(panel, source.indexOf('/>', panel))
expect(panelProps).toContain('open={agentPanelOpen}')
expect(panelProps).toContain('onOpen={() => setAgentPanelOpen(true)}')
expect(panelProps).toContain('onDismiss={() => setAgentPanelOpen(false)}')
```

- [ ] ChatPanel lifecycle test를 다시 실행해 같은 DOM/bridge/session이 보존되는지 확인한다.

Run: `npx vitest run tests/components/agent/ChatPanel.test.jsx`

Expected: PASS — dismiss 뒤 같은 aside node와 bridge listener가 유지되고 `agentSessionClose`는 0회다.

- [ ] App mount guard를 실행해 default-closed ownership과 single mount가 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/ChatPanel.appMount.test.js`

Expected: PASS — ChatPanel은 전역 sibling 한 개이며 App이 visibility state를 주입한다.

- [ ] Task 7 변경만 커밋한다.

```bash
git add src/assets/Robot.svg src/components/agent/ChatPanel.jsx src/components/agent/ChatPanel.css src/App.jsx tests/components/agent/ChatPanel.test.jsx tests/components/agent/ChatPanel.appMount.test.js
git commit -m "feat(agent): add persistent Robot FAB dismiss flow"
```

### Task 8: Effective mode, slide/floating layout, and container-clamped drag

**Files:**
- Create: `src/components/agent/agentPanelLayout.js:1`
- Modify: `src/components/agent/ChatPanel.jsx:14` (remove collapse), `:72` (drag hook), `:124` (mode props), `:393` (effective classes/toggle)
- Modify: `src/components/agent/ChatPanel.css:1` (container units, slide drawer, flex scroll, drag cursor)
- Modify: `src/App.jsx:2687` (appMode/stored mode/update callback)
- Test: Create `tests/components/agent/agentPanelLayout.test.js:1`
- Test: Modify `tests/components/agent/ChatPanel.test.jsx:188` (remove collapse tests), `:262` (replace collapse drag tests)
- Test: Modify `tests/components/agent/ChatPanel.appMount.test.js:8` (mode props)
- Test: Modify `tests/components/AppFlowSplitLayout.test.jsx:19` (four-way/narrow geometry)

**Interfaces:**
- Consumes: `appMode: 'api' | 'flow' | null`; Task 6 stored `agentPanelMode`; App `.app` positioned ancestor inside `.app-content-split`
- Produces: `normalizeAgentPanelMode(value): 'floating' | 'slide'`; `effectiveAgentPanelMode(appMode, storedMode): 'floating' | 'slide'`; `clampAgentPanelPosition(args): {left: number, top: number}`; `floatingPanelBox(container): {width: number, maxHeight: number}`

- [ ] `tests/components/agent/agentPanelLayout.test.js`를 다음 완전한 순수 함수 테스트로 생성한다.

```js
import { describe, expect, it } from 'vitest'
import {
  clampAgentPanelPosition,
  effectiveAgentPanelMode,
  floatingPanelBox,
  normalizeAgentPanelMode,
} from '../../../src/components/agent/agentPanelLayout.js'

describe('agentPanelLayout', () => {
  it('stored slide는 API에서 slide, Flow에서 floating이며 저장값 객체를 바꾸지 않는다', () => {
    const preference = { value: 'slide' }

    expect(effectiveAgentPanelMode('api', preference.value)).toBe('slide')
    expect(effectiveAgentPanelMode('flow', preference.value)).toBe('floating')
    expect(effectiveAgentPanelMode('api', preference.value)).toBe('slide')
    expect(preference).toEqual({ value: 'slide' })
  })

  it('invalid stored mode만 floating으로 정규화한다', () => {
    expect(normalizeAgentPanelMode('floating')).toBe('floating')
    expect(normalizeAgentPanelMode('slide')).toBe('slide')
    expect(normalizeAgentPanelMode('drawer')).toBe('floating')
    expect(normalizeAgentPanelMode(null)).toBe('floating')
  })

  it('pointer 좌표를 viewport가 아니라 offset container의 local bounds로 clamp한다', () => {
    const base = {
      offsetX: 12,
      offsetY: 10,
      containerRect: { left: 100, top: 50, width: 300, height: 200 },
      panelRect: { width: 252, height: 140 },
    }

    expect(clampAgentPanelPosition({ ...base, clientX: -500, clientY: -500 }))
      .toEqual({ left: 0, top: 0 })
    expect(clampAgentPanelPosition({ ...base, clientX: 999, clientY: 999 }))
      .toEqual({ left: 48, top: 60 })
  })

  it('288×180 App container에서 panel box가 양축을 넘지 않는다', () => {
    expect(floatingPanelBox({ width: 288, height: 180 })).toEqual({ width: 252, maxHeight: 144 })
    expect(floatingPanelBox({ width: 288, height: 180 }).width).toBeLessThanOrEqual(288)
    expect(floatingPanelBox({ width: 288, height: 180 }).maxHeight).toBeLessThanOrEqual(180)
  })
})
```

- [ ] helper test를 실행해 module 부재 RED를 확인한다.

Run: `npx vitest run tests/components/agent/agentPanelLayout.test.js`

Expected: FAIL — `Failed to resolve import "../../../src/components/agent/agentPanelLayout.js"`.

- [ ] `tests/components/agent/ChatPanel.test.jsx`에서 두 collapse describe를 삭제하고 다음 mode/drag tests를 추가한다.

```jsx
describe('ChatPanel — effective panel mode', () => {
  it('저장 slide는 Flow 진입 때 floating으로 파생되고 Flow 해제 때 slide로 자동 복귀한다', () => {
    const onAgentPanelModeChange = vi.fn()
    const { container, rerender } = render(
      <ChatPanel
        open
        appMode="api"
        agentPanelMode="slide"
        onAgentPanelModeChange={onAgentPanelModeChange}
        projectKey="p"
        batchStatusSources={batchSources()}
      />,
    )
    const panel = container.querySelector('.agent-chat-panel')
    const toggle = screen.getByRole('button', { name: 'Slide panel mode' })
    expect(panel).toHaveClass('mode-slide')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    rerender(
      <ChatPanel
        open
        appMode="flow"
        agentPanelMode="slide"
        onAgentPanelModeChange={onAgentPanelModeChange}
        projectKey="p"
        batchStatusSources={batchSources()}
      />,
    )
    expect(panel).toHaveClass('mode-floating')
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('The agent stays floating while Flow is active.')).toBeTruthy()
    expect(onAgentPanelModeChange).not.toHaveBeenCalled()

    rerender(
      <ChatPanel
        open
        appMode="api"
        agentPanelMode="slide"
        onAgentPanelModeChange={onAgentPanelModeChange}
        projectKey="p"
        batchStatusSources={batchSources()}
      />,
    )
    expect(panel).toHaveClass('mode-slide')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('API mode toggle은 저장 callback에 다음 preference만 전달한다', async () => {
    const user = userEvent.setup()
    const onAgentPanelModeChange = vi.fn()
    render(
      <ChatPanel
        open
        appMode="api"
        agentPanelMode="floating"
        onAgentPanelModeChange={onAgentPanelModeChange}
        projectKey="p"
        batchStatusSources={batchSources()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Slide panel mode' }))
    expect(onAgentPanelModeChange).toHaveBeenCalledWith('slide')
  })
})

describe('ChatPanel — open floating container drag', () => {
  function drag(el, from, to) {
    act(() => {
      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, clientX: from.x, clientY: from.y, button: 0,
      }))
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, clientX: to.x, clientY: to.y,
      }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
  }

  it('open+floating만 drag되고 offset container의 우하단 bounds에서 clamp된다', () => {
    const { container } = render(
      <div className="app">
        <ChatPanel open appMode="api" agentPanelMode="floating" projectKey="p" batchStatusSources={batchSources()} />
      </div>,
    )
    const app = container.querySelector('.app')
    const panel = container.querySelector('.agent-chat-panel')
    const header = container.querySelector('.agent-chat-header')
    app.getBoundingClientRect = () => ({ left: 100, top: 50, width: 300, height: 200, right: 400, bottom: 250 })
    panel.getBoundingClientRect = () => ({ left: 118, top: 68, width: 252, height: 140, right: 370, bottom: 208 })

    drag(header, { x: 130, y: 78 }, { x: 999, y: 999 })

    expect(panel.style.left).toBe('48px')
    expect(panel.style.top).toBe('60px')
  })

  it.each([
    { open: false, mode: 'floating' },
    { open: true, mode: 'slide' },
  ])('open=$open mode=$mode에서는 drag position을 쓰지 않는다', ({ open, mode }) => {
    const { container } = render(
      <div className="app">
        <ChatPanel open={open} appMode="api" agentPanelMode={mode} projectKey="p" batchStatusSources={batchSources()} />
      </div>,
    )
    const header = container.querySelector('.agent-chat-header')
    drag(header, { x: 130, y: 78 }, { x: 220, y: 150 })
    expect(container.querySelector('.agent-chat-panel').style.left).toBe('')
  })
})
```

- [ ] ChatPanel test를 실행해 mode toggle/helper와 새 drag 계약 부재 RED를 확인한다.

Run: `npx vitest run tests/components/agent/ChatPanel.test.jsx`

Expected: FAIL — `Unable to find role="button" and name "Slide panel mode"`.

- [ ] `src/components/agent/agentPanelLayout.js`를 다음 완전한 코드로 생성한다.

```js
export const AGENT_PANEL_MODES = Object.freeze(['floating', 'slide'])

const clamp = (value, max) => Math.min(Math.max(value, 0), Math.max(max, 0))

export function normalizeAgentPanelMode(value) {
  return AGENT_PANEL_MODES.includes(value) ? value : 'floating'
}

export function effectiveAgentPanelMode(appMode, storedMode) {
  return appMode === 'flow' ? 'floating' : normalizeAgentPanelMode(storedMode)
}

export function clampAgentPanelPosition({
  clientX,
  clientY,
  offsetX,
  offsetY,
  containerRect,
  panelRect,
}) {
  return {
    left: clamp(clientX - containerRect.left - offsetX, containerRect.width - panelRect.width),
    top: clamp(clientY - containerRect.top - offsetY, containerRect.height - panelRect.height),
  }
}

export function floatingPanelBox({ width, height }) {
  return {
    width: Math.min(420, Math.max(0, width - 36)),
    maxHeight: Math.min(640, Math.max(0, height - 36)),
  }
}
```

- [ ] `ChatPanel.jsx`의 collapse icon/hook/state를 제거하고 다음 floating drag hook과 mode 배선을 적용한다.

```diff
diff --git a/src/components/agent/ChatPanel.jsx b/src/components/agent/ChatPanel.jsx
@@
 import robotUrl from '../../assets/Robot.svg'
+import { clampAgentPanelPosition, effectiveAgentPanelMode } from './agentPanelLayout.js'
 import './ChatPanel.css'
@@
-function ChevronIcon({ collapsed }) {
-  return (
-    <svg
-      className="agent-chat-chevron"
-      width="12" height="12" viewBox="0 0 24 24"
-      fill="none" stroke="currentColor" strokeWidth="3"
-      strokeLinecap="round" strokeLinejoin="round"
-      aria-hidden="true" focusable="false"
-    >
-      {collapsed
-        ? <polyline points="6 15 12 9 18 15" />
-        : <polyline points="6 9 12 15 18 9" />}
-    </svg>
-  )
-}
-
@@
-const clamp = (value, max) => Math.min(Math.max(value, 0), Math.max(max, 0))
-
-function useCollapsedDrag(enabled) {
+function useFloatingDrag(enabled) {
   const [position, setPosition] = useState(null)
   const panelRef = useRef(null)
   const dragRef = useRef(null)
@@
       const drag = dragRef.current
       if (!drag) return
       const panel = panelRef.current
-      const width = panel?.offsetWidth ?? 0
-      const height = panel?.offsetHeight ?? 0
-      setPosition({
-        left: clamp(event.clientX - drag.offsetX, window.innerWidth - width),
-        top: clamp(event.clientY - drag.offsetY, window.innerHeight - height),
-      })
+      const container = panel?.closest('.app') || panel?.parentElement
+      if (!panel || !container) return
+      setPosition(clampAgentPanelPosition({
+        clientX: event.clientX,
+        clientY: event.clientY,
+        offsetX: drag.offsetX,
+        offsetY: drag.offsetY,
+        containerRect: container.getBoundingClientRect(),
+        panelRect: panel.getBoundingClientRect(),
+      }))
@@
     if (!enabled || event.button !== 0 || event.target.closest('button')) return
@@
-  return { panelRef, position: enabled ? position : null, onPointerDown }
+  return { panelRef, position: enabled ? position : null, onPointerDown }
 }
@@
   open = true,
   onOpen = () => {},
   onDismiss = () => {},
+  appMode = 'api',
+  agentPanelMode = 'floating',
+  onAgentPanelModeChange = () => {},
@@
   const t = useSafeT()
   const api = window.electronAPI
-  const [collapsed, setCollapsed] = useState(false)
-  const { panelRef, position, onPointerDown } = useCollapsedDrag(collapsed)
+  const effectiveMode = effectiveAgentPanelMode(appMode, agentPanelMode)
+  const dragEnabled = open && effectiveMode === 'floating'
+  const { panelRef, position, onPointerDown } = useFloatingDrag(dragEnabled)
@@
-      className={`agent-chat-panel ${open ? 'is-open' : 'is-dismissed'} ${collapsed ? 'is-collapsed' : ''}`}
+      className={`agent-chat-panel ${open ? 'is-open' : 'is-dismissed'} mode-${effectiveMode}`}
       aria-label={t('agent.panelLabel')}
       aria-hidden={!open}
-      style={position ? { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto' } : undefined}
+      data-effective-mode={effectiveMode}
+      style={dragEnabled && position
+        ? { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto' }
+        : undefined}
@@
-        className={`agent-chat-header ${collapsed ? 'is-draggable' : ''}`}
+        className={`agent-chat-header ${dragEnabled ? 'is-draggable' : ''}`}
@@
           {running && <span className="agent-chat-running">{t('agent.running')}</span>}
+          {appMode === 'flow' && (
+            <span className="agent-chat-flow-notice">{t('agent.flowFloatingOnly')}</span>
+          )}
+          <button
+            type="button"
+            className="agent-chat-mode-toggle"
+            aria-label={t('agent.modeToggle')}
+            aria-pressed={effectiveMode === 'slide'}
+            title={effectiveMode === 'slide' ? t('agent.switchToFloating') : t('agent.switchToSlide')}
+            disabled={appMode === 'flow'}
+            onClick={() => onAgentPanelModeChange(effectiveMode === 'slide' ? 'floating' : 'slide')}
+          >
+            <span aria-hidden="true">⇥</span>
+          </button>
@@
-          <button
-            type="button"
-            className="agent-chat-collapse"
-            aria-label={collapsed ? t('agent.expand') : t('agent.collapse')}
-            aria-expanded={!collapsed}
-            title={collapsed ? t('agent.expand') : t('agent.collapse')}
-            onClick={() => setCollapsed((value) => !value)}
-          >
-            <ChevronIcon collapsed={collapsed} />
-          </button>
@@
-      {!collapsed && (
-        <>
@@
-        </>
-      )}
```

- [ ] `ChatPanel.css`의 base panel/log/compose/collapse rules를 다음 floating/slide 규칙으로 교체한다.

```css
.agent-chat-panel {
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 3200;
  width: min(420px, calc(100% - 36px));
  max-height: min(640px, calc(100% - 36px));
  display: flex;
  flex-direction: column;
  min-height: 0;
  color: var(--text, #eee);
  background: var(--panel-bg, #1e1e22);
  border: 1px solid var(--border, #3a3a42);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.42);
  overflow: hidden;
  transition: transform 0.22s ease, opacity 0.18s ease, visibility 0.18s ease;
}
.agent-chat-panel.mode-floating.is-dismissed { transform: translateY(12px) scale(0.98); }
.agent-chat-panel.mode-slide {
  top: 0; right: 0; bottom: 0;
  width: min(420px, 100%); height: 100%; max-height: 100%;
  border-top-right-radius: 0; border-bottom-right-radius: 0;
  transform: translateX(100%);
}
.agent-chat-panel.mode-slide.is-open { transform: translateX(0); }
.agent-chat-panel.mode-slide.is-dismissed { transform: translateX(100%); }
.agent-chat-panel.is-dismissed { visibility: hidden; opacity: 0; pointer-events: none; }
.agent-chat-panel.is-open { visibility: visible; opacity: 1; }
.agent-chat-header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 13px; border-bottom: 1px solid var(--border, #3a3a42); }
.agent-chat-header-actions, .agent-chat-actions { display: flex; align-items: center; gap: 6px; }
.agent-chat-log { flex: 1 1 auto; min-height: 0; max-height: none; padding: 12px; overflow-y: auto; }
.agent-chat-compose { flex: 0 0 auto; padding: 10px 12px 12px; border-top: 1px solid var(--border, #3a3a42); }
.agent-chat-header.is-draggable { cursor: grab; user-select: none; }
.agent-chat-header.is-draggable:active { cursor: grabbing; }
.agent-chat-flow-notice { max-width: 150px; font-size: 10px; line-height: 1.2; color: #e9bd68; }
```

- [ ] `App.jsx` ChatPanel call에 app mode와 저장 callback을 추가한다.

```diff
diff --git a/src/App.jsx b/src/App.jsx
@@
         open={agentPanelOpen}
         onOpen={() => setAgentPanelOpen(true)}
         onDismiss={() => setAgentPanelOpen(false)}
+        appMode={mode}
+        agentPanelMode={settings.agentPanelMode}
+        onAgentPanelModeChange={(nextMode) => updateSetting('agentPanelMode', nextMode)}
         projectKey={`${settings.saveMode}:${workFolder ?? ''}:${settings.projectName ?? ''}`}
```

- [ ] `ChatPanel.appMount.test.js`의 `panelProps` assertions에 다음 mode wiring을 추가한다.

```js
expect(panelProps).toContain('appMode={mode}')
expect(panelProps).toContain('agentPanelMode={settings.agentPanelMode}')
expect(panelProps).toContain("onAgentPanelModeChange={(nextMode) => updateSetting('agentPanelMode', nextMode)}")
```

- [ ] `AppFlowSplitLayout.test.jsx`에 import와 네 방향 narrow geometry/CSS invariant test를 추가한다.

```diff
diff --git a/tests/components/AppFlowSplitLayout.test.jsx b/tests/components/AppFlowSplitLayout.test.jsx
@@
 import { useEffect } from 'react'
+import { readFileSync } from 'node:fs'
 import { computeAppClass, flowLayoutForMode, isHorizontalSplit, clampSplitRatio, ratioFromDrag, splitAppStyle, splitFlowStyle, splitResizerStyle } from '../../src/utils/appLayout'
+import { floatingPanelBox } from '../../src/components/agent/agentPanelLayout.js'
@@
+describe('agent floating/FAB stay inside four-way App split', () => {
+  it.each(['split-left', 'split-right', 'split-top', 'split-bottom'])(
+    '%s ratio 0.8에서 panel과 72px FAB가 App 영역을 넘지 않는다',
+    (layoutMode) => {
+      const horizontal = isHorizontalSplit(layoutMode)
+      const app = {
+        width: horizontal ? 1440 * 0.2 : 1440,
+        height: horizontal ? 900 : 900 * 0.2,
+      }
+      const panel = floatingPanelBox(app)
+      expect(panel.width).toBeLessThanOrEqual(app.width)
+      expect(panel.maxHeight).toBeLessThanOrEqual(app.height)
+      expect(72 + 36).toBeLessThanOrEqual(horizontal ? app.width : app.height)
+      expect(splitAppStyle(layoutMode, 0.8).position).toBe('absolute')
+    },
+  )
+
+  it('production CSS가 viewport 단위가 아닌 App container 단위를 쓴다', () => {
+    const css = readFileSync('src/components/agent/ChatPanel.css', 'utf8')
+    expect(css).toContain('width: min(420px, calc(100% - 36px))')
+    expect(css).toContain('max-height: min(640px, calc(100% - 36px))')
+    expect(css).not.toMatch(/agent-chat-panel[\s\S]*?100v[wh]/)
+  })
+})
```

- [ ] helper test를 다시 실행해 effective mode와 container clamp가 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/agentPanelLayout.test.js`

Expected: PASS — `4 passed`; Flow 파생과 288×180 geometry가 일치한다.

- [ ] ChatPanel mode/drag 통합 테스트를 다시 실행한다.

Run: `npx vitest run tests/components/agent/ChatPanel.test.jsx`

Expected: PASS — collapse-era 테스트 없이 open+floating drag, Flow fallback, slide 복귀가 통과한다.

- [ ] 네 방향 split 테스트를 실행해 floating/FAB가 App 영역 안에 남는지 확인한다.

Run: `npx vitest run tests/components/AppFlowSplitLayout.test.jsx`

Expected: PASS — `split-left/right/top/bottom`과 288px/180px 최소 App 영역이 모두 통과한다.

- [ ] App mount guard를 실행해 mode prop wiring이 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/ChatPanel.appMount.test.js`

Expected: PASS — App은 저장값을 보존한 채 `mode`와 update callback을 ChatPanel에 전달한다.

- [ ] Task 8 변경만 커밋한다.

```bash
git add src/components/agent/agentPanelLayout.js src/components/agent/ChatPanel.jsx src/components/agent/ChatPanel.css src/App.jsx tests/components/agent/agentPanelLayout.test.js tests/components/agent/ChatPanel.test.jsx tests/components/agent/ChatPanel.appMount.test.js tests/components/AppFlowSplitLayout.test.jsx
git commit -m "feat(agent): add Flow-safe floating and slide modes"
```

### Task 9: Icon action bar and edge-aware portal tooltip

**Files:**
- Create: `src/components/agent/AgentIconButton.jsx:1`
- Modify: `src/components/agent/ChatPanel.jsx:10` (icon button import/icon paths), `:406` (header icons), `:465` (action icons)
- Modify: `src/components/agent/ChatPanel.css:20` (square icon buttons), append portal tooltip
- Test: Create `tests/components/agent/AgentIconButton.test.jsx:1`
- Test: Modify `tests/components/agent/ChatPanel.test.jsx:59` (accessible-name/icon/portal integration)
- Test: Verify unchanged `tests/components/agent/ApprovalDialog.stacking.test.js:33`

**Interfaces:**
- Consumes: Task 4 tooltip strings; existing accessible labels `agent.send`, `steer`, `stop`, `closeSession`; `document.body`
- Produces: `tooltipPosition(anchorRect, tooltipRect, viewport, gap?): {left: number, top: number, placement: 'top' | 'bottom'}`; `AgentIconButton(props)` with portal tooltip and preserved accessible name

- [ ] `tests/components/agent/AgentIconButton.test.jsx`를 다음 완전한 component test로 생성한다.

```jsx
// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentIconButton, { tooltipPosition } from '../../../src/components/agent/AgentIconButton.jsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AgentIconButton portal tooltip', () => {
  it('아이콘만 보여도 aria-label로 기존 button name을 보존한다', () => {
    render(
      <AgentIconButton label="Send" tooltip="Send a new turn">
        <svg aria-hidden="true"><path d="M0 0" /></svg>
      </AgentIconButton>,
    )
    const button = screen.getByRole('button', { name: 'Send' })
    expect(button.querySelector('svg')).toBeTruthy()
    expect(button).toHaveTextContent('')
  })

  it('overflow hidden 조상 밖 document.body portal에 렌더하고 우상단 edge에서 안 잘린다', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this.classList.contains('agent-portal-tooltip')) {
        return { left: 0, top: 0, right: 200, bottom: 30, width: 200, height: 30 }
      }
      if (this.tagName === 'BUTTON') {
        return { left: 990, top: 2, right: 1010, bottom: 34, width: 20, height: 32 }
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    })
    const { container } = render(
      <div style={{ overflow: 'hidden', width: 40, height: 40 }}>
        <AgentIconButton label="Close session" tooltip="Close the agent session">
          <svg aria-hidden="true" />
        </AgentIconButton>
      </div>,
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Close session' }))
    const tooltip = await screen.findByRole('tooltip')
    await waitFor(() => expect(tooltip.style.left).toBe('816px'))

    expect(tooltip.parentElement).toBe(document.body)
    expect(container.contains(tooltip)).toBe(false)
    expect(tooltip.style.top).toBe('42px')
    expect(tooltip.dataset.placement).toBe('bottom')
  })

  it('순수 위치 함수는 좌우 clamp와 위쪽 우선 배치를 지킨다', () => {
    expect(tooltipPosition(
      { left: 100, right: 140, top: 100, bottom: 140 },
      { width: 80, height: 24 },
      { width: 320, height: 240 },
    )).toEqual({ left: 80, top: 68, placement: 'top' })
    expect(tooltipPosition(
      { left: -20, right: 20, top: 100, bottom: 140 },
      { width: 80, height: 24 },
      { width: 320, height: 240 },
    ).left).toBe(8)
  })
})
```

- [ ] icon tooltip test를 실행해 component 부재 RED를 확인한다.

Run: `npx vitest run tests/components/agent/AgentIconButton.test.jsx`

Expected: FAIL — `Failed to resolve import "../../../src/components/agent/AgentIconButton.jsx"`.

- [ ] `src/components/agent/AgentIconButton.jsx`를 다음 완전한 코드로 생성한다.

```jsx
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const EDGE = 8

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max))

export function tooltipPosition(anchorRect, tooltipRect, viewport, gap = 8) {
  const centered = anchorRect.left + ((anchorRect.right - anchorRect.left - tooltipRect.width) / 2)
  const left = clamp(centered, EDGE, viewport.width - tooltipRect.width - EDGE)
  const preferredTop = anchorRect.top - tooltipRect.height - gap
  const placement = preferredTop >= EDGE ? 'top' : 'bottom'
  const rawTop = placement === 'top' ? preferredTop : anchorRect.bottom + gap
  const top = clamp(rawTop, EDGE, viewport.height - tooltipRect.height - EDGE)
  return { left, top, placement }
}

function PortalTooltip({ id, anchorRef, text, open }) {
  const tooltipRef = useRef(null)
  const [position, setPosition] = useState(null)

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tooltipRef.current) return undefined
    const update = () => setPosition(tooltipPosition(
      anchorRef.current.getBoundingClientRect(),
      tooltipRef.current.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
    ))
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRef, open, text])

  if (!open) return null
  return createPortal(
    <div
      ref={tooltipRef}
      id={id}
      role="tooltip"
      className="agent-portal-tooltip"
      data-placement={position?.placement || 'top'}
      style={position ? { left: `${position.left}px`, top: `${position.top}px` } : undefined}
    >
      {text}
    </div>,
    document.body,
  )
}

export default function AgentIconButton({
  label,
  tooltip,
  className = '',
  children,
  disabled = false,
  pressed,
  type = 'button',
  onClick,
}) {
  const tooltipId = `agent-tooltip-${useId().replace(/:/g, '')}`
  const buttonRef = useRef(null)
  const [showTooltip, setShowTooltip] = useState(false)
  const show = () => { if (!disabled) setShowTooltip(true) }
  const hide = () => setShowTooltip(false)

  return (
    <>
      <button
        ref={buttonRef}
        type={type}
        className={`agent-icon-button ${className}`.trim()}
        aria-label={label}
        aria-describedby={showTooltip ? tooltipId : undefined}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </button>
      <PortalTooltip
        id={tooltipId}
        anchorRef={buttonRef}
        text={tooltip}
        open={showTooltip && Boolean(tooltip)}
      />
    </>
  )
}
```

- [ ] `ChatPanel.jsx`에 icon component와 다음 완전한 SVG icon switch를 추가한다.

```jsx
import AgentIconButton from './AgentIconButton.jsx'

function AgentControlIcon({ name }) {
  const paths = {
    send: <path d="M4 4l16 8-16 8 3-8-3-8zm3.4 8h7.6" />,
    steer: <path d="M5 19V7m0 0l-3 3m3-3l3 3m4 7V5m0 12l-3-3m3 3l3-3m4 5V9m0 0l-3 3m3-3l3 3" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    close: <path d="M5 5l14 14M19 5L5 19" />,
    dismiss: <path d="M6 6l12 12M18 6L6 18" />,
    mode: <path d="M4 5h6v14H4V5zm10 0h6v14h-6V5z" />,
  }
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}
```

- [ ] header의 mode/dismiss buttons를 다음 icon-button 코드로 교체한다.

```jsx
<AgentIconButton
  className="agent-chat-mode-toggle"
  label={t('agent.modeToggle')}
  tooltip={effectiveMode === 'slide' ? t('agent.switchToFloating') : t('agent.switchToSlide')}
  pressed={effectiveMode === 'slide'}
  disabled={appMode === 'flow'}
  onClick={() => onAgentPanelModeChange(effectiveMode === 'slide' ? 'floating' : 'slide')}
>
  <AgentControlIcon name="mode" />
</AgentIconButton>
<AgentIconButton
  className="agent-chat-dismiss"
  label={t('agent.dismissPanel')}
  tooltip={t('agent.dismissPanel')}
  onClick={onDismiss}
>
  <AgentControlIcon name="dismiss" />
</AgentIconButton>
```

- [ ] action bar의 텍스트 buttons 4개를 다음 icon-button 코드로 교체한다.

```jsx
<div className="agent-chat-actions">
  <AgentIconButton
    type="submit"
    className="is-primary"
    label={t('agent.send')}
    tooltip={t('agent.sendTooltip')}
    disabled={running || !input.trim()}
  >
    <AgentControlIcon name="send" />
  </AgentIconButton>
  <AgentIconButton
    label={t('agent.steer')}
    tooltip={t('agent.steerTooltip')}
    onClick={steer}
    disabled={!running || !input.trim()}
  >
    <AgentControlIcon name="steer" />
  </AgentIconButton>
  <AgentIconButton
    label={t('agent.stop')}
    tooltip={t('agent.stopTooltip')}
    onClick={abort}
    disabled={!running}
  >
    <AgentControlIcon name="stop" />
  </AgentIconButton>
  <AgentIconButton
    label={t('agent.closeSession')}
    tooltip={t('agent.closeSessionTooltip')}
    onClick={close}
    disabled={!sessionOpenRef.current}
  >
    <AgentControlIcon name="close" />
  </AgentIconButton>
</div>
```

- [ ] `ChatPanel.css`에 icon/portal tooltip 스타일을 추가하고 텍스트 submit selector를 `.is-primary`로 교체한다.

```css
.agent-icon-button {
  display: inline-grid; place-items: center; flex: 0 0 auto;
  width: 30px; height: 30px; padding: 0;
  color: inherit; background: transparent;
  border: 1px solid var(--border, #3a3a42); border-radius: 7px; cursor: pointer;
}
.agent-chat-actions .agent-icon-button,
.agent-chat-header .agent-icon-button { padding: 0; }
.agent-chat-compose {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  align-items: end; gap: 8px; padding: 8px;
}
.agent-chat-compose textarea { min-height: 44px; margin-bottom: 0; }
.agent-chat-actions { flex-wrap: nowrap; }
.agent-icon-button.is-primary { color: #fff; background: var(--accent, #4c8dff); border-color: transparent; }
.agent-icon-button:hover:not(:disabled) { background-color: rgba(255, 255, 255, 0.1); }
.agent-icon-button.is-primary:hover:not(:disabled) { background-color: color-mix(in srgb, var(--accent, #4c8dff) 82%, white); }
.agent-icon-button:focus-visible { outline: 2px solid #9ec5ff; outline-offset: 2px; }
.agent-icon-button:disabled { cursor: default; opacity: 0.42; }
.agent-portal-tooltip {
  position: fixed; z-index: 4000; max-width: min(260px, calc(100vw - 16px));
  padding: 6px 9px; color: #f7f9ff; background: #111827;
  border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.36);
  font-size: 11px; line-height: 1.3; white-space: normal; pointer-events: none;
}
```

- [ ] `ChatPanel.test.jsx` command describe에 다음 icon label/portal integration test를 추가한다.

```diff
diff --git a/tests/components/agent/ChatPanel.test.jsx b/tests/components/agent/ChatPanel.test.jsx
@@
-import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
+import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
```

```jsx
it('icon action bar가 기존 accessible names를 보존하고 tooltip은 panel overflow 밖 body에 뜬다', async () => {
  const user = userEvent.setup()
  const { container } = render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
  const input = screen.getByRole('textbox', { name: 'Message to the agent' })
  await user.type(input, '툴팁 확인')

  for (const name of ['Send', 'Steer', 'Stop', 'Close session']) {
    const button = screen.getByRole('button', { name })
    expect(button.querySelector('svg'), `${name} icon`).toBeTruthy()
    expect(button.textContent.trim()).toBe('')
  }

  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Send' }))
  const tooltip = await screen.findByRole('tooltip')
  expect(tooltip).toHaveTextContent('Send a new turn')
  expect(tooltip.parentElement).toBe(document.body)
  expect(container.querySelector('.agent-chat-panel')?.contains(tooltip)).toBe(false)
})
```

- [ ] icon tooltip unit test를 다시 실행해 body portal과 edge clamp가 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/AgentIconButton.test.jsx`

Expected: PASS — `3 passed`; 우상단 tooltip은 `left:816px`, `top:42px`, `placement:bottom`이다.

- [ ] ChatPanel test를 실행해 기존 label queries와 새 icon/portal assertion이 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/ChatPanel.test.jsx`

Expected: PASS — `Send`, `Steer`, `Stop`, `Close session` button-name 쿼리가 그대로 통과한다.

- [ ] approval stacking test를 실행해 tooltip/panel/FAB보다 ApprovalDialog가 여전히 위인지 확인한다.

Run: `npx vitest run tests/components/agent/ApprovalDialog.stacking.test.js`

Expected: PASS — 새 최대 z-index 4000은 approval `2147483000`보다 낮다.

- [ ] Task 9 변경만 커밋한다.

```bash
git add src/components/agent/AgentIconButton.jsx src/components/agent/ChatPanel.jsx src/components/agent/ChatPanel.css tests/components/agent/AgentIconButton.test.jsx tests/components/agent/ChatPanel.test.jsx
git commit -m "feat(agent): add icon actions with portal tooltips"
```

---

## Final Verification and Live Smoke Gate

- [ ] Codex package pin을 확인한다.

Run: `node -p "require('./package.json').dependencies['@openai/codex']"`

Expected: `0.142.5`

- [ ] B tool inventory가 그대로인지 기존 exact inventory test를 실행한다.

Run: `npx vitest run tests/electron/agent/toolCore.gate.test.js`

Expected: PASS — B tools는 `['generate_videos']` 정확히 하나다.

- [ ] backend runtime model chain을 최종 재실행한다.

Run: `npx vitest run tests/electron/agent/agentModelWiring.integration.test.js`

Expected: PASS — model 지정/생략 두 runtime chain이 통과한다.

- [ ] model catalog IPC와 preload surface를 최종 재실행한다.

Run: `npx vitest run tests/electron/ipc/agent-api.test.js`

Expected: PASS — retry/filter/cache/fallback handler가 통과한다.

- [ ] custom selector 접근성 테스트를 최종 재실행한다.

Run: `npx vitest run tests/components/agent/AgentModelSelector.test.jsx`

Expected: PASS — combobox/listbox/option ARIA와 keyboard/focus 계약이 통과한다.

- [ ] ChatPanel 통합 테스트를 최종 재실행한다.

Run: `npx vitest run tests/components/agent/ChatPanel.test.jsx`

Expected: PASS — snapshot, running controls, dismiss 수명, mode/drag, icons/tooltip가 통과한다.

- [ ] 전체 vitest suite를 실행한다.

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npm run test:run`

Expected: PASS — failed test 0, unhandled error 0.

- [ ] production build를 실행해 SVG/CSS/portal/Electron preload bundle을 검증한다.

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npm run build`

Expected: PASS — Vite build와 `dist-electron/preload.cjs` 생성이 exit code 0으로 끝난다.

- [ ] Task 1–9 diff에 범위 밖 파일이 없는지 확인한다.

Run: `git diff --name-only HEAD~9..HEAD -- electron/ipc/layout.js electron/agent/toolCore.js package.json`

Expected: 출력 없음.

- [ ] 개발 앱을 띄워 실제 Electron UI smoke를 시작한다.

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npm run dev`

Expected: Vite dev server가 ready가 되고 Electron 창이 열린다.

- [ ] 앱 최초 진입에서 패널 대신 우하단 72px Robot FAB가 보이고, FAB→패널→dismiss→FAB 왕복 뒤 기존 메시지가 남는지 눈으로 확인한다.

- [ ] API mode에서 floating↔slide를 전환하고 앱 재시작 뒤 저장한 slide 선호가 복원되는지 확인한다.

- [ ] 저장값이 slide인 상태에서 Flow mode를 켜면 즉시 floating으로 바뀌고 toggle이 disabled+안내를 보이며, API mode로 돌아오면 저장값을 덮지 않고 slide로 복귀하는지 확인한다.

- [ ] Flow `split-left`, `split-right`, `split-top`, `split-bottom`을 각각 ratio 0.8까지 줄여 panel/FAB가 native Flow 뒤로 가려지거나 288px×180px App 영역 밖으로 잘리지 않고 메시지 log가 내부 scroll되는지 확인한다.

- [ ] action icon 네 개에 hover와 keyboard focus를 각각 주어 tooltip이 panel 모서리에서 잘리지 않고 body portal로 보이는지 확인한다.

- [ ] 실제 Codex model A로 첫 응답을 시작한 뒤 streaming 중 selector를 model B로 바꾸고 Steer를 보내 active turn은 계속 동작하는지 확인한다.

- [ ] 첫 turn 완료 뒤 새 Send를 눌러 같은 thread context가 유지되면서 다음 응답부터 model B가 적용되는지 한 번의 실호출로 확인한다.

- [ ] model catalog 인증 실패 또는 Codex 미실행 환경에서 selector가 `Default`로 남고 Send가 정상적으로 app-server 기본 model로 시도되는지 확인한다.

---

## Self-Review Checklist

### Spec Coverage

| Spec section | Plan mapping | Acceptance evidence |
|---|---|---|
| §1 FAB + dismiss | Task 7 | default-closed App state, identical aside/bridge node, close 0회 |
| §2 floating↔slide + Flow | Task 6, Task 8 | stored preference, effective mode transition, four-way split, 288×180, container drag |
| §3 icon action bar + portal | Task 9 | existing aria names, body portal, edge clamp, approval stacking |
| §4 model selector + apply timing | Task 1–5 | runtime wire, cached catalog, full combobox ARIA, submit snapshot, Send/Steer split |
| §5 decision summary | Task 1, 5, 7–9 | no backdrop, steer retained, fallback omission, dismiss/close separation |
| §6 file impact | File Structure + Tasks 1–9 | 모든 production/test 파일에 단일 책임과 exact anchor 지정 |
| §7 TDD + visual gate | 각 Task RED/GREEN + Final Verification | single-file vitest, full suite, build, live smoke |
| §8 out of scope | Global Constraints | Claude disabled only, resume/layout.js 미구현 |
| §9 implementation confirmations | Task 2, 8 + live smoke | app-lifetime success cache, App prop wiring, per-turn real call |

Unmapped spec sections: 없음.

### Interface and Type Consistency

- [ ] 다음 exact signatures가 계획 전체에서 같은지 확인한다: `open(model?: string)`, `send(text: string, model?: string)`, `agentSessionOpen({model?})`, `agentSend({text, model?})`, `agentListModels(): Promise<CodexModel[]>`.
- [ ] selector value가 `string | null`이고 `null`일 때 IPC payload에서 model property가 생략되는지 확인한다.
- [ ] `effectiveAgentPanelMode(appMode, storedMode)`가 stored value를 쓰지 않고 반환만 하며 Flow off 때 slide가 복귀하는지 확인한다.
- [ ] `AgentIconButton`의 `label`이 accessible name, `tooltip`이 portal의 설명 문자열로 분리되어 기존 label queries가 유지되는지 확인한다.

### Code-Plan Hygiene

- [ ] 미완성 marker를 스캔한다.

Run: `rg -n 'T[B]D|T[O]DO|place[ -]?holder|s[a]me as|s[i]milar to Task|i[m]plement later' docs/superpowers/plans/2026-07-16-agent-ui-redesign.md`

Expected: 출력 없음.

- [ ] source anchors가 구현 시작 시점에도 유효한지 마지막으로 확인한다.

Run: `rg -n "function send\(|function open\(|agent:session-open|agentSend:|<ChatPanel|app-content-split|agent: \{" electron/agent/codexOrchestrator.js electron/agent/sessionManager.js electron/ipc/agent-api.js electron/preload.js src/App.jsx src/Shell.jsx src/locales/en.js src/locales/ko.js`

Expected: 이 계획의 Task 1–9 **Files** 절에 적은 symbol anchor가 모두 검색된다.

### Grounded Anchor Notes

- 설계에 적힌 `App.jsx:653`, `App.jsx:2687`, `ChatPanel.jsx:393`, `ChatPanel.jsx:466`, `agent-api.js:121`, `sessionManager.js:117/225`, `codexOrchestrator.js:301/316`, `preload.js:161`, `Shell.jsx:53`, `SideDrawer.jsx:36`, `package.json:51`, `useAppMode.js:16`은 현재 checkout에서 그대로 확인했다.
- `settings 저장소`는 설계에 파일명이 없어서 실제 소유자인 `src/hooks/useAppSettings.js:10-75`와 `tests/hooks/useAppSettings.test.js`로 구체화했다.
- `ModelSelector.jsx:35`는 agent용으로 수정하지 않는다. 기존 settings native select와 분리된 `AgentModelSelector.jsx`를 만들어 disabled badge/ARIA surface를 agent 범위에 한정한다.
- anchor drift 발견: 없음.
