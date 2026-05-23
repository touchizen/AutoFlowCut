/**
 * formatGoogleApiError — Google API 에러 객체에서 message + status 를 합쳐 반환.
 *
 * Google API 응답은 종종 generic 한 message 와 의미있는 status (예: "RESOURCE_EXHAUSTED")
 * 를 분리해서 보낸다:
 *   { error: { message: "Request failed", status: "RESOURCE_EXHAUSTED" } }
 *
 * 기존 코드들은 `data.error.message || JSON.stringify(data.error)` 로만 추출해서 status
 * 를 통째로 버렸다. 결과적으로 renderer 의 isQuotaExhaustedError 매칭이 message 의
 * "Request failed" 만 보고 quota 감지에 실패. video / image / 어디든 같은 회귀가 반복됐다.
 *
 * 이 함수는 두 필드를 모두 살려서 ` :: ` 로 합친다. renderer 측 quota detector 가
 * 어느 한쪽에서라도 패턴을 잡으면 OK.
 */
export function formatGoogleApiError(err) {
  if (!err) return null
  if (typeof err === 'string') return err
  if (typeof err !== 'object') return String(err)

  const parts = []
  if (err.message) parts.push(String(err.message))
  if (err.status) parts.push(String(err.status))
  if (parts.length > 0) return parts.join(' :: ')

  try { return JSON.stringify(err) } catch { return String(err) }
}
