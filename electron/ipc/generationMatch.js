/**
 * Async batchGenerateImages 응답 ↔ pending generation 매칭.
 *
 * 응답을 "가장 최근 등록된 미완료 gen"에 꽂던 기존 방식(newest-wins)은 생성이
 * 겹치면 응답을 엉뚱한 gen 으로 보냈다. 대신 outgoing 요청 body 로 상관시킨다:
 *
 *   1) prompt 매칭 — gen 의 promptKey(styledPrompt)가 요청 body 안에 'JSON 문자열
 *      값'으로 들어있는지 확인. 따옴표로 감싸 비교하므로 필드명/중첩 위치를 가정하지
 *      않으며("requests[].prompt" 등 — 실제 body 는 clientContext 래퍼가 앞에 붙는다),
 *      닫는 따옴표 덕에 "cat" 이 "cathedral" 의 부분문자열로 잘못 매칭되지도 않는다.
 *   2) prompt 동률이면 reference mediaIds / seed / aspectRatio 시그니처로 tie-break.
 *      이 필드들은 injectImageBatchBody 가 쓰는 확정된 필드명이라 파싱이 안전하다.
 *   3) 끝까지 유일하게 결정 안 되면 null — fail-closed. 오매칭(남의 이미지 저장)
 *      대신 그 씬을 timeout 시켜 가시적 실패로 만든다.
 *
 * gen 은 등록 시 promptKey / refMediaIds / reqSeed / reqAspectRatio 를 저장한다.
 */

// 문자열이 JSON body 안에 들어갔을 때의 표현 (바깥 따옴표 제거).
function escapeForJsonBody(s) {
  return JSON.stringify(s).slice(1, -1)
}

// promptKey 가 요청 body 안에 완전한 JSON 문자열 값으로 존재하는지.
// 앞뒤 따옴표까지 포함해 검색 → 부분문자열 오매칭 방지 + 필드명 무관.
function promptInBody(promptKey, requestBody) {
  if (typeof promptKey !== 'string' || promptKey.length === 0) return false
  return requestBody.includes('"' + escapeForJsonBody(promptKey) + '"')
}

function sameIds(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// tie-break 용 시그니처 — refMediaIds / seed / imageAspectRatio 는 injectImageBatchBody 가
// requests[] 의 각 항목에 직접 세팅하는 확정 필드명이라 JSON 파싱으로 안전하게 읽는다.
function parseSignature(requestBody) {
  let parsed
  try {
    parsed = JSON.parse(requestBody)
  } catch {
    return null
  }
  const first = Array.isArray(parsed?.requests) ? parsed.requests[0] : null
  if (!first) return null
  return {
    refMediaIds: Array.isArray(first.referenceImages)
      ? first.referenceImages.map((x) => x?.mediaId).filter(Boolean).sort()
      : [],
    seed: typeof first.seed === 'number' ? first.seed : null,
    aspectRatio: typeof first.imageAspectRatio === 'string' ? first.imageAspectRatio : null,
  }
}

// gen 의 시그니처가 요청과 호환되는지 — prompt 동률을 깨는 tie-break.
// reference mediaIds 는 항상 비교, seed/aspectRatio 는 gen 에 명시값이 있을 때만 제약.
function signatureMatches(gen, sig) {
  const genRefs = Array.isArray(gen.refMediaIds) ? gen.refMediaIds : []
  if (!sameIds(genRefs, sig.refMediaIds)) return false
  if (gen.reqSeed != null && sig.seed != null && gen.reqSeed !== sig.seed) return false
  if (gen.reqAspectRatio != null && sig.aspectRatio != null && gen.reqAspectRatio !== sig.aspectRatio) return false
  return true
}

export function matchGenerationForResponse(pendingGenerations, requestBody) {
  const all = [...pendingGenerations]
  const incomplete = all.filter(([, gen]) => !gen.completed)
  if (incomplete.length === 0) return null

  const hasBody = typeof requestBody === 'string' && requestBody.length > 0
  // 요청 body 를 못 읽음 → 모호하지 않을 때(미완료 1개)만 fallback, 아니면 fail-closed.
  if (!hasBody) {
    return incomplete.length === 1 ? incomplete[0][0] : null
  }

  // 1차: promptKey 가 body 에 JSON 문자열 값으로 존재하는 gen (완료 gen 도 포함해 본다).
  const promptMatches = all.filter(([, gen]) => promptInBody(gen.promptKey, requestBody))
  const incompletePromptMatches = promptMatches.filter(([, gen]) => !gen.completed)

  if (promptMatches.length > 0 && incompletePromptMatches.length === 0) {
    // body 의 프롬프트가 '이미 완료된' gen 의 것 → 중복/잉여 응답이므로 버린다
    // (죄 없는 미완료 gen 에 꽂으면 그 씬이 남의 이미지로 덮인다).
    return null
  }
  if (incompletePromptMatches.length === 0) {
    // 아무 gen 의 prompt 도 body 에서 못 찾음 (비표준 body 등) → 모호하지 않을 때만 fallback.
    return incomplete.length === 1 ? incomplete[0][0] : null
  }

  // 2차: 시그니처로 한 번 더 거른다 (단일 prompt 매칭이어도 — signature 가 어긋나면
  // 늦게 온 다른 gen 의 응답이므로 반환하지 않는다).
  const sig = parseSignature(requestBody)
  const sigMatches = sig
    ? incompletePromptMatches.filter(([, gen]) => signatureMatches(gen, sig))
    : incompletePromptMatches

  // 유일하게 결정될 때만 반환 — 0개·2개+ 는 fail-closed.
  return sigMatches.length === 1 ? sigMatches[0][0] : null
}
