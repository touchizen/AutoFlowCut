# Task 5 Report: ChatPanel model submit snapshot

## Status

**BLOCKED at commit only.** Implementation and required tests are complete, but the sandbox denies writes under `.git`, so no Task 5 commit could be created.

## Files changed

- `src/components/agent/ChatPanel.jsx`
  - Loads the model catalog on mount with rejection/invalid-result fallback to `[]`.
  - Renders `AgentModelSelector` with Task 4 locale labels.
  - Snapshots `{ text, model }` before awaiting session open.
  - Passes model to session open and send only when selected.
  - Blocks Send while running without blocking model selection or Steer.
- `src/components/agent/ChatPanel.css`
  - Adds the required header/selector flex shrink rules.
- `tests/components/agent/ChatPanel.test.jsx`
  - Adds `agentListModels` to the full API double and the four model timing/control contract tests.
- `tests/components/agent/agentI18n.test.jsx`
  - Adds `agentListModels` to the locale test API double.

No panel visibility, FAB, or mode-toggle code was changed.

## Drifted anchor locations

I opened the current `ChatPanel.jsx` and matched every hunk semantically rather than applying line numbers blindly:

1. Import anchor, original lines 8-10:

   ```jsx
   import { useOptionalI18n } from '../../hooks/useI18n'
   import en from '../../locales/en'
   import './ChatPanel.css'
   ```

   `AgentModelSelector` was inserted between the locale and CSS imports.

2. State anchor, original lines 138-142:

   ```jsx
   const [usage, setUsage] = useState(null)
   const [errors, setErrors] = useState([])
   const [running, setRunning] = useState(false)
   const sessionOpenRef = useRef(false)
   ```

   The model list/loading/selection state was inserted after `running`.

3. `ensureSession` anchor, original lines 304-310:

   ```jsx
   const ensureSession = useCallback(async () => {
     await projectSettleRef.current
     if (sessionOpenRef.current) return true
     if (!openPromiseRef.current) {
       const openingEpoch = sessionEpochRef.current
       let trackedOpen
       trackedOpen = Promise.resolve(api.agentSessionOpen())
   ```

   It now accepts `model` and opens with `model ? { model } : {}`.

4. `send` anchor, original lines 334-346:

   ```jsx
   const send = async (event) => {
     event.preventDefault()
     const text = input.trim()
     if (!text) return
     // ...
     setInput('')
     if (!(await ensureSession())) return
     setRunning(true)
     try {
       const result = await api.agentSend({ text })
   ```

   This became a submit-time `{ text, model }` snapshot before any await, followed by the `running` guard, `setRunning(true)`, `ensureSession(snapshot.model)`, and conditional model omission in `agentSend`.

5. Header anchor, original lines 401-406:

   ```jsx
   <div
     className={`agent-chat-header ${collapsed ? 'is-draggable' : ''}`}
     onPointerDown={onPointerDown}
   >
     <strong>{t('agent.title')}</strong>
     <div className="agent-chat-header-actions">
   ```

   The title was wrapped in `.agent-chat-heading` with `AgentModelSelector`; the existing header actions were left intact.

6. Send anchor, original lines 465-467:

   ```jsx
   <div className="agent-chat-actions">
     <button type="submit" disabled={!input.trim()}>{t('agent.send')}</button>
     <button type="button" onClick={steer} disabled={!running || !input.trim()}>{t('agent.steer')}</button>
   ```

   Only Send gained `running ||`; Steer's enablement and model-free payload were preserved.

7. CSS anchor, original lines 18-20:

   ```css
   .agent-chat-panel.is-collapsed { width: 190px; }
   .agent-chat-header { display: flex; align-items: center; justify-content: space-between; padding: 11px 13px; border-bottom: 1px solid var(--border, #3a3a42); }
   .agent-chat-header-actions, .agent-chat-actions { display: flex; align-items: center; gap: 6px; }
   ```

   The three required `.agent-chat-heading` rules were inserted between the header and action rules.

## TDD evidence

### RED

Command:

```text
cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/components/agent/ChatPanel.test.jsx
```

Observed before production changes:

```text
Test Files  1 failed (1)
Tests       4 failed | 26 passed (30)
```

The new tests alone failed. Three reported `agentListModels` was called 0 times; the running-control test reported `Unable to find an accessible element with the role "combobox" and name "Agent model"`. This is the expected missing model-loading/selector behavior.

### GREEN

Fresh final verification:

```text
tests/components/agent/ChatPanel.test.jsx
Test Files  1 passed (1)
Tests       30 passed (30)
```

```text
tests/components/agent/agentI18n.test.jsx
Test Files  1 passed (1)
Tests       6 passed (6)
```

Both commands exited with code 0. `git diff --check` also produced no errors. A read-only code review found no Critical, Important, or Minor issues.

## Commit

- Requested message: `feat(agent): snapshot model at submit`
- Commit hash: **not created**
- Current unchanged HEAD: `7dc401685e576a4a22091225fc9caa7f3a597fc7`
- Failure:

  ```text
  fatal: Unable to create '/Users/tuxxon/workspace/AutoFlowCut/.git/index.lock': Operation not permitted
  ```

The failed `git add` left all four changes unstaged. No partial commit was created.

## Concerns

- Functional concerns: none found by tests, diff review, or read-only code review.
- Process blocker: the environment exposes `.git` read-only and approval escalation is unavailable. A caller with Git write access must stage exactly the four listed files and create the requested commit.
- This report path already contained an unrelated older Task 5 report; it was replaced because the current brief explicitly requires the full report at this exact path. The report itself is not part of the requested four-file commit.
