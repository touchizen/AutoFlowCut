# Task 9 Report: Agent icon actions with portal tooltips

## Status

DONE

## Files changed and committed

- `src/components/agent/AgentIconButton.jsx`
  - Added the exact `tooltipPosition` pure function.
  - Added `PortalTooltip`, rendered with `createPortal(..., document.body)`.
  - Added `AgentIconButton`, preserving accessible names through `aria-label` and mapping `pressed`/`disabled` to the native button.
- `src/components/agent/ChatPanel.jsx`
  - Imported `AgentIconButton`.
  - Added the exact `AgentControlIcon` SVG path switch.
  - Converted the two header controls and four action-bar controls to icon buttons.
  - Kept the Flow notice span and Robot FAB unchanged.
- `src/components/agent/ChatPanel.css`
  - Added the exact square icon-button and portal-tooltip styles.
  - Replaced the old text submit selector with `.agent-icon-button.is-primary`.
  - Retained the existing Task 3 button selector, Task 7 FAB styles, and Task 8 mode/Flow styles.
- `tests/components/agent/AgentIconButton.test.jsx`
  - Added the exact three component/pure-function tests from the brief.
- `tests/components/agent/ChatPanel.test.jsx`
  - Added `fireEvent` to the Testing Library import.
  - Added the exact accessible-name/icon/body-portal integration test.

This report file is an ignored SDD artifact and was not included in the five-file Task 9 commit.

## Drifted anchors located

The brief line numbers had drifted, so anchors were located by class and surrounding JSX/CSS instead.

### Header mode toggle and Flow notice

Located with `rg -n -C 8 "agent-chat-mode-toggle|agent-chat-flow-notice" src/components/agent/ChatPanel.jsx`.

Surrounding pre-change lines:

```jsx
{appMode === 'flow' && (
  <span className="agent-chat-flow-notice">{t('agent.flowFloatingOnly')}</span>
)}
<button
  type="button"
  className="agent-chat-mode-toggle"
  aria-label={t('agent.modeToggle')}
  aria-pressed={effectiveMode === 'slide'}
```

This confirmed the Flow notice had to remain and the mode button had to preserve `aria-pressed`, Flow disabled state, and its click behavior.

### Header dismiss button

Located with `rg -n -C 8 "agent-chat-dismiss" src/components/agent/ChatPanel.jsx`.

Surrounding pre-change lines:

```jsx
</button>
<button
  type="button"
  className="agent-chat-dismiss"
  aria-label={t('agent.dismissPanel')}
  title={t('agent.dismissPanel')}
  onClick={onDismiss}
>
```

This confirmed the dismiss lifecycle handler was `onDismiss`, not the session-closing `close` handler.

### Four action-bar buttons

Located with `rg -n -C 8 "agent-chat-actions" src/components/agent/ChatPanel.jsx`.

Surrounding pre-change lines:

```jsx
<form className="agent-chat-compose" onSubmit={send}>
  <textarea
    aria-label={t('agent.inputLabel')}
    value={input}
    onChange={(event) => setInput(event.target.value)}
    placeholder={t('agent.placeholder')}
    rows={2}
  />
  <div className="agent-chat-actions">
    <button type="submit" disabled={running || !input.trim()}>{t('agent.send')}</button>
    <button type="button" onClick={steer} disabled={!running || !input.trim()}>{t('agent.steer')}</button>
    <button type="button" onClick={abort} disabled={!running}>{t('agent.stop')}</button>
    <button type="button" onClick={close} disabled={!sessionOpenRef.current}>{t('agent.closeSession')}</button>
```

This confirmed the exact submit type, handlers, and disabled conditions to preserve.

### CSS submit selector and retained selectors

Located with `rg -n -C 6 "agent-chat-compose|agent-chat-actions|agent-chat-fab|button\\[type='submit'\\]" src/components/agent/ChatPanel.css`.

Surrounding pre-change lines:

