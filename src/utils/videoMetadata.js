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

/**
 * 비디오 아이템 상태 patch 에 들어갈 model/seed 단편을 만든다.
 *
 * `pickVideoMetadata` 와 동일한 우선순위로 결정하되, 값이 없을 때 키 자체를 빼서
 * 호출자(setState) 가 기존 state 의 해당 키를 보존할 수 있도록 한다.
 * (값을 그대로 넣으면 setState 가 seed: null / model: undefined 로 덮어 써서
 *  in-flight resume 항목이 갖고 있던 원래 메타를 잃는다.)
 *
 * 사용처: useVideoAutomation 의 download 실패 / generation 실패 patch.
 *   - 이전 구현은 patch 에 항상 start() 의 현재 seed/videoModel 을 넣어서,
 *     resume 항목의 model/seed 가 한 번의 실패로 덮였다.
 *
 * @param {Object|null|undefined} item
 * @param {Object|null|undefined} options
 * @returns {{ model?: string, seed?: number }}
 */
export function buildVideoMetaPatch(item, options) {
  const { model, seed } = pickVideoMetadata(item, options)
  return {
    ...(seed != null ? { seed } : {}),
    ...(model ? { model } : {}),
  }
}
