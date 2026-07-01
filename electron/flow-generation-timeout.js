/**
 * electron/flow-generation-timeout.js
 *
 * 동기(sync) 이미지 생성의 "네트워크 응답 대기" 타임아웃.
 *
 * ⚠️ 반드시 pendingGeneration 을 arm 한 직후(= Generate 클릭 직전)에 만들어야 한다.
 *   제출 게이트(flow-submit-gate)가 최대 180s 동안 폴링할 수 있는데, 그 전에 타이머를
 *   미리 만들면:
 *     (1) 클릭(=네트워크 요청)이 나가기도 전에 120s 타임아웃이 만료 → 이후 응답 대기
 *         (await responsePromise)에 타임아웃이 없어, 응답이 안 오면 영구 hang.
 *     (2) 만료 콜백이 그 시점에 살아있는 "다른" pendingGeneration 을 지운다.
 *
 *   그래서 자기 pending(ownPending)만 identity 로 정리/resolve 한다.
 *
 * @param {object}   opts
 * @param {object}   opts.ownPending   - 이 타이머가 책임지는 pendingGeneration 객체(identity 기준).
 * @param {Function} opts.getPending   - 현재 pendingGeneration 을 반환.
 * @param {Function} opts.setPending   - pendingGeneration 을 설정(만료 시 null).
 * @param {Function} opts.resolve      - 응답 대기 Promise 의 resolve.
 * @param {number}   [opts.timeoutMs=120000]
 * @param {Function} [opts.setTimeoutFn=setTimeout] - 테스트 주입용.
 * @returns {*} setTimeout 핸들 (clearTimeout 대상).
 */
export function createGenerationTimeout({
  ownPending,
  getPending,
  setPending,
  resolve,
  timeoutMs = 120000,
  setTimeoutFn = setTimeout,
}) {
  return setTimeoutFn(() => {
    // 자기 pending 이 여전히 살아있을 때만 정리/resolve.
    // 다른 생성이 arm 한 pending(또는 이미 응답 처리돼 null 인 경우)은 건드리지 않는다.
    if (getPending() === ownPending) {
      // R9-P1: 만료 시 owner 의 collectionTimer(30s, multi-image partial 대기)도 정리 —
      //   안 그러면 그 timer 가 나중에 깨어나 그 시점의 (다른) pending 을 오resolve 할 수 있다.
      if (ownPending && ownPending.collectionTimer) clearTimeout(ownPending.collectionTimer)
      setPending(null)
      resolve({ error: true, message: `Response timeout (${Math.round(timeoutMs / 1000)}s)` })
    }
  }, timeoutMs)
}

/**
 * multi-image 동기 생성에서 일부 응답만 도착했을 때 나머지를 기다리는 collection 타이머.
 *
 * ⚠️ 만료 콜백은 "자기 owner" 가 여전히 현재 pendingGeneration 일 때만 resolve/정리한다.
 *   (owner 가 다른 경로로 이미 비워지고 새 생성이 pending 을 arm 했으면, 이 stale timer 가
 *    새 pending 을 owner 의 옛 responses 로 오resolve 하는 레이스가 생긴다 — R9-P1.)
 *
 * @param {object}   opts
 * @param {object}   opts.owner       - 이 타이머를 소유한 pendingGeneration 객체. resolve/responses 를 가진다.
 * @param {Function} opts.getPending  - 현재 pendingGeneration 반환.
 * @param {Function} opts.setPending  - pendingGeneration 설정(만료 시 null).
 * @param {number}   [opts.delayMs=30000]
 * @param {Function} [opts.setTimeoutFn=setTimeout]
 * @returns {*} setTimeout 핸들.
 */
/**
 * 응답이 "이전 생성의 늦은 응답"(stale)인지 판정.
 * reqStartedAt(요청 시작 시각) 이 현재 pending 의 setAt 보다 앞서면, 그 요청은 이 pending 을
 * arm 하기 전에 시작된 것이므로 현재 생성의 응답이 아니다 → drop.
 * reqStartedAt 미전달(숫자 아님)이거나 setAt falsy 면 비교 불가 → stale 아님(false).
 */
export function isStaleResponse(reqStartedAt, setAt) {
  return typeof reqStartedAt === 'number' && !!setAt && reqStartedAt < setAt
}

/**
 * R16-P2: 비디오 "제출" 엔드포인트(T2V/I2V/I2V_END)만 정확히 매칭한다.
 *   pendingVideoGeneration 라우팅이 'batchAsyncGenerateVideo' substring 으로 잡으면
 *   UpsampleVideo(업스케일)·status 응답까지 들어와 T2V/I2V 의 pending capture 를 잘못 resolve 한다.
 *   세 제출 엔드포인트만 allowlist (StartImage 는 StartAndEndImage 의 substring 이 아님).
 */
const VIDEO_SUBMIT_METHODS = new Set([
  'batchAsyncGenerateVideoText',          // T2V
  'batchAsyncGenerateVideoStartImage',    // I2V (start)
  'batchAsyncGenerateVideoStartAndEndImage', // I2V (start+end)
  'batchAsyncGenerateVideoReferenceImages',  // #R36-ref: @멘션 R2V(캐릭터 entity → 비디오). 이게 없으면
  //   pendingVideoGeneration 이 resolve 안 돼 응답 캡처 실패 → timeout → 완료감지/다운로드/upscale 못 함.
])

export function isVideoSubmitEndpoint(url) {
  if (typeof url !== 'string') return false
  // R17/R18-P3: path 의 마지막 세그먼트가 정확히 `video:<submit-method>` 형태여야 한다.
  //   (substring/bare-segment false positive 차단 — query 섞임, ...VideoTextExtra, /a/b/<method> 등.)
  const path = url.split(/[?#]/)[0]
  const lastSeg = path.split('/').pop() || ''
  const colon = lastSeg.indexOf(':')
  if (colon === -1) return false
  const resource = lastSeg.slice(0, colon)
  const method = lastSeg.slice(colon + 1)
  return resource === 'video' && VIDEO_SUBMIT_METHODS.has(method)
}

export function createOwnedCollectionTimer({
  owner,
  getPending,
  setPending,
  delayMs = 30000,
  setTimeoutFn = setTimeout,
}) {
  return setTimeoutFn(() => {
    if (getPending() === owner) {
      setPending(null)
      owner.resolve({ error: false, responses: owner.responses })
    }
  }, delayMs)
}
