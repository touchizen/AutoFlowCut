/**
 * electron/sentry-scrub.js
 *
 * Sentry 로 나가는 모든 것에서 사용자 콘텐츠·자격증명·계정명을 벗긴다. 순수 함수 — Sentry SDK 를
 * import 하지 않으므로 main 과 renderer 가 **같은 것**을 쓴다.
 *
 * ⚠️ 이 파일이 따로 존재하는 이유: 라운드마다 한쪽만 막다가 옆으로 샜다.
 *    main 의 console → http breadcrumb 의 URL → renderer(스크럽이 아예 없었다) → 이벤트 자체
 *    (message/exception/request/extra) → 그리고 transaction/span. 스크럽은 한 곳에 있고
 *    **모든 채널**이 이걸 통과해야 한다.
 *
 * 두 축으로 막는다:
 *   1) KEY 로 — `Authorization: "Basic dXNlcjpwYXNz"` 는 값만 봐선 자격증명인 줄 모른다. 키가 말해준다.
 *   2) VALUE 로 — 로그 문자열은 키가 없다. 모양(ya29…, AIza…, /Users/…)으로 잡는다.
 *
 * 원칙: 진단은 살리고 사람만 지운다. 경로는 통째로 지우지 않고 계정 세그먼트만 지운다 —
 *       "/Users/<redacted>/Desktop/dump.json" 은 여전히 "어디에 떨어졌나"를 말해준다.
 */

const REDACTED = '<redacted>'

// ─── KEY 기반 ────────────────────────────────────────────────────────────────
// 이 키의 값은 내용을 보지 않고 통째로 지운다.
// ⚠️ exact match 로는 sessionToken · clientSecret · x-api-key 가 빠져나가고, 단순 부분일치는
//    safeContext 의 "…tex t" 를 text 로 오인한다. 키를 camelCase/snake 로 쪼개 **단어 단위**로 본다.
const SECRET_WORDS = new Set(['auth', 'authorization', 'cookie', 'token', 'secret', 'password', 'credential', 'apikey', 'key'])
// 이 키의 값은 사용자 콘텐츠다(프롬프트·이름·캡션·페이지 텍스트).
// ⚠️ ^value$ 는 넣지 않는다 — Sentry 의 exception.values[].value 가 곧 에러 메시지다. 통째로
//    지우면 "ENOENT …" 같은 진단 자체가 사라진다. DOM 속성 value 는 flow-diag 쪽에서 거른다.
// characterName · pageText 같은 합성 키도 단어 분해로 잡힌다. 단, contexts(os.name/device.name 등
//   SDK 생성값)에는 적용하지 않는다 — 거기 name 을 지우면 진단만 사라진다.
const CONTENT_WORDS = new Set(['prompt', 'caption', 'narration', 'name', 'text', 'label', 'title', 'placeholder', 'html', 'body', 'content'])

/** 'characterName' → ['character','name'], 'x-api-key' → ['x','api','key'] */
function keyWords(key) {
  return String(key).split(/[_\-\s.]|(?=[A-Z])/).map((w) => w.toLowerCase()).filter(Boolean)
}
const hasWord = (key, set) => keyWords(key).some((w) => set.has(w))

