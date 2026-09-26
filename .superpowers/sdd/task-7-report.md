# Task 7 Report — Robot FAB and dismiss-without-close lifecycle

## Status

DONE_WITH_CONCERNS

구현과 지정 테스트는 완료했지만 sandbox가 `.git/index.lock` 생성을 거부해 stage/commit하지 못했다.

## Task files changed

1. `src/assets/Robot.svg`
   - brief의 SVG를 그대로 생성했다.
2. `src/components/agent/ChatPanel.jsx`
   - `robotUrl` asset import를 추가했다.
   - `open = true`, `onOpen = () => {}`, `onDismiss = () => {}` props를 추가했다.
   - 항상 mount되는 FAB와 aside를 fragment로 함께 반환한다.
   - aside에 open/dismissed class와 `aria-hidden={!open}`을 추가했다.
   - 기존 `is-collapsed` class와 collapsed state를 유지했다.
   - header actions에 dismiss 버튼을 추가했다. dismiss는 `onDismiss`만 호출하며 `agentSessionClose`를 호출하지 않는다.
3. `src/components/agent/ChatPanel.css`
   - `.agent-chat-panel`을 `position: fixed`에서 `position: absolute`로 바꿨다.
   - `.is-dismissed`, `.is-open`, `.agent-chat-fab`, `.is-hidden` 규칙을 추가했다.
4. `src/App.jsx`
   - `const [agentPanelOpen, setAgentPanelOpen] = useState(false)`를 추가했다.
   - 전역 sibling `<ChatPanel>`에 exact source-string props를 주입했다.
5. `tests/components/agent/ChatPanel.test.jsx`
   - persistent describe에 brief의 dismiss/FAB 왕복 lifecycle regression test를 그대로 추가했다.
6. `tests/components/agent/ChatPanel.appMount.test.js`
   - 첫 테스트에 App-owned visibility wiring source-string assertions 4개와 `panelProps` slice를 추가했다.

이 보고서 파일은 controller handoff용이며 위 6개 task file 커밋에는 포함하지 않으려 했다.

## Drifted anchors located

### `ChatPanel.jsx` props anchor

기존 실제 주변 줄:

```jsx
/**
 * D14 전역 ChatPanel. App의 generate/story 조건부 body 밖에서 한 번만 mount해야 한다.
 * view 전환은 state를 보존하지만 projectKey 전환은 D15에 따라 이전 session을 abort/close한다.
 */
export default function ChatPanel({
  projectKey = null,
  batchStatusSources = {},
```

brief의 visibility props를 `projectKey` 앞에 삽입했다.

### `ChatPanel.jsx` return/aside anchor

기존 실제 주변 줄:

```jsx
  return (
    <aside
      ref={panelRef}
      className={`agent-chat-panel ${collapsed ? 'is-collapsed' : ''}`}
      aria-label={t('agent.panelLabel')}
```

이 `<aside>`를 제거하거나 조건부 render하지 않고 fragment 안에 유지하면서 FAB를 바로 앞 sibling으로 추가했다.

### `ChatPanel.jsx` header actions anchor

기존 실제 주변 줄:

```jsx
        <div className="agent-chat-header-actions">
          {running && <span className="agent-chat-running">{t('agent.running')}</span>}
          {/* 🔴 아이콘만 두면 버튼의 **이름이 사라진다** — 스크린리더는 "button" 이라고만 읽는다.
```

`running` indicator 다음, 기존 collapse 버튼 앞에 `agent-chat-dismiss` 버튼을 추가했다.

### `App.jsx` state anchor

기존 실제 주변 줄:

```jsx
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState(null) // 설정 모달 초기 탭
  const [showImport, setShowImport] = useState(false)
  // SRT 가져오기 충돌 모달: 기존 scenes/srtTrack 있을 때 사용자에게 대체/병합/취소 묻는 상태.
```

`showImport` 바로 다음에 character-exact `agentPanelOpen` state 줄을 추가했다.

