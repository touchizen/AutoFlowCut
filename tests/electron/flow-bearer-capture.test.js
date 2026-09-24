// @vitest-environment node
//
// Flow 페이지가 스스로 보내는 aisandbox 요청의 Authorization: Bearer 를 main 에서 잡아 세션 대용으로 쓴다.
//
// 2026-09-23: flow.google.com 에는 세션 API 가 없다(/fx/api/auth/session, /api/auth/session 모두 SPA
// HTML 폴백 — Desktop autoflowcut-net-2026-09-23T08-59-52 덤프). 반면 페이지는 프로젝트를 열면
// GET /v1/credits, GET /v1/flow/models/statuses 를 Bearer 로 계속 호출한다(2026-07-29 덤프, 각 20회).
// 그 헤더를 webRequest.onBeforeSendHeaders 에서 잡아두면 세션 API 없이도 토큰이 나온다.
import { describe, it, expect } from 'vitest'
import { bearerFromHeaders, isFlowApiRequest, createBearerStore, BEARER_MAX_AGE_MS } from '../../electron/flow-bearer-capture.js'

describe('bearerFromHeaders', () => {
  it('Authorization: Bearer <token> 에서 토큰만 — 헤더 이름 대소문자 무관', () => {
    expect(bearerFromHeaders({ Authorization: 'Bearer ya29.abc' })).toBe('ya29.abc')
    expect(bearerFromHeaders({ authorization: 'bearer ya29.abc' })).toBe('ya29.abc')
  })
  it('Bearer 가 아니거나 없으면 null', () => {
    expect(bearerFromHeaders({ Authorization: 'Basic xyz' })).toBeNull()
    expect(bearerFromHeaders({ 'X-Goog-AuthUser': '0' })).toBeNull()
    expect(bearerFromHeaders(null)).toBeNull()
  })
})

describe('isFlowApiRequest', () => {
  it('aisandbox googleapis 호스트만 — 다른 googleapis 는 제외', () => {
    expect(isFlowApiRequest('https://aisandbox-pa.googleapis.com/v1/credits')).toBe(true)
    expect(isFlowApiRequest('https://fonts.googleapis.com/css')).toBe(false)
    expect(isFlowApiRequest('https://www.googleapis.com/oauth2/v3/tokeninfo')).toBe(false)
  })
})

describe('createBearerStore', () => {
  it('비어 있으면 null', () => {
    expect(createBearerStore().sessionText(1000)).toBeNull()
  })

  it('잡아둔 토큰은 세션 본문 모양({access_token}) 으로 나온다 — 옛 세션 파서가 그대로 읽는다', () => {
    const s = createBearerStore()
    s.set('ya29.abc', 1000)
    expect(JSON.parse(s.sessionText(1000 + 5 * 60 * 1000))).toEqual({ access_token: 'ya29.abc' })
  })

  it('BEARER_MAX_AGE_MS 를 넘긴 토큰은 null — 만료 토큰으로 생성을 시작하지 않는다', () => {
    const s = createBearerStore()
    s.set('ya29.abc', 1000)
    expect(s.sessionText(1000 + BEARER_MAX_AGE_MS + 1)).toBeNull()
  })

  it('새 토큰이 오면 갈아탄다', () => {
    const s = createBearerStore()
    s.set('old', 1000)
    s.set('new', 2000)
    expect(JSON.parse(s.sessionText(2500)).access_token).toBe('new')
  })
})
