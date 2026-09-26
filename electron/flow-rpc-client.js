/**
 * electron/flow-rpc-client.js
 *
 * 앱이 직접 부르는 **읽기** RPC(크레딧 nzlxg · 상태 jwpduf · 미디어 as29s) 클라이언트.
 *
 * 요청은 페이지 컨텍스트의 XMLHttpRequest 로 나간다(executeJavaScript). 쿠키와 `at`(WIZ_global_data.SNlM0e)
 * 은 페이지 안에만 있고 main 으로 나오지 않는다 — main 은 {status, text} 만 받는다.
 * 제출 RPC(ogiZ0b/YhhmEf — reCAPTCHA Enterprise 토큰이 실린다)는 허용 목록 밖: 빌더·클라이언트 모두 throw.
 * 앱은 제출 RPC 를 절대 만들지 않는다(제출은 신뢰 클릭으로만).
 *
 * 형식(2026-09-24 실측, docs/handoffs/evidence/2026-09-24-flow-batchexecute-rpcids.md §1):
 *   POST /_/AiSandboxAngularFrontend/data/batchexecute?rpcids=<id>&source-path=<path>&bl=<cfb2h>&f.sid=<FdrFJe>&hl=<hl>&_reqid=<n>&rt=c
 *   body  f.req=<enc [[[rpcid,"<payload json>",null,"generic"]]]>&at=<SNlM0e>&
 *   헤더  X-Same-Domain: 1 · Content-Type: application/x-www-form-urlencoded;charset=utf-8
 *
 * readWizGlobals / buildRpcRequest 는 페이지에 toString() 으로 직렬화된다 → 자기완결(모듈 스코프 참조 금지).
 * tests/electron/flow-rpc-client.test.js
 */
import { FlowRpcError, parseBatchexecuteResponse } from './flow-rpc-protocol.js'

export const FLOW_RPC_ALLOWLIST = Object.freeze(['nzlxg', 'jwpduf', 'as29s'])

/** 페이지 컨텍스트 XHR 마감. 폴링 cadence(10초)보다 넉넉히. */
export const FLOW_RPC_TIMEOUT_MS = 30000

const RPC_PATH = '/_/AiSandboxAngularFrontend/data/batchexecute'

function assertAllowed(rpcid) {
  if (!FLOW_RPC_ALLOWLIST.includes(rpcid)) throw new Error('rpcid not allowed: ' + String(rpcid))
}

/** window.WIZ_global_data → { at, sid, bl }. 그 외 키(계정 식별자 등)는 버린다. 누락은 키 이름으로 throw. 자기완결. */
export function readWizGlobals(wiz) {
  var w = wiz && typeof wiz === 'object' ? wiz : {}
  var keys = [['SNlM0e', 'at'], ['FdrFJe', 'sid'], ['cfb2h', 'bl']]
  var out = {}
  for (var i = 0; i < keys.length; i++) {
    var v = w[keys[i][0]]
    if (v == null || v === '') throw new Error('WIZ_global_data.' + keys[i][0] + ' missing')
    out[keys[i][1]] = String(v)
  }
  return out
}

/**
 * batchexecute 요청 한 건 → { url(상대경로), body, headers }. 허용 목록 밖 rpcid 는 throw. 자기완결.
 * @param {{rpcid:string, payload:any, wiz:{at,sid,bl}, hl:string, sourcePath:string, reqid:number}} o
 */
