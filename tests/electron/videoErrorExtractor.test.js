/**
 * extractServerErrorMessage — HTTP 4xx body 에서 server 에러 메시지 추출.
 *
 * Review finding 회귀 가드: Flow 비디오 API 가 quota 도달 시 HTTP 4xx + body 에
 * `{"error":{"message":"Resource has been exhausted..."}}` 를 반환하는데, 기존엔 body
 * 를 버려서 useVideoAutomation 의 quota 패턴 매칭이 한 번도 매치되지 않았다.
 *
 * 이 helper 는 body 가 있으면 parseFlowResponse 로 메시지를 추출해 그 회귀를 막는다.
 */

import { describe, it, expect, vi } from 'vitest'
import { extractServerErrorMessage } from '../../electron/ipc/videoErrorExtractor.js'

// shared.js 의 실제 parseFlowResponse 와 동일 동작 — `)]}'` 접두어 제거 + JSON parse.
function parseFlowResponse(text) {
  const cleaned = text.replace(/^\)\]\}',?\s*/, '').trim()
  if (!cleaned) return null
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

describe('extractServerErrorMessage', () => {
  it('netResult.message 가 있으면 그대로 반환 (Network.loadingFailed 케이스)', () => {
    const netResult = { error: true, message: 'net::ERR_INTERNET_DISCONNECTED' }
    expect(extractServerErrorMessage(netResult, parseFlowResponse))
      .toBe('net::ERR_INTERNET_DISCONNECTED')
  })

  it('body 에 quota 에러 JSON 이 있으면 error.message 를 반환 (회귀 핵심)', () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        message: 'Resource has been exhausted (e.g. check quota).',
        status: 'RESOURCE_EXHAUSTED',
      },
    })
    const netResult = { error: true, body, status: 429 }
    const msg = extractServerErrorMessage(netResult, parseFlowResponse)
    // message + status 합쳐서 노출 — 두 필드 다 quota 매칭 후보가 되도록.
    expect(msg).toContain('Resource has been exhausted (e.g. check quota).')
    expect(msg).toContain('RESOURCE_EXHAUSTED')
    expect(/resource has been exhausted/i.test(msg)).toBe(true)
  })

  it('회귀: message 는 generic 인데 status 만 quota 인 응답도 둘 다 노출', () => {
    const body = JSON.stringify({
      error: { message: 'Request failed', status: 'RESOURCE_EXHAUSTED' },
    })
    const netResult = { error: true, body, status: 429 }
    const msg = extractServerErrorMessage(netResult, parseFlowResponse)
    expect(msg).toContain('Request failed')
    expect(msg).toContain('RESOURCE_EXHAUSTED')
    // useVideoAutomation 의 quota 매칭이 이 합친 문자열에서 RESOURCE_EXHAUSTED 를 잡아낼 수 있다.
  })

  it('Flow 의 ")]}\'," 접두어가 있어도 정상 파싱', () => {
    const body = `)]}'\n` + JSON.stringify({ error: { message: 'quota exceeded' } })
    const netResult = { error: true, body, status: 429 }
    expect(extractServerErrorMessage(netResult, parseFlowResponse)).toBe('quota exceeded')
  })

  it('JSON 으로 해석 불가하면 body 일부(plain text) 폴백', () => {
    const body = 'RESOURCE_EXHAUSTED: please try again later'
    const netResult = { error: true, body, status: 429 }
    const msg = extractServerErrorMessage(netResult, parseFlowResponse)
    expect(msg).toContain('RESOURCE_EXHAUSTED')
  })

  it('body 도 message 도 없으면 status 기반 fallback', () => {
    const netResult = { error: true, status: 500 }
    expect(extractServerErrorMessage(netResult, parseFlowResponse))
      .toBe('HTTP 500: Video generation failed')
  })

  it('netResult 자체가 falsy 면 안전한 default', () => {
    expect(extractServerErrorMessage(null, parseFlowResponse)).toBe('Unknown error')
  })

  it('parseFlowResponse 가 안 넘어와도 body snippet 폴백', () => {
    const body = 'something failed'
    const netResult = { error: true, body, status: 400 }
    expect(extractServerErrorMessage(netResult, undefined)).toBe('something failed')
  })
})
