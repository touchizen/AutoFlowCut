/**
 * electron/flow-rpc-router.js
 *
 * batchexecute 캡처 이벤트(flow-rpc-capture.js) ↔ pendingGenerations 상관 라우터(순수 — 상태는 인자로).
 *
 * gen 엔트리(새 경로, flow-angular.js 가 만든다):
 *   { rpc, doc, seq, sentAt, normPrompt, wantRatio, wantModelKey, results, error, errorKind, completed,
 *     allowDomFallback:false, waiter:{resolve}|null, deadlines:{send?, grace?, loadend?}, setAt,
 *     sendDeadlinePassed?, onSendDeadline?(gen) }   // 뒤 둘은 M2-R7 L1(영상 send 유예)
 * 시각은 전부 초(Date.now()/1000).
 *
 *   send    : 후보 = rpc 동일·미바인딩·미완료·setAt <= sentAt. 1개면 바인딩(프롬프트 달라도 — warn 만), 2개 이상이면
 *             정규화 프롬프트 일치 중 setAt 최소, 없으면 unbound. multi(한 배치에 rpc 여럿) → flow-rpc-multi-batch.
 *             바인딩 = gen.doc/seq/sentAt, send 마감 해제 + loadend 마감(100s).
 *   loadend : {doc, seq} 로 gen 을 찾는다(같은 seq 라도 doc 이 다르면 남). 파싱 → results / error → completed.
 *             프롬프트 메아리 불일치는 warn 만(200 은 메아리로 실패시키지 않는다).
 *   마감    : 클릭→send 15s(flow-submit-not-sent), send→loadend 100s(flow-submit-lost). completed+error 로 표시만 —
 *             맵에서 지우는 건 collect·clear·orphan TTL 뿐(지우면 렌더러가 notFound 로 ITEM_TIMEOUT 까지 매달린다).
 *             M2-R7 L1: 영상(YhhmEf)의 send 15s 는 최종이 아니다 — sendDeadlinePassed 표시 + gen.onSendDeadline(gen) 훅(핸들러의 크레딧 재판독)
 *             뿐이고 클릭 뒤 100s(15+85 grace)까지 바인딩 가능한 채로 둔다; 그때까지 send 가 없으면 grace 마감이 flow-submit-not-sent. 이미지는 그대로.
 *   unbound : 바인딩 없는 YhhmEf 200 이 UUID 로 파싱되면 media 앞 8자만 로그·reportDomFailure('submit:unbound-loadend') — 과금된 미디어를 찾을 수 있게.
 *
 * 문서 커밋(did-navigate)·렌더러 크래시(render-process-gone) 에서 main 이 failBoundUnfinished 를 부른다:
 * 바인딩됐으나 미완료인 gen 은 응답이 영영 오지 않으므로 flow-submit-lost 로 닫는다. 미바인딩 armed gen 은
 * 새 문서에서 send 가 와 바인딩될 수 있어 자기 마감을 유지한다. did-start-navigation 은 취소될 수 있어 손대지
 * 않는다. 로그는 개수·id 앞 8자·상태어만(프롬프트·본문·URL 없음).
 * tests/electron/flow-rpc-router.test.js
 */
import {
  FlowRpcError, parseBatchexecuteResponse, parseImageGenerateResponse, parseVideoSubmitResponse,
  normalizePrompt, ratioOk, rpcErrorToRendererResult,
} from './flow-rpc-protocol.js'

export const SEND_DEADLINE_S = 15
export const LOADEND_DEADLINE_S = 100
// M2-R7 L1(A1): 영상 send 마감의 유예 — 클릭 뒤 100s 까지(send 15s + grace 85s). 그 안의 늦은 send 는 정상 바인딩, 없으면 not-sent.
export const SEND_GRACE_S = LOADEND_DEADLINE_S - SEND_DEADLINE_S
const DEADLINE_ERROR = { send: 'flow-submit-not-sent', grace: 'flow-submit-not-sent', loadend: 'flow-submit-lost' }
const DEADLINE_SECS = { send: SEND_DEADLINE_S, grace: SEND_GRACE_S, loadend: LOADEND_DEADLINE_S }
const SEND_GRACE_RPCS = new Set(['YhhmEf'])

const short = (s) => String(s ?? '').slice(0, 8)
// gen id 는 `gen-<ms>-<rand>` 라 앞 8자가 항상 "gen-1790" — 뒤 8자(끝 ms 두 자리 + 난수)가 씬을 가른다(R1#11).
const shortId = (s) => String(s ?? '').slice(-8)
const isDoc = (d) => typeof d === 'string' && /^[0-9a-f]{32}$/.test(d)
const isSeq = (n) => Number.isInteger(n) && n > 0

