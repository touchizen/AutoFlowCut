/**
 * google/models.js — Google GenAI 모델 목록/키 검증.
 *
 * genai.js 에서 무동작 이동(M0a). 생성 quota 를 소비하지 않는 가벼운 GET.
 */
import { formatGoogleApiError } from '../../../ipc/googleApiError.js'
import { GENAI_BASE, genaiFetch } from '../http.js'

/**
 * API 키 유효성 검증. 생성 quota 를 소비하지 않는 가벼운 호출(models 목록 조회).
 *
 * @returns {Promise<{valid:boolean, error?:string}>}
 */
export async function validateApiKey({ apiKey } = {}, deps = {}) {
  if (!apiKey) return { valid: false, error: 'No API key' }

  try {
    const { response, data } = await genaiFetch(`${GENAI_BASE}/models`, { apiKey }, deps)

    if (data?.error) {
      return { valid: false, error: formatGoogleApiError(data.error) }
    }
    if (response.ok && Array.isArray(data?.models)) {
      return { valid: true }
    }
    return { valid: false, error: `HTTP ${response?.status ?? '?'} :: unexpected response` }
  } catch (error) {
    return { valid: false, error: error?.message || String(error) }
  }
}

/**
 * 사용 가능한 모델 전체 목록(raw). 카테고리 분류는 호출자(renderer) 가 담당.
 * nextPageToken 을 따라 모든 페이지를 수집한다. quota 미소비(가벼운 GET).
 *
 * @returns {Promise<{success:boolean, models?:Array<{id,displayName,description,methods}>, error?:string}>}
 */
export async function listModels({ apiKey } = {}, deps = {}) {
  if (!apiKey) return { success: false, error: 'No API key' }

  try {
    const models = []
    let pageToken = null
    do {
      const url = `${GENAI_BASE}/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      const { response, data } = await genaiFetch(url, { apiKey }, deps)
      if (data?.error) return { success: false, error: formatGoogleApiError(data.error) }
      if (!response?.ok || !Array.isArray(data?.models)) {
        return { success: false, error: `HTTP ${response?.status ?? '?'} :: unexpected response` }
      }
      for (const m of data.models) {
        models.push({
          id: (m.name || '').replace(/^models\//, ''),
          displayName: m.displayName || '',
          description: m.description || '',
          methods: m.supportedGenerationMethods || [],
        })
      }
      pageToken = data.nextPageToken || null
    } while (pageToken)
    return { success: true, models }
  } catch (error) {
    return { success: false, error: error?.message || String(error) }
  }
}
