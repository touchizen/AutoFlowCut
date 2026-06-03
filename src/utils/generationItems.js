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
/**
 * activeTab → 생성 모드. 생성 시작 시 snapshot 해서 Grid 가 쓴다(탭 이동과 무관하게 일관).
 *   text·list → image, video-text → t2v, frame-to-video → f2v, 그 외 → image(기본)
 */
export function genModeForTab(activeTab) {
  if (activeTab === 'video-text') return 't2v'
  if (activeTab === 'frame-to-video') return 'f2v'
  return 'image'
}

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

// 그리드 표시 순서 — 생성 중인 게 맨 위로, 그다음 방금 완료된 것(최신순), 에러, 대기.
// 사용자가 "지금 뭐가 생성되는지" 와 갓 나온 결과를 스크롤 없이 바로 보게 한다.
const STATE_ORDER = { generating: 0, complete: 1, error: 2, pending: 3 }
export function sortGenerationItems(items) {
  // 원본 불변(순수) + 안정 정렬(같은 state 는 입력 순서 유지 — V8 sort 는 stable).
  return [...(items || [])].sort((a, b) => {
    const d = (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9)
    if (d !== 0) return d
    if (a.state === 'complete') return (b.generatedAt || 0) - (a.generatedAt || 0) // 최신 완료가 위
    return 0
  })
}
