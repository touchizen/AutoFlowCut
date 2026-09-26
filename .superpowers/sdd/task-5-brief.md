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

