/**
 * electron/flow-xhr-capture.js
 *
 * Flow 페이지의 XMLHttpRequest 를 몽키패치해 요청/응답을 main(flow:report-xhr)으로 보내는 **진단 주입**.
 * AUTOFLOWCUT_NET_TRACE=1 일 때만 main 이 실행한다(flow-net-trace.js). 관측만 — 요청은 절대 바꾸지 않는다.
 *
 * 2026-09-23 실기: 새 flow.google.com(Angular) 은 생성·상태·미디어 RPC 를 fetch 가 아니라 XHR 로
 * POST /_/AiSandboxAngularFrontend/data/batchexecute?rpcids=… 에 보낸다. 기존 fetch 몽키패치
 * (flow-page-injection.js)는 그래서 생성 응답을 한 건도 못 봤다. rpcid 표는 이 캡처로만 만든다(추측 금지).
 *
 * 문자열로 export — webContents.executeJavaScript 로 페이지 컨텍스트에서 실행된다(Node API 없음).
 * 헬퍼는 자기완결(toString 직렬화). tests/electron/flow-xhr-capture.test.js
 */

/** 응답 본문 보관 상한(문자). 미디어 목록 응답도 이 안에 든다. 넘으면 잘라내고 respTruncated 표시. */
export const XHR_TRACE_MAX_BODY = 4 * 1024 * 1024

/** Google 계열(google.com / googleapis.com / *.google)만 추적하고 로깅·reCAPTCHA 노이즈는 제외. 자기완결. */
export function shouldTraceXhrUrl(url, base) {
  var u
  try { u = new URL(String(url), base || undefined) } catch (_e) { return false }
  var host = u.hostname
  if (!/(^|\.)(google\.com|googleapis\.com|google)$/i.test(host)) return false
  if (/clients6\.google\.com$/i.test(host)) return false                            // ogads 등 로깅 RPC
  if (/^play\.google\.com$/i.test(host) && /^\/log/.test(u.pathname)) return false  // 클라이언트 로그
  if (/recaptcha/i.test(host + u.pathname)) return false
  return true
}

/** XHR send 본문 → 문자열. 바이너리는 값 대신 크기 표식. 자기완결. */
export function serializeXhrBody(body) {
  if (body == null) return null
  if (typeof body === 'string') return body
  try {
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString()
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var parts = []
      body.forEach(function (v, k) { parts.push(k + '=' + (typeof v === 'string' ? v : '<file>')) })
      return parts.join('&')
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) return '<blob ' + body.size + ' bytes>'
    if (typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) return '<binary ' + body.byteLength + ' bytes>'
    if (typeof Document !== 'undefined' && body instanceof Document) return '<document>'
  } catch (_e) { /* 아래 String 폴백 */ }
  return String(body)
}

/** XHR 응답 → { body, truncated }. responseType 별로 텍스트화. 자기완결. */
export function serializeXhrResponse(xhr, max) {
  var rt = ''
  try { rt = xhr.responseType || '' } catch (_e) { /* 접근 불가 — text 로 간주 */ }
  var text = null
  try {
    if (rt === '' || rt === 'text') text = xhr.responseText
    else if (rt === 'json') text = JSON.stringify(xhr.response)
    else if (rt === 'arraybuffer' && xhr.response && typeof TextDecoder !== 'undefined') text = new TextDecoder().decode(new Uint8Array(xhr.response).subarray(0, max))
    else if (rt === 'blob' && xhr.response) text = '<blob ' + xhr.response.size + ' bytes>'
    else text = '<' + rt + '>'
  } catch (e) { text = '<unreadable: ' + (e && e.message) + '>' }
  if (typeof text !== 'string') text = text == null ? null : String(text)
  var truncated = !!(text && text.length > max)
  return { body: truncated ? text.slice(0, max) : text, truncated: truncated }
}

