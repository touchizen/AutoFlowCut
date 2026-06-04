/**
 * sceneMedia — 씬 export 미디어 결정 공용 로직
 *
 * SceneList(시각 표시)와 useExport(실제 export)에서 동일한 결정 로직을 써야
 * "선택된 것처럼 보이는데 다른 게 export됨" 같은 거짓말 시각 버그를 막을 수 있다.
 *
 * 회귀 사고 컨텍스트:
 *   - 이전: SceneList 는 base64 필드만 보고("videoI2V"), useExport 는 base64 || path
 *           둘 다 봤기 때문에, 이전 세션에서 생성한 I2V(=path 만 남음)가 SceneList
 *           에선 "없는 것"으로 취급되고 useExport 에선 "있는 것"으로 취급됨.
 *   - 결과: 사용자에게 T2V 가 선택된 것처럼 보였지만 실제로는 I2V 가 export 됨.
 */

/**
 * export: 씬에서 내보낼 영상 목록(0~2개)을 반환.
 * B1: exportMedia(i2v/t2v/image 핀) 무시 — 존재하는 영상은 모두 내보낸다.
 *   (i2v·t2v 둘 다면 2개, i2v 먼저=프리뷰 상단/앞. 어느 take 쓸지는 CapCut 에서 큐레이션.)
 * 각 항목: { source:'i2v'|'t2v', path, data, duration }
 * → CapCut 2트랙 export(i2v 앞 / t2v 뒤)와 프리뷰가 항상 일치.
 */
export function resolveExportVideos(scene) {
  if (!scene) return []
  const i2v = (scene.videoI2V || scene.videoI2VPath) && !scene.videoI2VDisabled
    ? { source: 'i2v', path: scene.videoI2VPath || null, data: scene.videoI2V || null, duration: scene.videoI2VDuration ?? null }
    : null
  const t2v = (scene.videoT2V || scene.videoT2VPath) && !scene.videoT2VDisabled
    ? { source: 't2v', path: scene.videoT2VPath || null, data: scene.videoT2V || null, duration: scene.videoT2VDuration ?? null }
    : null
  return [i2v, t2v].filter(Boolean) // 있는 영상 다 (i2v 먼저), disabled 제외
}

/**
 * 씬에 export 가능한 미디어가 있는지 체크.
 *
 * **현재 exporter(capcutCloud) 의 contract**: 모든 씬은 이미지를 메인 트랙으로
 * 사용하고, 영상(T2V/I2V)은 그 위 overlay 로 배치한다. capcutCloud 는 image_path
 * 또는 image_fallback 이 없으면 씬 자체를 건너뛴다(line 135).
 *
 * 따라서 영상만 있고 이미지가 없는 씬은 exporter 가 silent drop 하므로
 * **이미지(base64 또는 path)를 가진 씬만 exportable** 로 판정한다.
 * 그렇게 해야 video-only 씬이 사용자 모르게 빠지는 대신, 명확한 "no images"
 * 경고로 surface 된다.
 *
 * (true video-only 씬을 지원하려면 exporter 를 video-as-base 모드로 확장해야
 * 함 — 별도 작업.)
 *
 * @param {object} scene
 * @returns {boolean}
 */
export function hasExportableMedia(scene) {
  if (!scene) return false
  return !!(scene.image || scene.imagePath)
}

/**
 * 실제 export 시 디스크 read 가 필요한 파일 경로만 반환.
 * data:base64 URL 은 권한 불필요 — 제외.
 *
 * B1: resolveExportVideos(= 있는 영상 다)에 맞춰 path 를 모은다:
 *   - 항상 imagePath (capcutCloud 가 메인 트랙으로 사용)
 *   - 존재하는 영상(i2v·t2v) path 모두 (둘 다면 둘 다 — 실제로 둘 다 export 하므로 권한 필요)
 *
 * @param {object} scene
 * @returns {string[]}
 */
export function getExportFilePaths(scene) {
  if (!scene) return []
  const paths = []

  // 이미지 path 는 모든 export 모드에서 읽힘 (메인 트랙)
  if (isFilePath(scene.imagePath)) paths.push(scene.imagePath)

  // 있는 영상(들)의 path 추가 (B1: i2v·t2v 둘 다면 둘 다).
  for (const v of resolveExportVideos(scene)) {
    if (isFilePath(v.path)) paths.push(v.path)
  }

  return paths
}

/**
 * video source 검증 — 'i2v' | 't2v' 만 허용. typo/undefined 가 조용히 잘못된 필드를
 * 업데이트하는 걸 막는다(이전 `source==='i2v' ? ... : ...` 의 silent t2v fallback 제거).
 * @param {'i2v'|'t2v'} source
 * @returns {'i2v'|'t2v'}
 */
export function assertVideoSource(source) {
  if (source !== 'i2v' && source !== 't2v') {
    throw new Error(`Unknown video source: ${JSON.stringify(source)} (expected 'i2v' | 't2v')`)
  }
  return source
}