```css
.agent-chat-header button, .agent-chat-actions button { border: 1px solid var(--border, #3a3a42); border-radius: 7px; padding: 5px 9px; color: inherit; background: transparent; cursor: pointer; }
.agent-chat-actions button[type='submit'] { color: #fff; background: var(--accent, #4c8dff); border-color: transparent; }
.agent-chat-header button:disabled, .agent-chat-actions button:disabled { cursor: default; opacity: 0.42; }
```

Only the text-submit selector was removed; the surrounding inherited button and disabled selectors were retained. The exact new icon/portal block was appended after the existing model styles.

### ChatPanel test integration point

Located in the first command behavior describe:

```jsx
describe('ChatPanel — 명령과 event의 사용자 효과', () => {
  it('send를 sessionManager IPC까지 보내고 delta/tool/usage/limit를 모두 화면에 남긴다', async () => {
```

The new integration test was added inside this describe, and the top import was updated from:

```jsx
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
```

to the brief-specified import including `fireEvent`.

## Six buttons converted

1. `Slide panel mode` — header mode toggle, `AgentControlIcon name="mode"`.
2. `Dismiss agent` — header dismiss, `AgentControlIcon name="dismiss"`.
3. `Send` — submit action, `AgentControlIcon name="send"`, primary style.
4. `Steer` — action, `AgentControlIcon name="steer"`.
5. `Stop` — action, `AgentControlIcon name="stop"`.
6. `Close session` — action, `AgentControlIcon name="close"`.

The `Open agent` Robot FAB was intentionally untouched.

## RED evidence

Command:

```text
npx vitest run tests/components/agent/AgentIconButton.test.jsx
```

Result: exit code 1, expected missing-component failure:

```text
FAIL  tests/components/agent/AgentIconButton.test.jsx
Error: Failed to resolve import "../../../src/components/agent/AgentIconButton.jsx"
Test Files  1 failed (1)
Tests  no tests
```

This failed for the required reason before any production implementation existed.

## GREEN verification

- `npx vitest run tests/components/agent/AgentIconButton.test.jsx`
  - PASS: 1 test file, 3 tests passed.
  - Covers accessible icon-only name, `document.body` portal, edge clamp (`left: 816px`, `top: 42px`, `bottom`), and pure positioning results.
- `npx vitest run tests/components/agent/ChatPanel.test.jsx`
  - PASS: 1 test file, 36 tests passed.
  - Existing action/mode/dismiss behavior and the new icon/portal integration all passed.
- `npx vitest run tests/components/agent/ApprovalDialog.stacking.test.js`
  - PASS: 1 test file, 1 test passed.
  - Tooltip z-index `4000` remains below approval z-index `2147483000`.

`git diff --cached --check` also completed with no errors before commit.

## Accessible-name preservation

Confirmed all six converted controls preserve the exact existing accessible names:

- `label={t('agent.send')}` → `aria-label="Send"`
- `label={t('agent.steer')}` → `aria-label="Steer"`
- `label={t('agent.stop')}` → `aria-label="Stop"`
- `label={t('agent.closeSession')}` → `aria-label="Close session"`
- `label={t('agent.modeToggle')}` → `aria-label="Slide panel mode"`
- `label={t('agent.dismissPanel')}` → `aria-label="Dismiss agent"`

All icons use `aria-hidden="true"` and `focusable="false"`, so they do not alter the accessible name. The full ChatPanel suite passed the existing `getByRole('button', { name: ... })` queries. The mode toggle also passes `pressed={effectiveMode === 'slide'}` and `disabled={appMode === 'flow'}` through `AgentIconButton`, preserving Task 8's `aria-pressed` and disabled assertions.

## Commit

- Branch: `feature/inapp-agent`
- Hash: `6079ab767bd91243895efe64350e7a679bdce6cd`
- Message: `feat(agent): add icon actions with portal tooltips`
- Commit contents: exactly the five requested production/test files.
- Not pushed.

## Concerns

- None.
- The controller-owned Final Verification, full suite/build, and live Electron smoke gate were intentionally not run, per the brief.
