/**
 * electron/flow-media-tokens.js
 *
 * 2026-10-31 — asb 토큰 지도({토큰: mediaId}, as29s 로 배운 것). Flow 가 칩·애셋 항목·미리보기 src 를 https://flow.google.com/asb/<토큰>=… 로 바꿔
 *   (이번 세션 업로드 포함 — id 없음) 칩 id 는 이 지도로만 읽힌다(flow-composer-refs.js mediaIdOfImg).
 * 돈 안전 규칙:
 *   - 지우지 않는다 — 같은 id 의 새 토큰은 더한다. 늦게 온 옛 답이 새 토큰을 지우거나 되돌리지 못한다.
 *   - 주인 기록(토큰 → 처음 받은 id)은 영구 — 한 토큰을 다른 id 가 받으면(갱신 뒤의 옛 토큰이어도) 그 토큰을 영구 격리한다.
 *     격리된 토큰은 판독 지도(map)에서 빠진다 → 그 칩·항목은 id 가 안 읽혀 클릭 전에 실패로 닫힌다(엉뚱한 미디어를 그 id 로 고르지 않는다).
 *   - 격리마다 epoch +1 — guarded(read) 는 그 사이 격리가 있었으면 판독을 버린다(null). 더하기는 이미 읽힌 id 를 틀리게 만들지 못해 epoch 를 안 올린다.
 * 토큰은 미디어 접근 주소 — 로그·보고에 싣지 않는다.
 * tests/electron/flow-media-tokens.test.js
 */
export function createMediaTokenRegistry() {
  const owner = new Map()
  const ambiguous = new Set()
  const map = {}
  let epoch = 0
  return {
    /** 판독에 싣는 지도(같은 객체) = 주인 기록 − 격리. */
    map,
    epoch: () => epoch,
    knows: (id) => Object.values(map).includes(id),
    /** → 'ok' | 'conflict'(이번에 격리) | 'ambiguous'(이미 격리) */
    record(token, id) {
      if (ambiguous.has(token)) return 'ambiguous'
      const prev = owner.get(token)
      if (prev && prev !== id) {
        ambiguous.add(token)
        delete map[token]
        epoch++
        return 'conflict'
      }
      owner.set(token, id)
      map[token] = id
      return 'ok'
    },
    /** read() 결과 — 그동안 격리가 있었거나 read 가 던지면 null(호출자는 판독 불가 = fail-closed). */
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
