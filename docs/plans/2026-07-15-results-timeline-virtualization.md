# Results and Timeline Virtualization Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Bound the mounted DOM for both ResultsTable layouts and large timeline lanes at 5,029 imported scenes while preserving all existing behavior at or below 200 items.

**Architecture:** ResultsTable uses TanStack row virtualizers above the shared threshold: individual rows for the semantic table and measured CSS-grid rows for cards. AudioTimeline passes its existing measured time viewport into TrackLane, which filters large clip arrays by intersection plus a margin and retains the actively dragged clip.

**Tech Stack:** React 18, `@tanstack/react-virtual` 3.14.6, CSS Grid, Vitest, Testing Library, jsdom.

---

### Task 1: Capture the pre-change mount baseline

**Files:**
- Temporarily create: `tests/components/Phase2.mount.benchmark.test.jsx`

**Step 1: Add the benchmark harness**

Render 5,029 lightweight image result items in table and grid layouts and 5,029 subtitle clips through `TrackLane`. Stub 1,000×480 result scroll rectangles and use a direct visible range for the lane. Warm each surface once, then record the median of three fresh mount/unmount samples with `performance.now()`.

**Step 2: Run the baseline**

Run: `npm run test:run -- tests/components/Phase2.mount.benchmark.test.jsx --reporter=verbose`

Expected: PASS with three `PHASE2_BASELINE` timings printed. Save the values in the working notes.

**Step 3: Remove the temporary harness**

Delete the benchmark test before writing regression tests so it cannot become a flaky suite requirement. Recreate the identical harness after implementation for the comparison.

### Task 2: Pin ResultsTable virtualization contracts

**Files:**
- Create: `tests/components/ResultsTable.virtualization.test.jsx`

**Step 1: Write failing table tests**

Stub `.results-table-body` to 1,000×480 and result rows to the estimate height. Render 5,029 items and require `0 < mountedRows < 40`, real table hierarchy, top/bottom spacer `tr` elements, and a spacer `colSpan` of five or six according to `selectable`. Render exactly 200 items and require all 200 with no spacers.

**Step 2: Write failing grid tests**

Use a controllable `ResizeObserver` and width stub. With unknown width, record that no card child renders; after reporting 1,000×480, require `0 < mountedCards < 150`. Count render calls as well as final DOM nodes so a transient 5,029-card commit fails. Verify exactly 200 items still use the original complete CSS grid and verify a width change updates cards-per-row without mounting all items.

**Step 3: Write failing auto-scroll tests**

Rerender a large list with an offscreen item newly changed to `generating`. Require table mode to call its virtualizer with the item index and grid mode with the containing row index. For the table, stub the header bottom and body top separately, execute the scroll, and require the target row to mount inside `.results-table-body`, whose viewport starts below the separate header.

**Step 4: Verify RED**

Run: `npm run test:run -- tests/components/ResultsTable.virtualization.test.jsx`

Expected: failures because both layouts currently mount all 5,029 items and use mounted element refs for auto-scroll.

### Task 3: Implement ResultsTable table virtualization

**Files:**
- Modify: `src/components/ResultsTable.jsx`

**Step 1: Add shared constants and row rendering**

Add a threshold of 200, eight-row overscan, a rounded table-row measurement, and ID-based `getItemKey`. Keep row/card event handlers and media rendering behavior unchanged.

**Step 2: Add the body virtualizer**

Attach the scroll ref to `.results-table-body`. Above the threshold, render top spacer, virtual rows, and bottom spacer. Use a dynamic spacer column count. At or below the threshold, map every row without spacer elements.

**Step 3: Lift generating auto-scroll**

Track prior item statuses by ID. On a transition to `generating`, scroll the last changed item in array order with `{ align: 'auto' }`. Do not apply header padding because the header is outside the scroll element.

**Step 4: Verify GREEN**

Run the ResultsTable virtualization test and existing ResultsTable test files. Require all to pass.

### Task 4: Implement row-based Results grid virtualization

**Files:**
- Modify: `src/components/ResultsTable.jsx`
- Modify: `src/App.css`

**Step 1: Measure width without a transient full render**

