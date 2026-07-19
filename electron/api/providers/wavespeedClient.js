/**
 * wavespeedClient.js — WaveSpeed-only raw REST queue transport.
 *
 * M6 fixture gate 전에는 다른 gateway와 공유하지 않는다. 아래 base URL, endpoint,
 * response code, status, result CDN/auth 규칙은 모두 real-key smoke 전 PROVISIONAL이다.
 */

// PROVISIONAL — re-verify the exact API origin with a real WaveSpeed key.
export const WAVESPEED_BASE_URL = 'https://api.wavespeed.ai'
// PROVISIONAL — the real result URL may be signed and use a different CDN origin.
export const WAVESPEED_CDN_ORIGIN = 'https://cdn.wavespeed.ai'

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

// PROVISIONAL — WaveSpeed may report a provider failure in an HTTP-200 JSON body.
function hasInternalFailure(payload) {
  if (payload?.error) return true
  const code = internalCode(payload)
  if (code === null || code === undefined || code === '') return false
  const normalized = String(code).trim().toLowerCase()
  return !['0', '200', 'ok', 'success', 'succeeded'].includes(normalized)
}

/** PROVISIONAL WaveSpeed native error → shared errorKind taxonomy. */
export function classifyWaveSpeedError(httpStatus, payload) {
  const status = effectiveStatus(httpStatus, payload)
  const signal = `${internalCode(payload) ?? ''} ${bodyText(payload)}`
  const internalFailureInOkBody = httpStatus === 200 && hasInternalFailure(payload)

  // Status boundaries are load-bearing: an inert pre-top-up account must not turn a real 401 into quota.
  if (status === 403) return 'forbidden'
  if (status === 401) return 'auth'
  if (status !== null && status >= 500 && status <= 599) return 'transient'
  if (AUTH_SIGNAL.test(signal)) return 'auth'
  // HTTP 402 Payment Required = credit 소진(G3, fal 패리티) — 문구 없이도 quota. top-up 전 무동작 배치 전패 방지.
  if (status === 402) return 'quota'
  if (status === 429) return CREDIT_SIGNAL.test(signal) ? 'quota' : 'transient'
  if (SAFETY_SIGNAL.test(signal)) return 'safety'
  if (status === 400 || status === 422) return 'invalid-input'
  if (internalFailureInOkBody && CREDIT_SIGNAL.test(signal)) return 'quota'
  if (internalFailureInOkBody && RATE_SIGNAL.test(signal)) return 'transient'
  if (internalFailureInOkBody && INVALID_INPUT_SIGNAL.test(signal)) return 'invalid-input'
  return 'other'
}

export function waveSpeedFailure(httpStatus, payload, extras = {}) {
  return {
    success: false,
    ...extras,
    error: payloadMessage(payload, httpStatus),
    errorKind: classifyWaveSpeedError(httpStatus, payload),
  }
}

function networkFailure(error, extras = {}) {
  return {
    success: false,
    ...extras,
    error: error?.message || String(error),
    errorKind: 'transient',
  }
}

async function safeJson(response) {
  try { return await response?.json?.() } catch { return null }
}

async function requestWaveSpeed(apiKey, url, options, { fetchImpl } = {}) {
  if (!apiKey) return { success: false, error: 'No API key', errorKind: 'auth' }
  const doFetch = fetchImpl ?? fetch
  try {
    const response = await doFetch(url, options)
    const payload = await safeJson(response)
    if (!response?.ok || hasInternalFailure(payload)) {
      return waveSpeedFailure(response?.status, payload)
    }
    return { success: true, payload }
  } catch (error) {
    return networkFailure(error)
  }
}

/**
 * Encode each model-id segment independently so '/' remains a path separator (G4).
 * PROVISIONAL — exact /api/v3 submit template requires the real-key smoke.
 */
