/**
 * videoMetadata — 비디오 다운로드/저장 시 메타(모델/seed) 우선순위 결정
 *
 * 우선순위:
 *   1. item.model / item.seed — in-flight resume 경로 (state 에 실제 generation 메타가 박혀 있음)
 *   2. options.videoModel / options.seed — 일반 fresh 생성 경로 (호출자 옵션)
 *   3. 폴백 ('flow-video' / null)
 *
 * in-flight 항목을 resume 할 때 현재 옵션으로 덮어쓰면 history/모달의 모델/seed 가
 * 실제 generation 과 어긋난다. 따라서 item 우선.
 *
 * Note: model 은 빈 문자열을 의미 있게 다루지 않으므로 `||` (truthy) 사용.
 *       seed 는 0 이 유효한 값이므로 `??` (nullish) 사용 — 0 을 절대 폴백으로 떨어뜨리지 않는다.
 */

/**
 * @param {Object|null|undefined} item - state 의 비디오 아이템 (vscene/framePair). model/seed 필드 가질 수 있음.
 * @param {Object|null|undefined} options - 호출자 옵션. videoModel/seed 필드 가질 수 있음.
 * @returns {{ model: string, seed: number|null }}
 */
export function pickVideoMetadata(item, options) {
  return {
    model: item?.model || options?.videoModel || 'flow-video',
    seed: item?.seed ?? options?.seed ?? null,
  }
}
