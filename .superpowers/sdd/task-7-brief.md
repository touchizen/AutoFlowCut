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

