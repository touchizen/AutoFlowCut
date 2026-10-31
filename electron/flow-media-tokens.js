/**
 * electron/flow-media-tokens.js
 *
 * 2026-10-31 — asb 토큰 지도({토큰: mediaId}). Flow 가 칩·애셋 항목·미리보기 src 를 https://flow.google.com/asb/<토큰>=… 로 바꿔(이번 세션 업로드 포함 —
 *   id 없음) 칩 id 는 이 지도로만 읽힌다(flow-composer-refs.js mediaIdOfImg). 토큰은 드라이버가 "우리가 방금 붙여넣은 칩 하나"에서 배워 maseQ 가 준 id 로
 *   등록한다(adopt). as29s 는 갓 올린 이미지에 옛 flow-content 주소만 줘 토큰 출처가 못 된다(10-31 실기).
 * 돈 안전 규칙:
 *   - 주인 기록(토큰 → 처음 받은 id)은 영구 — 한 토큰을 다른 id 가 받으면(판독 지도에서 내려간 옛 토큰이어도) 그 토큰을 영구 격리한다.
 *   - 판독 지도(map)는 id 마다 마지막 토큰 하나 — 새 토큰이 오면 옛 토큰은 내린다.
 *   - 판독 지도에서 빠질 때마다 epoch +1 — guarded(read) 는 그 사이 빠진 게 있으면 판독을 버린다(null). 더하기는 이미 읽힌 id 를 틀리게 만들지 못해 안 올린다.
 * 토큰은 미디어 접근 주소 — 로그·보고에 싣지 않는다.
 * tests/electron/flow-media-tokens.test.js
 */
export function createMediaTokenRegistry() {
  const owner = new Map()     // 토큰 → 처음 받은 id(영구)
  const ambiguous = new Set()
  const current = new Map()   // id → 판독 지도에 있는 토큰
  const map = {}
  let epoch = 0
  /** id 의 지금 토큰을 판독 지도에서 내린다. */
  const retire = (id) => {
    const t = current.get(id)
    if (t === undefined) return
    current.delete(id)
    if (map[t] === id) { delete map[t]; epoch++ }
  }
  return {
    /** 판독에 싣는 지도(같은 객체) = id 마다 마지막 토큰(격리 제외). */
    map,
    epoch: () => epoch,
    knows: (id) => current.has(id),
    /** id 의 토큰 등록 → 'ok' | 'conflict'(이번에 격리) | 'ambiguous'(이미 격리). 격리면 두 id 다 그 토큰으로 안 읽힌다. */
    adopt(id, token) {
      if (ambiguous.has(token)) { retire(id); return 'ambiguous' }
      const prev = owner.get(token)
      if (prev !== undefined && prev !== id) {
        ambiguous.add(token)
        if (current.get(prev) === token) retire(prev)
        retire(id)
        return 'conflict'
      }
      if (prev === undefined) owner.set(token, id)
      if (current.get(id) !== token) {
        retire(id)
        current.set(id, token)
        map[token] = id
      }
      return 'ok'
    },
    /** read() 결과 — 그동안 판독 지도에서 빠진 게 있었거나 read 가 던지면 null(호출자는 판독 불가 = fail-closed). */
    async guarded(read) {
      const e = epoch
      let v = null
      try { v = await read() } catch (_e) { return null }
      return e === epoch ? v : null
    },
  }
}

/**
 * 프로덕션 기본 지도 — 모듈 하나(세션 캐시 refMediaCache 처럼). 이미지(flow-api.js)·영상(video.js) 핸들러가 createFlowAngular 를 따로 만들어도
 *   같은 주인 기록을 봐야 한쪽에서 본 충돌이 다른 쪽의 토큰을 격리한다.
 */
let shared = createMediaTokenRegistry()
export function sharedMediaTokenRegistry() { return shared }
/** 시험 전용 — 새 지도로 바꾼다(이미 만든 핸들러는 옛 지도를 계속 쓴다). */
export function _resetSharedMediaTokensForTests() { shared = createMediaTokenRegistry() }
