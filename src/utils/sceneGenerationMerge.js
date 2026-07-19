import { IMAGE_MODELS, VIDEO_MODELS } from '../config/genModels'
import { isKnownImageProvider, isKnownVideoProvider } from './sceneProviderResolution'

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function isKnownModel(kind, provider, model, settings, stage) {
  if (typeof model !== 'string' || !model) return false
  const catalog = kind === 'image' ? IMAGE_MODELS : VIDEO_MODELS
  if (catalog.some(entry => entry.provider === provider && entry.id === model)) return true
  if (kind === 'image') return settings?.modelsByProvider?.[provider] === model
  return settings?.modelsByProviderVideo?.[stage]?.[provider] === model
}

function mergeStage(existing, patch, { kind, stage, settings, path }) {
  if (patch === null) return { value: undefined, warnings: [] }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { value: existing, warnings: [`Rejected invalid ${path} override.`] }
  }

  const hasProvider = hasOwn(patch, 'provider') && patch.provider != null
  const hasModel = hasOwn(patch, 'model') && patch.model != null
  if (!hasProvider && !hasModel) return { value: existing, warnings: [] }

  const provider = hasProvider ? patch.provider : existing?.provider
  const isKnownProvider = kind === 'image' ? isKnownImageProvider(provider) : isKnownVideoProvider(provider)
  if (hasProvider && !isKnownProvider) {
    return { value: existing, warnings: [`Rejected unknown provider '${provider}' at ${path}.`] }
  }

  if (hasProvider && hasModel && !isKnownModel(kind, provider, patch.model, settings, stage)) {
    return {
      value: existing,
      warnings: [`Rejected invalid provider/model pair '${provider}/${patch.model}' at ${path}.`],
    }
  }

  if (!hasProvider && hasModel) {
    if (!isKnownProvider || !isKnownModel(kind, provider, patch.model, settings, stage)) {
      return { value: existing, warnings: [`Rejected invalid model '${patch.model}' at ${path}.`] }
    }
  }

  const providerChanged = hasProvider && provider !== existing?.provider
  return {
    value: {
      ...(existing || {}),
      ...(hasProvider ? { provider } : {}),
      ...(hasModel ? { model: patch.model } : providerChanged ? { model: null } : {}),
    },
    warnings: [],
  }
}

function cleanGeneration(generation) {
  const next = { ...generation }
  if (next.video && typeof next.video === 'object') {
    next.video = { ...next.video }
    if (next.video.t2v === undefined) delete next.video.t2v
    if (next.video.i2v === undefined) delete next.video.i2v
    if (Object.keys(next.video).length === 0) delete next.video
  }
  if (next.image === undefined) delete next.image
  return Object.keys(next).length > 0 ? next : undefined
}

/**
 * Applies a sparse scene.generation patch at stage-pair granularity.
 * Returns warnings instead of throwing so an invalid leaf cannot discard valid siblings.
 */
export function mergeSceneGeneration(existing, patch, settings = {}) {
  if (patch === undefined) return { generation: existing, warnings: [] }
  if (patch === null) return { generation: undefined, warnings: [] }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { generation: existing, warnings: ['Rejected invalid scene.generation patch.'] }
  }

  const next = existing && typeof existing === 'object' ? { ...existing } : {}
  const warnings = []

  if (hasOwn(patch, 'image')) {
    const merged = mergeStage(next.image, patch.image, {
      kind: 'image', stage: 'image', settings, path: 'generation.image',
    })
    next.image = merged.value
    warnings.push(...merged.warnings)
  }

  if (hasOwn(patch, 'video')) {
    if (patch.video === null) {
      delete next.video
    } else if (!patch.video || typeof patch.video !== 'object' || Array.isArray(patch.video)) {
      warnings.push('Rejected invalid generation.video patch.')
    } else {
      const video = next.video && typeof next.video === 'object' ? { ...next.video } : {}
      for (const stage of ['t2v', 'i2v']) {
        if (!hasOwn(patch.video, stage)) continue
        const merged = mergeStage(video[stage], patch.video[stage], {
          kind: 'video', stage, settings, path: `generation.video.${stage}`,
        })
        video[stage] = merged.value
        warnings.push(...merged.warnings)
      }
      next.video = video
    }
  }

  return { generation: cleanGeneration(next), warnings }
}