// ─── VALUE 기반 ──────────────────────────────────────────────────────────────
// 프롬프트: `prompt: '…'` · `"prompt":"…"` · 따옴표 없는 여러 단어(줄 끝/닫는 괄호까지).
//   \b 로 시작해 `teleprompt:` 같은 단어를 먹지 않게 한다.
const PROMPT_BEARING = [
  /(\b["']?prompt["']?\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,}\n]+)/gi,
  /(dom-send-prompt called:\s*)(.*)$/gi,
]

// 쿼리스트링·헤더 자격증명. 쿠키는 ';' 로 구분된 각 쌍을 따로 지운다(하나만 지우면 나머지가 남는다).
const KEYED_SECRETS = [
  /([?&](?:key|access_token|refresh_token|id_token|token|api_?key|password|secret)=)[^&\s"'`]+/gi,
  /((?:authorization|x-api-key)\s*[:=]\s*)[^\n,;"'`]+/gi,
  // Cookie 헤더 문자열 — 쿠키 이름은 뭐든 될 수 있다(__Secure-1PSID, NID …). 각 쌍을 통째로 지운다.
  /((?:^|[;\s])cookie\s*:\s*)[^\n]+/gi,
  /(\b[A-Za-z_][A-Za-z0-9_-]*\s*=\s*)[^;\s,"'`]{8,}(?=;|$)/g,
  /(["']?(?:access|refresh|id)_token["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/-]{8,}/gi,
]

// 계정 이름 세그먼트만 지운다. 공백 있는 이름("/Users/Gordon Ahn/…")은 뒤에 '/' 가 이어질 때만
//   공백을 포함시킨다 — 안 그러면 "/Users/alice has no home directory" 에서 문장을 통째로 삼킨다.
const PATH_ACCOUNT = [
  /(\/(?:Users|home)\/)[^/\s"'`,)\]}]+(?:[ ][^/\s"'`,)\]}]+)*(?=\/)/g,
  /(\/(?:Users|home)\/)[^/\s"'`,)\]}]+/g,
  /([A-Za-z]:(?:\\{1,2})Users(?:\\{1,2}))[^\\/\s"'`,)\]}]+(?:[ ][^\\/\s"'`,)\]}]+)*(?=\\)/g,
  /([A-Za-z]:(?:\\{1,2})Users(?:\\{1,2}))[^\\/\s"'`,)\]}]+/g,
]

const SECRET_BEARING = [
  /\bya29\.[A-Za-z0-9._~+/-]{8,}/g,                       // Google OAuth 토큰
  /\bAIza[A-Za-z0-9._~+/-]{10,}/g,                        // Google API 키
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
  // ⚠️ local part 를 묶지 않으면(`+`) 매치 실패 시 위치마다 되풀이해 O(n²) 가 된다 —
  //    20만 자 문자열에서 실측 24초. Sentry 훅은 동기라 그대로 앱이 멈춘다. RFC 상한(64)으로 묶는다.
  /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g,   // 이메일
]

// 생성된 미디어 URL — 사용자 결과물의 주소이고 서명 토큰을 달고 있다.
//   ⚠️ URL 을 먼저 통으로 잡고 콜백에서 호스트를 검사한다. `[^\s]*(?:a|b)[^\s]*` 형태로 쓰면
//      매치 실패 시 2차 백트래킹이 터진다(실측: 32KB 600ms, 200KB 21초). Sentry 훅은 동기다.
// Sentry SDK 가 채우는 컨텍스트 — 여기 name/text 는 진단이지 사용자 콘텐츠가 아니다.
const SDK_CONTEXTS = /^(os|device|runtime|app|browser|culture|trace|gpu|cloud_resource|response)$/i

const ANY_URL = /https?:\/\/[^\s"'`,)\]}]+/g
const MEDIA_HOST = /googleusercontent|ggpht|fife|getMediaUrlRedirect/i

/** 한 문자열에서 콘텐츠·자격증명·계정명을 벗긴다. */
export function scrubSentryString(message) {
  let out = String(message)
  // ⚠️ 캡처 그룹이 있는 정규식만 '$1<redacted>' 를 쓸 수 있다. 그룹 없는 정규식에 콜백을 쓰면
  //    두 번째 인자가 캡처가 아니라 offset(숫자)이라 "20<redacted>" 같은 쓰레기가 만들어진다.
  for (const re of [...PROMPT_BEARING, ...KEYED_SECRETS, ...PATH_ACCOUNT]) out = out.replace(re, `$1${REDACTED}`)
  for (const re of SECRET_BEARING) out = out.replace(re, REDACTED)
  out = out.replace(ANY_URL, (url) => {
    let host = ''
    try { host = new URL(url).hostname } catch { host = url }
    return MEDIA_HOST.test(host) ? REDACTED : url   // 쿼리스트링이 아니라 host 로 판정한다
  })
  return out
}

/** 객체를 재귀적으로 씻는다 — 키로도 보고 값으로도 본다. 사이클이 있어도 죽지 않는다. */
function scrubDeep(value, seen = new WeakSet(), opts = { keys: true }) {
  if (typeof value === 'string') return scrubSentryString(value)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return value          // 진단 정리 중에 앱이 죽는 일은 없어야 한다
  seen.add(value)

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = scrubDeep(value[i], seen, opts)
    return value
  }

  for (const [k, v] of Object.entries(value)) {
    try {
      // 자격증명 키는 어디서든 지운다. 콘텐츠 키는 opts.keys 가 켜진 곳에서만(contexts 제외).
      if (hasWord(k, SECRET_WORDS) || (opts.keys && hasWord(k, CONTENT_WORDS))) value[k] = REDACTED
      else value[k] = scrubDeep(v, seen, opts)
    } catch { /* getter 가 던져도 무시 */ }
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
 * main·renderer 공용 beforeSend / beforeSendTransaction.
 *
 * breadcrumb 만 씻고 이벤트를 안 씻으면 의미가 없다 — 에러 메시지 하나가
 * "ENOENT: /Users/alice/Desktop/secret.txt" 이면 그대로 나간다. transaction/span 도 마찬가지로
 * 일반 beforeSend 를 타지 않으므로 같은 함수를 따로 걸어준다.
 */
export function scrubEvent(event) {
  if (!event) return event
  if (event.user) {
    delete event.user.ip_address
    delete event.user.email
  }
  if (event.request?.data) delete event.request.data

  // extra 는 키 이름부터 드러낸다 — 값 스크럽(정규식)은 자유 형식 콘텐츠를 다 못 덮으므로,
  //   콘텐츠를 담는 키는 통째로 버린다. 두 방어를 겹친다.
  if (event.extra) {
    for (const k of Object.keys(event.extra)) {
      if (/prompt|input|filename|path/i.test(k)) delete event.extra[k]
    }
  }

  const seen = new WeakSet()
  // transaction 이름·logentry·user.username/ user.data 는 전부 실측으로 그대로 나가고 있었다.
  for (const f of ['message', 'transaction']) {
    if (typeof event[f] === 'string') event[f] = scrubSentryString(event[f])
  }
  if (event.logentry) scrubDeep(event.logentry, seen)
  if (event.user) scrubDeep(event.user, seen)
  for (const field of ['request', 'exception', 'extra', 'tags', 'spans']) {
    if (event[field]) scrubDeep(event[field], seen)
  }
  // contexts: SDK 가 만드는 것(os.name, device.name …)에 CONTENT_KEYS 를 걸면 진단만 죽는다.
  //   반대로 우리가 붙인 커스텀 컨텍스트는 사용자 콘텐츠를 담을 수 있으니 키까지 본다.
  if (event.contexts) {
    for (const [name, ctx] of Object.entries(event.contexts)) {
      scrubDeep(ctx, seen, { keys: !SDK_CONTEXTS.test(name) })
    }
  }
  if (Array.isArray(event.breadcrumbs)) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean)

  return event
}
