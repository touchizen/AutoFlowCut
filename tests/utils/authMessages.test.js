import { describe, expect, it } from 'vitest'
import { getAuthErrorMessage, getAuthRequiredMessage, authErrorIsMachineToken } from '../../src/utils/authMessages.js'

const t = (map) => (key) => map[key] || key

describe('authMessages', () => {
  it('uses Flow login guidance in Flow mode', () => {
    expect(getAuthErrorMessage('flow', t({
      'status.flowAuthErrorStopped': 'Flow에 로그인 후 다시 시도해주세요.',
      'status.authErrorStopped': 'API 키를 확인해주세요.',
    }))).toBe('Flow에 로그인 후 다시 시도해주세요.')
  })

  it('uses API key guidance in API mode', () => {
    expect(getAuthErrorMessage('api', t({
      'status.flowAuthErrorStopped': 'Flow에 로그인 후 다시 시도해주세요.',
      'status.authErrorStopped': 'API 키를 확인해주세요.',
    }))).toBe('API 키를 확인해주세요.')
  })

  it('falls back to mode-specific English messages when locale keys are missing', () => {
    expect(getAuthErrorMessage('flow', (key) => key)).toMatch(/Flow/i)
    expect(getAuthErrorMessage('api', (key) => key)).toMatch(/API key/i)
  })

  it('uses Flow login-required guidance for no-token preflight in Flow mode', () => {
    expect(getAuthRequiredMessage('flow', t({
      'toast.flowLoginRequired': 'Flow 창에서 로그인해주세요.',
      'status.loginRequired': 'API 키가 필요합니다.',
    }))).toBe('Flow 창에서 로그인해주세요.')
  })

  it('uses API-key required guidance for no-token preflight in API mode', () => {
    expect(getAuthRequiredMessage('api', t({
      'toast.flowLoginRequired': 'Flow 창에서 로그인해주세요.',
      'status.loginRequired': 'API 키가 필요합니다.',
    }))).toBe('API 키가 필요합니다.')
  })
})

// M1-9: Flow 세션 판정 이유(flow:session-status.reason)별 안내. 로그인이 답인 이유만 flowLoginRequired,
//   서버/네트워크 쪽(500·code 3·timeout)은 flowSessionCheckFailed 에 이유를 넣어 보여준다.
describe('getAuthRequiredMessage — Flow 세션 이유 (M1-9)', () => {
  const tt = (key, params = {}) => ({
    'toast.flowLoginRequired': 'Flow 창에서 로그인해주세요.',
    'toast.flowSessionCheckFailed': `Flow 세션을 확인하지 못했습니다(${params.reason}).`,
    'status.loginRequired': 'API 키가 필요합니다.',
  })[key] || key

  it.each(['wiz-missing', 'not-on-flow', 'flow-inactive', 'rpc:er:16', 'rpc:http:401', undefined, null])('%s → flowLoginRequired', (reason) => {
    expect(getAuthRequiredMessage('flow', tt, reason)).toBe('Flow 창에서 로그인해주세요.')
  })

  it.each(['rpc:http:500', 'rpc:er:3', 'timeout', 'rpc:network:xhr-error', 'rpc:shape'])('%s → flowSessionCheckFailed(reason)', (reason) => {
    expect(getAuthRequiredMessage('flow', tt, reason)).toBe(`Flow 세션을 확인하지 못했습니다(${reason}).`)
  })

  it('로케일 키가 없어도 이유가 들어간 영어 폴백', () => {
    expect(getAuthRequiredMessage('flow', (k) => k, 'timeout')).toMatch(/timeout/)
    expect(getAuthRequiredMessage('flow', (k) => k, 'timeout')).not.toContain('{reason}')
  })

  it('API 모드는 이유와 무관하게 API 키 안내', () => {
    expect(getAuthRequiredMessage('api', tt, 'rpc:http:500')).toBe('API 키가 필요합니다.')
  })
})

// main 병합(리뷰 A F2): 인증 실패 결과의 error 가 기계 토큰인지(사람 안내 문구로 바꿀지) — 한 술어로 모은다.
//   Flow(main)의 authFailed 결과는 flow-* kind 와 이유 토큰(not-on-flow·wiz-missing·flow-rpc-error)을 싣는다 → 안내 문구.
//   multi-provider(브랜치)의 API 결과는 §5.11 로 errorKind:'auth' 와 provider 의 사람 메시지를 싣는다 → 그대로 보인다(어느 provider 키인지 알 수 있게).
//   kind 없는 옛 결과("Auth expired …")도 그대로.
describe('authErrorIsMachineToken', () => {
  it("flow-* 등 'auth' 가 아닌 kind 면 기계 토큰", () => {
    expect(authErrorIsMachineToken({ authFailed: true, errorKind: 'flow-session-missing', error: 'not-on-flow' })).toBe(true)
    expect(authErrorIsMachineToken({ authFailed: true, errorKind: 'flow-rpc-error', error: 'flow-rpc-error' })).toBe(true)
  })
  it("errorKind 'auth'(provider 분류) 또는 kind 없음이면 기계 토큰이 아니다", () => {
    expect(authErrorIsMachineToken({ authFailed: true, errorKind: 'auth', error: 'Incorrect API key provided: sk-…abcd' })).toBe(false)
    expect(authErrorIsMachineToken({ authFailed: true, error: 'Auth expired — please re-login' })).toBe(false)
    expect(authErrorIsMachineToken({ authFailed: true, errorKind: null, error: 'x' })).toBe(false)
    expect(authErrorIsMachineToken(null)).toBe(false)
  })
})
