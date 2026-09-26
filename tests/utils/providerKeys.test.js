import { describe, it, expect } from 'vitest'
import { hasRequiredProviderKeys } from '../../src/utils/providerKeys'

describe('hasRequiredProviderKeys (§5.7 배치 시작 게이트)', () => {
  const byProvider = { google: false, openai: true, grok: false, fal: false, wavespeed: false, higgsfield: false }

  it('필요 provider 키가 모두 있으면 true', () => {
    expect(hasRequiredProviderKeys(['openai'], byProvider)).toBe(true)
  })

  it('필요 provider 중 하나라도 키 없으면 false', () => {
    expect(hasRequiredProviderKeys(['google'], byProvider)).toBe(false)
    expect(hasRequiredProviderKeys(['openai', 'google'], byProvider)).toBe(false)
  })

  it('google 키 없이 openai 만 있어도 openai 배치는 시작 가능 (핵심: google 게이트가 막지 않음)', () => {
    expect(hasRequiredProviderKeys(['openai'], byProvider)).toBe(true)
  })

  it('빈 provider 집합 → true (요구 없음)', () => {
    expect(hasRequiredProviderKeys([], byProvider)).toBe(true)
  })

  it('byProvider 에 없는 provider id → 키 확인 불가 → false (fail-closed)', () => {
    expect(hasRequiredProviderKeys(['unknownprov'], byProvider)).toBe(false)
  })

  it('중복 provider id 는 집합으로 취급', () => {
    expect(hasRequiredProviderKeys(['openai', 'openai'], byProvider)).toBe(true)
    expect(hasRequiredProviderKeys(['google', 'google'], byProvider)).toBe(false)
  })

  it('byProvider 누락/비객체 → false (fail-closed, 요구가 있을 때)', () => {
    expect(hasRequiredProviderKeys(['openai'], undefined)).toBe(false)
    expect(hasRequiredProviderKeys(['openai'], null)).toBe(false)
    // 요구가 없으면 byProvider 없어도 true
    expect(hasRequiredProviderKeys([], undefined)).toBe(true)
  })

  it('providerIds 가 배열 아님 → true (요구 없음으로 간주, 방어)', () => {
    expect(hasRequiredProviderKeys(undefined, byProvider)).toBe(true)
    expect(hasRequiredProviderKeys(null, byProvider)).toBe(true)
  })
})
