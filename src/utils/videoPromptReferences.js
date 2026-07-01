import { applyStyle, isStyleReference } from '../services/styleService'
import { VIDEO_REFERENCE_IMAGE_LIMIT } from '../config/genModels'
import { resolveMentions, stripMentionPrefixes } from './mentionParser'
import { parseSceneMentions } from './sceneMentions'
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

function getVideoTargetDuration(scene, srtTrack) {
  const sceneDuration = Number(getSceneDuration(scene, srtTrack))
  if (Number.isFinite(sceneDuration) && sceneDuration > 0) return sceneDuration
  const explicitTarget = Number(scene?.targetDuration)
  return Number.isFinite(explicitTarget) && explicitTarget > 0 ? explicitTarget : 0
}

export function buildVideoPromptWithReferences(prompt, references = [], effectiveStyleId = null, appMode = 'api') {
  const refs = references || []

  // #R36: Flow 모드 T2V 는 @멘션을 "레퍼런스 이미지"가 아니라 컴포저 @칩(segments)으로 넣는다 —
  //   Flow T2V DOM 은 ref 이미지 주입을 지원하지 않아 기존엔 "레퍼런스 미지원" 에러로 막혔다.
  //   이미지 씬과 동일하게 스타일 적용 후(멘션 유지, strip 안 함) parseSceneMentions 로 segments 를
  //   만들어 넘긴다. seed/프롬프트는 그대로. 멘션이 없으면 segments 없이 일반 텍스트 T2V.
  if (appMode === 'flow') {
    const { styledPrompt } = applyStyle(prompt || '', effectiveStyleId, refs, [])
    const parsed = parseSceneMentions(styledPrompt, refs)
    return {
      styledPrompt,
      referenceImages: [],
      segments: parsed.hasMention ? parsed.segments : null,
      missing: (parsed.unresolved || []).map((u) => u.name),
      truncated: 0,
    }
  }

  // API 모드(공식 Veo): 멘션 → inline 레퍼런스 이미지 + @ strip (기존 동작).
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
    segments: null,
    missing,
    truncated: Math.max(0, mentionRefs.length - referenceImages.length),
  }
}

export function buildVideoPromptScenes(videoScenes = [], references = [], effectiveStyleId = null, srtTrack = [], appMode = 'api') {
  return (videoScenes || []).map((scene) => {
    const prepared = buildVideoPromptWithReferences(scene?.prompt, references, effectiveStyleId, appMode)
    return {
      ...prepared,
      scene: {
        ...scene,
        prompt: prepared.styledPrompt,
        referenceImages: prepared.referenceImages,
        segments: prepared.segments || null,  // #R36: Flow @멘션 씬은 컴포저 칩용 segments
        targetDuration: getVideoTargetDuration(scene, srtTrack),
      },
    }
  })
}
