export const AGENT_MCP_SERVER_NAME = 'autoflowcut'

// 사람이 승인할 수 있는 시간은 prompt·ledger·orchestrator가 함께 쓰는 하나의 계약이다.
export const AGENT_APPROVAL_WINDOW_MS = 10 * 60 * 1000
// adapter 타이머가 prompt보다 먼저 시작되므로 transport 정리 여유를 승인 창 밖에 둔다.
export const AGENT_APPROVAL_TIMEOUT_MARGIN_MS = 30 * 1000
export const AGENT_ADAPTER_APPROVAL_TIMEOUT_MS =
  AGENT_APPROVAL_WINDOW_MS + AGENT_APPROVAL_TIMEOUT_MARGIN_MS

// D10 앱 ledger. 공급자별 추정 비용이 아니라 제품이 직접 관측할 수 있는 단위만 센다.
export const AGENT_SESSION_MAX_MS = 2 * 60 * 60 * 1000
export const AGENT_SESSION_MAX_TURNS = 64
export const AGENT_SESSION_MAX_TOOL_CALLS = 256
export const AGENT_CLAUDE_MAX_TURNS =
  2 * AGENT_SESSION_MAX_TURNS + AGENT_SESSION_MAX_TOOL_CALLS

// §5.1: cold catalog에서도 Default는 동기적으로 이 built-in 행에 resolve된다.
export const COLD_DEFAULT_MODEL_ID = 'codex:gpt-5.5'
// §6 setModel 실측이 정확한 문자열을 확정하기 전에는 Claude candidate를 승격하지 않는다.
export const CLAUDE_AGENT_DEFAULT_SDK_MODEL = null
