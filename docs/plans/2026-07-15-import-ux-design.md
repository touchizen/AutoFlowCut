# Large Import UX Design

## Goal

Warn before a text, scene CSV, or SRT import would create an unusually large scene set, and provide an honest delayed progress indicator without limiting or truncating the imported data. Close the renderer localization gap that allowed Korean UI messages to bypass the locale catalogs.

## Large-import preflight

The warning threshold is 1,000 incoming scenes. The three virtualized scene surfaces switch at 200 items, but warning at that point would interrupt legitimate mid-length projects too often. A threshold five times higher reserves the interruption for long-form imports while still catching the reported 5,029-subtitle case.

`App.handleImport` remains the import decision boundary. It will use the already detected effective file type and extend the existing `confirmKey` mechanism rather than introducing a second confirmation path. A pure import inspection utility will compute the incoming scene count with the same parser semantics used by the commit path:

- SRT: subtitle blocks from `parseSRTToTrack`
- TXT: non-empty prompt lines
- Scene CSV: parsed scene groups for the new format, parsed rows for the legacy format
- Reference CSV: no scene warning

Inspection never calls a React setter or writes a project file. If the count reaches 1,000, the localized `window.confirm` message names the actual input and output counts. Cancel closes the pending import without changing scenes, `srtTrack`, or persisted project data. Confirm continues through the existing action and imports every item.

## Delayed processing indicator

An App-level import processing controller covers both the normal import action and the later replace/merge action in the SRT conflict modal. It exposes processing state and a runner for a synchronous or asynchronous action.

Before invoking the action, the runner sets processing state and yields through a browser animation frame into a later task. This lets React commit the processing DOM and lets the browser paint it before synchronous parsing or state normalization begins. The visible status is delayed by 150 ms so a fast import does not flash a spinner.

A pre-painted overlay also has a compositor-friendly CSS opacity reveal after 150 ms. This is the synchronous fallback: if the main thread remains occupied past the delay, the already painted layer can become visible instead of waiting for a blocked JavaScript timer. The JavaScript timer adds the visible status semantics for asynchronous slow work. Completion clears the timer and removes the overlay, so work that finishes before 150 ms stays visually silent.

## Renderer localization guardrail

The renderer sweep covers hardcoded Korean string literals passed to user-notification APIs such as `confirm`, `alert`, and `toast`, including multiline expressions. Each discovered UI message moves into both `src/locales/en.js` and `src/locales/ko.js` and is called through `t(...)`.

A renderer-specific static guardrail scans JavaScript and JSX under `src/` while excluding locale catalogs. It examines only notification call expressions, so Korean comments, source documentation, and story prompts sent to an LLM remain valid. Its own tests prove both directions: a synthetic `window.confirm('한글')` is rejected, while locale entries, comments, and prompt content are ignored.

## Testing and measurement

TDD coverage will pin these behaviors:

- Above-threshold SRT confirmation contains both exact counts.
- Cancel performs no scene or `srtTrack` commit; confirm imports the full set.
- Below-threshold imports bypass the large-import confirmation.
- TXT and both scene CSV formats use their real resulting scene counts; reference CSV is excluded.
- Slow work exposes the spinner after 150 ms, fast work never exposes it.
- Processing DOM is committed before the heavy action callback begins.
- New catalog keys exist in exact English/Korean parity.
- The renderer guardrail rejects a hardcoded Korean confirmation and accepts legitimate Korean non-UI content.

The 5,029-scene wall-clock measurement will cover the SRT parse and `useScenes` state commit after the virtualization work. The report will state the measurement method, result, and whether it crosses the 150 ms spinner delay. No hard cap, truncation, worker migration, or autosave timing change is part of this phase.
