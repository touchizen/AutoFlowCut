/**
 * electron/flow-aspect-ratio-ui.js
 *
 * Maps a project aspect ratio to Flow's Radix Tabs trigger id suffix.
 *
 * For IMAGE generation, correctness is also backed by the image inject path.
 * For VIDEO there is no such backup: CDP is off limits here, and injecting the
 * aspect into the video request body was tried and reverted because Flow then
 * failed the job outright (8821c558 → 8305e773). So for video this tab click is
 * the ONLY thing that decides the output aspect — its callers must treat a
 * failed click as a failed generation, not as cosmetics.
 *
 * See `configureFlowMode` in ipc/shared.js, which clicks the tab while the
 * settings menu is still open (Radix unmounts the menu content once closed, so
 * it must happen there).
 */

/**
 * Map a project aspect ratio to the Flow Radix Tabs trigger id suffix.
 *
 * Flow's aspect-ratio row is a Radix <Tabs>. Trigger ids have an unstable
 * generated prefix (radix-:rNN:) but a STABLE value suffix:
 *   -trigger-LANDSCAPE     -> 16:9     -trigger-PORTRAIT     -> 9:16
 *   -trigger-LANDSCAPE_4_3 -> 4:3      -trigger-PORTRAIT_3_4 -> 3:4
 *   -trigger-SQUARE        -> 1:1
 *
 * Callers match with an EXACT suffix (`id.endsWith(...)` / `[id$=...]`): a
 * contains match for '-trigger-PORTRAIT' would also hit '-trigger-PORTRAIT_3_4'
 * and select 3:4 instead of 9:16.
 *
 * @param {string} aspectRatio - '16:9' | '9:16'
 * @returns {string|null} trigger id suffix, or null if unsupported / missing
 */
export function aspectRatioTabSuffix(aspectRatio) {
  if (aspectRatio === '16:9') return '-trigger-LANDSCAPE'
  if (aspectRatio === '9:16') return '-trigger-PORTRAIT'
  return null
}
