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
 * M2-1(영상): parseVideoSubmitRequest / parseVideoSubmitResponse(단일 레코드, 거부 id 동반 throw) / parseMediaRecord /
 * parseVideoStatusResponse / mediaStateToStatus / modelKeyMatches(HTrJv 카탈로그 표 기반 — 플랜 D8-7).
 *
 * tests/electron/flow-rpc-protocol.test.js
 */

export class FlowRpcError extends Error {
  /**
   * @param {'rpc'|'er'|'http'|'network'|'shape'|'download'|'video-count'} kind
   *   video-count 는 YhhmEf 응답의 레코드 수 ≠ 1 — 에러 객체에 rejectedMediaIds([3][i][0] 전부)를 싣는다.
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

/** 생성물(이미지·mp4 서명 URL) 호스트 — 다른 호스트면 shape 로 닫는다. */
const MEDIA_HOST = 'flow-content.google'

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
    if (host !== MEDIA_HOST) {
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
 * YhhmEf(영상 제출) 요청 inner → { prompt, modelKey, ratioEnum }.
 *   item = inner[0][0]: 프롬프트 세그먼트 [0][2][0](요청 프롬프트와 같은 꼴, ' ' 결합), 모델키 [1](예 abra_t2v_6s), 종횡비 enum [2].
 *   경로 표기는 'req…' 접두(응답 경로와 구분). 앱은 이 요청을 만들지 않는다 — 캡처된 본문의 판독 전용.
 */
export function parseVideoSubmitRequest(inner) {
  const RPC = 'YhhmEf'
  const item = Array.isArray(inner) && Array.isArray(inner[0]) ? inner[0][0] : null
  if (!Array.isArray(item)) throw shapeError(RPC, 'req[0][0]')
  const segs = echoSegments(Array.isArray(item[0]) ? item[0][2] : null)
  if (segs.length === 0) throw shapeError(RPC, 'req[0][0][0][2]')
  const modelKey = item[1]
  if (typeof modelKey !== 'string' || !modelKey) throw shapeError(RPC, 'req[0][0][1]')
  const ratioEnum = item[2]
  if (typeof ratioEnum !== 'number') throw shapeError(RPC, 'req[0][0][2]')
  return { prompt: segs.join(' '), modelKey, ratioEnum }
}

/**
 * YhhmEf(영상 제출) payload → { mediaId, modelKey, creditsLeft, state, echo, ratioEnum, warnings } — 레코드는 정확히 하나(D8-6).
 *   필수는 셋뿐: [3].length(=1) · [3][0][0] mediaId · [3][0][7][0][12] 모델키. 나머지는 optional 이고 없으면 warnings 토큰
 *   ('credits-missing' [1] · 'state-missing' [3][0][5][8][0] · 'echo-missing' [3][0][5][6][2][0][2]) — 내용 없는 고정 문자열.
 *   [3].length ≠ 1 → FlowRpcError{kind:'video-count', rejectedMediaIds}. mediaId 를 읽은 뒤의 shape 실패는 항상
 *   rejectedMediaId 를 든다(200 뒤의 거부 — 훅이 download-only 로 물지 않게 mediaId/generationId 로는 절대 안 나간다).
 */
export function parseVideoSubmitResponse(payload) {
  const RPC = 'YhhmEf'
  if (!Array.isArray(payload)) throw shapeError(RPC, '[]')
  const list = payload[3]
  if (!Array.isArray(list) || list.length === 0) throw shapeError(RPC, '[3]')
  if (list.length !== 1) {
    const err = new FlowRpcError('video-count', { message: RPC + ' response has ' + list.length + ' video records' })
    err.rejectedMediaIds = list.map((rec) => (Array.isArray(rec) && typeof rec[0] === 'string' ? rec[0] : null)).filter(Boolean)
    throw err
  }
  const rec = list[0]
  if (!Array.isArray(rec)) throw shapeError(RPC, '[3][0]')
  const mediaId = rec[0]
  if (typeof mediaId !== 'string' || !mediaId) throw shapeError(RPC, '[3][0][0]')
  const rejected = (path) => Object.assign(shapeError(RPC, path), { rejectedMediaId: mediaId })
  const g0 = Array.isArray(rec[7]) && Array.isArray(rec[7][0]) ? rec[7][0] : null
  if (!g0) throw rejected('[3][0][7][0]')
  const modelKey = g0[12]
  if (typeof modelKey !== 'string' || !modelKey) throw rejected('[3][0][7][0][12]')
  const warnings = []
  const creditsLeft = typeof payload[1] === 'number' ? payload[1] : null
  if (creditsLeft == null) warnings.push('credits-missing')
  const meta = Array.isArray(rec[5]) ? rec[5] : null
  const state = meta && Array.isArray(meta[8]) && typeof meta[8][0] === 'number' ? meta[8][0] : null
  if (state == null) warnings.push('state-missing')
  const echo = echoSegments(meta && meta[6] && meta[6][2] && meta[6][2][0] ? meta[6][2][0][2] : null)
  if (echo.length === 0) warnings.push('echo-missing')
  return { mediaId, modelKey, creditsLeft, state, echo, ratioEnum: typeof g0[16] === 'number' ? g0[16] : null, warnings }
}

/**
 * 미디어 레코드(jwpduf `[2][i]` · as29s 루트) → { mediaId, state, bytes, videoUrl }.
 *   mediaId [0](필수) · 상태 [5][8][0](없으면 null → 폴이 unknown 으로) · 바이트 [5][13] · mp4 서명 URL [7][0][8](없으면 null,
 *   있으면 호스트 flow-content.google 필수 — 서명은 메시지에 싣지 않는다). 완료 폴의 모델키 재검사는 없다(D8-6).
 * @param {{rpcid?: string, path?: string}} [ctx] 경로 접두(jwpduf 는 '[2][i]', as29s 는 루트)
 */
export function parseMediaRecord(rec, ctx) {
  const RPC = (ctx && ctx.rpcid) || 'as29s'
  const base = (ctx && ctx.path) || ''
  if (!Array.isArray(rec)) throw shapeError(RPC, base || '[]')
  const mediaId = rec[0]
  if (typeof mediaId !== 'string' || !mediaId) throw shapeError(RPC, base + '[0]')
  const meta = Array.isArray(rec[5]) ? rec[5] : null
  const state = meta && Array.isArray(meta[8]) && typeof meta[8][0] === 'number' ? meta[8][0] : null
  const bytes = meta && typeof meta[13] === 'number' ? meta[13] : null
  const g0 = Array.isArray(rec[7]) && Array.isArray(rec[7][0]) ? rec[7][0] : null
  let videoUrl = null
  if (g0 && g0[8] != null) {
    if (typeof g0[8] !== 'string') throw shapeError(RPC, base + '[7][0][8]')
    let host = null
    try { host = new URL(g0[8]).hostname } catch (_e) { host = null }
    if (host !== MEDIA_HOST) {
      throw new FlowRpcShapeError(RPC + ' video url host mismatch' + (host ? ' host=' + host : ''), { rpcid: RPC, path: base + '[7][0][8]' })
    }
    videoUrl = g0[8]
  }
  return { mediaId, state, bytes, videoUrl }
}

/** jwpduf(상태 폴) payload `[null, credits|null, [records]]` → { creditsLeft, records }. 중간 폴은 [1]=null(R:143-149). */
export function parseVideoStatusResponse(payload) {
  const RPC = 'jwpduf'
  if (!Array.isArray(payload)) throw shapeError(RPC, '[]')
  const list = payload[2]
  if (!Array.isArray(list)) throw shapeError(RPC, '[2]')
  const creditsLeft = typeof payload[1] === 'number' ? payload[1] : null
  const records = list.map((rec, i) => parseMediaRecord(rec, { rpcid: RPC, path: '[2][' + i + ']' }))
  return { creditsLeft, records }
}

/** 상태 [5][8][0] → 'pending'(6 제출됨·2 생성중) | 'complete'(3) | 'unknown'(그 외·null — 폴이 pending+unknownState 로). */
export function mediaStateToStatus(state) {
  if (state === 6 || state === 2) return 'pending'
  if (state === 3) return 'complete'
  return 'unknown'
}

/** 요청 모델 라벨 → { family:'abra'|'veo_3_1', tier:null|'fast'|'lite'|'quality' }. 모르면 null(fail-closed). */
function videoModelSpec(model) {
  const s = String(model || '')
  if (/omni.*flash/i.test(s) || /^abra[_-]/i.test(s)) return { family: 'abra', tier: null }
  if (/veo/i.test(s)) {
    const tier = /lite/i.test(s) ? 'lite' : /fast/i.test(s) ? 'fast' : /quality/i.test(s) ? 'quality' : null
    return tier ? { family: 'veo_3_1', tier } : null
  }
  return null
}
const KEY_TIER_TOKENS = new Set(['fast', 'lite', 'quality'])
const KEY_QUEUE_TOKENS = new Set(['ultra', 'relaxed', 'low', 'priority'])
/** portrait 형제가 있는 base(카탈로그 사실): veo Quality 8s(`veo_3_1_t2v`)·Fast 8s(`veo_3_1_t2v_fast`) 뿐. */
function hasPortraitSibling(spec, duration) {
  return spec.family === 'veo_3_1' && duration === 8 && (spec.tier === 'quality' || spec.tier === 'fast')
}

/**
 * 응답 모델키가 요청 {model, duration, ratio, resolution} 과 맞는가 — HTrJv 카탈로그 **표 기반**(플랜 D8-7, 추론 없음):
 *   패밀리(abra ↔ Omni Flash · veo_3_1 ↔ Veo 3.1) + `_t2v` 세그먼트 필수(r2v/i2v/extend/edit 거부)
 *   + 길이 토큰 `(\d+)s` 는 있으면 일치·없으면 8 + 등급 토큰(fast|lite|quality)은 veo 만, 없으면 quality
 *   + `_portrait` 는 portrait 형제가 있는 base 에서만 9:16 ↔ 토큰 일치(형제가 있는데 토큰이 없으면 9:16 요청은 거부)
 *   + 큐 토큰 `_ultra|_relaxed|_low_priority` 중립 + `_360p` 는 요청 해상도와 일치(없으면 720p).
 *   모르는 토큰·모르는 라벨·길이 없음은 false(fail-closed). Omni 의 비율은 키에 없다 — 패널이 보장(D7).
 */
export function modelKeyMatches(key, want) {
  if (typeof key !== 'string' || !want) return false
  const spec = videoModelSpec(want.model)
  if (!spec) return false
  const wantDur = Number(want.duration)
  if (!Number.isFinite(wantDur)) return false
  const wantRes = String(want.resolution || '720p').toLowerCase()
  const m = /^(abra|veo_3_1)_([a-z0-9]+)((?:_[a-z0-9]+)*)$/.exec(key)
  if (!m || m[1] !== spec.family || m[2] !== 't2v') return false
  let duration = 8
  let tier = null
  let portrait = false
  let res = '720p'
  for (const tok of m[3].split('_').filter(Boolean)) {
    const d = /^(\d+)s$/.exec(tok)
    if (d) { duration = Number(d[1]); continue }
    if (KEY_TIER_TOKENS.has(tok)) { if (spec.family !== 'veo_3_1' || tier) return false; tier = tok; continue }
    if (tok === 'portrait') { if (spec.family !== 'veo_3_1') return false; portrait = true; continue }
    if (tok === '360p') { res = '360p'; continue }
    if (KEY_QUEUE_TOKENS.has(tok)) continue
    return false
  }
  if (duration !== wantDur) return false
  if (spec.family === 'veo_3_1' && (tier || 'quality') !== spec.tier) return false
  if (res !== wantRes) return false
  const wantPortrait = String(want.ratio || '') === '9:16'
  if (portrait) return hasPortraitSibling(spec, duration) && wantPortrait
  return !(wantPortrait && hasPortraitSibling(spec, duration))
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

/** 치수가 요청 종횡비('16:9' 등)와 맞는가(±3% 허용 — 플랜 §2 D4; 1376×768 은 16:9 에서 +0.8%). 치수 없음·비율 문자열 아님 → false. */
export function ratioOk(width, height, ratio) {
  if (!(width > 0) || !(height > 0)) return false
  const m = /^(\d+):(\d+)$/.exec(String(ratio || ''))
  if (!m) return false
  const want = Number(m[1]) / Number(m[2])
  return Math.abs(width / height - want) / want <= 0.03
}

/**
 * FlowRpcError → 렌더러 결과. 문구 중립(숫자·auth 단어 없음), 코드·상태는 별도 필드.
 *   rpc/er code 8 → error:'RESOURCE_EXHAUSTED'(quotaStop 감지용) · code 16 → authFailed
 *   http/network → rpcStatus, 401 만 authFailed · download → flow-download-error + httpStatus
 *   shape → error:'rpc-shape:<rpcid>@<path>'(+rejectedMediaId 가 있으면 통과) · video-count → flow-video-count-mismatch
 *   + rejectedMediaIds · 그 외 예외 → 중립 flow-rpc-error(메시지 미노출)
 */
export function rpcErrorToRendererResult(err) {
  const base = { success: false, errorKind: 'flow-rpc-error', error: 'flow-rpc-error' }
  const kind = err && err.kind
  if (kind === 'download') {
    return { success: false, errorKind: 'flow-download-error', error: 'flow-download-error', httpStatus: typeof err.status === 'number' ? err.status : null }
  }
  if (kind === 'video-count') {
    return { success: false, errorKind: 'flow-video-count-mismatch', error: 'flow-video-count-mismatch', rejectedMediaIds: Array.isArray(err.rejectedMediaIds) ? err.rejectedMediaIds : [] }
  }
  if (kind === 'shape') {
    const res = { ...base, error: 'rpc-shape:' + (err.rpcid || '?') + '@' + (err.path || '?') }
    if (typeof err.rejectedMediaId === 'string') res.rejectedMediaId = err.rejectedMediaId
    return res
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
