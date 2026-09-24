/**
 * electron/flow-rpc-protocol.js
 *
 * flow.google.com(Angular) batchexecute 프로토콜의 순수 파서·인코더. Node API·DOM 없음.
 *
 * 위치 핀은 2026-09-24 실측 캡처(docs/handoffs/evidence/2026-09-24-flow-batchexecute-rpcids.md)의
 * 검증표 그대로다. **스키마 적응 없음** — 기대 위치에 기대 타입이 없으면 FlowRpcShapeError 로 닫힌다.
 * 에러 메시지에는 입력 내용(프롬프트·URL·서명·본문)을 절대 싣지 않는다(Sentry 로 나간다).
 *
 * 렌더러 결과 매핑(rpcErrorToRendererResult)의 `error` 문구에는 숫자도 auth 단어도 없다 — engineFlow.js 의
 * isFlowAuthError 정규식(\b401\b|\b403\b|unauthorized|…)이 문구를 보기 때문. 코드·상태는 별도 필드
 * (rpcCode / rpcStatus / httpStatus) 로 싣고, authFailed:true 는 HTTP 401 과 rpc code 16 에만 명시한다.
 *
 * decodeFReqInner / extractSubmitPrompts / normalizePrompt 는 페이지 컨텍스트 주입 문자열에도
 * toString() 으로 직렬화된다 → 자기완결(모듈 스코프·다른 헬퍼 참조 금지, 브라우저 전역만).
 *
 * tests/electron/flow-rpc-protocol.test.js
 */

export class FlowRpcError extends Error {
  /**
   * @param {'rpc'|'er'|'http'|'network'|'shape'|'download'} kind
   * @param {{code?: number|null, status?: number|null, reason?: string|null, message?: string}} [detail]
   *   reason 은 network 계열의 원인 표식('timeout'|'wiz-missing'|'xhr-error'|'execute-failed') — 내용 없음.
   */
  constructor(kind, { code = null, status = null, reason = null, message } = {}) {
    super(message || ('flow rpc ' + kind + ' failure' + (reason ? ' (' + reason + ')' : '')))
    this.name = 'FlowRpcError'
    this.kind = kind
    this.code = code
    this.status = status
    this.reason = reason
  }
}

/** 응답 위치가 바뀌었을 때. message 는 '<rpcid> response shape changed at <path>' — 입력 내용 없음. */
export class FlowRpcShapeError extends FlowRpcError {
  constructor(message, { rpcid = null, path = null } = {}) {
    super('shape', { message })
    this.name = 'FlowRpcShapeError'
    this.rpcid = rpcid
    this.path = path
  }
}

function shapeError(rpcid, path) {
  return new FlowRpcShapeError(rpcid + ' response shape changed at ' + path, { rpcid, path })
}

/**
 * batchexecute 응답 텍스트 → 요청한 rpcid 프레임의 payload(JSON 파싱).
 *
 * 형식: `)]}'\n\n<len>\n<json>\n<len>\n<json>…`. 길이 접두는 믿지 않는다(마스킹 픽스처는 stale 이고,
 * 실제로도 줄 단위로 읽는 편이 안전) — `[` 로 시작하는 줄만 프레임 배열로 파싱한다.
 *   성공 `["wrb.fr", rpcid, "<json>", …]`
 *   실패 `["wrb.fr", rpcid, null, null, null, [code, …], "generic"]` → FlowRpcError{kind:'rpc', code}
 *   `["er", …, status@5, …, code@9]` → FlowRpcError{kind:'er'}
 *   `["di", n]` · `["af.httprm", …]` · `["e", 4, …]` 는 메타 — 무시.
 */
