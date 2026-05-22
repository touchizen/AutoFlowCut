/**
 * Async batchGenerateImages 응답 ↔ pending generation 매칭.
 *
 * 응답을 "가장 최근 등록된 미완료 gen"에 꽂던 기존 방식(newest-wins)은 생성이
 * 겹치면 응답을 엉뚱한 gen 으로 보냈다. 대신 outgoing 요청 body 로 상관시킨다:
 *
 *   1) prompt 정확 일치 — body 를 JSON parse 해 requests[].prompt 와 promptKey 를
 *      '정확히' 비교 (substring 아님 — "cat" 이 "cathedral" 을 가로채지 못하게).
 *   2) prompt 동률이면 reference mediaIds / seed / aspectRatio 시그니처로 tie-break.
 *   3) 끝까지 유일하게 결정 안 되면 null — fail-closed. 오매칭(남의 이미지 저장)
 *      대신 그 씬을 timeout 시켜 가시적 실패로 만든다.
 *
 * gen 은 등록 시 promptKey / refMediaIds / reqSeed / reqAspectRatio 를 저장한다.
 */

function parseImageRequest(requestBody) {
  if (typeof requestBody !== 'string' || requestBody.length === 0) return null
  let parsed
  try {
    parsed = JSON.parse(requestBody)
  } catch {
    return null
  }
  const requests = Array.isArray(parsed?.requests) ? parsed.requests : null
  if (!requests || requests.length === 0) return null

  const prompts = new Set()
  for (const r of requests) {
    if (typeof r?.prompt === 'string' && r.prompt.length > 0) prompts.add(r.prompt)
  }
  if (prompts.size === 0) return null

  const first = requests[0] || {}
  const refMediaIds = Array.isArray(first.referenceImages)
    ? first.referenceImages.map((x) => x?.mediaId).filter(Boolean).sort()
    : []
  return {
    prompts,
    refMediaIds,
    seed: typeof first.seed === 'number' ? first.seed : null,
    aspectRatio: typeof first.imageAspectRatio === 'string' ? first.imageAspectRatio : null,
  }
}

function sameIds(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// prompt 동률을 깨는 tie-break — reference mediaIds 는 항상 비교,
// seed/aspectRatio 는 gen 에 명시값이 있을 때만 제약 (random/미지정이면 제약하지 않음).
function signatureMatches(gen, req) {
  const genRefs = Array.isArray(gen.refMediaIds) ? gen.refMediaIds : []
  if (!sameIds(genRefs, req.refMediaIds)) return false
  if (gen.reqSeed != null && req.seed != null && gen.reqSeed !== req.seed) return false
  if (gen.reqAspectRatio != null && req.aspectRatio != null && gen.reqAspectRatio !== req.aspectRatio) return false
  return true
}

export function matchGenerationForResponse(pendingGenerations, requestBody) {
  const incomplete = []
  for (const [id, gen] of pendingGenerations) {
    if (!gen.completed) incomplete.push([id, gen])
  }
  if (incomplete.length === 0) return null

  const req = parseImageRequest(requestBody)

  // 요청 body 를 못 읽음 → 모호하지 않을 때(미완료 1개)만 fallback, 아니면 fail-closed.
  if (!req) {
    return incomplete.length === 1 ? incomplete[0][0] : null
  }

  // 1차: prompt 정확 일치.
  const promptMatches = incomplete.filter(
    ([, gen]) => typeof gen.promptKey === 'string' && req.prompts.has(gen.promptKey)
  )
  if (promptMatches.length === 0) return null // 미완료 중 주인 없음 (완료 gen 의 잉여 응답 등) → 버림

  // 2차: reference/seed/aspectRatio 시그니처까지 검증.
  // prompt 매칭이 1개뿐이어도 signature 가 어긋나면(늦게 온 다른 gen 의 응답) 반환하지 않는다.
  const sigMatches = promptMatches.filter(([, gen]) => signatureMatches(gen, req))

  // 유일하게 결정될 때만 반환 — 0개(주인 아님)·2개+(모호) 는 fail-closed.
  return sigMatches.length === 1 ? sigMatches[0][0] : null
}
