# ChatPanel focus transition fix report

## Change

- Added refs for the persistent Robot FAB and message textarea.
- Added an `[open]` effect that compares `open` with `prevOpenRef`.
- On false→true, focus moves to the message textarea.
- On true→false, focus moves to the Robot FAB.
- Initial render does not move focus because equal initial/current values are ignored.
- Added two lifecycle regression tests using the existing stateful `VisibilityHarness` pattern.

## RED evidence

Command:

`npx vitest run tests/components/agent/ChatPanel.test.jsx`

Before the implementation, the suite reported 2 failures and 36 passes:

- Open focus test: expected the message textarea, but `document.activeElement` remained the hidden FAB.
- Dismiss focus test: expected the FAB, but `document.activeElement` remained the hidden dismiss button.

## GREEN summary

The same full command passed after the implementation:

- Test files: 1 passed
- Tests: 38 passed

## Preservation test

`npx vitest run tests/components/agent/ChatPanel.test.jsx -t "dismiss/FAB 왕복"`

- 1 passed, 37 skipped.
- The panel/bridge/session preservation behavior still passes.

## Commit

`2bf5daa` — `fix(agent): move focus on panel open/dismiss for keyboard users`

## Concerns

None.
