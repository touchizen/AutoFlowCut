export const APPROVAL_PAYLOAD_VERSION = 1

/**
 * adapter가 `elicitInput.message`에 싣는 canonical 봉투.
 * 사람 문장이 아니라 main이 검증할 데이터라서 transport에서 자르거나 요약하지 않는다.
 */
export function encodeApprovalPayload(tool, args) {
  return JSON.stringify({ v: APPROVAL_PAYLOAD_VERSION, tool, args })
}

/**
 * main 전용 디코더. 손상된 봉투를 부분 해석하면 사람이 본 값과 grant가 다시 갈릴 수 있으므로
 * 전체 계약을 만족할 때만 tool/args를 돌려준다.
 */
export function decodeApprovalPayload(message) {
  if (typeof message !== 'string') return null

  try {
    const payload = JSON.parse(message)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    if (payload.v !== APPROVAL_PAYLOAD_VERSION) return null
    if (typeof payload.tool !== 'string' || !payload.tool) return null
    if (!payload.args || typeof payload.args !== 'object' || Array.isArray(payload.args)) return null
    return { tool: payload.tool, args: payload.args }
  } catch {
    return null
  }
}