export const FLOW_XHR_CAPTURE_INJECTION = /* js */ `
(function () {
  // 직렬화된 자기완결 헬퍼 — IIFE 안에 선언(재실행 시 top-level redeclaration 에러 방지).
  const shouldTraceXhrUrl = ${shouldTraceXhrUrl.toString()};
  const serializeXhrBody = ${serializeXhrBody.toString()};
  const serializeXhrResponse = ${serializeXhrResponse.toString()};
  const MAX = ${XHR_TRACE_MAX_BODY};

  function report(payload) {
    try {
      const api = window.electronAPI
      const p = api && typeof api.flowReportXhr === 'function' ? api.flowReportXhr(payload) : null
      if (p && typeof p.catch === 'function') p.catch(function () {})
    } catch (_) {}
  }

  // WIZ_global_data 1회 보고 — batchexecute 폼의 at(SNlM0e)·f.sid(FdrFJe)·bl(cfb2h) 출처 확인용.
  //   첫 실행 때 아직 없었을 수 있어(주입이 inline script 보다 빠른 경우) 매 실행마다 확인, 보고는 1회.
  try {
    const wiz = window.WIZ_global_data
    if (wiz && !window.__autoflowcut_wiz_reported__) {
      window.__autoflowcut_wiz_reported__ = true
      report({ source: 'wiz', url: window.location && window.location.href, wiz: JSON.stringify(wiz).slice(0, 65536) })
    }
  } catch (_) {}

  if (window.__autoflowcut_xhr_patched__) return
  window.__autoflowcut_xhr_patched__ = true
  const XHR = window.XMLHttpRequest
  if (!XHR || !XHR.prototype) return
  const _open = XHR.prototype.open
  const _send = XHR.prototype.send
  const _setRequestHeader = XHR.prototype.setRequestHeader

  XHR.prototype.open = function (method, url) {
    // 페이지는 상대경로(/_/…batchexecute)로 연다 — 보고는 절대 URL 로(main 의 rpcids 추출·호스트 요약 전제).
    let abs = String(url)
    try { abs = new URL(abs, window.location && window.location.href).href } catch (_) {}
    try { this.__af_trace = { method: String(method || 'GET').toUpperCase(), url: abs, reqHeaders: {} } } catch (_) {}
    return _open.apply(this, arguments)
  }
  XHR.prototype.setRequestHeader = function (name, value) {
    try { if (this.__af_trace) this.__af_trace.reqHeaders[String(name)] = String(value) } catch (_) {}
    return _setRequestHeader.apply(this, arguments)
  }
  XHR.prototype.send = function (body) {
    try {
      const t = this.__af_trace
      if (t && !t.armed && shouldTraceXhrUrl(t.url, window.location && window.location.href)) {
        t.armed = true
        t.reqBody = serializeXhrBody(body)
        t.reqStartedAt = Date.now()
        const xhr = this
        this.addEventListener('loadend', function () {
          try {
            const r = serializeXhrResponse(xhr, MAX)
            report({
              source: 'xhr', method: t.method, url: t.url, status: xhr.status,
              reqHeaders: t.reqHeaders, reqBody: t.reqBody,
              respBody: r.body, respTruncated: r.truncated, respType: xhr.responseType || '',
              reqStartedAt: t.reqStartedAt, endedAt: Date.now(),
            })
          } catch (_) {}
        })
      }
    } catch (_) {}
    return _send.apply(this, arguments)
  }

  // 흔적 최소화 — fetch 패치와 같은 방식으로 toString 을 네이티브처럼.
  try {
    ;[['open', XHR.prototype.open], ['send', XHR.prototype.send], ['setRequestHeader', XHR.prototype.setRequestHeader]].forEach(function (pair) {
      Object.defineProperty(pair[1], 'toString', { value: function () { return 'function ' + pair[0] + '() { [native code] }' }, configurable: true })
      Object.defineProperty(pair[1], 'name', { value: pair[0], configurable: true })
    })
  } catch (_) {}

  console.log('[Flow Inject] XMLHttpRequest traced (AUTOFLOWCUT_NET_TRACE)')
})()
`
