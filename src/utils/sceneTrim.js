/**
 * Scene trim helpers — supports the max-driver model where scenes.length =
 * max(image prompt count, video prompt count, F→V row count, SRT count).
 *
 * A scene EXISTS if any of these are non-empty (whitespace-only counts as empty):
 *   - scene.prompt           (image prompt)
 *   - scene.videoT2VPrompt   (video prompt)
 *   - scene.videoI2VPrompt   (video prompt)
 *   - scene.subtitle         (SRT)
 *   - generated media: scene.image / imagePath / mediaId / videoT2V(Path) / videoI2V(Path)
 *   - a framePair has ownerSceneId === scene.id (F→V)
 *
 * Trim policy: walk from the end, drop trailing scenes that fail all checks.
 * Middle gaps are preserved (the user may intentionally keep them — e.g. when
 * editing video tracks with gaps).
 *
 * Why include generated media: clearing a trailing PROMPT shouldn't silently
 * drop a generated IMAGE the user spent quota on. If they want to delete
 * generated assets, they go through SceneList delete (which shows the confirm
 * modal preview). Trim is for empty/text-only cleanup, not data destruction.
 */

const isNonEmptyString = (s) => typeof s === 'string' && s.trim().length > 0
const hasValue = (v) => v !== null && v !== undefined && v !== ''

/**
 * Returns true if a scene has no content in any driver field, no generated
 * media, AND no framePair owns it.
 *
 * @param {object} scene
 * @param {Array<{ ownerSceneId?: string|null }>} framePairs
 * @returns {boolean}
 */
export function isSceneEmpty(scene, framePairs) {
  if (!scene) return true
  // Text drivers
  if (isNonEmptyString(scene.prompt)) return false
  if (isNonEmptyString(scene.videoT2VPrompt)) return false
  if (isNonEmptyString(scene.videoI2VPrompt)) return false
  if (isNonEmptyString(scene.subtitle)) return false
  // Generated media — user invested quota/time, don't trim silently
  if (hasValue(scene.image)) return false
  if (hasValue(scene.imagePath)) return false
  if (hasValue(scene.mediaId)) return false
  if (hasValue(scene.videoT2V)) return false
  if (hasValue(scene.videoT2VPath)) return false
  if (hasValue(scene.videoI2V)) return false
  if (hasValue(scene.videoI2VPath)) return false
  // F→V ownership
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
