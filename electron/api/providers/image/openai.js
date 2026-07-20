/**
 * image/openai.js — OpenAI gpt-image 이미지 생성.
 *
 * 앱(styleService)이 이미 적용한 최종 프롬프트를 받아 OpenAI Images API 형식으로
 * 변환한다. 레퍼런스가 없으면 generations JSON, 있으면 edits multipart를 사용한다.
 * 순수 모듈(Electron import 없음)이며 fetch 주입으로 실제 네트워크 없이 테스트 가능하다.
 */

export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1'

const OPENAI_BASE = 'https://api.openai.com/v1'

const IMAGE_ASPECT_MAP = {
  '1:1': { size: '1024x1024', actualAspectRatio: '1:1' },
  '16:9': { size: '1536x1024', actualAspectRatio: '3:2' },
  '9:16': { size: '1024x1536', actualAspectRatio: '2:3' },
  '4:3': { size: '1536x1024', actualAspectRatio: '3:2' },
  '3:4': { size: '1024x1536', actualAspectRatio: '2:3' },
}

const DEFAULT_IMAGE_ASPECT = IMAGE_ASPECT_MAP['1:1']
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504])
const SAFETY_SIGNAL = /content[ _-]?policy|safety|moderation/i

function mapImageAspect(aspectRatio) {
  const normalized = typeof aspectRatio === 'string' ? aspectRatio.trim() : ''
  return Object.hasOwn(IMAGE_ASPECT_MAP, normalized)
    ? IMAGE_ASPECT_MAP[normalized]
    : DEFAULT_IMAGE_ASPECT
}

function normalizeRawBase64(data) {
  if (typeof data !== 'string') return null
  const trimmed = data.trim()
  if (!trimmed || /^data:/i.test(trimmed)) return null
  const value = trimmed.replace(/\s+/g, '')
  if (!value || /^data:/i.test(value)) return null
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null
  try {
    const canonical = Buffer.from(value, 'base64').toString('base64')
    return value === canonical || value === canonical.replace(/=+$/, '') ? value : null
  } catch {
    return null
  }
}

function normalizeReferenceImages(referenceImages) {
  if (!Array.isArray(referenceImages)) {
    return { error: 'referenceImages must be an array', referenceImages: [] }
  }
  const normalized = referenceImages.map((ref) => {
    const data = ref ? normalizeRawBase64(ref.data) : null
    return data ? { ...ref, data } : null
  })
  const invalidIndex = normalized.findIndex((ref) => !ref)
  return invalidIndex === -1
    ? { error: null, referenceImages: normalized }
    : { error: `Invalid reference image at index ${invalidIndex}`, referenceImages: [] }
}

async function safeJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function openaiErrorMessage(httpStatus, payload) {
  const nestedMessage = payload?.error?.message
  if (nestedMessage) return String(nestedMessage)
  if (payload?.message) return String(payload.message)
  return `HTTP ${httpStatus ?? '?'}`
}

/**
 * OpenAI raw 오류를 공통 errorKind로 분류한다.
 * 403은 키 교체로 해결되지 않는 entitlement/org verification 신호라 auth보다 우선한다.
 */
function classifyOpenaiError(httpStatus, payload) {
  const error = payload?.error || {}
  const code = String(error.code ?? '').toLowerCase()
  const type = String(error.type ?? '').toLowerCase()
  const message = String(error.message ?? '')

  // shape provisional — re-verify with real key, T6 gate.
  if (httpStatus === 403) return 'forbidden'
  if (httpStatus === 401 || code === 'invalid_api_key') return 'auth'
  if (httpStatus === 429) {
    // §5.11 quota 신호: code 뿐 아니라 type/message('exceeded your current quota')도 —
    // 크레딧 소진 배치가 rate-limit(transient)로 오분류돼 재시도 폭주하지 않게.
    if (
      code === 'insufficient_quota'
      || type === 'insufficient_quota'
      || /exceeded your current quota/i.test(message)
    ) return 'quota'
    return 'transient'
  }
  if (TRANSIENT_STATUSES.has(httpStatus)) return 'transient'
  if (
    code === 'moderation_blocked'
    || code === 'content_policy_violation'
    || SAFETY_SIGNAL.test(type)
    || SAFETY_SIGNAL.test(message)
  ) return 'safety'
  if (httpStatus === 400) return 'invalid-input'
  return 'other'
}

