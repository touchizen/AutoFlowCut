/**
 * Image Processing 유틸리티 — 업스케일링, 썸네일 등 공통 이미지 처리
 */

import { cleanBase64 } from './urls'

/**
 * 이미지 업스케일 (설정에 따라 Flow API 호출)
 * @param {object} genAPI - Flow API 인스턴스
 * @param {string} mediaId - 업스케일할 이미지의 mediaId
 * @param {string} upscaleRes - 업스케일 해상도 ('off', '2x', '4x' 등)
 * @param {string} logPrefix - 로그 접두사 (예: '[Scene]', '[Automation]')
 * @returns {Promise<string|null>} 업스케일된 이미지 데이터 또는 null (실패 시)
 */
export async function tryUpscaleImage(genAPI, mediaId, upscaleRes, logPrefix = '[Upscale]') {
  if (upscaleRes === 'off' || !upscaleRes || !mediaId) return null
  try {
    console.log(logPrefix, 'Upscaling image to', upscaleRes, '...')
    const upResult = await genAPI.upscaleImage(mediaId, upscaleRes)
    if (upResult.success && upResult.data) {
      console.log(logPrefix, 'Upscale success')
      return upResult.data
    }
    // M1-10 (D8-2): 새 Flow(flow.google.com) 는 업스케일을 지원하지 않는다 — "원본 사용"으로 삼키면 사용자가 2k 를
    //   켜 둔 채 조용히 원본을 받는다. 그 kind 만은 throw 로 올려 항목이 flow-upscale-unsupported 로 실패하게 한다.
    if (upResult.errorKind === 'flow-feature-unsupported') {
      throw Object.assign(new Error('flow-upscale-unsupported'), { errorKind: 'flow-upscale-unsupported', errorParams: {} })
    }
    console.warn(logPrefix, 'Upscale failed, using original:', upResult.error)
  } catch (e) {
    if (e?.errorKind === 'flow-upscale-unsupported') throw e
    console.warn(logPrefix, 'Upscale error, using original:', e.message)
  }
  return null
}

/**
 * 썸네일 데이터에서 clean base64 추출
 * filePath이면 파일에서 읽고, data URL이면 prefix 제거
 * @param {string} thumbData - 썸네일 데이터 (파일 경로 또는 base64/data URL)
 * @param {object} fileSystemAPI - 파일 시스템 API
 * @param {string} logPrefix - 로그 접두사
 * @returns {Promise<string|null>} clean base64 데이터 또는 null
 */
export async function extractThumbnailBase64(thumbData, fileSystemAPI, logPrefix = '[Thumbnail]') {
  if (!thumbData) return null

  // filePath인 경우 파일에서 읽기
  if (thumbData.startsWith('/') || /^[A-Z]:\\/i.test(thumbData)) {
    try {
      const fileResult = await fileSystemAPI.readFileByPath(thumbData)
      if (fileResult.success) {
        return cleanBase64(fileResult.data)
      }
    } catch (e) {
      console.warn(logPrefix, 'Failed to read thumbnail file:', e)
    }
    return null
  }

  // data URL 또는 raw base64
  return cleanBase64(thumbData)
}
