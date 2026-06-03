/**
 * generationItems — Live Generation Grid 용 정규화 item 어댑터.
 *
 * 탭마다 자산 소스가 다르다(이미지=scenes, T2V=videoScenes(파생), F2V=framePairs).
 * Grid 는 이 차이를 모르도록, 탭 모드별로 정규화된 GenerationItem 배열을 받는다.
 *
 *   GenerationItem = { id, rawStatus, state, kind, thumbSrc, generatedAt, error, ref }
 *     state: 'pending' | 'generating' | 'complete' | 'error'  (정규화)
 *     kind : 'image' | 'video'   (클릭 라우팅: image→SceneDetail, video→VideoDetail)
 *     ref  : 원본 객체 (상세 모달이 받는 형태 — scene / videoScene / framePair)
 */
import { resolveImageSrc } from './formatters'
import { resolveVideoSrc } from './videoSrc'

/**
 * 소스 raw status → 정규화 UI 상태.
 *   done(이미지)·complete(비디오) → complete
 *   generating → generating, error → error
 *   pending·waiting(F2V)·미시작·기타 → pending
 */
export function normalizeState(rawStatus) {
  if (rawStatus === 'done' || rawStatus === 'complete') return 'complete'
  if (rawStatus === 'generating') return 'generating'
  if (rawStatus === 'error') return 'error'
  return 'pending'
}

function imageItem(scene) {
  const imagePath = scene.imagePath || scene.image_path || scene.filePath
  return {
    id: scene.id,
    rawStatus: scene.status,
    state: normalizeState(scene.status),
    kind: 'image',
    thumbSrc: resolveImageSrc({ imagePath, generatedAt: scene.generatedAt, image: scene.image }),
    generatedAt: scene.generatedAt,
    error: scene.error,
    ref: scene,
  }
}

function videoItem(src) {
  // src = videoScene(T2V, vscene_…) 또는 framePair(F2V, fp_…)
  return {
    id: src.id,
    rawStatus: src.status,
    state: normalizeState(src.status),
    kind: 'video',
    thumbSrc: resolveVideoSrc(src.video || null, src.videoPath || null, { version: src.generatedAt }),
    generatedAt: src.generatedAt,
    error: src.error,
    ref: src,
  }
}

/**
 * 탭 모드별 정규화 item 배열.
 * @param {'image'|'t2v'|'f2v'} mode - snapshot 된 runningGenMode (live activeTab 아님)
 * @param {{scenes?:Array, videoScenes?:Array, framePairs?:Array}} sources
 */
export function buildGenerationItems(mode, { scenes, videoScenes, framePairs } = {}) {
  if (mode === 'image') return (scenes || []).map(imageItem)
  if (mode === 't2v') return (videoScenes || []).map(videoItem)
  if (mode === 'f2v') return (framePairs || []).map(videoItem)
  return []
}
