/**
 * normalizeFlowResult — pure mappers: Flow collect/status results → canonical scene fields.
 *
 * Canonical field names (from sceneMedia.js / useExport DTO):
 *   image:      scene.image      (base64 data URL, in-memory)
 *   imagePath:  scene.imagePath  (saved file, disk)
 *   videoT2V / videoT2VPath / videoT2VDuration
 *   videoI2V / videoI2VPath / videoI2VDuration
 *   videoScenes[].video / .videoPath  (frame-pair / standalone video)
 *   model:      scene.model
 *
 * These functions do NOT throw — all bad/missing inputs produce safe nulls so that
 * callers (useAutomation.processAsyncSceneResult, useVideoAutomation) can merge
 * the result into a scene without defensive guards.
 *
 * Actual file-save (videoT2VPath write etc.) reuses the existing API-mode save path
 * elsewhere; here we only map fields.
 */

/**
 * normalizeFlowImageResult
 *
 * Maps the result of `collectGeneration(id)` to canonical scene image fields.
 *
 * Flow shape: { success, images: [{ base64: 'data:image/png;base64,...', mediaId }] }
 *
 * @param {object|null} collectResult
 * @param {{ model?: string }} opts
 * @returns {{ image: string|null, mediaId: string|null, model: string|undefined }}
 */
export function normalizeFlowImageResult(collectResult, { model } = {}) {
  const first = collectResult?.images?.[0]
  if (!first || !collectResult?.success) {
    return { image: null, mediaId: null, model }
  }
  return {
    image: first.base64 ?? null,
    mediaId: first.mediaId ?? null,
    model,
  }
}

/**
 * normalizeFlowVideoStatus
 *
 * Maps a single entry from `checkVideoStatus(ids).statuses[]` (after engineFlow
 * zips the generationId back in) to a canonical representation.
 *
 * Flow shape: { generationId, status: 'pending'|'complete'|'failed', videoUrl, mediaId, error? }
 *
 * This is the pre-download stage — no base64 yet. The consumer decides whether
 * to call downloadVideo and then save to videoT2VPath / videoScenes[].videoPath.
 *
 * @param {object|null} status  single status entry (post-zip)
 * @param {{ model?: string }} opts
 * @returns {{ status: string|null, videoUrl: string|null, mediaId: string|null, model: string|undefined }}
 */
export function normalizeFlowVideoStatus(status, { model } = {}) {
  if (!status) {
    return { status: null, videoUrl: null, mediaId: null, model }
  }
  return {
    status: 'status' in status ? status.status : undefined,
    videoUrl: 'videoUrl' in status ? status.videoUrl : undefined,
    mediaId: 'mediaId' in status ? status.mediaId : undefined,
    model,
  }
}

/**
 * normalizeFlowVideoResult
 *
 * Maps the result of `downloadVideo(videoUrl)` to the canonical video patch
 * shape used by videoScenes[].video (frame-pair base64) and buildFramePairVideoPatch.
 *
 * Flow shape: { success, base64: 'data:video/mp4;base64,...' }
 *
 * @param {object|null} downloadResult
 * @param {{ model?: string }} opts
 * @returns {{ video: string|null, model: string|undefined }}
 */
export function normalizeFlowVideoResult(downloadResult, { model } = {}) {
  if (!downloadResult || !downloadResult.success || !downloadResult.base64) {
    return { video: null, model }
  }
  return {
    video: downloadResult.base64,
    model,
  }
}
