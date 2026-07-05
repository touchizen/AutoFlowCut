import { describe, expect, it } from 'vitest'
import { getAuthErrorMessage, getAuthRequiredMessage } from '../../src/utils/authMessages.js'

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
