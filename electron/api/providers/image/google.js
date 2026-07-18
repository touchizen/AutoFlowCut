/**
 * image/google.js — Google Gemini 이미지 생성 (gemini-3.1-flash-image).
 *
 * genai.js 에서 무동작 이동(M0a). 스타일/품질 프롬프트는 앱(styleService)이
 * 이미 적용해서 넘긴다 — 이 모듈은 style-agnostic. 레퍼런스가 있을 때만
 * "character consistency" 지시문을 앞에 붙인다.
 */
import { formatGoogleApiError } from '../../../ipc/googleApiError.js'
import { GENAI_BASE, DEFAULT_ASPECT_RATIO, genaiFetch } from '../http.js'

// Nano Banana 2. renderer 의 DEFAULT_IMAGE_MODEL_ID(src/config/genModels.js)와 동기화 유지
// — 한쪽만 바꾸면 model 미지정 IPC 호출이 옛 모델로 폴백됨 (genai.test.js drift 가드가 잡음).
export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image'

const IMAGE_ASPECT_RATIOS = new Set(['1:1', '3:4', '4:3', '9:16', '16:9'])

function normalizeImageAspectRatio(aspectRatio) {
  const raw = typeof aspectRatio === 'string' ? aspectRatio.trim() : ''
  if (IMAGE_ASPECT_RATIOS.has(raw)) return raw
  if (/PORTRAIT|9.?16/i.test(raw)) return '9:16'
  if (/SQUARE|1.?1/i.test(raw)) return '1:1'
  if (/3.?4/i.test(raw)) return '3:4'
  if (/4.?3/i.test(raw)) return '4:3'
  if (/LANDSCAPE|16.?9/i.test(raw)) return '16:9'
  return DEFAULT_ASPECT_RATIO
}

/**
 * 레퍼런스 이미지 배열을 Gemini parts 로 변환.
 * @param {Array<{mimeType:string, data:string}>} referenceImages - data 는 base64 (data: 프리픽스 없음)
 * @returns {Array<{inlineData:{mimeType:string,data:string}}>}
 */
function buildReferenceParts(referenceImages = []) {
  return (referenceImages || [])
    .filter((ref) => ref && ref.data)
    .map((ref) => ({
      inlineData: {
        mimeType: ref.mimeType || 'image/jpeg',
        data: ref.data,
      },
    }))
}

/**
 * 이미지 생성 (gemini-3.1-flash-image).
 *
 * @param {object} params
 * @param {string} params.apiKey - 사용자 Gemini API 키 (BYOK)
 * @param {string} params.prompt - 이미 스타일이 적용된 최종 프롬프트 (앱에서 빌드)
 * @param {Array<{mimeType:string,data:string}>} [params.referenceImages] - inline base64 레퍼런스
 * @param {string} [params.aspectRatio] - '16:9' | '9:16' | '1:1' 등
 * @param {string} [params.model]
 * @param {object} [deps]
 * @param {Function} [deps.fetchImpl] - 주입용 fetch (테스트)
 * @returns {Promise<{success:boolean, images?:Array<{base64:string,mimeType:string,dataUrl:string}>, error?:string}>}
 */
export async function generateImage(
  { apiKey, prompt, referenceImages = [], aspectRatio = DEFAULT_ASPECT_RATIO, model = DEFAULT_IMAGE_MODEL } = {},
  deps = {}
) {
  if (!apiKey) return { success: false, error: 'No API key' }

  const refParts = buildReferenceParts(referenceImages)
  const refCount = refParts.length

  // 레퍼런스가 있으면 캐릭터 일관성 지시문을 앞에 붙임 (SRT 에서 검증된 프롬프트 형태)
  const textPrompt = refCount > 0
    ? `Using the provided ${refCount} reference image(s) for character consistency and style, generate: ${prompt || ''}`
    : (prompt || '')

  const parts = [...refParts, { text: textPrompt }]
  const normalizedAspectRatio = normalizeImageAspectRatio(aspectRatio)

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      // aspect ratio 는 imageConfig.aspectRatio 로 전달한다.
      // (1.1.2 에서 responseFormat.image.aspectRatio 로 바꿨다가 v1beta 가 해당 enum 에서
      //  "16:9" 를 거부 → 전 모델 이미지 생성 실패. imageConfig 로 롤백.)
      imageConfig: { aspectRatio: normalizedAspectRatio },
    },
  }

  try {
    const { response, data } = await genaiFetch(
      `${GENAI_BASE}/models/${model}:generateContent`,
      { apiKey, method: 'POST', body },
      deps
    )

    if (data?.error) {
      return { success: false, error: formatGoogleApiError(data.error) }
    }
    if (!data) {
      return { success: false, error: `HTTP ${response?.status ?? '?'} :: empty response` }
    }

    const candidate = data.candidates?.[0]
    const responseParts = candidate?.content?.parts || []
    const imagePart = responseParts.find((p) => p.inlineData)

    if (imagePart) {
      const mimeType = imagePart.inlineData.mimeType || 'image/png'
      const base64 = imagePart.inlineData.data
      return {
        success: true,
        images: [{ base64, mimeType, dataUrl: `data:${mimeType};base64,${base64}` }],
      }
    }

    // 이미지가 없는 경우 — 사유를 최대한 구체적으로 표면화해 사용자가 안전필터 차단인지
    // 일시 오류인지 구분하고 재시도 여부를 판단할 수 있게 한다.
    const textPart = responseParts.find((p) => p.text)
    if (textPart?.text) return { success: false, error: textPart.text }
    const blockReason = data.promptFeedback?.blockReason
    if (blockReason) return { success: false, error: `Blocked by safety filter: ${blockReason}` }
    const finishReason = candidate?.finishReason
    if (finishReason && finishReason !== 'STOP') {
      return { success: false, error: `No image generated (finishReason: ${finishReason})` }
    }
    return { success: false, error: 'No image was generated' }
  } catch (error) {
    return { success: false, error: error?.message || String(error) }
  }
}