// 손상된 persisted model 문자열이 host 내 임의 경로로 서명된 POST 를 겨냥하지 못하게(Fable F3):
// dot-segment('.'/'..')·빈 세그먼트는 encodeURIComponent 를 통과하므로 명시 거부.
function assertSafePathSegment(seg, label) {
  if (seg === '' || seg === '.' || seg === '..') {
    throw new Error(`Invalid ${label} segment: ${JSON.stringify(seg)}`)
  }
}

export function buildWaveSpeedSubmitPath(modelId) {
  const segments = String(modelId).split('/')
  segments.forEach((s) => assertSafePathSegment(s, 'model'))
  return `/api/v3/${segments.map(encodeURIComponent).join('/')}`
}

export async function submitWaveSpeedTask(
  { apiKey, modelId, input } = {},
  { fetchImpl } = {},
) {
  const path = buildWaveSpeedSubmitPath(modelId)
  return requestWaveSpeed(apiKey, `${WAVESPEED_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input || {}),
  }, { fetchImpl })
}

export async function pollWaveSpeedTask(
  { apiKey, taskId } = {},
  { fetchImpl } = {},
) {
  // PROVISIONAL — exact prediction-status path requires the real-key smoke.
  assertSafePathSegment(String(taskId), 'task') // Fable F3: '..'/빈 task_id path traversal 방지
  const path = `/api/v3/predictions/${encodeURIComponent(taskId)}`
  return requestWaveSpeed(apiKey, `${WAVESPEED_BASE_URL}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  }, { fetchImpl })
}

/**
 * PROVISIONAL lightweight credential check based on the WaveSpeed Bearer-auth docs.
 * A real-key submit smoke remains authoritative until this endpoint is verified.
 */
export async function validateWaveSpeedKey(
  { apiKey } = {},
  { fetchImpl } = {},
) {
  const result = await requestWaveSpeed(apiKey, `${WAVESPEED_BASE_URL}/api/v3/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  }, { fetchImpl })
  if (result.success) return { valid: true }
  return {
    valid: false,
    error: result.error,
    errorKind: result.errorKind,
  }
}

export const downloadPolicy = {
  origins: [{
    // PROVISIONAL — real-key smoke re-verifies both origin and provider-key auth mode.
    // The actual result may be a signed URL, in which case authMode becomes 'none'.
    origin: WAVESPEED_CDN_ORIGIN,
    authMode: 'provider-key',
  }],
  buildAuthHeaders(creds) {
    return { Authorization: `Bearer ${creds}` }
  },
}

function assetOriginError(assetUrl) {
  let url
  try { url = new URL(String(assetUrl)) } catch { return 'Invalid WaveSpeed asset URL' }
  if (url.protocol !== 'https:') return 'WaveSpeed asset URL must use HTTPS'
  if (!downloadPolicy.origins.some(({ origin }) => origin === url.origin)) {
    return `WaveSpeed asset URL origin not allowed: ${url.origin}`
  }
  return null
}

/** Download a trusted provisional WaveSpeed result asset with provider Bearer auth. */
export async function fetchWaveSpeedAsset(
  { apiKey, assetUrl } = {},
  { fetchImpl, defaultMimeType = 'video/mp4' } = {},
) {
  if (!apiKey) return { success: false, error: 'No API key', errorKind: 'auth' }
  const originError = assetOriginError(assetUrl)
  if (originError) return { success: false, error: originError, errorKind: 'invalid-config' }

  const doFetch = fetchImpl ?? fetch
  try {
    const response = await doFetch(assetUrl, {
      headers: downloadPolicy.buildAuthHeaders(apiKey),
    })
    if (!response?.ok) {
      const payload = await safeJson(response)
      return waveSpeedFailure(response?.status, payload)
    }
    const bytes = await response.arrayBuffer()
    const mimeType = response.headers?.get?.('content-type') || defaultMimeType
    return { success: true, base64: Buffer.from(bytes).toString('base64'), mimeType }
  } catch (error) {
    return networkFailure(error)
  }
}
