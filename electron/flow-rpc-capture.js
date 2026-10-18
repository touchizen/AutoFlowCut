/**
 * electron/flow-rpc-capture.js
 *
 * flow.google.com 제출 RPC 캡처 주입 — **프로덕션, 항상 켜짐**(진단 트레이스 flow-xhr-capture.js 와 별개).
 *
 * 새 Flow(Angular) 는 이미지 생성(ogiZ0b)·영상 제출(YhhmEf)을 POST …/batchexecute 로 보내고(XHR — 2026-10 부터는 fetch(Request) 도) 그 요청에는
 * reCAPTCHA Enterprise 토큰이 실린다 → 앱은 제출을 절대 만들지 않고(신뢰 클릭만) 페이지가 보낸 요청의
 * send/loadend 를 **관측**해 pendingGenerations 와 상관시킨다. 요청 본문은 절대 바꾸지 않는다.
 *
 *   send    → flowReportResponse({kind:'batchexecute-send', doc, rpcid, rpcids, seq, prompts, sentAt, refs, mentions, multi?})
 *   loadend → flowReportResponse({kind:'batchexecute', doc, rpcid, seq, status, responseText, endedAt})
 *
 * M3-2(계획서 2026-09-25 M3 D5·D10): 허용 목록에 MZZa6b(레퍼런스 영상 r2v 제출)·maseQ(레퍼런스 이미지 업로드). 제출 send 에는 요청의
 * 레퍼런스·멘션 id(refs·mentions — extractSubmitRefs, id 만; 검증 불가면 null). **maseQ 는 본문을 디코드하지 않는다**(수 MB base64·파일명) —
 * send 는 prompts:[] 만(refs·mentions 키 없음), loadend 는 다른 rpc 와 같이 responseText(~600B, main 이 parseUploadResponse 로 파싱만).
 *
 * doc = 문서마다 새 32hex nonce(같은 문서 재주입은 유지 — SPA 내비게이션·재주입 안전), seq = 문서 안 카운터.
 * {doc, seq} 가 상관키(electron/flow-rpc-router.js). 제출 프롬프트는 send 이벤트로만 main 에 가고, main 은
 * 개수만 로그한다.
 *
 * 문자열로 export — webContents.executeJavaScript 로 페이지 컨텍스트에서 실행(Node API 없음). 헬퍼는
 * const 로 직렬화해 호출 지점에서 조합한다(서로 이름으로 부르지 않는다 — minified 빌드 안전).
 * 설치 플래그 window.__autoflowcut_rpc_capture__ 를 핸들러가 클릭 전에 프로브한다.
 * tests/electron/flow-rpc-capture.test.js · tests/electron/flow-injections-minified.test.js
 */
import { decodeFReqInner, extractSubmitPrompts, extractSubmitRefs } from './flow-rpc-protocol.js'

export const FLOW_RPC_CAPTURE_ALLOWLIST = Object.freeze(['ogiZ0b', 'YhhmEf', 'MZZa6b', 'maseQ'])

