/**
 * electron/flow-rpc-capture.js
 *
 * flow.google.com 제출 RPC 캡처 주입 — **프로덕션, 항상 켜짐**(진단 트레이스 flow-xhr-capture.js 와 별개).
 *
 * 새 Flow(Angular) 는 이미지 생성(ogiZ0b)·영상 제출(YhhmEf)을 XHR POST …/batchexecute 로 보내고 그 요청에는
 * reCAPTCHA Enterprise 토큰이 실린다 → 앱은 제출을 절대 만들지 않고(신뢰 클릭만) 페이지가 보낸 요청의
 * send/loadend 를 **관측**해 pendingGenerations 와 상관시킨다. 요청 본문은 절대 바꾸지 않는다.
 *
 *   send    → flowReportResponse({kind:'batchexecute-send', doc, rpcid, rpcids, seq, prompts, sentAt, multi?})
 *   loadend → flowReportResponse({kind:'batchexecute', doc, rpcid, seq, status, responseText, endedAt})
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
import { decodeFReqInner, extractSubmitPrompts } from './flow-rpc-protocol.js'

export const FLOW_RPC_CAPTURE_ALLOWLIST = Object.freeze(['ogiZ0b', 'YhhmEf'])

export const FLOW_RPC_CAPTURE_INJECTION = /* js */ `
(function () {
  const decodeFReqInner = ${decodeFReqInner.toString()};
  const extractSubmitPrompts = ${extractSubmitPrompts.toString()};
  const ALLOW = { ogiZ0b: 1, YhhmEf: 1 };

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
      if (t && !t.armed && t.method === 'POST') {
        let u = null
        try { u = new URL(t.url) } catch (_) { u = null }
        if (u && u.pathname.endsWith('/data/batchexecute')) {
          const rpcids = String(u.searchParams.get('rpcids') || '').split(',').filter(function (x) { return !!x })
          let rpcid = null
          for (let i = 0; i < rpcids.length; i++) { if (ALLOW[rpcids[i]]) { rpcid = rpcids[i]; break } }
          if (rpcid) {
            t.armed = true
            const seq = (window.__autoflowcut_rpc_seq__ = window.__autoflowcut_rpc_seq__ + 1)
            const decoded = typeof body === 'string' ? decodeFReqInner(body) : null
            const prompts = decoded ? extractSubmitPrompts(rpcid, decoded.inner) : []
            const ev = { kind: 'batchexecute-send', doc: doc, rpcid: rpcid, rpcids: rpcids, seq: seq, prompts: prompts, sentAt: Date.now() / 1000 }
            if (rpcids.length > 1) ev.multi = true
            report(ev)
            const xhr = this
            this.addEventListener('loadend', function () {
              try {
                let text = ''
                try { text = (xhr.responseType === '' || xhr.responseType === 'text') ? String(xhr.responseText || '') : '' } catch (_) { text = '' }
                report({ kind: 'batchexecute', doc: doc, rpcid: rpcid, seq: seq, status: xhr.status, responseText: text, endedAt: Date.now() / 1000 })
              } catch (_) {}
            })
          }
        }
      }
    } catch (_) {}
    return _send.apply(this, arguments)
  }

  console.log('[Flow Inject] batchexecute capture installed')
})()
`
