# Results and Timeline Virtualization Phase 2 Design

## Goal

Keep the results views and the always-mounted audio timeline responsive with roughly 5,000 imported SRT scenes, without regressing the Phase 1 SceneList virtualization or changing normal short-project behavior.

## Shared policy

Each surface keeps its existing full render at or below 200 items. Above 200 items, only a measured visible window plus overscan or a time margin is mounted. Tests must assert both a non-zero lower bound and a small upper bound with real viewport dimensions stubbed in jsdom.

Stable item IDs remain React keys. No implementation may render the full collection during an initial unmeasured commit: a large grid waits for a measured column count, and a large timeline lane waits for `visibleRangeMs`.

## Results table

The existing results header and body are separate tables. The body table already uses `table-layout: fixed`; the header is fixed by being outside `.results-table-body`, not by `position: sticky`. The body scroll element owns a TanStack row virtualizer with an estimated row height, rounded DOM measurement, eight-row overscan, and item ID keys.

Above the threshold, `tbody` contains a top spacer `tr`, the mounted result rows, and a bottom spacer `tr`. Spacer cells span five columns, or six when selection checkboxes are enabled. At or below the threshold, the existing complete row mapping remains intact.

Generating-item auto-scroll moves from mounted-row refs to status-transition detection in the results layout. Table mode calls `scrollToIndex(itemIndex, { align: 'auto' })` on the body virtualizer. Because the header is outside the scrolling body, no header offset is subtracted: the virtualizer aligns inside `.results-table-body`, whose visible rectangle begins below the header. A regression test stubs distinct header/body rectangles and verifies the target result row is rendered within the body viewport after the status change.

## Results grid

Grid virtualization operates on grid rows, not individual cards. The measured `.results-grid` width, its 10-pixel horizontal padding and gap, and the existing aspect-ratio minimum card widths determine `itemsPerRow`. Large grids render no cards while the width is unknown. A layout measurement reads the initial width before paint and a `ResizeObserver` updates it after resizes.

The row virtualizer counts `ceil(items.length / itemsPerRow)` rows. Each mounted virtual row is a nested CSS grid with the calculated column count, preserves card item IDs, and is dynamically measured. Top and bottom block spacers preserve the total scroll extent. The existing card actions, selection, hover media, status display, and list/listitem semantics remain unchanged.

Generating-item auto-scroll converts the item index to `floor(itemIndex / itemsPerRow)` and scrolls that virtual row. Hover video and image-preview state is cleared when its card leaves the mounted window so an unmounted hover does not reappear stale when the card returns.

## Timeline clips

`AudioTimeline` already measures `visibleRangeMs` from `.atl-scroll` in a layout effect. It passes that range to every `TrackLane`. A lane with at most 200 clips still renders all clips. A larger lane renders only clips intersecting the visible range plus a 10-second margin on each side. When the range is initially `null`, a large lane renders zero clips rather than transiently mounting the complete track; the parent's layout measurement supplies the first range before paint.

Clip filtering changes only DOM rendering. Playback collection, playhead/scrub calculations, poster lookup, click/double-click handlers, flags, and video toggles continue to use the complete normalized timeline data.

The currently pointer-interacted clip is always added to the rendered set even after it leaves the buffered range. `Clip` reports interaction start/end to `TrackLane`; window-level pointer listeners and the drag offset therefore survive scrolling until pointer-up commits the drag. The existing unmount cleanup remains a final safety net.

## Preview panel and non-targets

`PreviewPanel` does not render all SRT entries. It precomputes ranges in memory, resolves one current subtitle, and keeps one main plus one prefetch video element, so it is left unchanged.

`StoryView` is not on the SRT import path. StylePicker, VoicePicker, TagInputAutocomplete, and SelectablePromptList have bounded option counts. None are changed in this phase.

## Tests and measurement

New tests cover:

- table and grid full rendering at exactly 200 items;
- non-zero lower and small upper mounted bounds at 5,029 items with viewport rectangles stubbed;
- initial render instrumentation that fails if a large grid or timeline ever mounts the full collection before measurement;
- semantic table spacer rows and dynamic column spans;
- grid column-count changes from measured width;
- table and grid generating status-transition auto-scroll;
- table target visibility inside the separate body viewport;
- timeline range intersection, margin behavior, and a dragged clip remaining mounted outside the range.

Before production changes, a temporary jsdom benchmark measures the initial mount cost of the results table, results grid, and a timeline lane with 5,029 lightweight items. The same harness and viewport stubs run after implementation. The report uses the median of repeated warm measurements and states plainly if any measured surface is already cheap enough to skip.

## Accepted behavior

Above 200 items, browser find-in-page, cross-item selection, and complete Tab traversal cover only the mounted window. Dynamic row/card measurement can cause small scrollbar corrections when actual sizes differ from estimates. A large timeline can be blank only during the internal unmeasured layout commit; it must receive and render a non-zero visible window before paint when mounted through `AudioTimeline`.
