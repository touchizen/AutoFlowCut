# Virtualization Adversarial Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the reviewed virtualization lifecycle, reconciliation, measurement, auto-scroll, and timeline ruler defects while preserving bounded rendering and Phase 3 behavior.

**Architecture:** Keep the existing TanStack virtualizers and make their surrounding DOM and measurement inputs stable. SceneList and ResultsTable share one explicit generating-transition policy. TimeRuler filters which absolute-axis ticks mount, without changing their time-zero coordinate system.

**Tech Stack:** React 19, `@tanstack/react-virtual`, Vitest 4, Testing Library, jsdom.

---

### Task 1: SceneList header lifecycle and generating imports

**Files:**
- Modify: `tests/components/SceneList.virtualization.test.jsx`
- Modify: `src/components/SceneList.jsx:417-482`

**Step 1: Write the failing empty-import test**

Mount `<SceneList scenes={[]} />`, rerender it with 500 scenes whose index 350 has `status: 'generating'`, then assert the wrapper scrolls and row 350 mounts. Track controlled ResizeObserver instances so a clear/re-import test can also assert that the detached header observer disconnects and the new header is observed and remeasured.

**Step 2: Run the focused test and verify RED**

Run: `npm run test:run -- tests/components/SceneList.virtualization.test.jsx`

Expected: the empty-import test times out with `wrapper.scrollTop === 0`, proving the mount-only header effect never measured the recreated table.

**Step 3: Implement the minimal lifecycle and M3 policy fix**

Make the header layout effect depend on the empty/non-empty transition so cleanup runs when the table disappears and measurement/observation runs when it reappears. Change the generating predicate to:

```js
scene.status === 'generating' && (
  !previousStatuses
  || !previousStatuses.has(scene.id)
  || previousStatuses.get(scene.id) !== 'generating'
)
```

Add a comment explaining that unseen generating ids intentionally count as transitions so imports and inserts auto-scroll.

**Step 4: Run the focused test and verify GREEN**

Run: `npm run test:run -- tests/components/SceneList.virtualization.test.jsx`

Expected: all SceneList virtualization tests pass with bounded row assertions unchanged.

### Task 2: ResultsTable stable threshold reconciliation

**Files:**
- Modify: `tests/components/ResultsTable.virtualization.test.jsx`
- Modify: `src/components/ResultsTable.jsx:20-244`
- Modify: `src/components/ResultsTable.jsx:560-700`
- Modify: `src/App.css:1800-1830`

**Step 1: Write four failing focus tests**

For table layout, focus the first prompt input with `onPromptEdit` supplied and verify the same input node stays focused across 201→200 and 200→201. For grid layout, enable `selectable`, focus the first `.card-check`, and verify the same checkbox node stays focused across both directions.

Keep the existing 200-item cardinality assertions, changing their selectors to count content rows/cards while additionally requiring two zero-height spacer elements.

**Step 2: Run the focused tests and verify RED**

Run: `npm run test:run -- tests/components/ResultsTable.virtualization.test.jsx`

Expected: all four tests fail because the Fragment/array and wrapped/bare child shapes replace focused DOM nodes.

**Step 3: Implement stable table and grid shapes**

Always render table spacer rows and give them zero height below the threshold. Measure grid width for both modes, derive `itemsPerRow` for both modes, and always render cards inside the same keyed `.results-grid-row` wrappers. Above the threshold render virtual row indexes; below it render every row index. Always render grid spacers, with zero height below the threshold. Use a row-layout CSS class that retains the existing 10px padding and row gaps.

Hoist a shared immutable empty virtual-items array and use it for inactive table/grid collections so `mountedItemKeys` dependencies stay stable.

**Step 4: Run the focused tests and verify GREEN**

Run: `npm run test:run -- tests/components/ResultsTable.virtualization.test.jsx`

Expected: all ResultsTable tests pass, focused nodes retain identity, and large windows remain bounded and non-empty.

### Task 3: ResultsTable border-box measurement

**Files:**
- Modify: `tests/components/ResultsTable.virtualization.test.jsx`
- Modify: `src/components/ResultsTable.jsx:156-176`

**Step 1: Write the failing mixed-box test**

