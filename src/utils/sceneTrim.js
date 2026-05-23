/**
 * Scene trim helpers — supports the max-driver model where scenes.length =
 * max(image prompt count, video prompt count, F→V row count, SRT count).
 *
 * A scene EXISTS if any of these are non-empty (whitespace-only counts as empty):
 *   - scene.prompt           (image prompt)
 *   - scene.videoT2VPrompt   (video prompt)
 *   - scene.videoI2VPrompt   (video prompt)
 *   - scene.subtitle         (SRT)
 *   - a framePair has ownerSceneId === scene.id (F→V)
 *
 * Trim policy: walk from the end, drop trailing scenes that fail all checks.
 * Middle gaps are preserved (the user may intentionally keep them — e.g. when
 * editing video tracks with gaps).
 */

const isNonEmptyString = (s) => typeof s === 'string' && s.trim().length > 0

/**
 * Returns true if a scene has no content in any of the four driver fields
 * AND no framePair owns it.
 *
 * @param {object} scene
 * @param {Array<{ ownerSceneId?: string|null }>} framePairs
 * @returns {boolean}
 */
export function isSceneEmpty(scene, framePairs) {
  if (!scene) return true
  if (isNonEmptyString(scene.prompt)) return false
  if (isNonEmptyString(scene.videoT2VPrompt)) return false
  if (isNonEmptyString(scene.videoI2VPrompt)) return false
  if (isNonEmptyString(scene.subtitle)) return false
  if (framePairs?.some(fp => fp.ownerSceneId && fp.ownerSceneId === scene.id)) return false
  return true
}

/**
 * Trim trailing empty scenes. Middle empty scenes are preserved.
 * Returns the same reference when nothing changes (for perf / equality checks).
 *
 * @param {Array<object>} scenes
 * @param {Array<{ ownerSceneId?: string|null }>} framePairs
 * @returns {Array<object>}
 */
export function trimTrailingEmptyScenes(scenes, framePairs) {
  if (!scenes?.length) return scenes
  let lastNonEmpty = scenes.length - 1
  while (lastNonEmpty >= 0 && isSceneEmpty(scenes[lastNonEmpty], framePairs)) {
    lastNonEmpty--
  }
  if (lastNonEmpty === scenes.length - 1) return scenes
  return scenes.slice(0, lastNonEmpty + 1)
}
