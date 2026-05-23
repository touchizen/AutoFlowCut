/**
 * quotaStop — Flow 일일 quota 소진 감지 + 일관된 stop 정책 적용.
 *
 * 배경:
 *   여러 hook (useAutomation, useReferenceGeneration, useVideoAutomation,
 *   useSceneGeneration, useStyleThumbnails) 이 각각 quota detection 을 들고
 *   있어 (a) 패턴 매칭 불일치, (b) stop 정책 (queue clear 등) 누락, (c) UI
 *   singleton 직접 import 같은 계층 violation 이 누적됐다.
 *
 *   이 모듈은 단일 진실 공급원이다:
 *     - normalizeErrorText: 어떤 형태의 error 도 검사 가능한 문자열로 정규화
 *     - isQuotaExhaustedError: 정규화 후 패턴 매칭
 *     - emitQuotaStop: hook 들이 호출하는 단일 stop 트리거 (queue clear + event)
 *     - subscribeQuotaStop: UI Provider 가 모달을 띄우기 위해 구독
 *     - notifyQuotaModalDismissed: 사용자가 모달 닫을 때 호출 → unblock
 *
 *   이렇게 분리하면 hook 은 UI 컴포넌트를 import 하지 않고, 새 생성 경로가
 *   추가돼도 emitQuotaStop 한 줄만 호출하면 정책이 자동 적용된다.
 */

const PATTERNS = [
  /resource has been exhausted/i,
  /RESOURCE_EXHAUSTED/,
  /check quota/i,
  /quota exceeded/i,
]

/**
 * 어떤 형태의 error 입력도 검사 가능한 문자열로 정규화.
 *
 * 실제 IPC/API/throw 경로에서 들어오는 값:
 *   - string                          → 그대로
 *   - Error                           → err.message
 *   - { message }                     → message
 *   - { error: 'text' }               → error
 *   - { error: { message, status } }  → error.message
 *   - { status, statusText }          → "status: statusText"
 *   - 그 외 object                     → JSON.stringify (best-effort)
 *
 * 회귀 방지: 기존 isQuotaExhaustedError 가 string-only 였어서 IPC 에서 object 로
 * 올라온 quota 에러를 영영 매칭 못 했다. 이 정규화로 그 회귀를 막는다.
 */
export function normalizeErrorText(err) {
  if (err == null) return ''
  if (typeof err === 'string') return err
  if (typeof err === 'number' || typeof err === 'boolean') return String(err)
  if (err instanceof Error) return err.message || String(err)
  if (typeof err === 'object') {
    // 회귀 가드: 서버가 generic message 와 의미있는 status 를 함께 주는 경우
    // (예: { error: { message: "Request failed", status: "RESOURCE_EXHAUSTED" } })
    // message 만 보면 quota 감지 실패. 둘 다 있으면 합쳐서 두 필드 모두 검사 대상.
    if (typeof err.error === 'object' && err.error !== null) {
      const parts = []
      if (err.error.message) parts.push(String(err.error.message))
      if (err.error.status) parts.push(String(err.error.status))
      if (parts.length > 0) return parts.join(' :: ')
    }
    if (typeof err.message === 'string' || err.status != null) {
      const parts = []
      if (typeof err.message === 'string') parts.push(err.message)
      if (err.status != null) parts.push(`${err.status}${err.statusText ? `: ${err.statusText}` : ''}`)
      if (parts.length > 0) return parts.join(' :: ')
    }
    if (typeof err.error === 'string') return err.error
    try { return JSON.stringify(err) } catch { return String(err) }
  }
  return String(err)
}

/**
 * Flow 응답이 quota 소진인지 판정. 어떤 형태의 입력도 normalize 후 검사.
 */
export function isQuotaExhaustedError(err) {
  const text = normalizeErrorText(err)
  if (!text) return false
  return PATTERNS.some((re) => re.test(text))
}

// ─── Event bus ────────────────────────────────────────────────────────────────
// Toast 와 같은 module-level singleton 패턴 — Provider 가 mount 시 subscribe.
// hook 은 UI 컴포넌트를 import 하지 않고 emit 만 하면 된다.

const listeners = new Set()
let blockUntilDismiss = false  // 모달이 떠 있는 동안엔 새 enqueue 차단

/** UI Provider 가 quota stop 발생을 받기 위해 구독. 반환된 unsubscribe 호출로 해제. */
export function subscribeQuotaStop(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 모달이 떠 있는 동안 quota-block 상태인지 — useGenerationQueue 가 enqueue 차단에 사용. */
export function isQuotaBlocked() {
  return blockUntilDismiss
}

/** 사용자가 모달의 OK 를 눌렀을 때 호출 — block 해제. */
export function notifyQuotaModalDismissed() {
  blockUntilDismiss = false
}

/**
 * Quota stop 트리거 — 모든 batch hook 의 단일 진입점.
 *
 * @param {object} ctx
 * @param {{ current: boolean }} [ctx.stopRequestedRef] - 호출한 batch 의 stop 플래그
 * @param {string} [ctx.scope] - 로깅용 식별자 ('Automation' / 'GenerateRef' / ...)
 * @returns {boolean} 이번 호출이 새 quota 시퀀스의 첫 트리거인지
 *
 * 설계:
 *   - listeners (queue clear + 모달 표시) 는 매번 호출. 각 listener 가 자기 idempotency
 *     를 책임진다 (queue 비우기는 빈 큐에 no-op, setIsOpen(true)는 React idempotent).
 *   - 이렇게 한 이유: caller A 가 clearQueue 책임 없이 먼저 emit → caller B 가 clearQueue
 *     포함해 emit 했는데 firstTrigger=false 라서 큐가 안 비워지는 회귀 (review 지적).
 *     queue 가 직접 subscribe 하면 caller 책임이 사라져 회귀 자체가 봉쇄됨.
 *   - console.warn 만 firstTrigger 가드 (로그 노이즈 방지).
 */
export function emitQuotaStop({ stopRequestedRef, scope = 'Unknown' } = {}) {
  if (stopRequestedRef) stopRequestedRef.current = true
  const firstTrigger = !blockUntilDismiss
  blockUntilDismiss = true

  if (firstTrigger) {
    console.warn(`[${scope}] Flow quota exhausted — stopping batch`)
  }

  for (const listener of listeners) {
    try { listener({ scope, firstTrigger }) } catch (e) { console.warn(`[${scope}] quota listener threw:`, e?.message) }
  }

  return firstTrigger
}

/**
 * 테스트용 — 모듈 상태 리셋. Production 코드에서 호출 금지.
 */
export function __resetQuotaStopForTests() {
  listeners.clear()
  blockUntilDismiss = false
}
