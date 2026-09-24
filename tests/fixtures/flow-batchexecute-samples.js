// 2026-09-24 flow.google.com batchexecute 실측 샘플(마스킹) 픽스처 로더.
//
// 원본: docs/handoffs/evidence/2026-09-24-flow-batchexecute-samples.masked.jsonl
//   한 줄 = {rpcid, url, reqHeaders, status, durationMs, reqBody, respBody}
//   - reqBody 는 캡처 시점에 이미 URL 디코드된 `f.req=<json>&at=<at>&` 꼴이다 → 테스트는 이 모듈의
//     reencodeRequestBody() 로 브라우저가 실제로 보내는 인코딩(`f.req=<enc>&at=SECRET&`)으로 되돌린다.
//   - respBody 의 길이 접두(950 등)는 마스킹 뒤라 실제 줄 길이와 다르다(stale) — 파서는 줄 단위.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SAMPLES_PATH = fileURLToPath(new URL(
  '../../docs/handoffs/evidence/2026-09-24-flow-batchexecute-samples.masked.jsonl', import.meta.url,
))

/**
 * M2-R5 J2: 마스킹 토큰 `<uuid#N>` → 결정적 UUID 모양. 파서(parseVideoSubmitResponse [3][0][0])와 렌더러 분류(훅 submittedFlow · App chargedFlowItem · 복구 #R34-1)가
 *   같은 Flow 미디어 id 모양(UUID)을 요구하므로 픽스처의 id 도 그 모양이어야 한다. 테스트는 리터럴 대신 maskedUuid(N) 으로 기대값을 만든다.
 */
export function maskedUuid(n) {
  return String(n).padStart(8, '0') + '-0000-4000-8000-000000000000'
}
const unmaskUuids = (text) => text.replace(/<uuid#(\d+)>/g, (_m, n) => maskedUuid(n))

let cache = null
function load() {
  if (cache) return cache
  cache = readFileSync(SAMPLES_PATH, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(unmaskUuids(l)))
  return cache
}

/** rpcid 로 샘플 한 줄. 없으면 throw(픽스처가 사라진 것은 테스트 실패다). */
export function sample(rpcid) {
  const s = load().find((l) => l.rpcid === rpcid)
  if (!s) throw new Error(`no batchexecute sample for rpcid ${rpcid}`)
  return s
}

/** 디코드된 reqBody(`f.req=<json>&at=<at>&`) 에서 f.req 의 JSON 문자열만. */
export function decodedFReq(reqBody) {
  const start = reqBody.indexOf('f.req=')
  const end = reqBody.lastIndexOf('&at=')
  if (start !== 0 || end < 0) throw new Error('unexpected sample reqBody layout')
  return reqBody.slice('f.req='.length, end)
}

/**
 * 브라우저 인코딩으로 재인코딩. plus:true 면 공백을 `+` 로 보내는 변형(URLSearchParams 직렬화 꼴).
 * at 값은 SECRET — 테스트는 어떤 결과물에도 이 문자열이 없어야 한다고 단언한다.
 */
export function reencodeRequestBody(reqBody, { plus = false } = {}) {
  let enc = encodeURIComponent(decodedFReq(reqBody))
  if (plus) enc = enc.replace(/%20/g, '+')
  return 'f.req=' + enc + '&at=SECRET&'
}

/** 응답 본문에서 rpcid 프레임의 payload(JSON 파싱) — 테스트가 사본을 변형해 shape 케이스를 만들 때 쓴다. */
export function samplePayload(rpcid) {
  const { respBody } = sample(rpcid)
  for (const line of respBody.split('\n')) {
    if (!line.startsWith('[')) continue
    const frames = JSON.parse(line)
    for (const f of frames) {
      if (f[0] === 'wrb.fr' && f[1] === rpcid && typeof f[2] === 'string') return JSON.parse(f[2])
    }
  }
  throw new Error(`no wrb.fr frame for ${rpcid}`)
}

/** payload 사본을 다시 respBody 텍스트로(길이 접두는 stale 인 채로 둔다 — 실제 마스킹 샘플과 같은 조건). */
export function respBodyWithPayload(rpcid, payload) {
  const inner = JSON.stringify(payload)
  const frames = JSON.stringify([['wrb.fr', rpcid, inner, null, null, null, 'generic'], ['di', 1], ['af.httprm', 1, 'x', 1]])
  return ")]}'\n\n950\n" + frames + '\n26\n[["e",4,null,null,1000]]\n'
}

/** 실패 프레임 응답(`[code]` 를 [5] 에). */
export function respBodyFailure(rpcid, code) {
  const frames = JSON.stringify([['wrb.fr', rpcid, null, null, null, [code], 'generic'], ['di', 1]])
  return ")]}'\n\n99\n" + frames + '\n26\n[["e",4,null,null,1000]]\n'
}