Track the grid width as `null` initially. For a large grid, render no cards until a layout measurement produces a positive width. Observe later resizes. Calculate column count from content width, 10-pixel padding/gap, and ratio-specific minimum widths.

**Step 2: Add the grid-row virtualizer**

Virtualize `ceil(items.length / itemsPerRow)` measured rows. Render nested row grids with stable card ID keys and block top/bottom spacers. Preserve list/listitem semantics and the original complete grid DOM at or below 200 items.

**Step 3: Preserve interaction lifecycle**

Clear hover video/image-preview state when its item leaves the mounted window. Convert generating item indexes to row indexes for auto-scroll.

**Step 4: Verify GREEN**

Run: `npm run test:run -- tests/components/ResultsTable.virtualization.test.jsx tests/components/ResultsTable.test.jsx tests/components/ResultsTable.grid.test.jsx tests/components/ResultsTable.videoPoster.test.jsx`

Expected: all focused ResultsTable tests pass.

### Task 5: Pin timeline clip visibility and drag contracts

**Files:**
- Create: `tests/components/AudioTimeline/TrackLane.virtualization.test.jsx`

**Step 1: Write the no-transient-mount test**

Render a lane with 5,029 clips and `visibleRangeMs={null}`. Require zero clips in that initial pass. Rerender with a measured viewport and require `0 < mountedClips < 100`; also count clip mounts across both passes so a transient full render fails.

**Step 2: Write range and threshold tests**

Require clips intersecting the viewport ±10 seconds to render, clips outside it not to render, boundary intersections to remain included, and exactly 200 clips to render completely even without a visible range.

**Step 3: Write the drag survival test**

Start pointer interaction on a visible draggable clip, rerender the lane with a distant visible range, and require the active clip to stay mounted. Send pointer-up and require `onClipDrag` to receive the new time before the clip becomes eligible to unmount.

**Step 4: Verify RED**

Run: `npm run test:run -- tests/components/AudioTimeline/TrackLane.virtualization.test.jsx`

Expected: failures because TrackLane currently maps every clip and does not retain interaction state at the lane level.

### Task 6: Implement timeline range filtering

**Files:**
- Modify: `src/components/AudioTimeline/AudioTimeline.jsx`
- Modify: `src/components/AudioTimeline/TrackLane.jsx`
- Modify: `src/components/AudioTimeline/Clip.jsx`

**Step 1: Pass the existing viewport**

Pass `visibleRangeMs` from AudioTimeline to each TrackLane. Do not create another scroll observer or time-coordinate source.

**Step 2: Filter only large lanes**

At or below 200 clips, return the complete clip array. Above 200, return an empty array when the range is null; otherwise return only clips intersecting the range expanded by 10 seconds.

**Step 3: Retain pointer interaction**

Let Clip report pointer interaction start/end. TrackLane stores the active clip ID and includes that clip in the rendered set even outside the buffered range until the window-level pointer-up completes.

**Step 4: Verify GREEN**

Run the new TrackLane tests plus existing Clip, TrackLane drop, and AudioTimeline tests. Require all to pass.

### Task 7: Re-measure, review, and verify

**Files:**
- Temporarily recreate: `tests/components/Phase2.mount.benchmark.test.jsx`
- Review every changed file

**Step 1: Measure after implementation**

Run the identical benchmark harness and record `PHASE2_AFTER` median timings for the table, grid, and timeline lane. Remove the temporary file afterward.

**Step 2: Verify focused behavior**

Run the ResultsTable and TrackLane virtualization suites and confirm every bounded-count assertion has both lower and upper bounds after viewport measurement.

**Step 3: Verify the full project**

Run: `npm run test:run`

Expected: `566+` files and `5,745+` tests pass with zero failures.

Run: `npm run build`

Expected: exit code 0.

Run: `git diff --check`

Expected: no output.

**Step 4: Self-review**

Inspect the diff against commit `268dd06` and the approved design. Confirm SceneList is untouched, PreviewPanel/non-targets are untouched, and no test-only virtualization bypass exists.

**Step 5: Commit**

Stage only Phase 2 files and commit with an English message such as `perf: virtualize results and timeline clips`.