/** gen 을 완료로 확정하고 마감 타이머를 정리한 뒤 waiter 를 한 번만 깨운다. 맵에서 지우지 않는다. */
export function settleGen(gen, patch) {
  if (!gen || gen.completed) return false
  Object.assign(gen, patch)
  gen.completed = true
  const d = gen.deadlines
  if (d && typeof d === 'object') {
    for (const k of Object.keys(d)) { try { clearTimeout(d[k]) } catch (_e) { /* ignore */ } }
    gen.deadlines = {}
  }
  const w = gen.waiter
  gen.waiter = null
  if (w && typeof w.resolve === 'function') { try { w.resolve(gen) } catch (_e) { /* ignore */ } }
  return true
}

/** 마감 도래: completed + error(kind). 이미 완료면 false. */
export function markDeadline(gen, kind) {
  const err = DEADLINE_ERROR[kind]
  if (!err) return false
  return settleGen(gen, { error: err, errorKind: err })
}

/** 진단 보고·훅 호출 — throw/reject 해도 라우팅·마감을 막지 않는다(R2-2#6 과 같은 규칙). */
function callSafe(fn, ...args) {
  if (typeof fn !== 'function') return
  try { const p = fn(...args); if (p && typeof p.catch === 'function') p.catch(() => {}) } catch (_e) { /* 진단·훅 실패는 흐름을 막지 않는다 */ }
}

/** 마감 타이머 arm(send 15s / grace 85s / loadend 100s). 같은 kind 는 갈아끼운다. */
export function armDeadline(gen, kind) {
  if (!gen || gen.completed || !DEADLINE_ERROR[kind]) return
  const secs = DEADLINE_SECS[kind]
  if (!gen.deadlines || typeof gen.deadlines !== 'object') gen.deadlines = {}
  if (gen.deadlines[kind]) clearTimeout(gen.deadlines[kind])
  gen.deadlines[kind] = setTimeout(() => {
    if (gen.deadlines) delete gen.deadlines[kind]
    // M2-R7 L1(A1): 영상(YhhmEf)의 send 마감은 닫지 않는다 — 페이지의 reCAPTCHA execute + send 가 15s 를 넘기면(숨은 뷰 throttle·느린 네트워크) 전엔
    //   여기서 not-sent 로 닫혀(핸들러가 맵에서 지워) 그 뒤의 send/loadend 가 unbound 로 버려졌다: 서버는 과금했는데 행은 "다시 시도". 표시(sendDeadlinePassed)
    //   + 훅(핸들러가 크레딧을 재판독해 줄었으면 lost 로 닫는다) + grace 마감(클릭 뒤 100s 에 not-sent)만 — 그 안의 send 는 routeRpcSend 가 정상 바인딩한다.
    //   이미지(ogiZ0b)는 훅·크레딧이 없어 그대로 15s 에 not-sent.
    if (kind === 'send' && SEND_GRACE_RPCS.has(gen.rpc)) {
      if (gen.completed || gen.doc != null) return
      gen.sendDeadlinePassed = true
      armDeadline(gen, 'grace')
      console.warn(`[Flow RPC] ${gen.rpc} deadline send ${secs}s passed → grace ${SEND_GRACE_S}s (still bindable)`)
      callSafe(gen.onSendDeadline, gen)
      return
    }
    if (markDeadline(gen, kind)) console.warn(`[Flow RPC] ${gen.rpc} deadline ${kind} ${secs}s → ${DEADLINE_ERROR[kind]}`)
  }, secs * 1000)
}

/** 바인딩({doc, seq})됐으나 미완료인 새 경로 gen 을 전부 flow-submit-lost 로 닫는다. 닫은 개수를 돌려준다. */
export function failBoundUnfinished(pendingGenerations) {
  if (!pendingGenerations || typeof pendingGenerations.values !== 'function') return 0
  let n = 0
  for (const gen of pendingGenerations.values()) {
    if (!gen || !gen.rpc || gen.completed) continue
    if (gen.doc == null || gen.seq == null) continue
    if (settleGen(gen, { error: 'flow-submit-lost', errorKind: 'flow-submit-lost' })) n++
  }
  return n
}

