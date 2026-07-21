# SceneList Virtualization Phase 1 Design

## Goal

Keep SceneList usable with roughly 5,000 scenes without changing its semantic table layout or limiting imported data.

## Architecture

Use `@tanstack/react-virtual` only when `scenes.length > 200`. The existing `.scene-table-wrapper` remains the scroll element and the existing `table > thead + tbody > tr` hierarchy remains intact. A virtualized body contains a zero-style top spacer row, visible `SceneRow` rows, and a zero-style bottom spacer row. Spacer cells span all six columns.

The virtualizer uses scene IDs as item keys, eight-row overscan, and dynamic measurement. Each mounted row is measured through the virtualizer and its height is rounded before caching so collapsed table borders cannot cause repeated one-pixel corrections. At or below the threshold, SceneList renders every row exactly as it does now.

## Rendering cost

SceneList builds one SRT line ID map with `useMemo` and passes it to rows. The public `getSceneSubtitle(scene, srtTrack)` signature stays intact for other callers; SceneList resolves subtitles from its prebuilt map. `SceneRow` is wrapped in `React.memo`, and handlers supplied by SceneList and App are stabilized with `useCallback`.

The existing hover-triggered `<video>` behavior stays local to each row. Offscreen virtual rows unmount, which also releases any mounted hover video.

## Generating auto-scroll

The row-level `scrollIntoView` effect is removed. SceneList compares current statuses with its previous status snapshot and calls `virtualizer.scrollToIndex(index, { align: 'auto' })` for the last scene in array order that changed from a non-generating status to `generating` in the current update. Initial already-generating scenes do not count as a flip, and smooth scrolling is not used.

## Accepted behavior

Dynamic height correction can cause small scrollbar adjustments as estimated rows become measured rows. Above 200 scenes, browser find-in-page, cross-row selection, and Tab traversal cover only the mounted window. All three remain complete at or below the threshold.

## Out of scope

This phase does not touch ResultsTable, timeline lanes, import confirmation/spinners, scene caps, Flow/locale/i18n/SRT parsing, or their fixtures.
