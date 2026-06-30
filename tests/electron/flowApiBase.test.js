// @vitest-environment node
//
// #R33: Flow API 호스트 동적 해석 — region/계정별 호스트 차이에도 직접 호출이 깨지지 않게.
import { describe, it, expect } from 'vitest'
import { captureApiOrigin, resolveApiBase } from '../../electron/flow-api-base.js'

describe('#R33: captureApiOrigin', () => {
  it('aisandbox googleapis 요청 URL 에서 origin 추출', () => {
    expect(captureApiOrigin('https://aisandbox-pa.googleapis.com/v1/flowMedia:batchGenerateImages'))
      .toBe('https://aisandbox-pa.googleapis.com')
  })
  it('region 변형 호스트도 추출', () => {
    expect(captureApiOrigin('https://eu-aisandbox-pa.googleapis.com/v1/flow/uploadImage'))
      .toBe('https://eu-aisandbox-pa.googleapis.com')
  })
  it('일반 googleapis 호스트도 추출', () => {
    expect(captureApiOrigin('https://content-aisandbox-pa.googleapis.com/v1/x'))
      .toBe('https://content-aisandbox-pa.googleapis.com')
  })
  it('Flow 페이지(labs.google) 등 비-API URL 은 null', () => {
    expect(captureApiOrigin('https://labs.google/fx/tools/flow/project/abc')).toBeNull()
  })
  it('#R33-fix: aisandbox 가 아닌 googleapis 호스트는 캡처하지 않는다(잘못된 host 로 직접호출 방지)', () => {
    expect(captureApiOrigin('https://storage.googleapis.com/bucket/x.png')).toBeNull()
    expect(captureApiOrigin('https://www.googleapis.com/oauth2/v1/userinfo')).toBeNull()
    expect(captureApiOrigin('https://fonts.googleapis.com/css2?family=Roboto')).toBeNull()
  })
  it('빈/잘못된 입력은 null', () => {
    expect(captureApiOrigin('')).toBeNull()
    expect(captureApiOrigin(null)).toBeNull()
    expect(captureApiOrigin('not a url')).toBeNull()
    expect(captureApiOrigin('ftp://aisandbox.googleapis.com/x')).toBeNull()
  })
})

describe('#R33: resolveApiBase', () => {
  const FALLBACK = 'https://aisandbox-pa.googleapis.com/v1'
  it('캡처 origin 이 있으면 origin/v1', () => {
    expect(resolveApiBase('https://eu-aisandbox-pa.googleapis.com', FALLBACK))
      .toBe('https://eu-aisandbox-pa.googleapis.com/v1')
  })
  it('origin 이 없으면 fallback', () => {
    expect(resolveApiBase(null, FALLBACK)).toBe(FALLBACK)
    expect(resolveApiBase('', FALLBACK)).toBe(FALLBACK)
    expect(resolveApiBase('garbage', FALLBACK)).toBe(FALLBACK)
  })
  it('origin 에 경로가 섞여 와도 origin 만 사용', () => {
    expect(resolveApiBase('https://aisandbox-pa.googleapis.com/v1/foo', FALLBACK))
      .toBe('https://aisandbox-pa.googleapis.com/v1')
  })
})
