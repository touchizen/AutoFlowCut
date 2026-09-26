/**
 * http.js — Google GenAI REST 공유 유틸.
 *
 * genai.js 에서 무동작 이동(M0a): fetch 재시도/백오프/429 정책·JSON 안전파싱·
 * 공통 상수. Google image/video provider 가 공유한다.
 *
 * 순수 모듈(Electron import 없음) → fetch/sleep 주입으로 단위 테스트 가능.
 */

export const GENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
export const DEFAULT_ASPECT_RATIO = '16:9'

export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * fetch 응답을 안전하게 JSON 으로 파싱. 비-JSON 응답(HTML 에러 페이지 등)도 죽지 않게.
 */
async function safeJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

// 일시적 과부하 후 재시도 대기 (attempt 0, 1). 길이 = 최대 재시도 횟수.
export const RETRY_BACKOFF_MS = [1000, 3000]

// 429(RPM/IPM 순간초과) 재시도 시 존중할 서버 retryDelay 상한.
// 이보다 길거나(=일일소진/billing) retryDelay 가 없으면 재시도하지 않고 그대로 반환 →
// downstream quota-stop(모달) 이 처리. 짧은 burst 만 흡수.
export const MAX_429_RETRY_DELAY_MS = 30000
// retryDelay 위에 더하는 소량 jitter — 다중 클라이언트 동시 재시도(thundering herd) 완화.
const RETRY_JITTER_MS = 500

function abortError() {
  return Object.assign(new Error('Operation aborted'), { name: 'AbortError' })
}

async function waitBeforeRetry(ms, sleepImpl, signal) {
  if (!signal) {
    await sleepImpl(ms)
    return
  }
  if (signal.aborted) throw abortError()

  let abortHandler
  const abortPromise = new Promise((_, reject) => {
    abortHandler = () => reject(abortError())
    signal.addEventListener?.('abort', abortHandler, { once: true })
  })
  try {
    await Promise.race([
      Promise.resolve().then(() => sleepImpl(ms)),
      abortPromise,
    ])
  } finally {
    signal.removeEventListener?.('abort', abortHandler)
  }
}

/** 일시적 과부하 응답인지 — 503 / UNAVAILABLE / "overloaded". 429(quota)는 제외(아래 별도 처리). */
function isTransientOverload(response, data) {
  if (response?.status === 503) return true
  if (data?.error?.status === 'UNAVAILABLE') return true
  return /overloaded|temporarily unavailable|try again later/i.test(data?.error?.message || '')
}

/**
 * 429 응답의 google.rpc.RetryInfo.retryDelay(예: "5s", "1.5s") → ms. 없으면 null.
 * Gemini 는 RPM/IPM 순간초과 시 짧은 retryDelay 를 주고, 일일소진/billing 차단 시엔
 * retryDelay 가 없거나(또는 매우 김) 다른 detail 만 준다 — 그 차이로 "흡수 vs quota-stop" 을 가른다.
 */
export function parseRetryDelayMs(data) {
  const details = data?.error?.details
  if (!Array.isArray(details)) return null
  for (const d of details) {
    if (typeof d?.['@type'] === 'string' && d['@type'].endsWith('RetryInfo')) {
      const rd = d.retryDelay
      if (typeof rd === 'string') {
        const m = /^([\d.]+)s$/.exec(rd.trim())
        if (m) { const v = Number(m[1]); if (Number.isFinite(v)) return Math.round(v * 1000) }
      }
    }
  }
  return null
}

/**
 * 공통 JSON 요청 헬퍼.
 *   - API 키를 `x-goog-api-key` 헤더로 전달 (URL ?key= 노출 회피 — 로그/Sentry
 *     breadcrumb 으로 키가 새는 것을 막음).
 *   - 503/UNAVAILABLE/"overloaded" 일시 오류는 백오프 재시도 (Gemini 이미지/Veo 는
 *     부하 시 503 을 흔히 뱉음 — 단발 blip 으로 씬 전체를 실패시키지 않게).
 * fetch/sleep 주입 가능 → 실제 네트워크·타이머 없이 테스트.
 *
 * @returns {Promise<{response:any, data:any}>}
 */
export async function genaiFetch(
  url,
  { apiKey, method = 'GET', body = null, signal } = {},
  { fetchImpl = fetch, sleepImpl = defaultSleep, maxRetries = RETRY_BACKOFF_MS.length, random = Math.random } = {}
) {
  const init = {
    method,
    headers: { 'x-goog-api-key': apiKey },
    ...(signal ? { signal } : {}),
  }
  if (body != null) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let attempt = 0
  for (;;) {
    let response
    try {
      response = await fetchImpl(url, init)
    } catch (e) {
      if (signal?.aborted) throw e
      if (attempt < maxRetries) {
        await waitBeforeRetry(RETRY_BACKOFF_MS[attempt], sleepImpl, signal)
        attempt += 1
        continue
      }
      throw e
    }
    const data = await safeJson(response)
    if (isTransientOverload(response, data) && attempt < maxRetries) {
      await waitBeforeRetry(RETRY_BACKOFF_MS[attempt], sleepImpl, signal)
      attempt += 1
      continue
    }
    // 429 RPM/IPM 순간초과 — RetryInfo.retryDelay 가 짧을 때만 그 지연만큼 재시도.
    // retryDelay 없음/김(=일일소진·billing) 은 재시도 없이 그대로 반환 → downstream quota-stop.
    if (response?.status === 429 && attempt < maxRetries) {
      const serverDelay = parseRetryDelayMs(data)
      if (serverDelay != null && serverDelay <= MAX_429_RETRY_DELAY_MS) {
        await waitBeforeRetry(
          serverDelay + Math.floor(random() * RETRY_JITTER_MS),
          sleepImpl,
          signal,
        )
        attempt += 1
        continue
      }
    }
    return { response, data }
  }
}
