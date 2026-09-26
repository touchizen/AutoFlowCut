# Composer Redesign — Slice 1: portal-ize the model selector dropdown

Goal: the AgentModelSelector listbox must render to `document.body` (portal) so it is NOT clipped by the panel's `.agent-chat-panel { overflow: hidden }`. Currently the last row ("Claude — 구현 예정") is cut off (final-review finding I-1). Position it edge-aware relative to the combobox.

## File
- Modify: src/components/agent/AgentModelSelector.jsx
- Modify: tests/components/agent/AgentModelSelector.test.jsx (add portal tests; keep the 6 existing green)

## Requirements
1. Render the `role="listbox"` (and its option rows / provider headers) through `createPortal(..., document.body)` instead of inline inside the `.agent-model-selector` root.
2. Position the portaled listbox relative to the combobox trigger via `getBoundingClientRect()`:
   - Align its left edge to the combobox left; width = max(combobox width, 220px).
   - Open BELOW the combobox by default (top = comboRect.bottom + 6). If it would overflow the viewport bottom, flip ABOVE (bottom-anchored). Clamp horizontally into the viewport (8px edges).
   - Recompute on scroll (capture) + resize while open; use position:fixed on the portal listbox.
3. Preserve EVERY existing behavior and its tests:
   - role=combobox with aria-expanded/aria-controls/aria-activedescendant/aria-haspopup; role=listbox with the same id (`agent-model-listbox`) and aria-label; role=option with aria-selected; disabled Claude option aria-disabled; keyboard Arrow/Enter/Escape; disabled-skip; focus return to combobox on select/Escape.
   - The listbox id must remain `${id}-listbox` (default `agent-model-listbox`) so `aria-controls` still matches.
4. CRITICAL — outside-click: the existing handler closes when a pointerdown lands outside `rootRef`. With the listbox portaled to body it is NO LONGER inside rootRef, so a click on an option would be misread as "outside" and close before selecting. Add a `listboxRef` on the portaled listbox and close only when the pointerdown target is outside BOTH `rootRef` (the combobox) AND `listboxRef` (the portaled listbox). Verify option-click still selects (the existing "option click은 값을 반영" test must stay green).
5. Keep the disabled Claude "coming soon" row as the last option — it must now be fully visible (that's the whole point).

## Tests to add (jsdom)
- listbox renders to document.body: after opening, `screen.getByRole('listbox').parentElement` (or closest portal container) is `document.body`, NOT inside the `.agent-model-selector` root (`container.querySelector('.agent-model-selector').contains(listbox) === false`).
- the Claude "coming soon" option is present in the portaled listbox and has aria-disabled true (it must not be clipped/absent).
- outside-click still closes (click a sibling button outside), AND option-click still selects (guards the listboxRef fix — mutation: if outside-click ignores listboxRef, option-click would close-without-select).

## TDD + verification
- Write/adjust tests RED → implement → GREEN. All prior 6 tests + new ones pass.
- Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/components/agent/AgentModelSelector.test.jsx`
- Also run ChatPanel.test.jsx + agentI18n.test.jsx to ensure the header-embedded selector still works.
- Commit: `git commit -m "fix(agent): portal-ize model dropdown so it is not clipped by panel overflow"`