export const FLOW_RPC_CAPTURE_INJECTION = /* js */ `
(function () {
  const decodeFReqInner = ${decodeFReqInner.toString()};
  const extractSubmitPrompts = ${extractSubmitPrompts.toString()};
  const extractSubmitRefs = ${extractSubmitRefs.toString()};
  const ALLOW = { ogiZ0b: 1, YhhmEf: 1, MZZa6b: 1, maseQ: 1 };

  function report(payload) {
    try {
      const api = window.electronAPI
      const p = api && typeof api.flowReportResponse === 'function' ? api.flowReportResponse(payload) : null
      if (p && typeof p.catch === 'function') p.catch(function () {})
    } catch (_) {}
  }

  if (window.__autoflowcut_rpc_capture__) return
  const XHR = window.XMLHttpRequest
  if (!XHR || !XHR.prototype) return

  // 문서 nonce — 이 문서에서 처음 설치될 때만 만든다(재주입은 유지).
  let doc = window.__autoflowcut_rpc_doc__
  if (typeof doc !== 'string' || !/^[0-9a-f]{32}$/.test(doc)) {
    doc = ''
    try {
      const bytes = new Uint8Array(16)
      window.crypto.getRandomValues(bytes)
      for (let i = 0; i < bytes.length; i++) doc += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16)
    } catch (_) { doc = '' }
    while (doc.length < 32) doc += Math.floor(Math.random() * 16).toString(16)
    window.__autoflowcut_rpc_doc__ = doc
  }
  if (typeof window.__autoflowcut_rpc_seq__ !== 'number') window.__autoflowcut_rpc_seq__ = 0
  window.__autoflowcut_rpc_capture__ = true

  // XHR·fetch 공용 — POST …/data/batchexecute 의 허용 rpc 면 send 이벤트(본문 판독 전, seq 하나 사용), 아니면 null.
  const sendEventFor = function (method, url) {
    if (method !== 'POST') return null
    let u = null
    try { u = new URL(url, window.location && window.location.href) } catch (_) { return null }
    if (!u.pathname.endsWith('/data/batchexecute')) return null
    const rpcids = String(u.searchParams.get('rpcids') || '').split(',').filter(function (x) { return !!x })
    let rpcid = null
    for (let i = 0; i < rpcids.length; i++) { if (ALLOW[rpcids[i]]) { rpcid = rpcids[i]; break } }
    if (!rpcid) return null
    const seq = (window.__autoflowcut_rpc_seq__ = window.__autoflowcut_rpc_seq__ + 1)
    const ev = { kind: 'batchexecute-send', doc: doc, rpcid: rpcid, rpcids: rpcids, seq: seq, prompts: [], sentAt: Date.now() / 1000 }
    if (rpcids.length > 1) ev.multi = true
    return ev
  }
  // 제출 본문 → prompts·refs·mentions. maseQ 에는 부르지 않는다(업로드 본문 base64·파일명은 풀지 않는다).
  const fillSubmit = function (ev, body) {
    const decoded = typeof body === 'string' ? decodeFReqInner(body) : null
    const refs = decoded ? extractSubmitRefs(ev.rpcid, decoded.inner) : null
    ev.prompts = decoded ? extractSubmitPrompts(ev.rpcid, decoded.inner) : []
    ev.refs = refs ? refs.refs : null
    ev.mentions = refs ? refs.mentions : null
  }
  const loadendEvent = function (ev, status, text) {
    return { kind: 'batchexecute', doc: doc, rpcid: ev.rpcid, seq: ev.seq, status: status, responseText: text, endedAt: Date.now() / 1000 }
  }

  const _open = XHR.prototype.open
  const _send = XHR.prototype.send
  XHR.prototype.open = function (method, url) {
    try {
      let abs = String(url)
      try { abs = new URL(abs, window.location && window.location.href).href } catch (_) {}
      this.__af_rpc = { method: String(method || 'GET').toUpperCase(), url: abs }
    } catch (_) {}
    return _open.apply(this, arguments)
  }
  XHR.prototype.send = function (body) {
    try {
      const t = this.__af_rpc
      const ev = t && !t.armed ? sendEventFor(t.method, t.url) : null
      if (ev) {
        t.armed = true
        if (ev.rpcid !== 'maseQ') fillSubmit(ev, body)
        report(ev)
        const xhr = this
        this.addEventListener('loadend', function () {
          try {
            let text = ''
            try { text = (xhr.responseType === '' || xhr.responseType === 'text') ? String(xhr.responseText || '') : '' } catch (_) { text = '' }
            report(loadendEvent(ev, xhr.status, text))
          } catch (_) {}
        })
      }
    } catch (_) {}
    return _send.apply(this, arguments)
  }

  // 2026-10-18 실기: Flow 가 batchexecute 를 fetch(Request) 로도 보낸다(maseQ·ogiZ0b 등) — XHR 만 감싸면 send 를 못 봐 upload-not-sent.
  //   같은 doc·seq·이벤트 모양으로 보고한다. Request 본문은 clone 으로만 읽고(원본 미소비), maseQ 본문은 읽지 않는다.
  //   본문 판독이 실패해도 send 는 보고하고(loadend 만 남지 않게), loadend 는 send 보고 뒤에 — 라우터는 send 로 바인딩하고 loadend 를 {doc, seq} 로 찾는다.
  const _fetch = window.fetch
  if (typeof _fetch === 'function') {
    const patchedFetch = function (input, init) {
      let ev = null
      try {
        const isObj = !!input && typeof input === 'object'
        const url = typeof input === 'string' ? input : (isObj && typeof input.url === 'string' ? input.url : String(input))
        ev = sendEventFor(String((init && init.method) || (isObj && input.method) || 'GET').toUpperCase(), url)
      } catch (_) { ev = null }
      if (!ev) return _fetch.apply(this, arguments)

      let sendDone = null
      try {
        const raw = init && init.body != null ? init.body : null
        if (ev.rpcid === 'maseQ') report(ev)
        else if (raw == null && typeof input === 'object' && typeof input.clone === 'function') {
          let text = null
          try { text = input.clone().text() } catch (_) { text = null }
          if (text && typeof text.then === 'function') {
            sendDone = text.then(function (t) { fillSubmit(ev, t) }, function () { fillSubmit(ev, null) }).then(function () { report(ev) }, function () { report(ev) })
          } else { fillSubmit(ev, null); report(ev) }
        } else { fillSubmit(ev, typeof raw === 'string' ? raw : null); report(ev) }
      } catch (_) { report(ev) }

      const end = function (status, text) {
        const fire = function () { report(loadendEvent(ev, status, text)) }
        if (sendDone) sendDone.then(fire, fire); else fire()
      }
      let p
      try { p = _fetch.apply(this, arguments) } catch (e) { end(0, ''); throw e }
      try {
        p.then(function (res) {
          let t = null
          try { t = res.clone().text() } catch (_) { t = null }
          if (t && typeof t.then === 'function') t.then(function (s) { end(res.status, String(s || '')) }, function () { end(res.status, '') })
          else end(res.status, '')
        }, function () { end(0, '') })
      } catch (_) {}
      return p
    }
    try {
      Object.defineProperty(patchedFetch, 'toString', { value: function () { return 'function fetch() { [native code] }' }, configurable: true })
      Object.defineProperty(patchedFetch, 'name', { value: 'fetch', configurable: true })
    } catch (_) {}
    window.fetch = patchedFetch
  }

  console.log('[Flow Inject] batchexecute capture installed')
})()
`
