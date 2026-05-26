// @vitest-environment node

/**
 * matchGenerationForResponse — async batchGenerateImages 응답을 올바른 generation 에 매칭.
 *
 * 회귀(P1): 기존 flow:report-response 핸들러(main.js)는 "가장 최근 등록된 미완료
 * generation"에 응답을 꽂았다 (newest-wins, 상관키 없음). 생성이 겹치면 응답이
 * 엉뚱한 gen 으로 가서 원래 gen 은 timeout, 최신 gen 은 남의 이미지로 completed 됐다.
 *
 * 코드리뷰 후속:
 *   P1#1 — promptKey substring(includes) 매칭은 "cat" ⊂ "cathedral" 오매칭 가능
 *          → request body 를 JSON parse 해 prompt 를 '정확히' 비교.
 *   P1#2 — 매칭 실패 시 oldest-FIFO fallback 은 오매칭 재생산
 *          → fail-closed: 유일하게 결정될 때만 반환, 모호하면 null(→ timeout, 가시적).
 *   P2  — prompt 동률일 때 reference mediaIds / seed / aspectRatio 시그니처로 tie-break.
 */

import { describe, it, expect } from 'vitest'
import { matchGenerationForResponse } from '../../../electron/ipc/generationMatch.js'

function gen(promptKey, { completed = false, refMediaIds = [], reqSeed = null, reqAspectRatio = null } = {}) {
  return { promptKey, completed, refMediaIds, reqSeed, reqAspectRatio, responses: [], expectedCount: 1 }
}

function reqBody(prompt, { refMediaIds = [], seed, aspectRatio } = {}) {
  const r = { prompt }
  if (seed != null) r.seed = seed
  if (aspectRatio) r.imageAspectRatio = aspectRatio
  if (refMediaIds.length) r.referenceImages = refMediaIds.map((m) => ({ mediaId: m }))
  return JSON.stringify({ requests: [r] })
}

