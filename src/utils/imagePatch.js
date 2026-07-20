import { isSceneGenerationDone } from '../services/generationStatus.js'

export function baseImageReplacementPatch(extra = {}) {
  return {
    upscaledAt: null,
    upscaled_size: null,
    ...extra,
  }
}

export function computeUpscaylTargets(scenes, targetSceneIds) {
  const selectedIds = Array.isArray(targetSceneIds) ? new Set(targetSceneIds) : null
  const source = selectedIds
    ? (scenes || []).filter((scene) => selectedIds.has(scene.id))
    : (scenes || [])
  const generated = source.filter(isSceneGenerationDone)
  const targets = generated.filter((scene) => scene.imagePath && !scene.upscaledAt)

  return {
    targets,
    alreadyUpscaled: generated.filter((scene) => scene.imagePath && scene.upscaledAt).length,
    skippedNoFile: generated.filter((scene) => !scene.imagePath).length,
    skipped: source.length - targets.length,
  }
}