export function buildRpcRequest(o) {
  var allowed = { nzlxg: 1, jwpduf: 1, as29s: 1 }
  if (!o || !allowed[o.rpcid]) throw new Error('rpcid not allowed: ' + String(o && o.rpcid))
  var q = new URLSearchParams()
  q.set('rpcids', o.rpcid)
  q.set('source-path', String(o.sourcePath || '/'))
  q.set('bl', o.wiz.bl)
  q.set('f.sid', o.wiz.sid)
  q.set('hl', String(o.hl || 'en'))
  q.set('_reqid', String(o.reqid))
  q.set('rt', 'c')
  var freq = JSON.stringify([[[o.rpcid, JSON.stringify(o.payload), null, 'generic']]])
  return {
    url: '/_/AiSandboxAngularFrontend/data/batchexecute?' + q.toString(),
    body: 'f.req=' + encodeURIComponent(freq) + '&at=' + encodeURIComponent(o.wiz.at) + '&',
    headers: { 'X-Same-Domain': '1', 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
  }
}

/**
 * 페이지에서 실행할 스크립트(Promise → {status, text} | {status:0, error:'timeout'|'wiz-missing'|'xhr-error'}).
 * 헬퍼는 const 로 직렬화해 호출 지점에서 조합한다(서로 이름으로 부르지 않는다 — minified 빌드 안전).
 * _reqid 는 문서 전역의 단순 카운터.
 */
export function FLOW_RPC_CALL_JS(rpcid, payloadJson) {
  assertAllowed(rpcid)
  if (typeof payloadJson !== 'string') throw new Error('payloadJson must be a JSON string')
  JSON.parse(payloadJson) // 깨진 JSON 을 페이지에 심지 않는다
  return /* js */ `
(function () {
  const readWizGlobals = ${readWizGlobals.toString()};
  const buildRpcRequest = ${buildRpcRequest.toString()};
  const TIMEOUT_MS = ${FLOW_RPC_TIMEOUT_MS};
  return new Promise(function (resolve) {
    let wiz
    try { wiz = readWizGlobals(window.WIZ_global_data) } catch (_e) { resolve({ status: 0, error: 'wiz-missing' }); return }
    const reqid = (window.__autoflowcut_rpc_reqid__ = (window.__autoflowcut_rpc_reqid__ || 0) + 1)
    let hl = 'en'
    try { hl = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'en' } catch (_e) {}
    let req
    try {
      req = buildRpcRequest({ rpcid: ${JSON.stringify(rpcid)}, payload: ${payloadJson}, wiz: wiz, hl: hl, sourcePath: location.pathname, reqid: reqid })
    } catch (_e) { resolve({ status: 0, error: 'build-failed' }); return }
    let done = false
    const settle = function (v) { if (!done) { done = true; resolve(v) } }
    try {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', req.url)
      for (const k in req.headers) xhr.setRequestHeader(k, req.headers[k])
      xhr.timeout = TIMEOUT_MS
      xhr.addEventListener('timeout', function () { settle({ status: 0, error: 'timeout' }) })
      xhr.addEventListener('error', function () { settle({ status: 0, error: 'xhr-error' }) })
      xhr.addEventListener('loadend', function () {
        if (xhr.status === 0) { settle({ status: 0, error: 'xhr-error' }); return }
        settle({ status: xhr.status, text: String(xhr.responseText || '') })
      })
      xhr.send(req.body)
    } catch (_e) { settle({ status: 0, error: 'xhr-error' }) }
  })
})()`
}

/**
 * 읽기 RPC 한 건: 페이지 XHR → 파싱된 payload. 실패는 전부 FlowRpcError(kind: rpc|er|http|network|shape).
 * 메시지에 응답 본문은 싣지 않는다.
 */
export async function callFlowRpc(flowView, rpcid, payload) {
  assertAllowed(rpcid)
  const script = FLOW_RPC_CALL_JS(rpcid, JSON.stringify(payload === undefined ? null : payload))
  let r
  try {
    r = await flowView.webContents.executeJavaScript(script, true)
  } catch (_e) {
    throw new FlowRpcError('network', { status: 0, reason: 'execute-failed' })
  }
  if (!r || typeof r !== 'object') throw new FlowRpcError('network', { status: 0, reason: 'no-result' })
  if (r.error || r.status === 0) throw new FlowRpcError('network', { status: 0, reason: String(r.error || 'xhr-error') })
  if (r.status !== 200) throw new FlowRpcError('http', { status: Number(r.status) })
  return parseBatchexecuteResponse(r.text, rpcid)
}