### `App.jsx` ChatPanel mount anchor

기존 실제 주변 줄:

```jsx
      <ApprovalDialog />
      <ChatPanel
        projectKey={`${settings.saveMode}:${workFolder ?? ''}:${settings.projectName ?? ''}`}
        videoAdmissionSources={videoAdmissionSources}
```

전역 sibling인 동일 `<ChatPanel>` 하나에 `open`, `onOpen`, `onDismiss`를 추가했다.

### `ChatPanel.appMount.test.js` source/panel anchors

첫 테스트의 기존 실제 주변 줄:

```js
    const source = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8')
    const appRoot = source.indexOf('<div className={computeAppClass(mode)}>')
    const panel = source.indexOf('<ChatPanel', appRoot)
    const generateBranch = source.indexOf("{activeView === 'generate' && (", appRoot)
```

기존 `source`와 숫자 offset `panel`을 그대로 사용해 첫 테스트 끝에서 `panelProps`를 slice했다.

## RED evidence

Command:

```bash
npx vitest run tests/components/agent/ChatPanel.test.jsx
```

Result:

- Exit code: 1
- Test files: 1 failed
- Tests: 1 failed, 33 passed
- 새 lifecycle test가 첫 visibility assertion에서 실패했다.

```text
Expected the element to have class:
  is-dismissed
Received:
  agent-chat-panel
```

brief는 다음 assertion의 `Open agent` button-not-found 메시지를 예상했지만, 제공된 exact test는 `is-dismissed` class를 먼저 검사하므로 그 한 assertion 앞에서 멈췄다. 실패 원인은 요구된 visibility/FAB 기능이 아직 없었기 때문이다.

## GREEN verification

### ChatPanel lifecycle/component suite

```bash
npx vitest run tests/components/agent/ChatPanel.test.jsx
```

- 1 file passed
- 34/34 tests passed

### App mount/source wiring guard

```bash
npx vitest run tests/components/agent/ChatPanel.appMount.test.js
```

- 1 file passed
- 3/3 tests passed

### Agent i18n chrome guard

```bash
npx vitest run tests/components/agent/agentI18n.test.jsx
```

- 1 file passed
- 6/6 tests passed

### Fresh combined verification before commit attempt

```bash
npx vitest run tests/components/agent/ChatPanel.test.jsx tests/components/agent/ChatPanel.appMount.test.js tests/components/agent/agentI18n.test.jsx
```

- 3 files passed
- 43/43 tests passed
- Exit code: 0

## SVG import verification

`import robotUrl from '../../assets/Robot.svg'`가 포함된 상태에서 ChatPanel vitest가 transform/import 단계와 전체 34개 테스트를 통과했다. Vite/Vitest가 SVG asset import를 clean하게 resolve했으며 별도 mock이나 우회는 추가하지 않았다.

## Commit

Commit hash: none

Attempted exact staging command:

```bash
git add src/assets/Robot.svg src/components/agent/ChatPanel.jsx src/components/agent/ChatPanel.css src/App.jsx tests/components/agent/ChatPanel.test.jsx tests/components/agent/ChatPanel.appMount.test.js
```

Error:

```text
fatal: Unable to create '/Users/tuxxon/workspace/AutoFlowCut/.git/index.lock': Operation not permitted
```

따라서 `git commit -m "feat(agent): add persistent Robot FAB dismiss flow"`는 실행할 수 없었고 task 변경은 uncommitted로 남아 있다.

## Concerns

1. Sandbox 권한 때문에 stage/commit이 불가능하다. Controller가 위 6개 task file만 stage하고 지정 메시지로 commit해야 한다.
2. RED 메시지는 brief가 적은 FAB query가 아니라 그보다 먼저 실행되는 `is-dismissed` class assertion에서 발생했다. exact test 순서를 변경하지 않았으며 구현 후 lifecycle 전체가 GREEN이다.
