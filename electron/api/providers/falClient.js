/**
 * falClient.js — fal.ai SDK queue transport shared by image/video adapters.
 *
 * fal is intentionally the only provider whose API transport uses an injected
 * SDK client instead of fetchImpl. Signed result assets are still fetched by
 * the common no-auth download path below.
 */
import { createFalClient } from '@fal-ai/client'

const CREDIT_SIGNAL = /(?:credit|balance)[ _-]?(?:exhausted|depleted|insufficient)|exhausted[ _-]?balance|insufficient[ _-]?(?:credit|quota)|payment[ _-]?required|top[ -]?up/i
const AUTH_SIGNAL = /invalid[ _-]?(?:api[ _-]?)?key|unauthori[sz]ed|invalid credentials/i
const SAFETY_SIGNAL = /content[ _-]?(?:filter|policy)|safety|moderation|nsfw/i
const FAL_ENDPOINT_ID = /^[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)+$/i

export function isValidFalEndpointId(id) {
  if (typeof id !== 'string' || /[:\s]/.test(id) || id.includes('//')) return false
  if (id.split('/').some(segment => segment === '.' || segment === '..')) return false
  try {
    if (new URL(id).protocol) return false
  } catch {
    // Plain fal endpoint ids are paths, not absolute URLs.
  }
  return FAL_ENDPOINT_ID.test(id)
}

function errorBody(error) {
  return error?.body ?? error?.response?.data ?? error?.cause?.body ?? null
}

function errorStatus(error) {
  const value = Number(error?.status ?? error?.response?.status)
  return Number.isInteger(value) ? value : null
}

function bodyText(body) {
  if (typeof body === 'string') return body
  try { return JSON.stringify(body ?? '') } catch { return '' }
}

/** PROVISIONAL — verify fal SDK exception status/body shapes with the M4 real-key gate. */
export function classifyFalError(error) {
  const status = errorStatus(error)
  const body = errorBody(error)
  const signal = `${error?.message ?? ''} ${bodyText(body)}`
  const hasCreditSignal = CREDIT_SIGNAL.test(signal)

  if (status === 402) return 'quota'
  if (status === 403 && hasCreditSignal) return 'quota'
  if (status === 403) return 'forbidden'
  if (status === 401 || AUTH_SIGNAL.test(signal)) return 'auth'
  if (hasCreditSignal) return 'quota'
  if (status === 429) return 'transient'
  if (status !== null && status >= 500 && status <= 599) return 'transient'
  if (SAFETY_SIGNAL.test(signal)) return 'safety'
  if (status === 400 || status === 422) return 'invalid-input'
  if (status === null) return 'transient'
  return 'other'
}

function nestedMessage(body) {
  if (typeof body === 'string' && body) return body
  if (typeof body?.detail === 'string' && body.detail) return body.detail
  if (typeof body?.error?.message === 'string' && body.error.message) return body.error.message
  if (typeof body?.message === 'string' && body.message) return body.message
  return null
}

export function falFailure(error, extras = {}) {
  const body = errorBody(error)
  return {
    success: false,
    ...extras,
    error: error?.message || nestedMessage(body) || String(error),
    errorKind: classifyFalError(error),
  }
}

export function configureFalClient(apiKey, client = null) {
  // Fable F1: 공유 싱글톤(fal)을 config()로 변조하지 않는다 — 동시 생성/validateKey 후보키가
  // 서로의 credentials 를 덮어써 in-flight 폴링이 엉뚱한 키로 실패하는 경합을 막는다.
  // prod: 매 operation 마다 credentials-scoped 클라이언트를 새로 만든다(격리). test: 주입 fake 사용.
  if (client) {
    client.config?.({ credentials: apiKey })
    return client
  }
  return createFalClient({ credentials: apiKey })
}

/**
 * SDK v1.10.1 has no non-billable credential-validation call. The real-key
 * submit smoke is therefore the authoritative validation gate for M4.
 */
export async function validateKey(
  { apiKey } = {},
  { client = null } = {}
) {
  if (!apiKey) return { valid: false, error: 'No API key', errorKind: 'auth' }
  try {
    // PROVISIONAL — SDK v1.10.1 엔 non-billable 키 검증 엔드포인트가 없다 → 실제 검증은 real-key
    // submit smoke 가 유일한 게이트(F3). 여기선 scoped 클라이언트만 만들고 싱글톤은 안 건드린다(F1).
    configureFalClient(apiKey, client)
    return { valid: true }
  } catch (error) {
    const failure = falFailure(error)
    return { valid: false, error: failure.error, errorKind: failure.errorKind }
  }
}

