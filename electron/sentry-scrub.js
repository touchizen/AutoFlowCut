/**
 * electron/sentry-scrub.js
 *
 * Sentry 로 나가는 모든 문자열에서 사용자 콘텐츠·자격증명·계정명을 벗긴다. 순수 함수 — Sentry SDK 를
 * import 하지 않으므로 main 과 renderer 가 **같은 것**을 쓴다.
 *
 * ⚠️ 이 파일이 따로 존재하는 이유: 라운드마다 한쪽 채널만 막다가 다른 쪽으로 샜다.
 *    main 의 console 을 막았더니 → http breadcrumb 의 URL 로 API 키가 나갔고,
 *    그걸 막았더니 → renderer Sentry 에는 beforeBreadcrumb 이 아예 없어 경로가 나갔고,
 *    그걸 막았더니 → 이벤트 자체(event.message / exception.value / request.url / extra)는
 *    아무도 안 씻고 있었다. 스크럽은 한 곳에 있고, **모든 채널**이 이걸 통과해야 한다.
 *
 * 원칙: 진단은 살리고 사람만 지운다. 경로는 통째로 지우지 않고 계정 이름 세그먼트만 지운다 —
 *       "/Users/<redacted>/Desktop/dump.json" 은 여전히 "어디에 떨어졌나"를 말해준다.
 */

// 프롬프트 — `prompt: '…'` 와 `"prompt":"…"` 두 형태 모두. 값은 지우고 키는 남긴다.
const PROMPT_BEARING = [
  /(["']?prompt["']?\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,}\s]+)/gi,
  /(dom-send-prompt called:\s*)(.*)$/gi,
]

// 쿼리스트링·헤더 자격증명 — Gemini TTS 는 ?key=<사용자 API 키>, Flow 토큰 검증은 ?access_token=
//   을 URL 에 싣고, Sentry 의 http/fetch breadcrumb 은 URL 을 통째로 기록한다.
const KEYED_SECRETS = [
  /([?&](?:key|access_token|refresh_token|id_token|token|api_?key|password|secret)=)[^&\s"'`]+/gi,
  /((?:authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*)[^\s,;"'`][^\n,;"'`]*/gi,
  /(["']?(?:access|refresh|id)_token["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/-]{8,}/gi,
]

// 계정 이름 세그먼트만 지운다 — 나머지 경로는 진단에 필요하다.
//   공백 있는 이름("/Users/Gordon Ahn/…")을 덮되, 다음 '/' 에서 멈춰 뒤 문장을 삼키지 않는다.
const PATH_ACCOUNT = [
  /(\/(?:Users|home)\/)[^/\n"'`,)\]}]+/g,
  /([A-Za-z]:(?:\\{1,2})Users(?:\\{1,2}))[^\\/\n"'`,)\]}]+/g,
]

// 값 전체를 지워야 하는 것들.
const SECRET_BEARING = [
  /\bya29\.[A-Za-z0-9._~+/-]{8,}/g,                       // Google OAuth 토큰
  /\bAIza[A-Za-z0-9._~+/-]{10,}/g,                        // Google API 키
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,      // 이메일
  // 생성된 미디어 URL — 사용자가 만든 결과물의 주소이고 서명 토큰을 달고 있다.
  /https?:\/\/[^\s"'`,)\]}]*(?:googleusercontent|ggpht|fife|getMediaUrlRedirect)[^\s"'`,)\]}]*/gi,
]

/** 한 문자열에서 콘텐츠·자격증명·계정명을 벗긴다. */
export function scrubSentryString(message) {
  let out = String(message)
  // ⚠️ 캡처 그룹이 있는 정규식만 '$1<redacted>' 를 쓸 수 있다. 그룹 없는 정규식에 콜백을 쓰면
  //    두 번째 인자가 캡처가 아니라 offset(숫자)이라 "20<redacted>" 같은 쓰레기가 만들어진다.
  for (const re of [...PROMPT_BEARING, ...KEYED_SECRETS, ...PATH_ACCOUNT]) out = out.replace(re, '$1<redacted>')
  for (const re of SECRET_BEARING) out = out.replace(re, '<redacted>')
  return out
}

/** 객체 안의 모든 문자열 값을 재귀적으로 씻는다. 사이클이 있어도 죽지 않는다. */
function scrubDeep(value, seen = new WeakSet()) {
  if (typeof value === 'string') return scrubSentryString(value)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return value          // 진단 정리 중에 앱이 죽는 일은 없어야 한다
  seen.add(value)
  for (const [k, v] of Object.entries(value)) {
    try { value[k] = scrubDeep(v, seen) } catch { /* getter 가 던져도 무시 */ }
  }
  return value
}

/**
 * main·renderer 공용 beforeBreadcrumb.
 *
 * Flow 페이지의 콘솔은 통째로 버린다 — main 이 페이지 콘솔을 포워딩하는데, 페이지 스크립트는
 * Flow DOM 조각을 그대로 찍는다. 그 페이지가 곧 사용자의 프로젝트다(프롬프트·미디어·캐릭터 이름).
 */
export function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb) return breadcrumb
  if (typeof breadcrumb.message === 'string' && breadcrumb.message.startsWith('[Flow Page]')) return null

  if (breadcrumb.message) breadcrumb.message = scrubSentryString(breadcrumb.message)

  // consoleIntegration 은 원본 인자를 data.arguments 에 그대로 보관한다 — message 만 씻으면
  //   가려진 텍스트가 인자로 다시 나간다. 자유 형식 콘텐츠는 정규식으로 못 덮으므로 아예 버린다.
  if (breadcrumb.category === 'console' && breadcrumb.data) delete breadcrumb.data.arguments

  if (breadcrumb.data) scrubDeep(breadcrumb.data)
  return breadcrumb
}

/**
 * main·renderer 공용 beforeSend.
 *
 * breadcrumb 만 씻고 이벤트를 안 씻으면 아무 의미가 없다 — 에러 메시지 하나가
 * "ENOENT: /Users/alice/Desktop/secret.txt" 이면 그대로 나간다.
 */
export function scrubEvent(event) {
  if (!event) return event
  if (event.user) {
    delete event.user.ip_address
    delete event.user.email
  }
  if (event.request?.data) delete event.request.data

  // extra 는 키 이름부터 드러낸다 — 값을 씻는 것과 별개로, 콘텐츠를 담는 키는 통째로 버린다.
  //   (값 스크럽은 정규식이라 자유 형식 콘텐츠를 다 못 덮는다. 두 방어를 겹친다.)
  if (event.extra) {
    for (const k of Object.keys(event.extra)) {
      if (/prompt|input|filename|path/i.test(k)) delete event.extra[k]
    }
  }

  const seen = new WeakSet()
  if (typeof event.message === 'string') event.message = scrubSentryString(event.message)
  if (event.request) scrubDeep(event.request, seen)
  if (event.exception) scrubDeep(event.exception, seen)
  if (event.extra) scrubDeep(event.extra, seen)
  if (event.contexts) scrubDeep(event.contexts, seen)
  if (Array.isArray(event.breadcrumbs)) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean)

  return event
}
