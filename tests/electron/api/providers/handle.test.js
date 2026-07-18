import { describe, it, expect } from 'vitest'
import { encodeHandle, decodeHandle, HANDLE_PREFIX } from '../../../../electron/api/providers/handle.js'

describe('encodeHandle', () => {
  it('google → rawId 그대로 (prefix 없음, legacy 호환)', () => {
    expect(encodeHandle('google', 'operations/abc-123')).toBe('operations/abc-123')
    expect(encodeHandle('google', 'operations/abc-123')).not.toMatch(/^gen:v1:/)
  })

  it('비-google(grok) → gen:v1: + base64url', () => {
    const h = encodeHandle('grok', 'req-xyz')
    expect(h.startsWith(HANDLE_PREFIX)).toBe(true)
    // round-trip
    expect(decodeHandle(h)).toEqual({ provider: 'grok', rawId: 'req-xyz' })
  })

  it('fal → 객체 rawId {model_id, request_id} 흡수', () => {
    const raw = { model_id: 'fal-ai/veo', request_id: 'uuid-123' }
    const h = encodeHandle('fal', raw)
    expect(h.startsWith(HANDLE_PREFIX)).toBe(true)
    expect(decodeHandle(h)).toEqual({ provider: 'fal', rawId: raw })
  })

  it('wavespeed/higgsfield → string rawId', () => {
    expect(decodeHandle(encodeHandle('wavespeed', 'task-1'))).toEqual({ provider: 'wavespeed', rawId: 'task-1' })
    expect(decodeHandle(encodeHandle('higgsfield', 'job-1'))).toEqual({ provider: 'higgsfield', rawId: 'job-1' })
  })

  it('google rawId 가 string 아니면 throw (google=operationName string)', () => {
    expect(() => encodeHandle('google', { x: 1 })).toThrow()
    expect(() => encodeHandle('google', null)).toThrow()
  })

  it('unknown provider → throw (round-trip 못 하는 handle 방출 금지)', () => {
    expect(() => encodeHandle('openai', 'x')).toThrow()
    expect(() => encodeHandle('nope', 'x')).toThrow()
  })

  it('대칭: encode 가 방출한 handle 이 상한 초과면 encode 에서 throw (decode 거부 방지, F1)', () => {
    // 6KB 넘는 rawId → 인코딩 handle 이 8192 초과 → encode 에서 실패해야(영속 후 복구불가 방지)
    const huge = 'x'.repeat(7000)
    expect(() => encodeHandle('grok', huge)).toThrow(/maximum length/)
  })

  it('provider 별 rawId schema 위반 → throw', () => {
    // grok 은 string 이어야
    expect(() => encodeHandle('grok', { model_id: 'a', request_id: 'b' })).toThrow()
    // fal 은 {model_id, request_id} 여야
    expect(() => encodeHandle('fal', 'plain-string')).toThrow()
    expect(() => encodeHandle('fal', { model_id: 'a' })).toThrow() // request_id 누락
    expect(() => encodeHandle('fal', { model_id: 'a', request_id: 'b', extra: 1 })).toThrow() // 추가 필드
    // 빈 문자열 rawId 거부
    expect(() => encodeHandle('grok', '')).toThrow()
  })
})

describe('decodeHandle', () => {
  it('prefix 없음 → legacy google', () => {
    expect(decodeHandle('operations/abc-123')).toEqual({ provider: 'google', rawId: 'operations/abc-123' })
  })

  it('round-trip: encode → decode 동치', () => {
    for (const [p, raw] of [
      ['grok', 'r1'],
      ['fal', { model_id: 'm', request_id: 'r' }],
      ['wavespeed', 't1'],
      ['higgsfield', 'j1'],
    ]) {
      expect(decodeHandle(encodeHandle(p, raw))).toEqual({ provider: p, rawId: raw })
    }
  })

  it('malformed base64 → throw (google 폴백 금지)', () => {
    expect(() => decodeHandle('gen:v1:!!!not-base64!!!')).toThrow()
    expect(() => decodeHandle('gen:v1:')).toThrow() // 빈 payload
  })

  it('base64url 이지만 JSON 아님 → throw', () => {
    const notJson = Buffer.from('hello world', 'utf8').toString('base64url')
    expect(() => decodeHandle(HANDLE_PREFIX + notJson)).toThrow()
  })

  it('base64 padding/표준알파벳 등 non-canonical payload → throw (F2: 문자 규칙 §5.6c)', () => {
    // 유효 handle 에 padding '=' 을 붙이면 base64url charset 위반 → throw
    const valid = encodeHandle('grok', 'r1')
    expect(() => decodeHandle(valid + '=')).toThrow()
    // 표준 base64 알파벳('+','/')은 base64url 아님 → throw
    expect(() => decodeHandle(HANDLE_PREFIX + 'ab+/')).toThrow()
  })

  it('JSON 이 object 아닌 값으로 파싱 → throw (F3: number/array/null/string)', () => {
    const mk = (val) => HANDLE_PREFIX + Buffer.from(JSON.stringify(val), 'utf8').toString('base64url')
    expect(() => decodeHandle(mk(123))).toThrow()
    expect(() => decodeHandle(mk([1, 2]))).toThrow()
    expect(() => decodeHandle(mk(null))).toThrow()
    expect(() => decodeHandle(mk('just a string'))).toThrow()
  })

  it('fal rawId 가 배열 → throw (F3: array 는 object 아님)', () => {
    const mk = (obj) => HANDLE_PREFIX + Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url')
    expect(() => decodeHandle(mk({ provider: 'fal', rawId: ['model', 'req'] }))).toThrow()
  })

  it('provider allowlist 밖 → throw (google/openai 포함)', () => {
    const mk = (obj) => HANDLE_PREFIX + Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url')
    // google 은 handle 로 인코딩되지 않음 → prefix 붙은 google 은 malformed
    expect(() => decodeHandle(mk({ provider: 'google', rawId: 'x' }))).toThrow()
    expect(() => decodeHandle(mk({ provider: 'openai', rawId: 'x' }))).toThrow()
    expect(() => decodeHandle(mk({ provider: '__proto__', rawId: 'x' }))).toThrow()
  })

  it('추가 필드 있는 payload → throw', () => {
    const mk = (obj) => HANDLE_PREFIX + Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url')
    expect(() => decodeHandle(mk({ provider: 'grok', rawId: 'x', extra: 1 }))).toThrow()
    expect(() => decodeHandle(mk({ provider: 'grok' }))).toThrow() // rawId 누락
    expect(() => decodeHandle(mk({ rawId: 'x' }))).toThrow() // provider 누락
  })

  it('rawId schema 위반 payload → throw', () => {
    const mk = (obj) => HANDLE_PREFIX + Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url')
    expect(() => decodeHandle(mk({ provider: 'grok', rawId: { a: 1 } }))).toThrow() // grok=string
    expect(() => decodeHandle(mk({ provider: 'fal', rawId: 'str' }))).toThrow() // fal=object
    expect(() => decodeHandle(mk({ provider: 'fal', rawId: { model_id: 'm', request_id: 'r', x: 1 } }))).toThrow()
  })

  it('과도하게 긴 handle → throw (DoS/오염 방어)', () => {
    const huge = HANDLE_PREFIX + 'A'.repeat(100000)
    expect(() => decodeHandle(huge)).toThrow()
  })

  it('null/비문자 입력 → throw', () => {
    expect(() => decodeHandle(null)).toThrow()
    expect(() => decodeHandle(123)).toThrow()
  })
})