export function parseBatchexecuteResponse(text, rpcid) {
  const s = typeof text === 'string' ? text : ''
  if (!s.startsWith(")]}'")) throw new FlowRpcShapeError('batchexecute response prefix missing', { rpcid })
  for (const line of s.split('\n')) {
    if (line[0] !== '[') continue
    let frames
    try { frames = JSON.parse(line) } catch (_e) {
      throw new FlowRpcShapeError('batchexecute response line is not JSON', { rpcid })
    }
    if (!Array.isArray(frames)) continue
    for (const f of frames) {
      if (!Array.isArray(f)) continue
      if (f[0] === 'er') {
        throw new FlowRpcError('er', {
          code: typeof f[9] === 'number' ? f[9] : null,
          status: typeof f[5] === 'number' ? f[5] : null,
        })
      }
      if (f[0] !== 'wrb.fr' || f[1] !== rpcid) continue
      if (typeof f[2] === 'string') {
        try { return JSON.parse(f[2]) } catch (_e) {
          throw new FlowRpcShapeError(rpcid + ' response payload is not JSON', { rpcid })
        }
      }
      const fail = Array.isArray(f[5]) ? f[5] : null
      if (fail && typeof fail[0] === 'number') throw new FlowRpcError('rpc', { code: fail[0] })
      throw new FlowRpcShapeError(rpcid + ' response frame has neither payload nor failure code', { rpcid })
    }
  }
  throw new FlowRpcShapeError(rpcid + ' response frame missing', { rpcid })
}

const IMAGE_MEDIA_HOST = 'flow-content.google'

function isPosInt(n) { return Number.isInteger(n) && n > 0 }

/** `[[["…"], ["…"]]]` 모양(요청 프롬프트와 같은 꼴)의 세그먼트 텍스트 목록. 비어 있거나 모양이 다르면 []. */
function echoSegments(node) {
  const segments = Array.isArray(node) && Array.isArray(node[0]) ? node[0] : null
  if (!segments) return []
  const out = []
  for (const seg of segments) if (Array.isArray(seg) && typeof seg[0] === 'string') out.push(seg[0])
  return out
}

/**
 * ogiZ0b(이미지 생성) payload → { results: [{ mediaId, seed, url, width, height, echo }] }.
 *   item = payload[0][i] (7원소): mediaId [0], 레코드 [6][0] (18원소: seed [1], url [13], 원 프롬프트
 *   [15][2][0][2]), 치수 [6][2] = [w, h]. url 호스트는 flow-content.google 이어야 한다.
 */
export function parseImageGenerateResponse(payload) {
  const RPC = 'ogiZ0b'
  const items = Array.isArray(payload) ? payload[0] : null
  if (!Array.isArray(items) || items.length === 0) throw shapeError(RPC, '[0]')
  const results = items.map((item, i) => {
    const p = '[0][' + i + ']'
    if (!Array.isArray(item)) throw shapeError(RPC, p)
    const mediaId = item[0]
    if (typeof mediaId !== 'string' || !mediaId) throw shapeError(RPC, p + '[0]')
    const holder = item[6]
    if (!Array.isArray(holder)) throw shapeError(RPC, p + '[6]')
    const record = holder[0]
    if (!Array.isArray(record)) throw shapeError(RPC, p + '[6][0]')
    const seed = record[1]
    if (seed != null && typeof seed !== 'number') throw shapeError(RPC, p + '[6][0][1]')
    const url = record[13]
    if (typeof url !== 'string') throw shapeError(RPC, p + '[6][0][13]')
    let host = null
    try { host = new URL(url).hostname } catch (_e) { host = null }
    if (host !== IMAGE_MEDIA_HOST) {
      throw new FlowRpcShapeError(RPC + ' image url host mismatch' + (host ? ' host=' + host : ''), { rpcid: RPC, path: p + '[6][0][13]' })
    }
    const dims = holder[2]
    if (!Array.isArray(dims) || !isPosInt(dims[0]) || !isPosInt(dims[1])) throw shapeError(RPC, p + '[6][2]')
    const echo = echoSegments(record[15] && record[15][2] && record[15][2][0] ? record[15][2][0][2] : null)
    return { mediaId, seed: seed == null ? null : seed, url, width: dims[0], height: dims[1], echo }
  })
  return { results }
}