export const downloadPolicy = {
  origins: [{
    // PROVISIONAL — exact signed CDN origins must be frozen by the M4 real-key smoke.
    origin: 'https://fal.media',
    authMode: 'none',
  }],
  buildAuthHeaders() {
    return {}
  },
}

function originError(assetUrl) {
  let url
  try { url = new URL(String(assetUrl)) } catch { return 'Invalid fal asset URL' }
  if (url.protocol !== 'https:') return 'fal asset URL must use HTTPS'
  if (!downloadPolicy.origins.some(({ origin }) => origin === url.origin)) {
    return `fal asset URL origin not allowed: ${url.origin}`
  }
  return null
}

async function safeJson(response) {
  try { return await response?.json?.() } catch { return null }
}

/** Download a trusted fal signed asset without attaching provider credentials. */
export async function fetchFalAsset(
  assetUrl,
  { fetchImpl, defaultMimeType = 'application/octet-stream', signal } = {}
) {
  const policyError = originError(assetUrl)
  if (policyError) return { success: false, error: policyError, errorKind: 'invalid-config' }

  const doFetch = fetchImpl ?? fetch
  try {
    if (signal?.aborted) throw abortError()
    // authMode:none is load-bearing: never attach the fal key to this signed CDN URL.
    const response = await doFetch(assetUrl, {
      headers: {},
      ...(signal ? { signal } : {}),
    })
    if (signal?.aborted) throw abortError()
    if (!response?.ok) {
      const body = await safeJson(response)
      if (signal?.aborted) throw abortError()
      const error = Object.assign(
        new Error(nestedMessage(body) || `HTTP ${response?.status ?? '?'}`),
        { status: response?.status, body },
      )
      return falFailure(error)
    }
    const bytes = await response.arrayBuffer()
    if (signal?.aborted) throw abortError()
    const mimeType = response.headers?.get?.('content-type') || defaultMimeType
    return { success: true, base64: Buffer.from(bytes).toString('base64'), mimeType }
  } catch (error) {
    if (signal?.aborted) throw abortError()
    return falFailure(error)
  }
}

export function withAbortSignal(options, signal) {
  return signal ? { ...options, abortSignal: signal } : options
}

const FAL_DEADLINE_ERROR_NAME = 'FalDeadlineError'

function abortError() {
  return Object.assign(new Error('Operation aborted'), { name: 'AbortError' })
}

function deadlineError(message) {
  return Object.assign(new Error(message), { name: FAL_DEADLINE_ERROR_NAME })
}

export function isFalDeadlineError(error) {
  return error?.name === FAL_DEADLINE_ERROR_NAME
}

/** Bound one SDK/fetch await to an operation's absolute wall-clock deadline. */
export async function withFalDeadline(
  task,
  { deadline, signal, timeoutMessage } = {},
) {
  if (signal?.aborted) throw abortError()
  const remainingMs = Number(deadline) - Date.now()
  if (!(remainingMs > 0)) throw deadlineError(timeoutMessage)

  let timeoutId
  let abortHandler
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(deadlineError(timeoutMessage)),
      remainingMs,
    )
  })
  const contenders = [Promise.resolve().then(task), timeout]
  if (signal) {
    contenders.push(new Promise((_, reject) => {
      abortHandler = () => reject(abortError())
      signal.addEventListener?.('abort', abortHandler, { once: true })
    }))
  }

  try {
    return await Promise.race(contenders)
  } finally {
    clearTimeout(timeoutId)
    if (abortHandler) signal?.removeEventListener?.('abort', abortHandler)
  }
}

export function isFalPendingStatus(status) {
  // PROVISIONAL — SDK status values verified from v1.10.1 types; confirm live transitions.
  return status === 'IN_QUEUE' || status === 'IN_PROGRESS'
}

export function isFalCompletedStatus(status) {
  // PROVISIONAL — SDK status value verified from v1.10.1 types; confirm live transition.
  return status === 'COMPLETED'
}
