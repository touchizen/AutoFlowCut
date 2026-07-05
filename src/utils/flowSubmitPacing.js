export const FLOW_SUBMIT_PACING_MIN_MS = 20000
export const FLOW_SUBMIT_PACING_MAX_MS = 40000

export function getFlowSubmitPacingDelayMs(random = Math.random) {
  return FLOW_SUBMIT_PACING_MIN_MS + Math.floor(random() * (FLOW_SUBMIT_PACING_MAX_MS - FLOW_SUBMIT_PACING_MIN_MS + 1))
}
