/**
 * electron/flow-ref-media-cache.js
 *
 * M3-6 — 레퍼런스 이미지 → Flow mediaId 캐시(계획서 2026-09-25 M3 D6 · 사용자 결정 2). **페이지 세션(문서) 범위, 메모리 전용.**
 *   키 `${doc}|${projectId}|${sha256}` — doc 은 캡처 주입의 문서 nonce(window.__autoflowcut_rpc_doc__, 문서마다 새 32hex)라 페이지 로드·
 *   내비게이션 커밋이면 전부 miss 가 된다(무효화 배선 없음). 앞 세션 업로드는 애셋 창 썸네일이 불투명해 id 로 고를 수 없으므로(PR P5)
 *   세션을 넘는 재사용은 불가능하다 — 그래서 디스크에 쓰지 않는다(영속이 얻는 것이 없다).
 *   캐시는 **힌트**: 항목마다 애셋 창 사전 스캔이 그 id 의 id 썸네일을 확인하고, 없으면 지우고 다시 올린다(D7).
 *   상한 200 — 가장 오래된 것부터 버린다(Map 삽입 순서). 모양이 틀린 키(doc 없음 등)는 기록도 조회도 하지 않는다(= 업로드).
 * tests/electron/flow-ref-media-cache.test.js
 */

export const REF_MEDIA_CACHE_MAX = 200

const DOC_RE = /^[0-9a-f]{32}$/
const SHA_RE = /^[0-9a-f]{64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const store = new Map()

function keyOf(doc, projectId, sha) {
  if (typeof doc !== 'string' || !DOC_RE.test(doc)) return null
  if (typeof projectId !== 'string' || !projectId) return null
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) return null
  return `${doc}|${projectId}|${sha}`
}

export const refMediaCache = {
  /** mediaId 또는 null. */
  get(doc, projectId, sha) {
    const k = keyOf(doc, projectId, sha)
    return k && store.has(k) ? store.get(k) : null
  },
  /** 기록(같은 키는 가장 새것으로 옮긴다). 상한을 넘으면 가장 오래된 것부터 버린다. */
  set(doc, projectId, sha, mediaId) {
    const k = keyOf(doc, projectId, sha)
    if (!k || typeof mediaId !== 'string' || !UUID_RE.test(mediaId)) return
    store.delete(k)
    store.set(k, mediaId)
    while (store.size > REF_MEDIA_CACHE_MAX) store.delete(store.keys().next().value)
  },
  delete(doc, projectId, sha) {
    const k = keyOf(doc, projectId, sha)
    if (k) store.delete(k)
  },
  size() { return store.size },
  /** 테스트용. */
  clear() { store.clear() },
}
