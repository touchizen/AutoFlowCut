/**
 * electron/sentry-scrub.js
 *
 * Sentry 로 나가는 문자열에서 사용자 콘텐츠·자격증명·경로를 벗긴다. 순수 함수 — Sentry SDK 를
 * import 하지 않으므로 main 과 renderer 가 **같은 것**을 쓴다.
 *
 * ⚠️ 이 파일이 따로 존재하는 이유: 라운드마다 한쪽 채널만 막다가 다른 쪽으로 샜다. main 의 console
 *    을 막았더니 http breadcrumb 의 URL 로 API 키가 나갔고, 그걸 막았더니 renderer Sentry 에는
 *    beforeBreadcrumb 이 아예 없어 경로가 그대로 나갔다. 스크럽은 한 곳에 있고, 모든 채널이 그걸
 *    통과해야 한다.
 */

// [Flow API] generate-image: { prompt: '…' } / [DOM IPC] dom-send-prompt called: …
const PROMPT_BEARING = [
  /(prompt:\s*)('[^']*'|"[^"]*"|[^,}]+)/gi,
  /(dom-send-prompt called:\s*)(.*)$/gi,
]

// 쿼리스트링 자격증명 — Gemini TTS 는 ?key=<사용자 API 키>, Flow 토큰 검증은 ?access_token=<OAuth>
//   를 URL 에 싣는다. Sentry 의 http/fetch breadcrumb 은 URL 을 통째로 기록한다.
const QUERY_SECRETS = /([?&](?:key|access_token|token|api_?key|password|secret)=)[^&\s"'`]+/gi

const SECRET_BEARING = [
  /(?:["']?access_?token["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/-]{12,}/gi,
  /\bya29\.[A-Za-z0-9._~+/-]{8,}/g,                       // Google OAuth 토큰
  /\bAIza[A-Za-z0-9._~+/-]{10,}/g,                        // Google API 키
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,      // 이메일
  // 절대 경로 — 계정 이름이 들어간다. 공백 있는 이름("/Users/Gordon Ahn/…")과 JSON 안에서
  //   이스케이프된 Windows 경로("C:\\Users\\…")를 모두 덮는다.
  /\/(?:Users|home)\/[^"'`,)\]}]*/g,
  /[A-Za-z]:(?:\\{1,2})Users(?:\\{1,2})[^"'`,)\]}]*/g,
  // 생성된 미디어 URL — 사용자가 만든 결과물의 주소다(그리고 서명 토큰을 달고 있다).
  /https?:\/\/[^\s"'`,)\]}]*(?:googleusercontent|ggpht|fife|getMediaUrlRedirect)[^\s"'`,)\]}]*/gi,
]

/** 한 문자열에서 콘텐츠·자격증명·경로를 벗긴다. */
export function scrubSentryString(message) {
  let out = String(message)
  // ⚠️ 캡처 그룹이 있는 정규식만 '$1<redacted>' 를 쓸 수 있다. 그룹 없는 정규식에 콜백을 쓰면
  //    두 번째 인자가 캡처가 아니라 offset(숫자)이라 "20<redacted>" 같은 쓰레기가 만들어진다.
  for (const re of [...PROMPT_BEARING, QUERY_SECRETS]) out = out.replace(re, '$1<redacted>')
  for (const re of SECRET_BEARING) out = out.replace(re, '<redacted>')
  return out
}

/** breadcrumb.data 안의 문자열 값(특히 http breadcrumb 의 url)을 재귀적으로 벗긴다. */
function scrubData(data, seen = new WeakSet()) {
  if (!data || typeof data !== 'object' || seen.has(data)) return data
  seen.add(data)
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') data[k] = scrubSentryString(v)
    else if (v && typeof v === 'object') scrubData(v, seen)
  }
  return data
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

  if (breadcrumb.data) scrubData(breadcrumb.data)
  return breadcrumb
}
