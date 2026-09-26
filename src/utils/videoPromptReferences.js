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

function getVideoTargetDuration(scene, srtTrack) {
  const sceneDuration = Number(getSceneDuration(scene, srtTrack))
  if (Number.isFinite(sceneDuration) && sceneDuration > 0) return sceneDuration
  const explicitTarget = Number(scene?.targetDuration)
  return Number.isFinite(explicitTarget) && explicitTarget > 0 ? explicitTarget : 0
}

export function buildVideoPromptWithReferences(prompt, references = [], effectiveStyleId = null, appMode = 'api') {
  const refs = references || []

  // M3(D15): Flow 모드 T2V 의 @멘션 = 인라인 멘션(레퍼런스 영상 r2v). 스타일 적용 뒤 @ 토큰은 그대로 두고(엔진 계획 planFlowReferenceComposition 이
  //   멘션 세그먼트로 만든다) 멘션된 ref 를 referenceImages 로 넘긴다 — 타입 무관, 자르지 않는다(상한은 엔진 계획이 거부). imagePath 는 filePath 로 옮겨
  //   싣는다(엔진이 그 경로로 읽는다). 이미지 원천이 없는 멘션 ref 도 넘긴다: 빼면 그 @토큰이(다른 멘션이 없을 때) 평문으로 나가 레퍼런스 없는 영상이
  //   과금된다 — 엔진이 flow-reference-source-missing 으로 클릭 전에 거부한다. missing = 미해결 이름(App 이 시작을 막는다).
  if (appMode === 'flow') {
    const { styledPrompt } = applyStyle(prompt || '', effectiveStyleId, refs, [])
    const { matched, missing } = resolveMentions(styledPrompt, refs)
    return {
      styledPrompt,
      referenceImages: matched.map((ref) => ({ ...toGenerationReference(ref), filePath: ref.filePath || ref.imagePath || null })),
      segments: null,
      missing,
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
        targetDuration: getVideoTargetDuration(scene, srtTrack),
      },
    }
  })
}
