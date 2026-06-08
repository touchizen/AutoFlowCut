import { applyStyle, isStyleReference } from '../services/styleService'
import { VIDEO_REFERENCE_IMAGE_LIMIT } from '../config/genModels'
import { resolveMentions, stripMentionPrefixes } from './mentionParser'
import { getSceneDuration } from './srtTrack'

export const VIDEO_REFERENCE_LIMIT = VIDEO_REFERENCE_IMAGE_LIMIT

export function isUsableVideoReference(ref) {
  return !!(!isStyleReference(ref) && (ref?.data || (ref?.name && ref?.filePath)))
}

export function toGenerationReference(ref = {}) {
  const out = {
    category: ref.category,
    mediaId: ref.mediaId || null,
    caption: ref.caption || '',
    name: ref.name,
    data: ref.data || null,
    filePath: ref.filePath || null,
  }
  if (ref.referenceType) out.referenceType = ref.referenceType
  if (ref.mimeType) out.mimeType = ref.mimeType
  return out
}

function referenceKey(ref) {
  if (ref?.name) return `name:${String(ref.name).toLowerCase()}`
  if (ref?.filePath) return `file:${ref.filePath}`
  if (ref?.data) return `data:${String(ref.data).slice(0, 64)}`
  return null
}

function pushUniqueReference(out, ref) {
  if (!isUsableVideoReference(ref)) return
  const prepared = toGenerationReference(ref)
  const key = referenceKey(prepared)
  if (key && out.some(existing => referenceKey(existing) === key)) return
  out.push(prepared)
}

function capVideoReferences(mentionRefs) {
  return mentionRefs.slice(0, VIDEO_REFERENCE_LIMIT)
}

export function buildVideoPromptWithReferences(prompt, references = [], effectiveStyleId = null) {
  const refs = references || []
  const mentionSources = refs.filter(isUsableVideoReference)
  const { matched: mentionMatched, missing } = resolveMentions(prompt, mentionSources)
  const mentionRefs = []

  for (const ref of mentionMatched) {
    pushUniqueReference(mentionRefs, ref)
  }

  const referenceImages = capVideoReferences(mentionRefs)
  const cleanPrompt = stripMentionPrefixes(prompt, referenceImages)
  const { styledPrompt } = applyStyle(cleanPrompt, effectiveStyleId, refs, referenceImages)

  return {
    styledPrompt,
    referenceImages,
    missing,
    truncated: Math.max(0, mentionRefs.length - referenceImages.length),
  }
}

export function buildVideoPromptScenes(videoScenes = [], references = [], effectiveStyleId = null, srtTrack = []) {
  return (videoScenes || []).map((scene) => {
    const prepared = buildVideoPromptWithReferences(scene?.prompt, references, effectiveStyleId)
    return {
      ...prepared,
      scene: {
        ...scene,
        prompt: prepared.styledPrompt,
        referenceImages: prepared.referenceImages,
        targetDuration: getSceneDuration(scene, srtTrack),
      },
    }
  })
}
