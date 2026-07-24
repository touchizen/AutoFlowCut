# SceneList Virtualization Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Virtualize large SceneList tables while preserving the real table, normal short-list behavior, generating auto-scroll, and hover-lazy video mounting.

**Architecture:** SceneList conditionally renders TanStack virtual items above 200 scenes. It owns the scroll element, SRT lookup map, status-transition tracking, and stable callbacks; memoized SceneRow retains only row-local interaction state and accepts a measurement ref.

**Tech Stack:** React 18, `@tanstack/react-virtual`, Vitest, Testing Library, jsdom.

---

### Task 1: Large-list DOM contract

**Files:**
- Create: `tests/components/SceneList.virtualization.test.jsx`
- Modify: `tests/setup.js`

**Step 1: Write failing tests**

Add the required no-op `ResizeObserver` polyfill. Render 5,000 scenes with a stubbed scroll viewport and assert a small mounted-row bound, semantic table hierarchy, six-column top/bottom spacer cells, zero spacer padding/border, and estimated total height accounting.

**Step 2: Verify RED**

Run: `npm run test:run -- tests/components/SceneList.virtualization.test.jsx`

Expected: failure because the current body mounts all 5,000 rows and has no spacers.

### Task 2: Scroll and video lifecycle contract

**Files:**
- Modify: `tests/components/SceneList.virtualization.test.jsx`

**Step 1: Write failing tests**

Spy on the TanStack virtualizer and rerender with an offscreen scene newly marked `generating`; require `scrollToIndex(index, { align: 'auto' })`. Hover a visible video thumbnail, require one `<video>`, then move the virtual window away and require it to unmount. Render exactly 200 scenes and require all rows with no spacers.

**Step 2: Verify RED**

Run the focused test and confirm each behavior fails for the missing feature.

### Task 3: Minimal implementation

**Files:**
- Modify: `src/components/SceneList.jsx`
- Modify: `src/App.jsx`

**Step 1: Implement**

Import `memo`, `useMemo`, `useCallback`, and `useVirtualizer`. Build one SRT map, memoize SceneRow, pass a rounded measurement ref to virtual rows, render spacer/visible rows only above the threshold, and lift generating transition scrolling to SceneList. Stabilize SceneList detail/tag callbacks and App's delete-request callback.

**Step 2: Verify GREEN**

Run: `npm run test:run -- tests/components/SceneList.virtualization.test.jsx tests/components/SceneList.videoLazy.test.jsx tests/components/SceneList.srtTrack.test.jsx tests/components/SceneList.editSrtTrack.test.jsx tests/components/SceneList.headerButtons.test.jsx tests/components/SceneList.exportMedia.test.jsx tests/components/SceneList.videoPromptSeed.test.jsx`

Expected: all focused SceneList tests pass.

### Task 4: Measure and tune estimateSize

**Files:**
- Modify: `src/components/SceneList.jsx`
- Modify: `tests/components/SceneList.virtualization.test.jsx`

**Step 1: Measure**

Run the actual renderer with a representative default row after CSS loads, measure `tr.scene-row.getBoundingClientRect().height`, round it, and use the measured value for `estimateSize`.

**Step 2: Re-run focused tests**

Expected: focused tests remain green with the measured estimate.

### Task 5: Review, verify, and commit

**Files:**
- Review every changed file

**Step 1: Verify**

Run `npm run test:run`, `npm run build`, and `git diff --check`. Require zero failures/errors.

**Step 2: Commit**

Stage only Phase 1 files and commit with the English message `perf: virtualize large scene lists`.
