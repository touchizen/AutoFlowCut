import { describe, it, expect } from 'vitest'
import { isStaleRegistrationResponse, isStaleEntityErrorBody } from '../../electron/flow-character-api'

/**
 * #R37 BLOCKER 회귀 방지.
 *
 * 등록 복구(PATCH /flow/entities)가 실패했을 때 "entity 가 지워졌다"를 못 알아보면, 업로드
 * self-heal 이 막혀 ref 가 영구 복구 불능이 된다. 사용자에게 "Flow 라이브러리의 중복 캐릭터를
 * 지우세요"라고 안내하는 마당이라 실제로 밟는 경로다.
 *
 * 처음엔 isStaleEntityErrorBody(INVALID_ARGUMENT)를 재사용했는데 틀렸다 — 그건 reroll
 * (batchGenerateImages) **400** 전용이다. 이 PATCH 의 캡처 규약은 flow-character-api.js A2 주석:
 *   "PATCH /flow/entities 는 기존 entity 만 수정(없는 id 면 404) … client UUID 를 새로 만들면 NOT_FOUND"
 */
describe('isStaleRegistrationResponse — PATCH /flow/entities 의 stale 판정', () => {
  it('bare 404 는 wrong base/route 일 수 있어 stale 로 보지 않는다', () => {
    expect(isStaleRegistrationResponse({ status: 404, text: '' })).toBe(false)
  })

  it('HTTP 404 + body error.status=NOT_FOUND 일 때만 stale', () => {
    const text = JSON.stringify({ error: { status: 'NOT_FOUND', message: 'Entity not found' } })
    expect(isStaleRegistrationResponse({ status: 404, text })).toBe(true)
  })

  it('NOT_FOUND body 여도 HTTP 404 가 아니면 stale 로 보지 않는다', () => {
    const text = JSON.stringify({ error: { status: 'NOT_FOUND', message: 'Entity not found' } })
    expect(isStaleRegistrationResponse({ status: 400, text })).toBe(false)
  })

  // INVALID_ARGUMENT 는 "entity 는 멀쩡한데 요청이 잘못됨"일 수 있다. 그걸 stale 로 오인하면
  //   업로드 폴백이 돌아 **새 entity 를 만든다** — 정확히 이 작업이 고치려는 버그다.
  //   오판의 대가가 비대칭이라(놓치면 에러 토스트, 오인하면 중복 생성) 좁게 판정한다.
  it('400 + INVALID_ARGUMENT 는 stale 아님 — 오인하면 중복 entity 를 만든다', () => {
    const text = JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } })
    expect(isStaleRegistrationResponse({ status: 400, text })).toBe(false)
  })

  it('401 은 stale 아님 — 재업로드로 안 풀리고 entity 만 늘린다', () => {
    expect(isStaleRegistrationResponse({ status: 401, text: '' })).toBe(false)
  })

  it('500 은 stale 아님 (일시적 서버 오류)', () => {
    expect(isStaleRegistrationResponse({ status: 500, text: '' })).toBe(false)
  })

  it('content-policy 류 400 은 stale 아님 — status 게이트 유지', () => {
    const text = JSON.stringify({ error: { status: 'PERMISSION_DENIED' } })
    expect(isStaleRegistrationResponse({ status: 400, text })).toBe(false)
  })

  it('파싱 불가 body 여도 터지지 않는다', () => {
    expect(isStaleRegistrationResponse({ status: 400, text: '<html>oops' })).toBe(false)
    expect(isStaleRegistrationResponse(null)).toBe(false)
  })

  // 왜 기존 헬퍼를 못 쓰는지 못 박아둔다 — 다시 재사용하려는 시도를 여기서 막는다.
  it('기존 isStaleEntityErrorBody 는 404/NOT_FOUND 를 못 잡는다 (그래서 별도 함수가 필요했다)', () => {
    const notFound = JSON.stringify({ error: { status: 'NOT_FOUND' } })
    expect(isStaleEntityErrorBody(notFound)).toBe(false)
    expect(isStaleRegistrationResponse({ status: 404, text: notFound })).toBe(true)
  })
})
