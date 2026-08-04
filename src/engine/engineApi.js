/**
 * engineApi — 생성 엔진 facade의 'api'(BYOK) 어댑터.
 *
 * M2: useGenAPI 반환에 대한 항등(identity) 래퍼 — 동작 0 변화. 각 메서드 참조를
 * 그대로 노출한다(useGenAPI가 useCallback으로 안정 참조 보장 → 소비자 deps 안정성 유지).
 * M4 T7: 멘션 strip, opts.references, uploadReference 메타 정규화를 여기서 흡수.
 *   - generateImage / submitGeneration: opts.references 로 @mention strip 후 genAPI 위임
 *   - uploadReference: (base64, {category,...}) 메타 정규화
 *
 * 계약(§3.1.1)의 단일 진실원: tests/engine/engineContract.js
 */
import { stripMentionPrefixes } from '../utils/mentionParser'

export function createEngineApi(genAPI) {
  return {
    // 값 필드
    accessToken: genAPI.accessToken,
    projectId: genAPI.projectId,
    // 인증
    getAccessToken: genAPI.getAccessToken,
    clearTokenCache: genAPI.clearTokenCache,
    // 모델
    listModels: genAPI.listModels,
    // 이미지 (단일 + 공유 큐) — M4 T7: @mention strip 흡수
    generateImage: (rawPrompt, refImages, opts = {}) => {
      const stripped = stripMentionPrefixes(rawPrompt, opts.references || [])
      return genAPI.generateImage(stripped, refImages, opts)
    },
    submitGeneration: (rawPrompt, refImages, opts = {}) => {
      const stripped = stripMentionPrefixes(rawPrompt, opts.references || [])
      return genAPI.submitGeneration(stripped, refImages, opts)
    },
    checkGeneration: genAPI.checkGeneration,
    collectGeneration: genAPI.collectGeneration,
    clearGenerations: genAPI.clearGenerations,
    // 레퍼런스 — M4 T7: 메타 정규화 (object 전용; string 브랜치 제거 M6 T4)
    uploadReference: (base64, meta) => {
      const category = meta?.category
      return genAPI.uploadReference(base64, category)
    },
    fetchMedia: genAPI.fetchMedia,
    // 비디오
    generateVideoT2V: genAPI.generateVideoT2V,
    generateVideoI2V: genAPI.generateVideoI2V,
    checkVideoStatus: genAPI.checkVideoStatus,
    downloadVideo: genAPI.downloadVideo,
    // 업스케일 / Flow 레거시 (API 모드선 graceful degrade stub)
    upscaleVideo: genAPI.upscaleVideo,
    upscaleImage: genAPI.upscaleImage,
    fetchGallery: genAPI.fetchGallery,
    listFlowProjects: genAPI.listFlowProjects,
    // 정지 제어
    setStopRequested: genAPI.setStopRequested,
    cancelGeneration: genAPI.cancelGeneration,
  }
}

export default createEngineApi
