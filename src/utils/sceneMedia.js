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
 * 새 generation 제출/clear 시 해당 source 의 영상 필드를 초기화하는 patch.
 * per-clip `video*Disabled` 도 reset(null) — 재생성한 클립은 "새 클립" = enabled.
 * @param {'i2v'|'t2v'} source
 */
export function videoClearPatch(source) {
  return source === 'i2v'
    ? { videoI2V: null, videoI2VPath: null, videoI2VDuration: null, videoI2VDisabled: null }
    : { videoT2V: null, videoT2VPath: null, videoT2VDuration: null, videoT2VDisabled: null }
}

function isFilePath(v) {
  return v && typeof v === 'string' && !v.startsWith('data:')
}
