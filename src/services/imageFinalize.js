/**
 * ImageFinalize — 이미지 생성 후처리 (업스케일 + 크기 추출 + 저장 + 상태 갱신)
 *
 * useSceneGeneration, useAutomation(processScene, processAsyncResult)에서
 * 동일한 후처리 로직이 3곳에 중복되어 있었으므로 하나로 통합.
 */

import { RESOURCE } from '../config/defaults'
import { fileSystemAPI } from '../hooks/useFileSystem'
import { getImageSizeFromBase64 } from '../utils/formatters'
import { tryUpscaleImage } from '../utils/imageProcessing'

/**
 * 생성된 이미지 결과를 후처리 (업스케일 + 크기 + 저장 + 씬 업데이트 데이터 반환)
 *
 * @param {object} params
 * @param {object} params.result - 생성 결과 { success, images: [{ base64, mediaId }] }
 * @param {object} params.flowAPI - Flow API 인스턴스 (upscaleImage)
 * @param {string} params.upscaleRes - 업스케일 해상도 ('off', '2k', '4k')
 * @param {string} params.saveMode - 저장 모드 ('folder' | 'none')
 * @param {string} params.projectName - 프로젝트명
 * @param {string} params.sceneId - 씬 ID
 * @param {string} params.prompt - 프롬프트 (메타데이터용)
 * @param {string} params.logPrefix - 로그 접두사
 * @returns {Promise<{ success: boolean, sceneUpdate?: object }>}
 *   sceneUpdate: updateScene에 전달할 객체 (status, image, imagePath, mediaId, image_size)
 */
export async function finalizeGeneratedImage({
  result, flowAPI, upscaleRes = 'off', saveMode, projectName, sceneId, prompt, logPrefix = '[Finalize]'
}) {
  if (!result.success || !result.images?.length) {
    return { success: false, sceneUpdate: { status: 'error', error: result.error || 'No images' } }
  }

  const firstImage = result.images[0]
  let imageData = firstImage.base64 || firstImage
  const mediaId = firstImage.mediaId || null

  // 업스케일
  const upscaled = await tryUpscaleImage(flowAPI, mediaId, upscaleRes, logPrefix)
  if (upscaled) imageData = upscaled

  // 이미지 크기 추출
  let imageSize = null
  try {
    imageSize = await getImageSizeFromBase64(imageData)
  } catch (e) { /* ignore */ }

  // 저장
  let imagePath = null
  if (saveMode === 'folder') {
    // projectName은 호출자(useAutomation/useSceneGeneration)가 넘겨야 한다.
    // 누락 시엔 고아 autoflowcut_<ts> 폴더 대신 'Untitled'로 폴백.
    if (!projectName) {
      console.warn(`${logPrefix} projectName missing — falling back to "Untitled"`)
    }
    const name = projectName || 'Untitled'
    const metadata = { prompt, mediaId, model: 'flow', timestamp: Date.now() }
    const saveResult = await fileSystemAPI.saveImage(name, sceneId, imageData, 'flow', metadata)
    if (saveResult.success) {
      imagePath = saveResult.path
    }

    // 여분 이미지 → History에만 저장
    await fileSystemAPI.saveExtraToHistory(name, RESOURCE.SCENES, sceneId, result.images, prompt, logPrefix.replace(/[\[\]]/g, ''))
  }

  return {
    success: true,
    sceneUpdate: {
      status: 'done',
      image: imagePath ? null : imageData,
      imagePath: imagePath || null,
      mediaId,
      image_size: imageSize
    }
  }
}