function buildEditForm({ model, prompt, size, referenceImages }) {
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', prompt)
  form.append('size', size)
  referenceImages.forEach((ref, index) => {
    const bytes = Buffer.from(ref.data, 'base64')
    const blob = new Blob([bytes], { type: ref.mimeType || 'image/png' })
    form.append('image[]', blob, `ref${index}.png`)
  })
  return form
}

/**
 * 이미지 생성 (gpt-image-1).
 *
 * @param {object} params
 * @param {string} params.apiKey - 사용자 OpenAI API 키 (BYOK)
 * @param {string} params.prompt - 이미 스타일이 적용된 최종 프롬프트
 * @param {Array<{mimeType:string,data:string}>} [params.referenceImages] - raw base64 레퍼런스
 * @param {string} [params.aspectRatio] - 요청 aspect ratio
 * @param {string} [params.model]
 * @param {object} [deps]
 * @param {Function} [deps.fetchImpl] - 주입용 fetch (테스트)
 * @returns {Promise<{success:boolean, images?:Array<{base64:string,mimeType:string,dataUrl:string}>, actualAspectRatio?:string, error?:string, errorKind?:string}>}
 */
export async function generateImage(
  {
    apiKey,
    prompt,
    referenceImages = [],
    aspectRatio,
    model = DEFAULT_OPENAI_IMAGE_MODEL,
  } = {},
  { fetchImpl } = {}
) {
  if (!apiKey) return { success: false, error: 'No API key', errorKind: 'auth' }

  const {
    error: referenceError,
    referenceImages: normalizedReferenceImages,
  } = normalizeReferenceImages(referenceImages)
  if (referenceError) {
    return { success: false, error: referenceError, errorKind: 'invalid-input' }
  }

  const doFetch = fetchImpl ?? fetch
  const { size, actualAspectRatio } = mapImageAspect(aspectRatio)
  const selectedModel = model || DEFAULT_OPENAI_IMAGE_MODEL
  const finalPrompt = prompt || ''
  const hasReferences = normalizedReferenceImages.length > 0
  const url = hasReferences
    ? `${OPENAI_BASE}/images/edits`
    : `${OPENAI_BASE}/images/generations`
  const headers = { Authorization: `Bearer ${apiKey}` }
  const init = { method: 'POST', headers }

  if (hasReferences) {
    init.body = buildEditForm({
      model: selectedModel,
      prompt: finalPrompt,
      size,
      referenceImages: normalizedReferenceImages,
    })
  } else {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify({
      model: selectedModel,
      prompt: finalPrompt,
      size,
      n: 1,
    })
  }

  try {
    const response = await doFetch(url, init)
    const data = await safeJson(response)

    if (!response?.ok || data?.error) {
      return {
        success: false,
        error: openaiErrorMessage(response?.status, data),
        errorKind: classifyOpenaiError(response?.status, data),
      }
    }

    const base64 = data?.data?.[0]?.b64_json
    if (!base64) {
      return { success: false, error: 'No image was generated', errorKind: 'other' }
    }

    return {
      success: true,
      images: [{
        base64,
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${base64}`,
      }],
      actualAspectRatio,
    }
  } catch (error) {
    return {
      success: false,
      error: error?.message || String(error),
      errorKind: 'transient',
    }
  }
}

/**
 * OpenAI 키를 gpt-image-1 모델 조회로 가볍게 검증한다.
 *
 * @param {object} params
 * @param {string} params.apiKey
 * @param {object} [deps]
 * @param {Function} [deps.fetchImpl] - 주입용 fetch (테스트)
 * @returns {Promise<{valid:boolean,error?:string,errorKind?:string}>}
 */
export async function validateKey({ apiKey } = {}, { fetchImpl } = {}) {
  if (!apiKey) return { valid: false, error: 'No API key', errorKind: 'auth' }

  const doFetch = fetchImpl ?? fetch
  try {
    const response = await doFetch(`${OPENAI_BASE}/models/${DEFAULT_OPENAI_IMAGE_MODEL}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const data = await safeJson(response)
    if (response?.ok) return { valid: true }
    return {
      valid: false,
      error: openaiErrorMessage(response?.status, data),
      errorKind: classifyOpenaiError(response?.status, data),
    }
  } catch (error) {
    return {
      valid: false,
      error: error?.message || String(error),
      errorKind: 'transient',
    }
  }
}

/** Provider 객체 형태(레지스트리 §5.10용). */
export const openaiImageProvider = {
  id: 'openai',
  kind: 'image',
  generateImage,
  validateKey,
  catalogModel: DEFAULT_OPENAI_IMAGE_MODEL,
}
