# Virtualization Adversarial Fixes Design

## Scope

Fix the adversarial-review defects in SceneList, ResultsTable, and AudioTimeline without weakening virtualization or the Phase 3 import safeguards. The affected behavior is limited to virtualization lifecycle, reconciliation stability, grid measurement, generating-item auto-scroll, and ruler tick rendering.

## SceneList lifecycle and auto-scroll

The table header measurement must follow the header DOM node lifecycle. The layout effect will rerun when the list crosses between empty and non-empty, disconnecting the old ResizeObserver and measuring and observing the recreated `thead` before paint.

Both SceneList and ResultsTable will use the same generating-item rule: an item qualifies when its current status is `generating` and either its id was not present in the previous snapshot or its previous status was not `generating`. This deliberately treats imported or inserted generating items as transitions. A comment beside each effect will preserve that policy.

Tests will cover an empty SceneList mount followed by a large import containing an offscreen generating row, and a clear/re-import cycle with a changed header height.

## ResultsTable reconciliation and measurement

Table mode will always render top and bottom spacer rows. Below the threshold their heights are zero, so rows keep the same keyed sibling structure when crossing 200/201 items.

Grid mode will always measure the grid width and render cards inside stable row wrappers, with unconditional top and bottom spacers. Below the threshold every logical row is rendered; above it only virtual rows are rendered. With a stable width and column count, cards retain the same keyed parent row across threshold crossings.

Grid column calculation will consume one box model only: the grid element's border-box width from `getBoundingClientRect()` (falling back to `offsetWidth`). ResizeObserver notifications trigger a fresh border-box measurement rather than using `contentRect`. The calculation then subtracts the horizontal grid padding exactly once, matching the CSS grid content width.

Tests will preserve focused table prompt inputs and focused grid checkboxes in both threshold directions. A ResizeObserver test will intentionally report a content-box width 20px smaller than the unchanged 860px border-box and assert that the five-column layout and mounted card nodes remain stable.

The inactive virtual-item collections will use a shared immutable empty array so hover cleanup memoization does not churn on unrelated renders.

## TimeRuler windowing and axis alignment

TimeRuler will accept AudioTimeline's existing `visibleRangeMs`. Small rulers render all ticks. Large rulers render aligned major ticks only in the visible range plus the same 10-second margin used by TrackLane. Tick selection is window-relative, but every tick's CSS `left` remains absolute from timeline time zero:

`left = tickTimeMs * pxPerMs`

No local viewport origin or scroll offset is subtracted. Clips already use `left = clip.startMs * pxPerMs`, so ticks and clips remain pinned to the same axis during scrolling and zooming.

Tests will assert that a 3.5-hour high-zoom ruler renders a bounded, non-empty tick window. At a scrolled, zoomed position, a ruler tick at time T and a TrackLane clip starting at T must have identical CSS left offsets.

## Verification

Each behavior change follows red-green TDD with focused Vitest files. After focused tests pass, run `npm run test:run` and confirm the expected full-suite file and test counts remain green. Run `git diff --check` before the final English commit.