/** batchexecute-send 이벤트 → 후보 gen 바인딩. */
export function routeRpcSend(ev, pendingGenerations) {
  if (!pendingGenerations || !ev || !isDoc(ev.doc) || !isSeq(ev.seq) || typeof ev.rpcid !== 'string'
    || typeof ev.sentAt !== 'number' || !Number.isFinite(ev.sentAt)) return { ok: false, reason: 'invalid' }
  const candidates = []
  for (const [id, gen] of pendingGenerations) {
    if (!gen || gen.rpc !== ev.rpcid || gen.completed || gen.doc != null) continue
    if (typeof gen.setAt === 'number' && gen.setAt > ev.sentAt) continue
    candidates.push([id, gen])
  }
  const prompt = normalizePrompt(Array.isArray(ev.prompts) ? ev.prompts[0] : '')
  let chosen = null
  if (candidates.length === 1) {
    chosen = candidates[0]
    if ((chosen[1].normPrompt || '') !== prompt) {
      console.warn(`[Flow RPC] ${ev.rpcid} send seq=${ev.seq} prompt-mismatch-single lens=${(chosen[1].normPrompt || '').length}/${prompt.length}`)
    }
  } else if (candidates.length > 1) {
    const matching = candidates.filter(([, g]) => (g.normPrompt || '') === prompt)
      .sort((a, b) => (a[1].setAt ?? 0) - (b[1].setAt ?? 0))
    chosen = matching[0] || null
  }
  if (!chosen) {
    console.warn(`[Flow RPC] ${ev.rpcid} send doc=${short(ev.doc)} seq=${ev.seq} unbound candidates=${candidates.length}`)
    return { ok: true, dropped: 'unbound' }
  }
  const [id, gen] = chosen
  if (ev.multi) {
    // 한 배치에 rpc 가 여럿 — 페이지가 제출을 다른 RPC 와 묶었다(미관측 모양). 닫는다(fail-closed).
    settleGen(gen, { error: 'flow-rpc-multi-batch', errorKind: 'flow-rpc-multi-batch' })
    console.warn(`[Flow RPC] ${ev.rpcid} send seq=${ev.seq} multi-batch rpcids=${Array.isArray(ev.rpcids) ? ev.rpcids.length : '?'} → failed ${shortId(id)}`)
    return { ok: true, failed: id, error: 'flow-rpc-multi-batch' }
  }
  gen.doc = ev.doc
  gen.seq = ev.seq
  gen.sentAt = ev.sentAt
  // M2-R7 L1: 유예(grace) 마감도 해제 — 늦은 send 의 바인딩은 정상 경로(loadend 100s)로 간다. 로그에 late 표시만.
  for (const k of ['send', 'grace']) { if (gen.deadlines && gen.deadlines[k]) { clearTimeout(gen.deadlines[k]); delete gen.deadlines[k] } }
  armDeadline(gen, 'loadend')
  console.log(`[Flow RPC] ${ev.rpcid} send doc=${short(ev.doc)} seq=${ev.seq} bound=${shortId(id)}${gen.sendDeadlinePassed ? ' late' : ''}`)
  return { ok: true, bound: id }
}

/**
 * M2-R7 L1: 바인딩 없는 YhhmEf 200 본문 → 파서가 UUID 로 검증한 mediaId(J2). 실패 프레임·비 200·shape·다른 rpc 는 null — 검증 안 된 값은 절대 내보내지 않는다
 *   (200 뒤 shape 실패의 rejectedMediaId 도 [3][0][0] 검증 뒤에만 실린다; video-count 의 rejectedMediaIds 는 미검증이라 쓰지 않는다).
 */
function unboundVideoMediaId(ev) {
  if (ev.rpcid !== 'YhhmEf' || ev.status !== 200) return null
  try { return parseVideoSubmitResponse(parseBatchexecuteResponse(ev.responseText, 'YhhmEf')).mediaId }
  catch (e) { return e && typeof e.rejectedMediaId === 'string' ? e.rejectedMediaId : null }
}

/**
 * batchexecute(loadend) 이벤트 → {doc, seq} 일치 gen 파싱·완료.
 * @param {{reportDomFailure?:Function}} [opts] M2-R7 L1: 바인딩 없는 YhhmEf 200(UUID) 보고용 — main 의 ctx 가 넘긴다
 */
