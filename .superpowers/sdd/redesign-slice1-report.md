# Composer Redesign Slice 1 Report

## What changed

- `AgentModelSelector` now renders `agent-model-listbox` with `createPortal(..., document.body)`, outside the panel's `overflow: hidden` clipping boundary.
- Added `listboxPosition()` and `useLayoutEffect` measurement:
  - left-aligns to the combobox;
  - uses `max(combobox width, 220px)`;
  - opens 6px below by default;
  - flips above when the listbox would overflow the viewport bottom;
  - clamps to 8px viewport edges;
  - uses `position: fixed` and portal-level `z-index: 4000`;
  - recomputes on capture-phase scroll and resize while open.
- Preserved the listbox id, ARIA contract, option structure, keyboard behavior, disabled-Claude skip, selection behavior, and focus return.
- Stopped pointerdown propagation from the portaled listbox so React portal event bubbling cannot accidentally initiate `ChatPanel` dragging.

## Outside-click `listboxRef` fix

The previous document `pointerdown` handler only checked `rootRef`. After portal rendering, option rows are no longer DOM descendants of that root, so their pointerdown would be classified as outside.

The selector now owns `listboxRef` and closes only when the pointerdown target is outside both:

- the combobox/root (`rootRef`), and
- the portaled listbox (`listboxRef`).

This lets option clicks reach their click handler and call `onChange`, while a pointerdown on an unrelated sibling still closes the listbox.

## RED evidence

Command:

```text
npx vitest run tests/components/agent/AgentModelSelector.test.jsx
```

Pre-implementation result:

```text
Test Files  1 failed (1)
Tests       4 failed | 6 passed (10)
```

The four new tests failed for the expected missing behavior: the listbox remained inline, had no fixed viewport position, and did not recompute on scroll/resize. All six pre-existing tests passed during RED.

## GREEN verification

`AgentModelSelector`:

```text
Test Files  1 passed (1)
Tests       10 passed (10)
```

`ChatPanel` + `agentI18n`:

```text
Test Files  2 passed (2)
Tests       44 passed (44)
```

An intermediate integration run exposed one `ChatPanel` drag regression caused by React portal event bubbling. Adding listbox-level pointerdown propagation control fixed it without changing `ChatPanel.jsx`; the fresh rerun above is green.

`git diff --check` also completed with exit code 0.

## Commit

`4ab8e26` — `fix(agent): portal-ize model dropdown so it is not clipped by panel overflow`

## Concerns

None. The report is intentionally ignored by git, and the requested commit is limited to `AgentModelSelector.jsx` and `AgentModelSelector.test.jsx`.
