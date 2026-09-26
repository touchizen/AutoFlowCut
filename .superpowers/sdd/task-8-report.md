# Task 8 Report — Flow-safe floating/slide agent panel

## Status

DONE

## Commit

`b7dfbca` — `feat(agent): add Flow-safe floating and slide modes`

Commit contains only the eight brief-listed implementation/test files.

## Files changed

1. `src/components/agent/agentPanelLayout.js` — added pure mode normalization, Flow-safe effective-mode derivation, container-local drag clamp, and floating panel geometry helpers.
2. `src/components/agent/ChatPanel.jsx` — removed collapse state/UI, added effective floating/slide mode, Flow notice/mode toggle, and open-floating container-clamped drag.
3. `src/components/agent/ChatPanel.css` — replaced viewport-sized/collapse layout with container-sized floating/slide/flex-scroll rules while preserving FAB, model selector, heading, and remaining chat styling.
4. `src/App.jsx` — wired `mode`, stored `settings.agentPanelMode`, and `updateSetting` callback into the global `ChatPanel`.
5. `tests/components/agent/agentPanelLayout.test.js` — added the exact four pure-helper tests.
6. `tests/components/agent/ChatPanel.test.jsx` — removed the two collapse-era describes and added the exact effective-mode and open-floating drag describes.
7. `tests/components/agent/ChatPanel.appMount.test.js` — added the three exact App source-wiring assertions.
8. `tests/components/AppFlowSplitLayout.test.jsx` — added four-way narrow App geometry and production CSS invariants.

## Drifted anchors and removed collapse code

Line numbers were ignored and every target was located by code/content:

- `ChatPanel.jsx`: found `ChevronIcon({ collapsed })`, module-level `const clamp`, `useCollapsedDrag(enabled)`, `const [collapsed, setCollapsed]`, the `agent-chat-collapse` header button, and the `{!collapsed && (...)}` body wrapper.
- `ChatPanel.test.jsx`: found the describe querying `screen.getByRole('button', { name: 'Collapse' })` / `Expand`, and the describe dispatching pointer events after collapsing the header.
- `ChatPanel.css`: found the base `.agent-chat-panel` rules containing `100vw`/`100vh`, plus `.agent-chat-panel.is-collapsed` and `.agent-chat-collapse`.
- `App.jsx`: found the one global `<ChatPanel>` immediately after `<ApprovalDialog />`, before the generate/story branches.
- `ChatPanel.appMount.test.js`: found the existing `panelProps` block containing open/FAB dismiss wiring assertions.
- `AppFlowSplitLayout.test.jsx`: found the production helper import and confirmed `computeAppClass`, `isHorizontalSplit`, and `splitAppStyle` are exported by `src/utils/appLayout`.

Removed test blocks:

> `describe('ChatPanel — 접기/펼치기 아이콘 버튼', () => {`

> `describe('ChatPanel — 접었을 때 드래그로 옮기기', () => {`

Removed production collapse code included:

> `function ChevronIcon({ collapsed })`

> `function useCollapsedDrag(enabled)`

> `const [collapsed, setCollapsed] = useState(false)`

> `className="agent-chat-collapse"`

> `{!collapsed && (`

Self-review grep confirmed no `collapsed`, `Collapse`, `Expand`, `Chevron`, `useCollapsedDrag`, `agent-chat-collapse`, `agent-chat-chevron`, or `is-collapsed` remains in the modified ChatPanel source/CSS/test.

## TDD RED evidence

1. `npx vitest run tests/components/agent/agentPanelLayout.test.js`
   - Failed as required before production helper creation.
   - Error: `Failed to resolve import "../../../src/components/agent/agentPanelLayout.js"`.
   - Result: 1 failed file, 0 tests collected.
2. `npx vitest run tests/components/agent/ChatPanel.test.jsx`
   - Failed as required before ChatPanel implementation.
   - Primary expected error: `Unable to find an accessible element with the role "button" and name "Slide panel mode"`.
   - Container drag also failed with expected empty `panel.style.left`.
   - Result: 3 failed, 29 passed.

## GREEN verification

Individual runs:

- `tests/components/agent/agentPanelLayout.test.js`: 4/4 passed.
- `tests/components/agent/ChatPanel.test.jsx`: 32/32 passed.
- `tests/components/agent/ChatPanel.appMount.test.js`: 3/3 passed.
- `tests/components/AppFlowSplitLayout.test.jsx`: 26/26 passed.

Fresh combined related run:

```text
Test Files  4 passed (4)
Tests       65 passed (65)
```

`git diff --check` and staged `git diff --cached --check` also completed without errors before commit.

## CSS and preservation checks

- Base panel rule contains exactly:
  - `width: min(420px, calc(100% - 36px))`
  - `max-height: min(640px, calc(100% - 36px))`
- No `100vw` or `100vh` remains in `ChatPanel.css`; the production CSS invariant test passed.
- Task 7 FAB selectors survived: `.agent-chat-fab`, hover, focus, hidden, and image rules.
- Task 3 model selector selectors survived: `.agent-model-selector`, `.agent-model-combobox`, `.agent-model-listbox`, provider/option/badge rules.
- Task 5 heading selectors survived: `.agent-chat-heading`, strong, and nested model selector rules.
- Task 5 model/snapshot/running behavior and Task 7 dismiss/FAB tests remained GREEN.

## Concerns

None.
