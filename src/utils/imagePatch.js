export function baseImageReplacementPatch(extra = {}) {
  return {
    upscaledAt: null,
    upscaled_size: null,
    ...extra,
  }
}
