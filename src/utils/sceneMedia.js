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
 * 씬에 대해 export 시 어떤 미디어가 선택될지 반환.
 *
 * 우선순위:
 *   1. scene.exportMedia 가 명시되어 있으면 그대로 사용 ('i2v' | 't2v' | 'image')
 *   2. 'auto' 면 base64 또는 path 가 있는 미디어 중 I2V > T2V > image 순
 *
 * 중요: base64(메모리)와 path(디스크) 둘 다 체크해야 한다. 이전 세션에서 생성된
 * 영상은 메모리(base64)에는 없지만 디스크(path)에는 남아있다.
 *
 * @param {object} scene
 * @returns {'i2v' | 't2v' | 'image'}
 */
export function resolveExportMediaChoice(scene) {
  if (!scene) return 'image'
  const choice = scene.exportMedia || 'auto'
  if (choice === 'i2v' || choice === 't2v' || choice === 'image') return choice
  // auto: I2V > T2V > image
  if (scene.videoI2V || scene.videoI2VPath) return 'i2v'
  if (scene.videoT2V || scene.videoT2VPath) return 't2v'
  return 'image'
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
 * **resolveExportMediaChoice 결과에 맞춰 path 를 추리**한다:
 *   - 항상 imagePath (capcutCloud 가 메인 트랙으로 사용)
 *   - choice 가 'i2v' 면 videoI2VPath 추가
 *   - choice 가 't2v' 면 videoT2VPath 추가
 *   - 'image' 이면 영상 path 는 추가 안 함 (실제로 안 읽으니까)
 *
 * 이렇게 좁혀야 "사용자는 image 만 export 하는데 과거에 만든 video path 가
 * 남아있어서 권한 prompt 가 뜨거나 export 가 차단되는" UX 회귀를 막는다.
 *
 * @param {object} scene
 * @returns {string[]}
 */
export function getExportFilePaths(scene) {
  if (!scene) return []
  const paths = []

  // 이미지 path 는 모든 export 모드에서 읽힘 (메인 트랙)
  if (isFilePath(scene.imagePath)) paths.push(scene.imagePath)

  // 선택된 영상의 path 만 추가
  const choice = resolveExportMediaChoice(scene)
  if (choice === 'i2v' && isFilePath(scene.videoI2VPath)) paths.push(scene.videoI2VPath)
  if (choice === 't2v' && isFilePath(scene.videoT2VPath)) paths.push(scene.videoT2VPath)

  return paths
}

function isFilePath(v) {
  return v && typeof v === 'string' && !v.startsWith('data:')
}