/** source 의 per-clip disabled 필드명. */
export function getVideoDisabledField(source) {
  return assertVideoSource(source) === 'i2v' ? 'videoI2VDisabled' : 'videoT2VDisabled'
}

/**
 * 새 generation 제출/clear 시 해당 source 의 영상 필드를 초기화하는 patch.
 * per-clip `video*Disabled` 도 reset(null) — 재생성한 클립은 "새 클립" = enabled.
 * @param {'i2v'|'t2v'} source
 */
export function videoClearPatch(source) {
  return assertVideoSource(source) === 'i2v'
    ? { videoI2V: null, videoI2VPath: null, videoI2VDuration: null, videoI2VDisabled: null }
    : { videoT2V: null, videoT2VPath: null, videoT2VDuration: null, videoT2VDisabled: null }
}

/**
 * history 복원 → framePair 에 적용할 patch (source 무관 — framePair 필드는 prefix 없음).
 * F→V 결과표/fp 상세가 base64 우선 렌더하므로 video/base64/videoPath + 메타까지.
 * (App fp_ 복원 분기와 동일 shape — 한 곳에서 정의해 분기 간 drift 방지.)
 * @param {{video?, videoPath?, seed?, generatedAt?, model?, mediaId?}} patch
 */
export function buildFramePairVideoPatch(patch = {}) {
  const out = {}
  // media key 가 있을 때만 영상 필드 세팅 — meta-only patch 에 재사용돼도 framePair 영상을
  // 조용히 wipe 하지 않게(video=undefined spread 방지). base64 도 함께 넣어 stale base64 방지.
  if ('video' in patch || 'videoPath' in patch) {
    out.video = patch.video
    out.base64 = patch.video
    out.videoPath = patch.videoPath
  }
  for (const k of ['seed', 'generatedAt', 'model', 'mediaId']) if (k in patch) out[k] = patch[k]
  return out
}

/**
 * history 복원(VideoDetailModal save) → 씬에 적용할 source-specific patch.
 * ⚠️ patch 의 seed/generatedAt/model/mediaId 는 video 메타다. scene 에 raw 로 넣으면
 * 이미지 메타(scene.seed/generatedAt/model — SceneDetailModal 用)를 오염시키므로(useVideoScenes
 * FIELD_MAP 이 같은 이유로 videoT2V* 네임스페이스 분리), source 별 video 필드로 매핑한다.
 * disabled 도 reset(null) — 복원된 새 영상은 enabled.
 *   - t2v: videoT2V/Path/Disabled + videoT2VSeed/GeneratedAt/Model/MediaId
 *   - i2v: videoI2V/Path/Disabled + (최소) videoI2VGeneratedAt(캐시버스터).
 *     i2v 의 seed/model/mediaId source-of-truth 는 framePair 라 SceneList 에선 못 건드림.
 * @param {'i2v'|'t2v'} source
 * @param {{video?, videoPath?, seed?, generatedAt?, model?, mediaId?}} patch
 */
export function buildVideoRestorePatch(source, patch = {}) {
  assertVideoSource(source)
  if (source === 't2v') {
    const out = { videoT2VPath: patch.videoPath || null, videoT2VDisabled: null }
    if (patch.video) out.videoT2V = patch.video
    if ('seed' in patch) out.videoT2VSeed = patch.seed
    if ('generatedAt' in patch) out.videoT2VGeneratedAt = patch.generatedAt
    if ('model' in patch) out.videoT2VModel = patch.model
    if ('mediaId' in patch) out.videoT2VMediaId = patch.mediaId
    return out
  }
  const out = { videoI2VPath: patch.videoPath || null, videoI2VDisabled: null }
  if (patch.video) out.videoI2V = patch.video
  if ('generatedAt' in patch) out.videoI2VGeneratedAt = patch.generatedAt
  return out
}

/**
 * i2v history 복원(VideoDetailModal save) 시 patch 를 적용할 scene/framePair 해석.
 * - fpId: video.fpId 우선, 없으면 id(`i2v_N`)에서 `fp_N` 파싱(App fp_ 갱신 대상).
 * - sceneId: owning framePair 의 ownerSceneId 우선, 없으면 payload 의 sceneId 폴백.
 *   폴백 i2v_id(owning fp 없을 때 scene 번호로 생성됨)는 `fp_N` 이 없어 scene 갱신이
 *   통째로 no-op 되던 버그(P2-1)를 sceneId 폴백으로 막는다.
 * @param {{id?: string, fpId?: string, sceneId?: string}|null} video
 * @param {Array<{id: string, ownerSceneId?: string}>} framePairs
 * @returns {{fpId: string|null, sceneId: string|null}}
 */
export function resolveI2vRestoreSceneId(video, framePairs = []) {
  if (!video) return { fpId: null, sceneId: null }
  const fpId = video.fpId || (video.id ? `fp_${String(video.id).replace('i2v_', '')}` : null)
  const fp = fpId ? framePairs.find(p => p.id === fpId) : null
  return { fpId, sceneId: fp?.ownerSceneId || video.sceneId || null }
}

function isFilePath(v) {
  return v && typeof v === 'string' && !v.startsWith('data:')
}
