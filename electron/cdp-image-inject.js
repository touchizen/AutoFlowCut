/**
 * Pure body-transform for the batchGenerateImages CDP Fetch interception.
 *
 * main.js intercepts the outgoing batchGenerateImages request and rewrites its
 * body to apply what the renderer staged: reference images, a fixed seed, and
 * the project aspect ratio. The transform lives here so the core injection
 * logic is unit-testable in isolation — the CDP handler that calls it sits
 * inside a closure in createWindow().
 */

/**
 * Mutate a parsed batchGenerateImages request body in place.
 *
 * @param {object} body - parsed request JSON; expected shape { requests: [...] }
 * @param {object} [pending]
 * @param {Array|null}  [pending.referenceImages] - [{ mediaId }]
 * @param {number|null} [pending.seed] - fixed seed (0 is valid)
 * @param {string|null} [pending.aspectRatio] - IMAGE_ASPECT_RATIO_* enum
 * @returns {{ references: boolean, seed: boolean, aspectRatio: boolean }}
 *   which injections were applied (all false if body has no requests array)
 */
export function injectImageBatchBody(body, { referenceImages = null, seed = null, aspectRatio = null } = {}) {
  const applied = { references: false, seed: false, aspectRatio: false }
  const requests = body && Array.isArray(body.requests) ? body.requests : null
  if (!requests) return applied

  if (referenceImages && referenceImages.length > 0) {
    for (const req of requests) {
      if (!req.imageInputs) req.imageInputs = []
      for (const ref of referenceImages) {
        req.imageInputs.push({ imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: ref.mediaId })
      }
    }
    applied.references = true
  }

  if (seed != null) {
    for (const req of requests) req.seed = seed
    applied.seed = true
  }

  // 화면비: UI 탭 클릭에 의존하지 않고 요청 바디의 imageAspectRatio 를 직접 교체.
  if (aspectRatio) {
    for (const req of requests) req.imageAspectRatio = aspectRatio
    applied.aspectRatio = true
  }

  return applied
}