describe('matchGenerationForResponse', () => {
  it('routes a response to the gen whose prompt is in the request body, not the newest', () => {
    const pending = new Map()
    pending.set('gen-A', gen('a knight standing at a castle gate'))
    pending.set('gen-B', gen('a dragon flying over snowy mountains'))

    const matched = matchGenerationForResponse(pending, reqBody('a knight standing at a castle gate'))

    expect(matched).toBe('gen-A')
  })

  it('does NOT substring-match: "cat" gen must not capture a "cathedral interior" response', () => {
    // P1#1 회귀 — includes() 였으면 "cathedral interior" 가 "cat" 을 포함해 오매칭됐다.
    const pending = new Map()
    pending.set('gen-cat', gen('cat'))
    pending.set('gen-cathedral', gen('cathedral interior'))

    const matched = matchGenerationForResponse(pending, reqBody('cathedral interior'))

    expect(matched).toBe('gen-cathedral')
  })

  it('falls back to the only incomplete gen when the request body is unavailable', () => {
    const pending = new Map()
    pending.set('gen-A', gen('only one prompt'))

    expect(matchGenerationForResponse(pending, null)).toBe('gen-A')
  })

  it('returns null (fail-closed) when body is unavailable and 2+ gens are pending', () => {
    // P1#2 — body 없을 때 oldest-FIFO 로 임의 배달하면 "남의 이미지 저장". 차라리 버린다.
    const pending = new Map()
    pending.set('gen-A', gen('first prompt'))
    pending.set('gen-B', gen('second prompt'))

    expect(matchGenerationForResponse(pending, null)).toBe(null)
  })

  it('returns null when the request prompt matches no incomplete gen', () => {
    // 이미 완료된 gen 의 잉여 응답이거나 미지의 응답 — 죄 없는 미완료 gen 에 꽂지 않는다.
    const pending = new Map()
    pending.set('gen-A', gen('finished prompt', { completed: true }))
    pending.set('gen-B', gen('other prompt'))

    expect(matchGenerationForResponse(pending, reqBody('finished prompt'))).toBe(null)
  })

  it('skips completed gens when falling back', () => {
    const pending = new Map()
    pending.set('gen-A', gen('first prompt', { completed: true }))
    pending.set('gen-B', gen('second prompt'))

    expect(matchGenerationForResponse(pending, null)).toBe('gen-B')
  })

  it('matches prompts containing JSON-escaped characters (quotes, newlines)', () => {
    const tricky = 'a sign reading "OPEN"\nwith bold letters'
    const pending = new Map()
    pending.set('gen-plain', gen('plain prompt'))
    pending.set('gen-tricky', gen(tricky))

    expect(matchGenerationForResponse(pending, reqBody(tricky))).toBe('gen-tricky')
  })

  it('tie-breaks same-prompt gens by reference mediaIds', () => {
    // P2 — 같은 styled prompt 라도 reference 가 다르면 request signature 로 구분.
    const pending = new Map()
    pending.set('gen-A', gen('same prompt', { refMediaIds: ['m1'] }))
    pending.set('gen-B', gen('same prompt', { refMediaIds: ['m2'] }))

    const matched = matchGenerationForResponse(pending, reqBody('same prompt', { refMediaIds: ['m2'] }))

    expect(matched).toBe('gen-B')
  })

  it('returns null when same-prompt gens are indistinguishable (truly ambiguous)', () => {
    const pending = new Map()
    pending.set('gen-A', gen('same prompt', { refMediaIds: ['m1'] }))
    pending.set('gen-B', gen('same prompt', { refMediaIds: ['m1'] }))

    expect(matchGenerationForResponse(pending, reqBody('same prompt', { refMediaIds: ['m1'] }))).toBe(null)
  })

  it('returns null when the only prompt match has a contradicting signature', () => {
    // 늦게 도착한 응답이 (이미 완료된) 다른 gen 것 — incomplete 후보가 같은 prompt 1개뿐이어도
    // signature(ref) 가 어긋나면 그 gen 에 꽂지 않는다. promptMatches.length===1 지름길의 허점.
    const pending = new Map()
    pending.set('gen-m1', gen('shared prompt', { refMediaIds: ['m1'] }))

    const body = reqBody('shared prompt', { refMediaIds: ['m2'] })
    expect(matchGenerationForResponse(pending, body)).toBe(null)
  })

  // === imageInputs[] format (현재 정식) — 2026-05-26 regression fix ===
  // monkey-patch (flow-page-injection.js) 가 보내는 reference 필드는 protobuf
  // 정식 포맷인 imageInputs[]: [{ imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: <mediaId> }].
  // parseSignature 가 이 새 포맷에서 refMediaIds 를 못 뽑으면 모든 ref 가 있는 gen 의
  // 응답이 시그니처 mismatch 로 폐기돼 180s timeout 으로 끝난다 — 실제 회귀 발생함.
  it('tie-breaks same-prompt gens by imageInputs[] (modern Flow request format)', () => {
    const pending = new Map()
    pending.set('gen-A', gen('same prompt', { refMediaIds: ['m1'] }))
    pending.set('gen-B', gen('same prompt', { refMediaIds: ['m2'] }))

    const body = JSON.stringify({
      requests: [{
        prompt: 'same prompt',
        imageInputs: [{ imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: 'm2' }],
      }],
    })

    expect(matchGenerationForResponse(pending, body)).toBe('gen-B')
  })

  it('matches a single-pending gen whose refs were sent as imageInputs[]', () => {
    // 실제 회귀 시나리오: 씬 1개 생성, refs 3장 → imageInputs[] 로 전송 →
    // 응답이 매칭 안 돼 폐기 → 180s timeout.
    const pending = new Map()
    pending.set('gen-only', gen('scholar reading under a tree', {
      refMediaIds: ['ref-1', 'ref-2', 'ref-3'],
    }))

    const body = JSON.stringify({
      clientContext: { recaptchaContext: { token: 'x' } },
      requests: [{
        userInput: 'scholar reading under a tree',
        imageAspectRatio: 'IMAGE_ASPECT_RATIO_LANDSCAPE',
        seed: 753942,
        imageInputs: [
          { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: 'ref-1' },
          { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: 'ref-2' },
          { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: 'ref-3' },
        ],
      }],
    })

    expect(matchGenerationForResponse(pending, body)).toBe('gen-only')
  })

  it('ignores non-reference imageInputs[] entries when extracting refMediaIds', () => {
    // imageInputs[] 는 reference 외 다른 imageInputType (예: IMAGE_INPUT_TYPE_OTHER) 도
    // 담을 수 있다. refMediaIds 시그니처는 IMAGE_INPUT_TYPE_REFERENCE 만 봐야 한다.
    const pending = new Map()
    pending.set('gen-A', gen('same prompt', { refMediaIds: ['ref-1'] }))

    const body = JSON.stringify({
      requests: [{
        prompt: 'same prompt',
        imageInputs: [
          { imageInputType: 'IMAGE_INPUT_TYPE_OTHER', name: 'other-1' },
          { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: 'ref-1' },
        ],
      }],
    })

    expect(matchGenerationForResponse(pending, body)).toBe('gen-A')
  })

  it('matches the prompt regardless of its field name or nesting in the request body', () => {
    // 회귀: 실제 batchGenerateImages body 는
    //   { clientContext: { recaptchaContext: { token } }, requests: [...] }
    // 형태다. 프롬프트 필드명을 가정하면(requests[].prompt) 매칭이 전부 실패해 fail-closed 로
    // 모든 응답이 폐기됐다. promptKey 가 body 안에 JSON 문자열 값으로 있으면 매칭돼야 한다.
    const prompt = 'A young scholar reading under an oak tree, Western 3D CG cartoon style'
    const pending = new Map()
    pending.set('gen-A', gen(prompt))
    pending.set('gen-B', gen('an unrelated celebration scene with banners'))

    const body = JSON.stringify({
      clientContext: { recaptchaContext: { token: 'x'.repeat(600) } },
      requests: [{ userInput: prompt, seed: 1, imageAspectRatio: 'IMAGE_ASPECT_RATIO_LANDSCAPE' }],
    })

    expect(matchGenerationForResponse(pending, body)).toBe('gen-A')
  })
})