Set `getBoundingClientRect().width` to 860 while the ResizeObserver entry reports `contentRect.width` as 840. Capture a card node before notification, deliver the observer entry, then assert the first row still has five cards and the card node is unchanged.

**Step 2: Run the focused test and verify RED**

Run: `npm run test:run -- tests/components/ResultsTable.virtualization.test.jsx`

Expected: the row changes from five columns to four and the card node is replaced.

**Step 3: Use one width source**

In both the initial measurement and observer callback, read `element.getBoundingClientRect().width || element.offsetWidth`. Ignore `contentRect` so `getGridColumnCount` always receives a border-box width and subtracts horizontal padding once.

**Step 4: Run the focused test and verify GREEN**

Run: `npm run test:run -- tests/components/ResultsTable.virtualization.test.jsx`

Expected: the five-column layout and card identity remain stable after the observer delivery.

### Task 4: TimeRuler bounded ticks on the shared time axis

**Files:**
- Create: `tests/components/AudioTimeline/TimeRuler.virtualization.test.jsx`
- Modify: `src/components/AudioTimeline/TimeRuler.jsx`
- Modify: `src/components/AudioTimeline/AudioTimeline.jsx:1207-1212`

**Step 1: Write failing bounded-window and alignment tests**

Render a 3.5-hour ruler at high zoom with a scrolled visible range. Assert tick count is greater than zero and less than 100. Render a TrackLane clip beginning at a major tick time T using the same `pxPerMs`; assert the tick and clip inline `left` values both equal `T * pxPerMs`.

**Step 2: Run the focused test and verify RED**

Run: `npm run test:run -- tests/components/AudioTimeline/TimeRuler.virtualization.test.jsx`

Expected: the bounded-window assertion fails because all ~12,600 ticks mount.

**Step 3: Filter tick indexes, not coordinates**

Accept `visibleRangeMs` in TimeRuler. When the total major-tick count exceeds 200, calculate the first and last aligned tick seconds intersecting the visible range plus 10 seconds on each side. Continue setting every tick's `left` to `sec * 1000 * pxPerMs`. Pass AudioTimeline's existing `visibleRangeMs` prop into TimeRuler.

**Step 4: Run focused timeline tests and verify GREEN**

Run: `npm run test:run -- tests/components/AudioTimeline/TimeRuler.virtualization.test.jsx tests/components/AudioTimeline/AudioTimeline.test.jsx tests/components/AudioTimeline/TrackLane.virtualization.test.jsx`

Expected: bounded tick and exact axis-alignment assertions pass, along with existing timeline tests.

### Task 5: Integrated verification and commit

**Files:**
- Verify all modified source, tests, CSS, and plan files.

**Step 1: Run all focused regression files**

Run: `npm run test:run -- tests/components/SceneList.virtualization.test.jsx tests/components/ResultsTable.virtualization.test.jsx tests/components/AudioTimeline/TimeRuler.virtualization.test.jsx tests/components/AudioTimeline/AudioTimeline.test.jsx tests/components/AudioTimeline/TrackLane.virtualization.test.jsx`

Expected: all focused files pass with no weakened lower bounds.

**Step 2: Run the full suite**

Run: `npm run test:run`

Expected: 573 files and 5,787 existing tests plus the new regression tests pass. The final count will increase by the number of added tests.

**Step 3: Check the patch**

Run: `git diff --check`

Expected: exit 0 and no output.

Review `git diff --stat`, `git status --short`, and the final diff for Phase 3 regressions or unrelated edits.

**Step 4: Create the English commit**

```bash
git add src/components/SceneList.jsx src/components/ResultsTable.jsx src/components/AudioTimeline/TimeRuler.jsx src/components/AudioTimeline/AudioTimeline.jsx src/App.css tests/components/SceneList.virtualization.test.jsx tests/components/ResultsTable.virtualization.test.jsx tests/components/AudioTimeline/TimeRuler.virtualization.test.jsx docs/plans/2026-07-15-virtualization-adversarial-fixes-design.md docs/plans/2026-07-15-virtualization-adversarial-fixes.md
git commit -m "fix: harden virtualized result surfaces"
```
