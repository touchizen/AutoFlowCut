/**
 * electron/flow-bearer-capture.js
 *
 * Flow 페이지가 스스로 보내는 aisandbox 요청의 Authorization: Bearer 를 잡아 세션 대용으로 쓴다.
 *
 * 2026-09-23: flow.google.com 에는 세션 API 가 없다(/fx/api/auth/session, /api/auth/session 모두
 * SPA HTML 폴백, 옛 labs.google 주소는 cross-origin 이라 `{}`). 반면 페이지는 프로젝트를 열면
 * GET /v1/credits, GET /v1/flow/models/statuses 를 Bearer 로 계속 호출한다(2026-07-29 덤프).
 * main 의 webRequest.onBeforeSendHeaders 는 페이지 로드 시점의 요청까지 다 보므로, 배치 시작 전에
 * 토큰이 준비된다. 순수 함수 + 작은 스토어 — tests/electron/flow-bearer-capture.test.js.
 *
 * ⚠️ 2026-09-24 실기: 새 flow.google.com 은 aisandbox 를 직접 부르지 않고 모든 RPC 를 같은 origin 의
 *   batchexecute(쿠키 인증, Bearer 없음)로 보낸다 → 캡처 **0건**. 무해하지만 새 Flow 의 답이 아니다.
 *   진짜 수정은 batchexecute 재작업(docs/handoffs/2026-09-24-flow-batchexecute-migration-HANDOFF.md §3-B).
 */
import { captureApiOrigin } from './flow-api-base.js'

/** 잡아둔 토큰을 세션 대용으로 쓰는 최대 나이. Google access token 은 1시간 — 여유를 둔다.
 *  진짜 유효성은 호출측(flow:validate-token → tokeninfo)이 다시 확인한다. */
export const BEARER_MAX_AGE_MS = 50 * 60 * 1000

/** 요청 헤더에서 Bearer 토큰만. 헤더 이름 대소문자 무관. 없으면 null. */
export function bearerFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') return null
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== 'authorization') continue
    const m = String(v ?? '').match(/^bearer\s+(\S+)$/i)
    return m ? m[1] : null
  }
  return null
}

/** Flow 생성 API(aisandbox googleapis) 요청인가 — 다른 googleapis(fonts/tokeninfo)는 제외. */
export function isFlowApiRequest(url) {
  return captureApiOrigin(url) !== null
}

/**
 * 마지막으로 잡은 Bearer 와 시각. sessionText(now) 는 옛 세션 파서가 그대로 읽는
 * `{"access_token": …}` 본문을 돌려주고, 없거나 오래됐으면 null.
 */
export function createBearerStore() {
  let token = null
  let at = 0
  return {
    set(nextToken, now = Date.now()) {
      if (!nextToken) return
      token = nextToken
      at = now
    },
    sessionText(now = Date.now()) {
      if (!token || now - at > BEARER_MAX_AGE_MS) return null
      return JSON.stringify({ access_token: token })
    },
    ageMs(now = Date.now()) {
      return token ? now - at : null
    },
  }
}
