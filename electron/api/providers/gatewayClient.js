/**
 * Shared raw-REST async-queue transport for WaveSpeed/Higgsfield.
 *
 * Provider-specific API details stay in each thin client config. This layer owns
 * only the fixture-proven common mechanics: auth-header invocation, submit/poll,
 * HTTP-200 internal failures, native error mapping, validate, and asset gating.
 */

const CREDIT_SIGNAL = /insufficient[ _-]?(?:quota|credit)|credit[ _-]?(?:exhausted|depleted|insufficient)|payment[ _-]?required|balance(?:[ _-](?:low|exhausted|insufficient))?|top[ _-]?up/i
const AUTH_SIGNAL = /invalid[ _-]?(?:api[ _-]?)?key|unauthori[sz]ed|invalid credentials/i
const RATE_SIGNAL = /rate[ _-]?limit|too many requests|throttl/i
const SAFETY_SIGNAL = /content[ _-]?(?:filter|policy|safety)|safety|moderation|nsfw/i
const INVALID_INPUT_SIGNAL = /invalid[ _-]?(?:input|request|parameter|prompt|duration)|validation/i

function bodyText(payload) {
  if (typeof payload === 'string') return payload
  try { return JSON.stringify(payload ?? '') } catch { return '' }
}

function payloadMessage(payload, httpStatus) {
  if (typeof payload === 'string' && payload) return payload
  const nested = (typeof payload?.error === 'string' ? payload.error : payload?.error?.message)
    ?? payload?.detail?.message
    ?? payload?.detail
    ?? payload?.message
  return nested ? String(nested) : `HTTP ${httpStatus ?? '?'}`
}

function internalCode(payload) {
  return payload?.code ?? payload?.error?.code ?? null
}

function effectiveStatus(httpStatus, payload) {
  const numericCode = Number(internalCode(payload))
  if (httpStatus === 200 && Number.isInteger(numericCode) && numericCode >= 400 && numericCode <= 599) {
    return numericCode
  }
  return Number.isInteger(httpStatus) ? httpStatus : null
}

function hasInternalFailure(payload) {
  if (payload?.error) return true
  const code = internalCode(payload)
  if (code === null || code === undefined || code === '') return false
  const normalized = String(code).trim().toLowerCase()
  return !['0', '200', 'ok', 'success', 'succeeded'].includes(normalized)
}

/** Shared fixture-confirmed gateway error precedence (§5.11/G3). */
export function classifyGatewayError(httpStatus, payload) {
  const status = effectiveStatus(httpStatus, payload)
  const signal = `${internalCode(payload) ?? ''} ${bodyText(payload)}`
  const internalFailureInOkBody = httpStatus === 200 && hasInternalFailure(payload)

  if (status === 403) return 'forbidden'
  if (status === 401) return 'auth'
  if (status !== null && status >= 500 && status <= 599) return 'transient'
  if (status === 402) return 'quota'
  if (AUTH_SIGNAL.test(signal)) return 'auth'
  if (status === 429) return CREDIT_SIGNAL.test(signal) ? 'quota' : 'transient'
  if (SAFETY_SIGNAL.test(signal)) return 'safety'
  if (status === 400 || status === 422) return 'invalid-input'
  if (internalFailureInOkBody && CREDIT_SIGNAL.test(signal)) return 'quota'
  if (internalFailureInOkBody && RATE_SIGNAL.test(signal)) return 'transient'
  if (internalFailureInOkBody && INVALID_INPUT_SIGNAL.test(signal)) return 'invalid-input'
  return 'other'
}

async function safeJson(response) {
  try { return await response?.json?.() } catch { return null }
}

function networkFailure(error, extras = {}) {
  return {
    success: false,
    ...extras,
    error: error?.message || String(error),
    errorKind: 'transient',
  }
}

function credentialFailure(error) {
  return {
    success: false,
    error: error?.message || String(error),
    errorKind: 'auth',
  }
}

export function createGatewayClient({
  providerName,
  baseUrl,
  buildAuthHeaders,
  submitPath,
  pollPath,
  validatePath,
  classifyError,
  downloadPolicy,
} = {}) {
  const failure = (httpStatus, payload, extras = {}) => ({
    success: false,
    ...extras,
    error: payloadMessage(payload, httpStatus),
    errorKind: classifyError(httpStatus, payload),
  })

  const authHeaders = (apiKey) => {
    if (!apiKey) return { failure: credentialFailure(new Error('No API key')) }
    try {
      return { headers: buildAuthHeaders(apiKey) }
    } catch (error) {
      return { failure: credentialFailure(error) }
    }
  }

  const request = async ({ apiKey, path, method, input }, { fetchImpl } = {}) => {
    const auth = authHeaders(apiKey)
    if (auth.failure) return auth.failure
    const doFetch = fetchImpl ?? fetch
    const options = method === 'POST'
      ? {
          method: 'POST',
          headers: {
            Authorization: auth.headers.Authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input || {}),
        }
      : {
          method: 'GET',
          headers: { Authorization: auth.headers.Authorization },
        }
    try {
      const response = await doFetch(`${baseUrl}${path}`, options)
      const payload = await safeJson(response)
      if (!response?.ok || hasInternalFailure(payload)) {
        return failure(response?.status, payload)
      }
      return { success: true, payload }
    } catch (error) {
      return networkFailure(error)
    }
  }

  const submitTask = ({ apiKey, modelId, input } = {}, deps = {}) => request({
    apiKey,
    path: typeof submitPath === 'function' ? submitPath(modelId) : submitPath,
    method: 'POST',
    input,
  }, deps)

  const pollTask = ({ apiKey, taskId } = {}, deps = {}) => request({
    apiKey,
    path: typeof pollPath === 'function' ? pollPath(taskId) : pollPath,
    method: 'GET',
    input: undefined,
  }, deps)

  const validateKey = async ({ apiKey } = {}, deps = {}) => {
    const result = await request({
      apiKey,
      path: validatePath,
      method: 'GET',
      input: undefined,
    }, deps)
    if (result.success) return { valid: true }
    return { valid: false, error: result.error, errorKind: result.errorKind }
  }

  const assetOriginError = (assetUrl) => {
    let url
    try { url = new URL(String(assetUrl)) } catch { return `Invalid ${providerName} asset URL` }
    if (url.protocol !== 'https:') return `${providerName} asset URL must use HTTPS`
    if (!downloadPolicy.origins.some(({ origin }) => origin === url.origin)) {
      return `${providerName} asset URL origin not allowed: ${url.origin}`
    }
    return null
  }

  const fetchAsset = async (
    { apiKey, assetUrl } = {},
    { fetchImpl, defaultMimeType = 'application/octet-stream' } = {},
  ) => {
    if (!apiKey) return credentialFailure(new Error('No API key'))
    const originError = assetOriginError(assetUrl)
    if (originError) return { success: false, error: originError, errorKind: 'invalid-config' }

    let headers
    try {
      headers = downloadPolicy.buildAuthHeaders(apiKey)
    } catch (error) {
      return credentialFailure(error)
    }
    const doFetch = fetchImpl ?? fetch
    try {
      const response = await doFetch(assetUrl, { headers })
      if (!response?.ok) {
        const payload = await safeJson(response)
        return failure(response?.status, payload)
      }
      const bytes = await response.arrayBuffer()
      const mimeType = response.headers?.get?.('content-type') || defaultMimeType
      return { success: true, base64: Buffer.from(bytes).toString('base64'), mimeType }
    } catch (error) {
      return networkFailure(error)
    }
  }

  return { submitTask, pollTask, validateKey, fetchAsset, failure }
}
