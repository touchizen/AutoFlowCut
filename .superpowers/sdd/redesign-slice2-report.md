# Composer Redesign Slice 2 Report

## Status

DONE

## What changed

### Header

- Removed `AgentModelSelector` from `.agent-chat-heading`.
- Kept the running and Flow-mode notices beside the title on the left.
- Reordered `.agent-chat-header-actions` to:
  1. Slide/floating mode toggle
  2. Close session
  3. Dismiss agent
- Preserved the existing Close-session handler and disabled condition.

### Composer

- Replaced the old textarea-plus-four-button row with a two-row composer:
  - Full-width textarea on the first row.
  - `.agent-chat-toolbar` on the second row.
- Moved `AgentModelSelector` to the toolbar's left side without changing any props or selected-model state.
- Added `.agent-chat-toolbar-actions` on the right with Steer followed by one state-dependent primary button.
- Preserved `send()`, model snapshotting, Steer, abort, session lifecycle, focus, dismiss/FAB, panel mode, and drag behavior.

### Send/Stop merge

- Idle renders only `Send`:
  - `type="submit"`
  - `className="is-primary"`
  - disabled only when the trimmed input is empty
- Running renders only `Stop`:
  - `className="is-primary is-stop"`
  - enabled
  - calls the existing `abort()` handler
- Removed the separate always-rendered Stop button.

### CSS

- Restyled `.agent-chat-compose` as a dark rounded container with a subtle border, background, padding, and focus-within accent.
- Made the textarea borderless and transparent inside the composer.
- Added flex toolbar layout with the model selector constrained to 120–180px.
- Kept Steer and primary controls aligned on the toolbar's right.
- Preserved the blue Send primary treatment and added an error-theme red Stop primary treatment.
- Removed the old `.agent-chat-actions` and two-column composer rules.

## Test changes

- Added a regression test proving the single primary control:
  - Idle `Send` submits through `agentSend`.
  - Running removes `Send`, exposes enabled `Stop`, and clicking it calls `agentAbort`.
- Updated the running-state test:
  - Replaced the old “Send remains disabled while running” assertion.
  - Now asserts enabled `Stop`, absent `Send`, and unchanged model-free Steer behavior.
- Updated the icon/layout test:
  - Confirms `Close session` is inside the header.
  - Confirms the `Agent model` combobox is inside the composer toolbar.
  - Confirms idle has no separate `Stop`.
  - Keeps icon-only accessible-name and portaled tooltip coverage.
- Left model snapshot, dismiss preservation, focus handoff, effective mode, and drag tests unchanged.

## RED evidence

Command:

```sh
cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/components/agent/ChatPanel.test.jsx
```

Before implementation:

- Test files: 1 failed
- Tests: 3 failed, 36 passed
- Expected failures:
  - Idle still rendered the old separate Stop button.
  - Close session was not in the header.
  - Running still rendered the disabled Send button.

## GREEN verification

Command:

```sh
cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/components/agent/ChatPanel.test.jsx tests/components/agent/agentI18n.test.jsx tests/components/agent/ChatPanel.appMount.test.js tests/components/agent/AgentModelSelector.test.jsx
```

Result:

- `tests/components/agent/ChatPanel.test.jsx`: PASS
- `tests/components/agent/agentI18n.test.jsx`: PASS
- `tests/components/agent/ChatPanel.appMount.test.js`: PASS
- `tests/components/agent/AgentModelSelector.test.jsx`: PASS
- Aggregate: 4 files passed, 58 tests passed
- `git diff --check`: PASS

## Accessibility confirmation

Preserved accessible names:

- `Send` while idle
- `Stop` while running
- `Steer`
- `Close session`
- `Slide panel mode`
- `Dismiss agent`
- `Open agent`
- Combobox `Agent model`

## Commit

- Commit: `d2220ee`
- Message: `feat(agent): reference-style bottom-toolbar composer with merged send/stop`
- Committed files only:
  - `src/components/agent/ChatPanel.jsx`
  - `src/components/agent/ChatPanel.css`
  - `tests/components/agent/ChatPanel.test.jsx`

## Concerns

None.