export function routeRpcLoadend(ev, pendingGenerations, opts) {
  if (!pendingGenerations || !ev || !isDoc(ev.doc) || !isSeq(ev.seq)) return { ok: false, reason: 'invalid' }
  let found = null
  for (const [id, gen] of pendingGenerations) {
    if (gen && gen.rpc && gen.doc === ev.doc && gen.seq === ev.seq) { found = [id, gen]; break }
  }
  if (!found) {
    console.warn(`[Flow RPC] loadend doc=${short(ev.doc)} seq=${ev.seq} unbound`)
    // M2-R7 L1(A1): 바인딩 없는 YhhmEf 200 이 UUID 로 파싱되면 과금된 미디어다(유예를 넘긴 send · 크레딧 재판독으로 먼저 lost 로 닫힌 gen 의 뒤늦은 응답) —
    //   앞 8자만 로그·보고해 찾을 수 있게. 보고는 기다리지 않고 실패해도 라우팅을 막지 않는다.
    const media = unboundVideoMediaId(ev)
    if (media) {
      console.warn(`[Flow RPC] YhhmEf unbound loadend media=${short(media)}`)
      callSafe(opts && opts.reportDomFailure, 'submit:unbound-loadend', 'unbound-loadend', { rpc: 'YhhmEf', seq: ev.seq, media: short(media) })
    }
    return { ok: true, dropped: 'unbound' }
  }
  const [id, gen] = found
  if (gen.completed) return { ok: true, duplicate: id }
  const status = typeof ev.status === 'number' ? ev.status : 0
  console.log(`[Flow RPC] ${gen.rpc} loadend seq=${ev.seq} status=${status}`)
  try {
    if (status === 0) throw new FlowRpcError('network', { status: 0, reason: 'xhr-error' })
    if (status !== 200) throw new FlowRpcError('http', { status })
    const payload = parseBatchexecuteResponse(ev.responseText, gen.rpc)
    if (gen.rpc === 'ogiZ0b') {
      const { results } = parseImageGenerateResponse(payload)
      warnEchoMismatch(gen, ev.seq, results[0] && results[0].echo)
      if (gen.wantRatio) {
        const bad = results.find((r) => !ratioOk(r.width, r.height, gen.wantRatio))
        if (bad) {
          console.warn(`[Flow RPC] ogiZ0b seq=${ev.seq} aspect mismatch ${bad.width}x${bad.height} want=${gen.wantRatio}`)
          settleGen(gen, { results, error: 'flow-aspect-mismatch', errorKind: 'flow-aspect-mismatch' })
          return { ok: true, completed: id }
        }
      }
      // 개수 불일치는 실패가 아니다(요청 x1 에 1장이 정상; 여분은 collect 가 그대로 돌려준다) — 숫자만 warn(R1#12).
      const want = Number(gen.expectedCount) || 1
      if (results.length !== want) console.warn(`[Flow RPC] ogiZ0b seq=${ev.seq} count mismatch got=${results.length} want=${want}`)
      console.log(`[Flow RPC] ogiZ0b seq=${ev.seq} results=${results.length} ${results[0].width}x${results[0].height}`)
      settleGen(gen, { results })
    } else if (gen.rpc === 'YhhmEf') {
      // 레코드 수 ≠ 1(video-count + rejectedMediaIds)·200 뒤 shape(+rejectedMediaId) 는 파서가 throw → catch 가 매핑(M2-1).
      const v = parseVideoSubmitResponse(payload)
      warnEchoMismatch(gen, ev.seq, v.echo)
      if (v.warnings.length) console.warn(`[Flow RPC] YhhmEf seq=${ev.seq} warnings=${v.warnings.join(',')}`)
      settleGen(gen, { mediaId: v.mediaId, creditsLeft: v.creditsLeft, modelKey: v.modelKey, warnings: v.warnings })
    } else {
      throw new FlowRpcError('shape', { message: 'unsupported rpc ' + String(gen.rpc) })
    }
  } catch (e) {
    const { success: _s, ...mapped } = rpcErrorToRendererResult(e)
    settleGen(gen, mapped)
    console.warn(`[Flow RPC] ${gen.rpc} loadend seq=${ev.seq} failed kind=${(e && e.kind) || 'error'} code=${e && e.code != null ? e.code : '-'} status=${status}`)
  }
  return { ok: true, completed: id }
}

function warnEchoMismatch(gen, seq, echo) {
  const norm = normalizePrompt(echo || [])
  if (gen.normPrompt && norm && norm !== gen.normPrompt) {
    console.warn(`[Flow RPC] ${gen.rpc} seq=${seq} echo-mismatch lens=${gen.normPrompt.length}/${norm.length}`)
  }
}

/** flow:report-response 의 batchexecute* 페이로드 디스패치. */
export function routeRpcReport(payload, ctx) {
  const map = ctx && ctx.pendingGenerations
  if (!map) return { ok: false, reason: 'invalid' }
  if (payload && payload.kind === 'batchexecute-send') return routeRpcSend(payload, map)
  if (payload && payload.kind === 'batchexecute') return routeRpcLoadend(payload, map, { reportDomFailure: ctx.reportDomFailure })   // M2-R7 L1
  return { ok: false, reason: 'unknown kind' }
}
