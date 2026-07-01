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

import { isStaleResponse } from '../flow-generation-timeout.js'

// 문자열이 JSON body 안에 들어갔을 때의 표현 (바깥 따옴표 제거).
function escapeForJsonBody(s) {
  return JSON.stringify(s).slice(1, -1)
}

// promptKey 가 요청 body 안에 완전한 JSON 문자열 값으로 존재하는지.
// 앞뒤 따옴표까지 포함해 검색 → 부분문자열 오매칭 방지 + 필드명 무관.
function promptInBody(promptKey, requestBody) {
  if (typeof promptKey !== 'string' || promptKey.length === 0) return false
  // R14-P2: requestBody 가 string 이 아니면(flow-page-injection 이 body 미상 시 null 전달) crash 방지.
  if (typeof requestBody !== 'string') return false
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
//
// reference image 추출은 두 포맷을 모두 지원해야 한다:
//   (1) imageInputs[] — 현재 Google Flow protobuf 가 요구하는 정식 포맷.
//       [{ imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: <mediaId> }]
//   (2) referenceImages[] — 레거시. 한때 우리 monkey-patch 가 잘못 보내던 필드명.
//       Google 이 unknown field 로 400 INVALID_ARGUMENT 를 던지지만, 본 매칭은
//       outgoing 요청 본문을 보는 것이므로 server 거부와 무관하게 안전한 폴백.
// 둘 다 비어 있으면 [] — refs 없는 일반 생성과 동일하게 처리된다.
function parseSignature(requestBody) {
  let parsed
  try {
    parsed = JSON.parse(requestBody)
  } catch {
    return null
  }
  const first = Array.isArray(parsed?.requests) ? parsed.requests[0] : null
  if (!first) return null

  let refMediaIds = []
  if (Array.isArray(first.imageInputs) && first.imageInputs.length > 0) {
    refMediaIds = first.imageInputs
      .filter((x) => x?.imageInputType === 'IMAGE_INPUT_TYPE_REFERENCE')
      .map((x) => x?.name)
      .filter(Boolean)
      .sort()
  } else if (Array.isArray(first.referenceImages)) {
    refMediaIds = first.referenceImages.map((x) => x?.mediaId).filter(Boolean).sort()
  }

  return {
    refMediaIds,
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

/**
 * R13-P1: batchGenerateImages 응답을 sync(pendingGeneration) vs async(pendingGenerations)
 *   중 어디로 보낼지 라우팅.
 *
 * 기존엔 report-response 가 sync 를 먼저 봤다 → async 배치 대기 중 thumbnail 같은 sync 생성이
 * 활성이면, async 배치 응답이 sync 분기에 붙거나(또는 stale 로 drop) async matcher 까지 못 갔다.
 * async matcher 는 requestBody(prompt/refs/seed) 로 정확 매칭하므로 async 를 먼저 본다.
 *
 * ⚠️ sync 가 "동시에" 활성일 때는 async 의 "미완료 1개 fallback"(prompt 미일치인데 유일 gen 이라
 *   매칭)이 sync 응답을 가로챌 수 있으므로, 그 경우엔 **엄격 prompt 일치**일 때만 async 로 본다.
 *   sync 가 없으면(async-only) 기존 fallback 동작을 그대로 유지한다.
 *
 * @returns {{target:'async', matchId}|{target:'sync'}|{target:'drop'}}
 */
export function routeBatchImageResponse({ hasSyncPending, syncSetAt, pendingGenerations, requestBody, reqStartedAt }) {
  const asyncActive = pendingGenerations && pendingGenerations.size > 0
  if (asyncActive) {
    // R13/R14-P1: 이 응답의 prompt 가 async gen(완료분 포함) 중 하나와 일치하면 'async 영역' 응답이다.
    //   → 미완료 gen 에 매칭되면 async, "완료분 중복(늦은 응답)"이면 drop. 절대 sync 로 흘리지 않는다
    //   (matchGenerationForResponse 가 완료분 중복에 null 을 주는데, 그 null 을 sync fall-through 로
    //    오해하면 thumbnail 같은 sync 생성에 남의 늦은 응답이 붙는다 — fail-closed).
    // #R35 note: async 멘션 씬은 genTag 로 reportResponseRouter 가 먼저 확정 매칭한다(여기 도달 전).
    //   여기는 genTag 없는 응답(일반 async 이미지)만 promptKey 로 async 소유를 판정.
    const belongsToAsync = [...pendingGenerations].some(([, g]) => promptInBody(g?.promptKey, requestBody))
    if (belongsToAsync) {
      const matchId = matchGenerationForResponse(pendingGenerations, requestBody)
      return matchId ? { target: 'async', matchId } : { target: 'drop' }
    }
    // prompt 가 어느 async gen 과도 무관(또는 body 미상): 1-incomplete fallback 은 sync 가 동시
    //   활성이 아닐 때(async-only)만 허용 — sync 동시 시 fallback 이 sync 응답 가로채는 것 차단.
    if (!hasSyncPending) {
      const matchId = matchGenerationForResponse(pendingGenerations, requestBody)
      if (matchId) return { target: 'async', matchId }
    }
  }
  if (hasSyncPending && !isStaleResponse(reqStartedAt, syncSetAt)) return { target: 'sync' }
  return { target: 'drop' }
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

  const sig = parseSignature(requestBody)

  // #R35 note: async 멘션 씬은 응답 보고에 실린 genTag 로 reportResponseRouter 가 이미 100% 매칭한다
  //   (여기 도달 전). 이 함수는 genTag 가 없는 응답(일반 async 이미지 등)만 promptKey/signature 로 매칭.

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
  // #R35 note: 멘션 씬은 refMediaIds 가 비어(entity 참조) signature tie-break 이 안 된다. 같은 "가장 긴
  //   텍스트 세그먼트"를 가진 서로 다른 캐릭터 씬(@Alice smiles / @Bob smiles)이 동시 in-flight 면 여기서
  //   2개+ 로 모호 → null(fail-closed) → 해당 씬들은 timeout 후 재시도된다. 잘못된 이미지 배정은 없다.
  //   (텍스트 매칭이 안 되는 경우는 위 0차 seed 매칭이 씬을 고유 seed 로 구분한다.)
  const sigMatches = sig
    ? incompletePromptMatches.filter(([, gen]) => signatureMatches(gen, sig))
    : incompletePromptMatches

  // 유일하게 결정될 때만 반환 — 0개·2개+ 는 fail-closed.
  return sigMatches.length === 1 ? sigMatches[0][0] : null
}
