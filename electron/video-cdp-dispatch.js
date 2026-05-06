/**
 * CDP Fetch dispatch — outgoing 요청에 어떤 주입 케이스를 적용할지 결정.
 *
 * 이 결정 로직은 main.js의 Fetch 인터셉터에서 호출된다. 별도 파일로 분리해
 * 단위 테스트가 가능하도록 했다.
 *
 * ## 우선순위 (반드시 이 순서)
 *
 *   1. **image-batch** — 이미지 생성 요청 (`batchGenerateImages`)
 *      URL이 매치되면 항상 반환. 케이스 내부에서 pendingReferenceImages 와
 *      pendingSeedValue 를 가용한 만큼 주입. 둘 다 없으면 pass-through로 동작.
 *
 *   2. **i2v** — Frame-to-Video / Image-to-Video 키프레임 주입
 *      `batchAsyncGenerateVideo*` URL + pendingI2VInjection 객체가 있을 때.
 *      케이스 내부에서 startImage/endImage + 모델 키 변환 + URL 재작성 +
 *      seed(있으면) 함께 주입.
 *
 *      ⚠️ Flow UI는 I2V 모드에서도 outgoing URL이 일단 `batchAsyncGenerateVideoText`
 *         (T2V)로 나간다. 우리 인터셉터가 이 케이스에서 URL을 I2V endpoint로
 *         바꿔주는 구조. 따라서 i2v 케이스는 seed-only 케이스보다 **반드시 먼저**
 *         매치되어야 한다 — 그렇지 않으면 seed-only가 가로채서 키프레임이 날아간다.
 *         (회귀 사고: 54b3293 커밋, 2026-04-25)
 *
 *   3. **t2v-seed** — Text-to-Video seed 덮어쓰기
 *      `batchAsyncGenerateVideoText` URL + pendingSeedValue가 숫자일 때 + I2V 모드 아님.
 *      OPTIONS preflight는 제외.
 *
 *   4. **pass-through** — 위 어떤 조건도 안 맞으면 수정 없이 통과.
 *
 * @param {object} params
 * @param {string} params.reqUrl - 요청 URL
 * @param {string} [params.reqMethod] - 요청 메서드 (기본 'POST')
 * @param {number|null} [params.pendingSeedValue] - 사용자 지정 seed (null이면 미사용)
 * @param {object|null} [params.pendingI2VInjection] - I2V 주입 데이터 (null이면 미사용)
 * @returns {'image-batch'|'i2v'|'t2v-seed'|'pass-through'}
 */
export function selectCdpCase({
  reqUrl,
  reqMethod = 'POST',
  pendingSeedValue = null,
  pendingI2VInjection = null,
}) {
  if (!reqUrl) return 'pass-through'

  // 1. Image batch (always intercepted; mutations decided inside)
  if (reqUrl.includes('batchGenerateImages')) {
    return 'image-batch'
  }

  // 2. I2V (frame-to-video). seed-only보다 우선이어야 함 — 위 코멘트 참조.
  //    Flow가 보내는 URL은 batchAsyncGenerateVideoText지만, 우리가 I2V 모드일 때는
  //    URL을 I2V endpoint로 변경하면서 startImage/endImage도 같이 주입한다.
  if (pendingI2VInjection && reqUrl.includes('batchAsyncGenerateVideo')) {
    return 'i2v'
  }

  // 3. T2V seed-only (사용자 seed 덮어쓰기). I2V 모드가 아닐 때만.
  //    OPTIONS preflight는 제외.
  if (
    pendingSeedValue != null &&
    reqUrl.includes('batchAsyncGenerateVideoText') &&
    reqMethod !== 'OPTIONS'
  ) {
    return 't2v-seed'
  }

  return 'pass-through'
}