/**
 * YhhmEf(영상 제출) payload → { creditsLeft, records:[{ mediaId, state, echo, modelKey, ratioEnum }] }.
 *   payload[1] 크레딧(중간 폴은 null 가능) · payload[3][i] 영상 레코드: mediaId [0], 상태 [5][8][0](6→2→3, 없으면
 *   null — 완료 판정은 상태 폴이 한다), 원 프롬프트 [5][6][2][0][2], 모델키 [7][0][12], 종횡비 enum [7][0][16].
 */
export function parseVideoSubmitResponse(payload) {
  const RPC = 'YhhmEf'
  if (!Array.isArray(payload)) throw shapeError(RPC, '[]')
  const credits = payload[1]
  if (credits != null && typeof credits !== 'number') throw shapeError(RPC, '[1]')
  const list = payload[3]
  if (!Array.isArray(list) || list.length === 0) throw shapeError(RPC, '[3]')
  const records = list.map((rec, i) => {
    const p = '[3][' + i + ']'
    if (!Array.isArray(rec)) throw shapeError(RPC, p)
    const mediaId = rec[0]
    if (typeof mediaId !== 'string' || !mediaId) throw shapeError(RPC, p + '[0]')
    const meta = Array.isArray(rec[5]) ? rec[5] : null
    const state = meta && Array.isArray(meta[8]) && typeof meta[8][0] === 'number' ? meta[8][0] : null
    const echo = echoSegments(meta && meta[6] && meta[6][2] && meta[6][2][0] ? meta[6][2][0][2] : null)
    const g0 = Array.isArray(rec[7]) && Array.isArray(rec[7][0]) ? rec[7][0] : null
    if (!g0) throw shapeError(RPC, p + '[7][0]')
    const modelKey = g0[12]
    if (typeof modelKey !== 'string' || !modelKey) throw shapeError(RPC, p + '[7][0][12]')
    return { mediaId, state, echo, modelKey, ratioEnum: typeof g0[16] === 'number' ? g0[16] : null }
  })
  return { creditsLeft: credits == null ? null : credits, records }
}

/**
 * batchexecute 요청 본문(`f.req=<enc>&at=<at>&`) → { rpcid, rpcids, inner }. at 은 버린다.
 * 디코드는 URLSearchParams(`+` 공백 변형도 같이 처리). 실패는 null — throw 없음(주입 문자열에서도 쓴다).
 * 자기완결.
 */
export function decodeFReqInner(body) {
  if (typeof body !== 'string') return null
  var freq = null
  try { freq = new URLSearchParams(body).get('f.req') } catch (_e) { return null }
  if (!freq) return null
  var entries
  try { entries = JSON.parse(freq) } catch (_e) { return null }
  if (!Array.isArray(entries) || !Array.isArray(entries[0]) || entries[0].length === 0) return null
  var rpcids = []
  for (var i = 0; i < entries[0].length; i++) {
    var e = entries[0][i]
    if (Array.isArray(e) && typeof e[0] === 'string') rpcids.push(e[0])
  }
  if (rpcids.length === 0) return null
  var inner = null
  var first = entries[0][0]
  if (typeof first[1] === 'string') {
    try { inner = JSON.parse(first[1]) } catch (_e) { inner = null }
  }
  return { rpcid: rpcids[0], rpcids: rpcids, inner: inner }
}

/**
 * 제출 RPC 의 inner payload 에서 프롬프트 텍스트 목록(항목당 1개, 세그먼트는 ' ' 결합).
 *   ogiZ0b: inner[1][i][8][0] = [["…"], …]      YhhmEf: inner[0][i][0][2][0] = [["…"], …]
 * 모양이 다르거나 모르는 rpcid 면 [] — throw 없음. 자기완결.
 */
