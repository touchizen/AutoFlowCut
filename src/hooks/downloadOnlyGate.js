/**
 * Phase 0 의 download-only 항목을 배치 다운로드 게이트(consumeGate.ensure) 기준으로 가른다.
 *
 * M2-R3 H6(B2): 옛 규칙은 errorKind==='download-entitlement'(거부됐던 것)만 게이트로 보내고 나머지는 "이미 과금됨" 으로 봤다 — 그런데 G1(b) 로 download-only 가 된
 * stopped·타임아웃·폴 auth 항목은 첫 다운로드 직전에만 도는 게이트를 지난 적이 없어 무료로 재다운로드됐다. 이제 그 배치의 게이트가 ok 를 돌려준 뒤 훅이 종결 패치에
 * 남기는 **downloadGated:true 마커**가 없으면 게이트를 지난다.
 *
 * - gated   : errorKind==='download-entitlement' 이거나 downloadGated 마커가 없는 항목 — consumeGate.ensure() 를 지나야 한다(거부 → download-entitlement, ok → 마커).
 * - ungated : downloadGated:true 인 항목(entitlement 아님) — 이미 그 배치의 다운로드 권한이 확인됐다. 무료 재다운로드.
 *
 * @param {Array} items - download-only 항목
 * @returns {{ gated: Array, ungated: Array }}
 */
export function partitionDownloadOnly(items) {
  const gated = []
  const ungated = []
  for (const it of items) {
    if (it.errorKind === 'download-entitlement' || it.downloadGated !== true) gated.push(it)
    else ungated.push(it)
  }
  return { gated, ungated }
}
