// 2026-09-25 M3(레퍼런스) 실측 샘플(마스킹) 픽스처 로더 — docs/handoffs/evidence/2026-09-25-m3-samples.masked.jsonl
//
//   한 줄 = {step, rpcid, url, reqHeaders, status, durationMs, reqBody, respBody}. 계획서의 S3#n 은 이 파일의 n번째 줄이다
//   (2 maseQ 파일 대화상자 · 3 ogiZ0b ref1 · 4 maseQ 붙여넣기 · 9 ogiZ0b ref2+멘션 · 10 MZZa6b Omni · 14 YhhmEf 대조군 · 15 MZZa6b Veo ·
//   17 MZZa6b 인라인 멘션 · 19 ogiZ0b 같은 미디어 두 번 멘션 · 20 MZZa6b 같은 미디어 두 번 멘션). 줄은 step(+rpcid)로 고른다 — 한 step 에
//   rpc 가 여럿이면(1·2 = b-upload-file-dialog 의 JJH6Ub·maseQ) rpcid 가 필요하다.
//   `<uuid#N>` 은 09-24 로더와 같은 maskedUuid(N) 으로 푼다(파서·분류가 UUID 모양을 요구). reqBody 는 캡처 때 이미 디코드돼 있어
//   reencodeRequestBody 로 브라우저 인코딩(`f.req=<enc>&at=SECRET&`)으로 되돌린다. respBody 의 길이 접두는 stale(파서는 줄 단위).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { maskedUuid, reencodeRequestBody } from './flow-batchexecute-samples.js'

const SAMPLES_PATH = fileURLToPath(new URL(
  '../../docs/handoffs/evidence/2026-09-25-m3-samples.masked.jsonl', import.meta.url,
))

/** 계획서 표기 S3#n 의 step 이름(rpc 가 둘인 step 은 rpcid 까지). */
const S3 = Object.freeze({
  2: ['b-upload-file-dialog', 'maseQ'],
  3: ['c-image-1ref'],
  4: ['d-upload-paste'],
  9: ['g2-image-2refs-inline-mention'],
  10: ['h1-omni-r2v-submit'],
  14: ['h2a-veo-t2v-control-no-ref'],
  15: ['h2b-veo-r2v-submit'],
  17: ['p9-video-inline-mention-submit'],
  19: ['r1a-image-duplicate-mention'],
  20: ['r1a-video-duplicate-mention'],
})

let cache = null
function load() {
  if (cache) return cache
  cache = readFileSync(SAMPLES_PATH, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => JSON.parse(l.replace(/<uuid#(\d+)>/g, (_m, n) => maskedUuid(n))))
  return cache
}

/** step(+rpcid) 로 샘플 한 줄. 없거나 모호하면 throw(픽스처가 사라진 것은 테스트 실패다). */
export function m3Sample(step, rpcid) {
  const rows = load().filter((l) => l.step === step && (!rpcid || l.rpcid === rpcid))
  if (rows.length !== 1) throw new Error(`m3 sample step=${step} rpcid=${rpcid || '*'}: ${rows.length} rows`)
  return rows[0]
}

/** 계획서 번호로(S3#n). */
export function s3(n) {
  const key = S3[n]
  if (!key) throw new Error(`no S3#${n} mapping`)
  return m3Sample(key[0], key[1])
}

/** S3#n 요청을 브라우저 인코딩으로(plus:true 는 공백 `+` 변형). */
export function s3RequestBody(n, opts) {
  return reencodeRequestBody(s3(n).reqBody, opts)
}

/** S3#n 응답의 wrb.fr payload(JSON 파싱) — 사본. */
export function s3Payload(n) {
  const { rpcid, respBody } = s3(n)
  for (const line of respBody.split('\n')) {
    if (!line.startsWith('[')) continue
    for (const f of JSON.parse(line)) {
      if (f[0] === 'wrb.fr' && f[1] === rpcid && typeof f[2] === 'string') return JSON.parse(f[2])
    }
  }
  throw new Error(`no wrb.fr frame in S3#${n}`)
}
