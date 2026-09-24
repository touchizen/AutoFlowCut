/**
 * electron/flow-net-trace.js
 *
 * AUTOFLOWCUT_NET_TRACE=1 진단 트레이스의 순수 헬퍼(main 전용, 관측만 — 생성 로직 무관).
 *
 * 2026-09-23 실기: 새 flow.google.com 은 모든 RPC 를 POST /_/AiSandboxAngularFrontend/data/batchexecute
 * ?rpcids=… (XHR, 쿠키 인증)로 보낸다. 옛 fetch 몽키패치·aisandbox REST·세션 API 는 전부 안 보인다.
 * main 은 (1) webRequest 의 uploadData(요청 본문) (2) 페이지 XHR 훅(flow-xhr-capture.js)이 보낸 응답을
 * JSONL 한 줄씩 append 한다 — 파일은 AUTOFLOWCUT_NET_TRACE_FILE 또는 바탕화면 autoflowcut-xhr-<stamp>.jsonl.
 * 개인 id·토큰이 그대로 들어가므로 파일은 저장소에 넣지 않는다(마스킹한 표만 docs/handoffs/evidence/).
 * tests/electron/flow-net-trace.test.js
 */
import path from 'node:path'

/** 정확히 "1" 일 때만 켠다 — "true"/"0" 은 off. */
export function isNetTraceOn(env) {
  return !!env && env.AUTOFLOWCUT_NET_TRACE === '1'
}

/** 명시 경로(AUTOFLOWCUT_NET_TRACE_FILE) 우선, 없으면 <desktop>/autoflowcut-xhr-<stamp>.jsonl. */
export function netTraceFilePath(env, desktopDir, now = new Date()) {
  const explicit = env && env.AUTOFLOWCUT_NET_TRACE_FILE
  if (explicit) return explicit
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return path.join(desktopDir, `autoflowcut-xhr-${stamp}.jsonl`)
}

/** webRequest.onBeforeRequest 의 uploadData → 본문 문자열. bytes 는 utf8, file 은 <file:…>. 없으면 null. */
export function decodeUploadData(uploadData) {
  if (!Array.isArray(uploadData) || uploadData.length === 0) return null
  return uploadData.map((d) => {
    if (!d) return ''
    if (d.bytes) return Buffer.from(d.bytes).toString('utf8')
    if (d.file) return `<file:${d.file}>`
    return ''
  }).join('')
}

/** 상대경로(페이지 XHR 은 /_/… 로 연다)도 파싱되게 — 호스트가 없으면 (relative) 표식 호스트를 붙인다. */
const RELATIVE_BASE = 'https://relative.invalid'
function parseUrl(url) {
  const s = String(url ?? '')
  try { return new URL(s) } catch { /* 상대경로 */ }
  try { return new URL(s, RELATIVE_BASE) } catch { return null }
}

/** batchexecute URL 의 ?rpcids=A,B → ['A','B']. 없거나 깨진 URL 은 []. */
export function batchexecuteRpcIds(url) {
  const u = parseUrl(url)
  const v = u && u.searchParams.get('rpcids')
  return v ? v.split(',').filter(Boolean) : []
}

/** JSONL 한 줄 — t(수신 시각)·rpcids 를 앞에 붙이고 entry 필드는 그대로. */
export function buildTraceLine(entry, receivedAt = Date.now()) {
  const e = entry || {}
  return JSON.stringify({ t: receivedAt, rpcids: batchexecuteRpcIds(e.url), ...e })
}

/** 콘솔 한 줄 — 값은 절대 안 찍고(쿼리의 at 등) source/method/host/path/rpcids/status/크기만. */
export function summarizeTraceEntry(entry) {
  const e = entry || {}
  let host = '?'
  let pathname = String(e.url || '')
  const u = parseUrl(e.url)
  if (u) {
    host = u.hostname === 'relative.invalid' ? '(relative)' : u.hostname
    pathname = u.pathname
  }
  const size = (s) => (typeof s === 'string' ? `${s.length}b` : '-')
  return `${e.source || '?'} ${e.method || ''} ${host} ${pathname.slice(0, 80)} rpcids=${batchexecuteRpcIds(e.url).join(',')} status=${e.status ?? '-'} req=${size(e.reqBody)} resp=${size(e.respBody)}`
}
