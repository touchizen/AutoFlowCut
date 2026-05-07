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
 * 비고 (model 필드 의미):
 *   Flow 가 이미지 생성에 실제로 어떤 내부 모델(GEM_PIX_2 / IMAGEN_4 등)을 썼는지는
 *   현재 DOM 응답에서 노출되지 않는다. 따라서 `model` 인자는 사실상 "엔진 식별자"
 *   ('flow') 로만 들어오며, 호출자가 더 구체적인 값(예: result.images[0].model 같은
 *   응답 필드)을 thread 해줄 수 있게 되면 그대로 통과시킨다.
 *   상세 모달의 🤖 표시는 이 한계 안에서 동작한다 — 비디오는 정확한 모델명,
 *   이미지는 엔진명에 근사.
 *
 * @param {object} params
 * @param {object} params.result - 생성 결과 { success, images: [{ base64, mediaId, model? }], seed? }
 * @param {object} params.flowAPI - Flow API 인스턴스 (upscaleImage)
 * @param {string} params.upscaleRes - 업스케일 해상도 ('off', '2k', '4k')
 * @param {string} params.saveMode - 저장 모드 ('folder' | 'none')
 * @param {string} params.projectName - 프로젝트명
 * @param {string} params.sceneId - 씬 ID
 * @param {string} params.prompt - 프롬프트 (메타데이터용)
 * @param {string|number} [params.seed] - effective seed (결과에 포함되지 않을 때 폴백)
 * @param {string} [params.model='flow'] - 엔진/모델 식별자 (응답에서 더 구체적인 값 받으면 우선)
 * @param {string} [params.logPrefix]
 * @returns {Promise<{ success: boolean, sceneUpdate?: object }>}
 *   sceneUpdate: updateScene 에 전달할 객체 (status, image, imagePath, mediaId, image_size, seed, generatedAt, model)
 */
export async function finalizeGeneratedImage({
  result, flowAPI, upscaleRes = 'off', saveMode, projectName, sceneId, prompt,
  seed = null, model = 'flow', logPrefix = '[Finalize]'
}) {
  if (!result.success || !result.images?.length) {
    return { success: false, sceneUpdate: { status: 'error', error: result.error || 'No images' } }
  }

  const firstImage = result.images[0]
  let imageData = firstImage.base64 || firstImage
  const mediaId = firstImage.mediaId || null
  const generatedAt = Date.now()
  // 응답에 실제 model 필드가 들어오면 (예: 미래 Flow API 응답 schema 확장) 우선 사용,
  // 없으면 호출자 인자(기본 'flow' = 엔진 ID).
  const effectiveModel = firstImage.model ?? result.model ?? model
  // result 에서 직접 받은 seed 가 있으면 우선 (Flow 가 랜덤 seed 를 반환하는 경우 등 대비),
  // 없으면 호출자가 넘긴 effectiveSeed 사용.
  const effectiveSeed = firstImage.seed ?? result.seed ?? seed ?? null

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
  let saveError = null
  if (saveMode === 'folder') {
    // projectName은 호출자(useAutomation/useSceneGeneration)가 넘겨야 한다.
    // 누락 시엔 고아 autoflowcut_<ts> 폴더 대신 'Untitled'로 폴백.
    if (!projectName) {
      console.warn(`${logPrefix} projectName missing — falling back to "Untitled"`)
    }
    const name = projectName || 'Untitled'
    const metadata = {
      prompt,
      mediaId,
      model: effectiveModel,
      timestamp: generatedAt,
      seed: effectiveSeed
    }
    const saveResult = await fileSystemAPI.saveImage(name, sceneId, imageData, effectiveModel, metadata)
    if (saveResult.success) {
      imagePath = saveResult.path
    } else {
      // 저장 실패 — saveCurrentProject 가 base64 를 strip 하므로 path 없이 두면 재시작 시 유실.
      // 호출자에게 명시적 에러 전달 → UI 에서 재시도/사용자 알림 가능.
      saveError = saveResult.error || 'Save failed'
      console.error(`${logPrefix} saveImage failed:`, saveError)
    }

    // 여분 이미지 → History에만 저장 (main image 와 동일한 model/seed 규칙 적용)
    await fileSystemAPI.saveExtraToHistory(
      name, RESOURCE.SCENES, sceneId, result.images, prompt, logPrefix.replace(/[\[\]]/g, ''),
      { model: effectiveModel, seed: effectiveSeed }
    )
  }

  // folder 모드에서 저장 실패 → 'error' 로 surface (재시작 시 base64 가 strip 되어 데이터 유실 위험).
  // saveMode='none' 인 경우는 base64 가 project.json 에도 남아 정상 동작 → 'done'.
  if (saveMode === 'folder' && saveError) {
    return {
      success: false,
      sceneUpdate: {
        status: 'error',
        error: `Image save failed: ${saveError}`,
        // 메모리 표시는 유지 (사용자가 재시도 결정 가능)
        image: imageData,
        mediaId,
        image_size: imageSize,
        seed: effectiveSeed,
        generatedAt,
        model: effectiveModel
      }
    }
  }

  return {
    success: true,
    sceneUpdate: {
      status: 'done',
      image: imagePath ? null : imageData,
      imagePath: imagePath || null,
      mediaId,
      image_size: imageSize,
      seed: effectiveSeed,
      generatedAt,
      model: effectiveModel
    }
  }
}
