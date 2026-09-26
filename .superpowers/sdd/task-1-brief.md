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