export function extractSubmitPrompts(rpcid, inner) {
  var out = []
  if (!Array.isArray(inner)) return out
  var items = null
  if (rpcid === 'ogiZ0b') items = inner[1]
  else if (rpcid === 'YhhmEf') items = inner[0]
  if (!Array.isArray(items)) return out
  for (var i = 0; i < items.length; i++) {
    var item = items[i]
    if (!Array.isArray(item)) continue
    var node = rpcid === 'ogiZ0b' ? item[8] : (Array.isArray(item[0]) ? item[0][2] : null)
    var segments = Array.isArray(node) && Array.isArray(node[0]) ? node[0] : null
    if (!segments) continue
    var texts = []
    for (var j = 0; j < segments.length; j++) {
      var seg = segments[j]
      if (Array.isArray(seg) && typeof seg[0] === 'string') texts.push(seg[0])
    }
    if (texts.length) out.push(texts.join(' '))
  }
  return out
}

/** 프롬프트 정규화: 세그먼트 ' ' 결합 → NFC → 공백 압축 → trim. 양쪽(main·주입) 동일. 자기완결. */
export function normalizePrompt(s) {
  var str
  if (Array.isArray(s)) {
    var parts = []
    for (var i = 0; i < s.length; i++) parts.push(s[i] == null ? '' : String(s[i]))
    str = parts.join(' ')
  } else {
    str = s == null ? '' : String(s)
  }
  try { str = str.normalize('NFC') } catch (_e) { /* normalize 없음 — 그대로 */ }
  return str.replace(/\s+/g, ' ').trim()
}

/** 로그용 미디어 URL 요약 — 호스트 + 마지막 경로 세그먼트(미디어 id) 앞 8자. 서명·만료는 절대 싣지 않는다. */
export function describeMediaUrl(url) {
  try {
    const u = new URL(String(url))
    const seg = u.pathname.split('/').filter(Boolean).pop() || ''
    return { host: u.hostname || '?', media: seg ? seg.slice(0, 8) : '?' }
  } catch (_e) {
    return { host: '?', media: '?' }
  }
}

/** 치수가 요청 종횡비('16:9' 등)와 맞는가(5% 허용). 치수 없음·비율 문자열 아님 → false. */
export function ratioOk(width, height, ratio) {
  if (!(width > 0) || !(height > 0)) return false
  const m = /^(\d+):(\d+)$/.exec(String(ratio || ''))
  if (!m) return false
  const want = Number(m[1]) / Number(m[2])
  return Math.abs(width / height - want) / want <= 0.05
}

/**
 * FlowRpcError → 렌더러 결과. 문구 중립(숫자·auth 단어 없음), 코드·상태는 별도 필드.
 *   rpc/er code 8 → error:'RESOURCE_EXHAUSTED'(quotaStop 감지용) · code 16 → authFailed
 *   http/network → rpcStatus, 401 만 authFailed · download → flow-download-error + httpStatus
 *   shape → error:'rpc-shape:<rpcid>@<path>' · 그 외 예외 → 중립 flow-rpc-error(메시지 미노출)
 */
export function rpcErrorToRendererResult(err) {
  const base = { success: false, errorKind: 'flow-rpc-error', error: 'flow-rpc-error' }
  const kind = err && err.kind
  if (kind === 'download') {
    return { success: false, errorKind: 'flow-download-error', error: 'flow-download-error', httpStatus: typeof err.status === 'number' ? err.status : null }
  }
  if (kind === 'shape') {
    return { ...base, error: 'rpc-shape:' + (err.rpcid || '?') + '@' + (err.path || '?') }
  }
  if (kind === 'rpc' || kind === 'er') {
    const code = typeof err.code === 'number' ? err.code : null
    const res = { ...base, rpcCode: code }
    if (code === 8) res.error = 'RESOURCE_EXHAUSTED'
    if (code === 16) res.authFailed = true
    return res
  }
  if (kind === 'http' || kind === 'network') {
    const status = typeof err.status === 'number' ? err.status : 0
    const res = { ...base, rpcStatus: status }
    if (status === 401) res.authFailed = true
    return res
  }
  return base
}
