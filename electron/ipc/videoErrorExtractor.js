/**
 * extractServerErrorMessage — HTTP error 응답에서 의미 있는 server 메시지 추출.
 *
 * Flow 비디오 API 가 HTTP 4xx/5xx 응답할 때 netResult 는 다음 형태로 들어온다:
 *   - { error: true, body: <string>, status: <number> }  (CDP getResponseBody 성공)
 *   - { error: true, message: <string> }                   (Network.loadingFailed, body 없음)
 *
 * body 가 있으면 parseFlowResponse 로 JSON 파싱 후 formatGoogleApiError 로 message + status
 * 를 합쳐 노출. JSON 해석 불가하면 body 일부 폴백.
 */

import { formatGoogleApiError } from './googleApiError.js'

export function extractServerErrorMessage(netResult, parseFlowResponse) {
  if (!netResult) return 'Unknown error'
  if (netResult.message) return netResult.message
  if (netResult.body) {
    const data = parseFlowResponse?.(netResult.body)
    if (data) {
      const inner = data.error && typeof data.error === 'object' ? data.error : data
      const msg = formatGoogleApiError(inner)
      if (msg) return msg
    }
    // JSON 으로 해석 불가하면 body 일부 폴백 — quota 문구가 plain text 일 수 있음.
    const snippet = String(netResult.body).slice(0, 500).trim()
    if (snippet) return snippet
  }
  return `HTTP ${netResult.status ?? '???'}: Video generation failed`
}
