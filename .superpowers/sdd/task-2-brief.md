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

