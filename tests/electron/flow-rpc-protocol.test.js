// @vitest-environment node
//
// M1-1 — flow.google.com batchexecute 프로토콜 파서(순수). 픽스처는 2026-09-24 실측 샘플(마스킹)을
// fs 로 읽고, 요청 본문은 브라우저 인코딩으로 재인코딩한다(reqBody 는 캡처 시 이미 디코드돼 있다).
// 위치 핀은 docs/handoffs/evidence/2026-09-24-flow-batchexecute-rpcids.md 의 검증표 그대로 —
// 스키마 적응 없음: 위치가 바뀌면 FlowRpcShapeError 로 닫힌다(입력 내용은 메시지에 싣지 않는다).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  FlowRpcError, FlowRpcShapeError,
  parseBatchexecuteResponse, parseImageGenerateResponse,
  decodeFReqInner, extractSubmitPrompts, normalizePrompt, ratioOk,
  rpcErrorToRendererResult, describeMediaUrl,
  parseVideoSubmitRequest, parseVideoSubmitResponse, parseMediaRecord, parseVideoStatusResponse,
  mediaStateToStatus, modelKeyMatches,
  extractSubmitRefs, parseUploadResponse,
} from '../../electron/flow-rpc-protocol.js'
import { isFlowAuthError, markFlowAuthFailure } from '../../src/engine/engineFlow.js'
import { isQuotaExhaustedError } from '../../src/utils/quotaStop.js'
import {
  sample, reencodeRequestBody, samplePayload, respBodyWithPayload, respBodyFailure, maskedUuid,
} from '../fixtures/flow-batchexecute-samples.js'
import { s3, s3RequestBody, s3Payload } from '../fixtures/flow-m3-samples.js'

const UUID5 = maskedUuid(5)   // M2-R5 J2: 픽스처의 <uuid#5> 는 로더가 UUID 모양으로 푼다
const PROMPT = '궁정안에 있는 왕'

describe('parseBatchexecuteResponse — )]}\' 접두 + 줄 단위 프레임', () => {
  it('실측 ogiZ0b 응답에서 wrb.fr 프레임의 payload 를 돌려준다(길이 접두는 stale 이라 무시)', () => {
    const payload = parseBatchexecuteResponse(sample('ogiZ0b').respBody, 'ogiZ0b')
    expect(Array.isArray(payload)).toBe(true)
    expect(payload[0][0][0]).toBe(UUID5)
  })

  it('nzlxg 크레딧 응답 → [1050,1,2,2,null,1050]', () => {
    expect(parseBatchexecuteResponse(sample('nzlxg').respBody, 'nzlxg')).toEqual([1050, 1, 2, 2, null, 1050])
  })

  it(")]}' 접두가 없으면 FlowRpcShapeError", () => {
    expect(() => parseBatchexecuteResponse('[["wrb.fr","nzlxg","[1]",null,null,null,"generic"]]', 'nzlxg'))
      .toThrow(FlowRpcShapeError)
  })

  it('실패 프레임 [8] → FlowRpcError{kind:"rpc", code:8}', () => {
    let err
    try { parseBatchexecuteResponse(respBodyFailure('ogiZ0b', 8), 'ogiZ0b') } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcError)
    expect(err).toMatchObject({ kind: 'rpc', code: 8 })
  })

  it('["er",…] 프레임 → FlowRpcError{kind:"er"} (코드는 [9] 가 있으면 그것)', () => {
    const text = ")]}'\n\n60\n" + JSON.stringify([['er', null, null, null, null, 400, null, null, null, 3]]) + '\n'
    let err
    try { parseBatchexecuteResponse(text, 'nzlxg') } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcError)
    expect(err).toMatchObject({ kind: 'er', code: 3 })
  })

  it('요청한 rpcid 의 프레임이 없으면 kind:"shape"', () => {
    let err
    try { parseBatchexecuteResponse(sample('nzlxg').respBody, 'jwpduf') } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcShapeError)
    expect(err.kind).toBe('shape')
  })

  it('깨진 JSON 줄 → FlowRpcShapeError 이고 메시지에 입력 부분문자열이 없다', () => {
    const text = ")]}'\n\n12\n[[\"wrb.fr\",\"ogiZ0b\",\"SECRET_PROMPT_TEXT\n"
    let err
    try { parseBatchexecuteResponse(text, 'ogiZ0b') } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcShapeError)
    expect(err.message).not.toContain('SECRET_PROMPT_TEXT')
    expect(String(err)).not.toContain('SECRET_PROMPT_TEXT')
  })
})

describe('parseImageGenerateResponse — ogiZ0b 위치 핀', () => {
  it('실측 응답 → results[0] {mediaId, seed, url, width, height, echo}', () => {
    const { results } = parseImageGenerateResponse(samplePayload('ogiZ0b'))
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ mediaId: UUID5, seed: 1687588041, width: 1376, height: 768, echo: [PROMPT] })
    expect(results[0].url.startsWith('https://flow-content.google/image/' + UUID5 + '?')).toBe(true)
  })

  it('[0][0][6][2](치수) 삭제 → "ogiZ0b response shape changed at [0][0][6][2]"', () => {
    const payload = samplePayload('ogiZ0b')
    payload[0][0][6].splice(2, 1)
    expect(() => parseImageGenerateResponse(payload)).toThrow(/ogiZ0b response shape changed at \[0\]\[0\]\[6\]\[2\]/)
  })

  it('mediaId [0][0][0] 가 문자열이 아니면 그 경로로 닫힌다', () => {
    const payload = samplePayload('ogiZ0b')
    payload[0][0][0] = null
    expect(() => parseImageGenerateResponse(payload)).toThrow(FlowRpcShapeError)
    expect(() => parseImageGenerateResponse(payload)).toThrow(/at \[0\]\[0\]\[0\]/)
  })

  it('url 호스트가 flow-content.google 이 아니면 "image url host" 로 닫힌다(서명은 메시지에 없다)', () => {
    const payload = samplePayload('ogiZ0b')
    payload[0][0][6][0][13] = 'https://evil.example/image/x?Signature=SIGSECRET'
    let err
    try { parseImageGenerateResponse(payload) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcShapeError)
    expect(err.message).toMatch(/image url host/)
    expect(err.message).not.toContain('SIGSECRET')
  })

  it('응답 텍스트에서 바로: parseBatchexecuteResponse → parseImageGenerateResponse', () => {
    const payload = parseBatchexecuteResponse(respBodyWithPayload('ogiZ0b', samplePayload('ogiZ0b')), 'ogiZ0b')
    expect(parseImageGenerateResponse(payload).results[0].mediaId).toBe(UUID5)
  })
})

describe('decodeFReqInner / extractSubmitPrompts — 요청 본문(URLSearchParams)', () => {
  const body = reencodeRequestBody(sample('ogiZ0b').reqBody)
  const plusBody = reencodeRequestBody(sample('ogiZ0b').reqBody, { plus: true })

  it('재인코딩 본문 → {rpcid:"ogiZ0b", inner} 이고 결과 어디에도 at(SECRET) 이 없다', () => {
    const r = decodeFReqInner(body)
    expect(r.rpcid).toBe('ogiZ0b')
    expect(r.rpcids).toEqual(['ogiZ0b'])
    expect(Array.isArray(r.inner)).toBe(true)
    expect(JSON.stringify(r)).not.toContain('SECRET')
  })

  it('공백을 + 로 보낸 변형도 같은 inner', () => {
    expect(decodeFReqInner(plusBody).inner).toEqual(decodeFReqInner(body).inner)
  })

  it('extractSubmitPrompts("ogiZ0b", inner) → ["궁정안에 있는 왕"]', () => {
    expect(extractSubmitPrompts('ogiZ0b', decodeFReqInner(body).inner)).toEqual([PROMPT])
    expect(extractSubmitPrompts('ogiZ0b', decodeFReqInner(plusBody).inner)).toEqual([PROMPT])
  })

  it('extractSubmitPrompts("YhhmEf", inner) → 영상 프롬프트', () => {
    const inner = decodeFReqInner(reencodeRequestBody(sample('YhhmEf').reqBody)).inner
    expect(extractSubmitPrompts('YhhmEf', inner)).toEqual(['왕이 궁전 내부를 산책하는 영상'])
  })

  it('깨진 inner / 모르는 rpcid → []', () => {
    expect(extractSubmitPrompts('ogiZ0b', null)).toEqual([])
    expect(extractSubmitPrompts('ogiZ0b', [])).toEqual([])
    expect(extractSubmitPrompts('ogiZ0b', [null, [[1, 2]]])).toEqual([])
    expect(extractSubmitPrompts('jwpduf', decodeFReqInner(body).inner)).toEqual([])
  })

  it('본문이 f.req 가 아니거나 JSON 이 깨지면 null(throw 없음)', () => {
    expect(decodeFReqInner('at=SECRET&')).toBeNull()
    expect(decodeFReqInner('f.req=%5B%5B%5B%22ogiZ0b%22%2C&at=SECRET&')).toBeNull()
    expect(decodeFReqInner(null)).toBeNull()
  })
})

describe('normalizePrompt', () => {
  it('공백 압축 + trim', () => {
    expect(normalizePrompt('  a\n\n b  ')).toBe('a b')
  })
  it('NFD → NFC', () => {
    const nfd = '궁정안에'.normalize('NFD')
    expect(nfd).not.toBe('궁정안에')
    expect(normalizePrompt(nfd)).toBe('궁정안에')
  })
  it('세그먼트 배열은 공백으로 결합, null 은 빈 문자열', () => {
    expect(normalizePrompt(['a', ' b '])).toBe('a b')
    expect(normalizePrompt(null)).toBe('')
  })
})

describe('ratioOk', () => {
  it('1376×768 / 16:9 → true', () => { expect(ratioOk(1376, 768, '16:9')).toBe(true) })
  it('768×1376 / 16:9 → false', () => { expect(ratioOk(768, 1376, '16:9')).toBe(false) })
  it('1024×1024 / 1:1 → true', () => { expect(ratioOk(1024, 1024, '1:1')).toBe(true) })
  it('치수 null → false', () => { expect(ratioOk(null, null, '16:9')).toBe(false) })
  it('허용 오차는 ±3% (R1#12): 2% 어긋남은 true, 4% 는 false', () => {
    expect(ratioOk(1813, 1000, '16:9')).toBe(true)    // 1.813 / 1.7778 = +2.0%
    expect(ratioOk(1849, 1000, '16:9')).toBe(false)   // +4.0%
    expect(ratioOk(1000, 1849, '9:16')).toBe(false)
  })
})

describe('rpcErrorToRendererResult — 문구에 숫자·auth 단어 없음, 코드·상태는 별도 필드', () => {
  const rows = [
    ['code 8', new FlowRpcError('rpc', { code: 8 }), { error: 'RESOURCE_EXHAUSTED', errorKind: 'flow-rpc-error', rpcCode: 8 }, false],
    ['code 16', new FlowRpcError('rpc', { code: 16 }), { error: 'flow-rpc-error', errorKind: 'flow-rpc-error', rpcCode: 16, authFailed: true }, true],
    ['HTTP 401', new FlowRpcError('http', { status: 401 }), { error: 'flow-rpc-error', errorKind: 'flow-rpc-error', rpcStatus: 401, authFailed: true }, true],
    ['code 7', new FlowRpcError('rpc', { code: 7 }), { error: 'flow-rpc-error', errorKind: 'flow-rpc-error', rpcCode: 7 }, false],
    ['er code 3', new FlowRpcError('er', { code: 3 }), { error: 'flow-rpc-error', errorKind: 'flow-rpc-error', rpcCode: 3 }, false],
    ['HTTP 403', new FlowRpcError('http', { status: 403 }), { error: 'flow-rpc-error', errorKind: 'flow-rpc-error', rpcStatus: 403 }, false],
    ['HTTP 429', new FlowRpcError('http', { status: 429 }), { error: 'flow-rpc-error', errorKind: 'flow-rpc-error', rpcStatus: 429 }, false],
    ['status 0', new FlowRpcError('network', { status: 0 }), { error: 'flow-rpc-error', errorKind: 'flow-rpc-error', rpcStatus: 0 }, false],
    ['download 403', new FlowRpcError('download', { status: 403 }), { error: 'flow-download-error', errorKind: 'flow-download-error', httpStatus: 403 }, false],
  ]

  it.each(rows)('%s', (_label, err, expected, auth) => {
    const res = rpcErrorToRendererResult(err)
    expect(res.success).toBe(false)
    expect(res).toMatchObject(expected)
    if (!auth) expect(res).not.toHaveProperty('authFailed')
    expect(res.error).not.toMatch(/\d/)
    expect(res.error).not.toMatch(/unauthorized|unauthenticated|permission denied|token|sign in|로그인|인증|토큰/i)
    // engineFlow.js:168 정규식 그대로 — 거짓 auth 없음, authFailed 는 401/16 명시만.
    expect(isFlowAuthError(res)).toBe(false)
    expect(!!markFlowAuthFailure(res).authFailed).toBe(auth)
  })

  it('shape 실패 → error "rpc-shape:<rpcid>@<path>" (D8-9 표기), errorKind flow-rpc-error, auth 아님', () => {
    let err
    try { parseImageGenerateResponse([[['<uuid#5>', null, '<uuid#6>', null, null, null, [[null, 1, null, null, null, null, 1, 'x', 29, null, null, 'y', null, 'https://flow-content.google/image/<uuid#5>?Signature=S', 3, null, null, '<uuid#5>']]]]]) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcShapeError)
    const res = rpcErrorToRendererResult(err)
    expect(res).toEqual({ success: false, errorKind: 'flow-rpc-error', error: 'rpc-shape:ogiZ0b@[0][0][6][2]' })
    expect(isFlowAuthError(res)).toBe(false)
    expect(markFlowAuthFailure(res)).not.toHaveProperty('authFailed')
  })

  it('code 8 은 quotaStop 감지기가 잡는다(RESOURCE_EXHAUSTED), 나머지는 잡지 않는다', () => {
    expect(isQuotaExhaustedError(rpcErrorToRendererResult(new FlowRpcError('rpc', { code: 8 })))).toBe(true)
    expect(isQuotaExhaustedError(rpcErrorToRendererResult(new FlowRpcError('rpc', { code: 7 })))).toBe(false)
    expect(isQuotaExhaustedError(rpcErrorToRendererResult(new FlowRpcError('http', { status: 429 })))).toBe(false)
  })

  it('FlowRpcError 가 아닌 예외는 flow-rpc-error 로 중립 매핑(메시지 미노출)', () => {
    const res = rpcErrorToRendererResult(new Error('boom /Users/alice 401'))
    expect(res).toMatchObject({ success: false, error: 'flow-rpc-error', errorKind: 'flow-rpc-error' })
    expect(res).not.toHaveProperty('authFailed')
  })
})

describe('describeMediaUrl — 로그용 요약(호스트 + 미디어 id 앞 8자)', () => {
  it('서명 URL → {host, media}; 서명·만료는 들어가지 않는다', () => {
    const d = describeMediaUrl('https://flow-content.google/video/2f1c9a7e-1111-2222-3333-444455556666?Expires=1&KeyName=k&Signature=SIGSECRET')
    expect(d).toEqual({ host: 'flow-content.google', media: '2f1c9a7e' })
  })
  it('깨진 URL → ? 표식', () => {
    expect(describeMediaUrl('not a url')).toEqual({ host: '?', media: '?' })
    expect(describeMediaUrl(null)).toEqual({ host: '?', media: '?' })
  })
})

// ─── M2-1 영상 파서 + 표 기반 모델키 ────────────────────────────────────────────────────────────────
const VIDEO_PROMPT = '왕이 궁전 내부를 산책하는 영상'
const UUID11 = maskedUuid(11)   // M2-R5 J2: 픽스처의 <uuid#11> 은 로더가 UUID 모양으로 푼다
/** R:143-149 첫 폴(상태 [2], 크레딧 null, 바이트 없음) — jwpduf 샘플(마지막 폴)에서 역산한 사본. */
function firstPollPayload() {
  const p = samplePayload('jwpduf')
  p[1] = null
  p[2][0][5] = p[2][0][5].slice(0, 10)
  p[2][0][5][8] = [2]
  return p
}

describe('M2-1 parseVideoSubmitRequest — YhhmEf 요청 inner 위치 핀', () => {
  it('S2 inner → {prompt, modelKey:"abra_t2v_6s", ratioEnum:2}', () => {
    const inner = decodeFReqInner(reencodeRequestBody(sample('YhhmEf').reqBody)).inner
    expect(parseVideoSubmitRequest(inner)).toEqual({ prompt: VIDEO_PROMPT, modelKey: 'abra_t2v_6s', ratioEnum: 2 })
  })
  it('모델키 자리([0][0][1])가 문자열이 아니면 shape 에러(경로 req[0][0][1])', () => {
    const inner = decodeFReqInner(reencodeRequestBody(sample('YhhmEf').reqBody)).inner
    inner[0][0][1] = null
    let err
    try { parseVideoSubmitRequest(inner) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcShapeError)
    expect(err).toMatchObject({ rpcid: 'YhhmEf', path: 'req[0][0][1]' })
    expect(err.message).not.toContain(VIDEO_PROMPT)
  })
})

describe('M2-1 parseVideoSubmitResponse — 단일 레코드, 필수는 [3].length·[3][0][0]·[3][0][7][0][12] 뿐', () => {
  it('S2 → {mediaId:"<uuid#11>", modelKey:"abra_t2v_6s", creditsLeft:1040, state:6, echo:[프롬프트], warnings:[]}', () => {
    const v = parseVideoSubmitResponse(samplePayload('YhhmEf'))
    expect(v).toEqual({ mediaId: UUID11, modelKey: 'abra_t2v_6s', creditsLeft: 1040, state: 6, echo: [VIDEO_PROMPT], ratioEnum: 2, warnings: [] })
    expect(v).not.toHaveProperty('records')
  })
  it('[3][0][5][8] 삭제 사본 → 성공 + state:null + warnings:["state-missing"]', () => {
    const p = samplePayload('YhhmEf'); delete p[3][0][5][8]
    expect(parseVideoSubmitResponse(p)).toMatchObject({ mediaId: UUID11, modelKey: 'abra_t2v_6s', state: null, warnings: ['state-missing'] })
  })
  it('[1] null → creditsLeft:null + warnings:["credits-missing"]', () => {
    const p = samplePayload('YhhmEf'); p[1] = null
    expect(parseVideoSubmitResponse(p)).toMatchObject({ mediaId: UUID11, creditsLeft: null, warnings: ['credits-missing'] })
  })
  it('메아리 누락([3][0][5][6] 삭제) → 성공 + echo:[] + warnings:["echo-missing"]', () => {
    const p = samplePayload('YhhmEf'); delete p[3][0][5][6]
    expect(parseVideoSubmitResponse(p)).toMatchObject({ mediaId: UUID11, echo: [], warnings: ['echo-missing'] })
  })
  it('긴 프롬프트 픽스처: 제목 [2][0][3][0] 이 잘려도 echo([3][0][5][6][2][0][2]) 는 전체', () => {
    const long = ('왕이 궁전 내부를 아주 천천히 산책하며 창밖의 정원을 바라보는 영상, ').repeat(6).trim()
    const p = samplePayload('YhhmEf')
    p[2][0][3][0] = long.slice(0, 40)
    p[3][0][5][1] = long.slice(0, 40)
    p[3][0][5][6][2][0][2] = [[[long]]]
    const v = parseVideoSubmitResponse(p)
    expect(v.echo).toEqual([long])
    expect(v.warnings).toEqual([])
  })
  it('[3] 2개 → throws FlowRpcError{kind:"video-count"} + rejectedMediaIds 2개(순서 유지)', () => {
    const p = samplePayload('YhhmEf')
    const second = JSON.parse(JSON.stringify(p[3][0])); second[0] = '<uuid#12>'
    p[3].push(second)
    let err
    try { parseVideoSubmitResponse(p) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcError)
    expect(err).toMatchObject({ kind: 'video-count', rejectedMediaIds: [UUID11, '<uuid#12>'] })
    expect(err).not.toHaveProperty('rejectedMediaId')
  })
  it('[3][0][7][0][12] 삭제 → shape 에러(그 경로) + rejectedMediaId:"<uuid#11>"', () => {
    const p = samplePayload('YhhmEf'); delete p[3][0][7][0][12]
    let err
    try { parseVideoSubmitResponse(p) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcShapeError)
    expect(err).toMatchObject({ rpcid: 'YhhmEf', path: '[3][0][7][0][12]', rejectedMediaId: UUID11 })
    expect(err.message).toBe('YhhmEf response shape changed at [3][0][7][0][12]')
  })
  // M2-R3 H1(A1): [3][0][7][0][12] 는 문자열이기만 하면 통과했다 — 응답 모양이 바뀌어 그 자리에 사용자 텍스트(프롬프트·URL)가 오면 핸들러가 modelKey= 로
  //   그대로 로그·진단에 싣는다. 모델키 문법(/^[a-z0-9_]{1,64}$/)을 지키지 않으면 shape 실패(+rejectedMediaId — 과금됐지만 검증 불가) 로 닫고 값은 절대 밖으로 안 나간다.
  //   M2-R4 I5(A4): 소문자 한 단어(`sunset`·`dragon_king`)도 옛 문법을 지나 flow-angular 의 로그·report·errorParams.actual 에 실렸다 — HTrJv 카탈로그 샘플의 영상 키는 전부
  //   모델 패밀리 접두 `abra_`·`veo_`·`omni_`(evidence/2026-09-24-flow-batchexecute-samples.masked.jsonl: abra_t2v_6s · veo_3_1_t2v_* · omni_flash_i2v_*_first_last)로 시작한다 → 접두 필수, ≤64자.
  it('[3][0][7][0][12] 가 모델키 문법이 아니면(공백·유니코드·URL·접두 없는 소문자 단어) shape 에러 + rejectedMediaId, 메시지에 그 값 없음; 카탈로그 키는 통과', () => {
    const USER_TEXT = '왕이 궁전 내부를 산책 https://evil.example/x?y=1 Hello World'
    for (const bad of [USER_TEXT, 'abra t2v', 'Abra_T2V', 'abra-t2v', '', 'a'.repeat(65), 'sunset', 'dragon_king', 'abra', 'veo_', 'abra_' + 'x'.repeat(60), 'xabra_t2v_6s']) {
      const p = samplePayload('YhhmEf'); p[3][0][7][0][12] = bad
      let err
      try { parseVideoSubmitResponse(p) } catch (e) { err = e }
      expect(err, JSON.stringify(bad)).toBeInstanceOf(FlowRpcShapeError)
      expect(err).toMatchObject({ rpcid: 'YhhmEf', path: '[3][0][7][0][12]', rejectedMediaId: UUID11 })
      if (bad) expect(err.message).not.toContain(bad)
    }
    for (const good of ['abra_t2v_6s', 'veo_3_1_t2v_fast_ultra_relaxed', 'veo_3_1_t2v_fast_portrait_ultra_relaxed', 'abra_t2v_6s_360p', 'omni_flash_i2v_8s_first_last', 'veo_2_1_fast_d_15_t2v', 'abra_' + 'x'.repeat(59)]) {
      const p = samplePayload('YhhmEf'); p[3][0][7][0][12] = good
      expect(parseVideoSubmitResponse(p).modelKey).toBe(good)
    }
  })
  it('[3][0][7] 삭제 → shape [3][0][7][0] + rejectedMediaId', () => {
    const p = samplePayload('YhhmEf'); delete p[3][0][7]
    let err
    try { parseVideoSubmitResponse(p) } catch (e) { err = e }
    expect(err).toMatchObject({ kind: 'shape', path: '[3][0][7][0]', rejectedMediaId: UUID11 })
  })
  it('[3] 비어 있음 → shape [3], rejectedMediaId 없음', () => {
    const p = samplePayload('YhhmEf'); p[3] = []
    let err
    try { parseVideoSubmitResponse(p) } catch (e) { err = e }
    expect(err).toMatchObject({ kind: 'shape', path: '[3]' })
    expect(err).not.toHaveProperty('rejectedMediaId')
    expect(err).not.toHaveProperty('rejectedMediaIds')
  })
  // M2-R5 J2(A2): [3][0][0] 은 문자열이기만 하면 통과했다 — 렌더러 분류(훅 submittedFlow I4 · App chargedFlowItem · 복구 #R34-1)는 UUID 모양에 묶여 있으므로 모양이 다른
  //   id 는 재시작 뒤 fresh 로 잡혀 재제출된다(돈에 fail-open). 파서가 먼저 같은 모양을 요구해 분류와 파서가 한 모양을 말하게 한다. 검증 안 된 값은 밖으로 안 나간다(메시지·rejectedMediaId 없음).
  it('[3][0][0] 이 UUID 모양이 아니면(operation 이름·사용자 텍스트·URL·대시 없는 hex·UUID 를 품은 값) shape [3][0][0], rejectedMediaId 없음, 메시지에 그 값 없음; 픽스처 id 는 통과 (M2-R5 J2 · M2-R6 K5)', () => {
    // M2-R6 K5(B4): UUID 를 **품은** 값 넷 — 술어의 ^…$ 앵커가 없으면 파서가 이들을 과금 id 로 받는다(전엔 이 목록에 내장 UUID 가 없어 앵커를 지워도 초록).
    const embedded = ['models/veo-3.1-fast-generate-preview/operations/' + UUID11, UUID11 + 'x', 'x' + UUID11, 'projects/' + UUID11 + '/x']
    for (const bad of ['models/veo-3.1-fast-generate-preview/operations/op1', 'not a uuid 사용자 텍스트', 'https://evil.example/x', '0f3b9c1e5d2a4b7c8e9f0a1b2c3d4e5f', 'CLIENT_1234', ...embedded]) {
      const p = samplePayload('YhhmEf'); p[3][0][0] = bad
      let err
      try { parseVideoSubmitResponse(p) } catch (e) { err = e }
      expect(err, bad).toBeInstanceOf(FlowRpcShapeError)
      expect(err).toMatchObject({ kind: 'shape', rpcid: 'YhhmEf', path: '[3][0][0]' })
      expect(err).not.toHaveProperty('rejectedMediaId')
      expect(err.message).not.toContain(bad)
    }
    expect(parseVideoSubmitResponse(samplePayload('YhhmEf')).mediaId).toBe(UUID11)
    expect(UUID11).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
  it('[3][0][0] 이 문자열이 아니면 shape [3][0][0], rejectedMediaId 없음', () => {
    const p = samplePayload('YhhmEf'); p[3][0][0] = 7
    let err
    try { parseVideoSubmitResponse(p) } catch (e) { err = e }
    expect(err).toMatchObject({ kind: 'shape', path: '[3][0][0]' })
    expect(err).not.toHaveProperty('rejectedMediaId')
  })
  it('응답 텍스트에서 바로: parseBatchexecuteResponse → parseVideoSubmitResponse', () => {
    const v = parseVideoSubmitResponse(parseBatchexecuteResponse(sample('YhhmEf').respBody, 'YhhmEf'))
    expect(v).toMatchObject({ mediaId: UUID11, modelKey: 'abra_t2v_6s', creditsLeft: 1040 })
  })
})

describe('M2-1 rpcErrorToRendererResult — 거부 id 통과', () => {
  it('video-count → flow-video-count-mismatch + rejectedMediaIds(mediaId/generationId 키 없음)', () => {
    const p = samplePayload('YhhmEf')
    const second = JSON.parse(JSON.stringify(p[3][0])); second[0] = '<uuid#12>'
    p[3].push(second)
    let err
    try { parseVideoSubmitResponse(p) } catch (e) { err = e }
    const res = rpcErrorToRendererResult(err)
    expect(res).toEqual({ success: false, errorKind: 'flow-video-count-mismatch', error: 'flow-video-count-mismatch', rejectedMediaIds: [UUID11, '<uuid#12>'] })
    expect(isFlowAuthError(res)).toBe(false)
  })
  it('rejectedMediaId 를 든 shape 에러 → 결과에도 rejectedMediaId (경로 표기 유지)', () => {
    const p = samplePayload('YhhmEf'); delete p[3][0][7][0][12]
    let err
    try { parseVideoSubmitResponse(p) } catch (e) { err = e }
    expect(rpcErrorToRendererResult(err)).toEqual({ success: false, errorKind: 'flow-rpc-error', error: 'rpc-shape:YhhmEf@[3][0][7][0][12]', rejectedMediaId: UUID11 })
  })
})

describe('M2-1 parseMediaRecord / parseVideoStatusResponse / mediaStateToStatus', () => {
  it('R 첫 폴 → creditsLeft:null, records[0] {mediaId, state:2, bytes:null, videoUrl:null}', () => {
    const v = parseVideoStatusResponse(firstPollPayload())
    expect(v).toEqual({ creditsLeft: null, records: [{ mediaId: UUID11, state: 2, bytes: null, videoUrl: null }] })
  })
  it('S3 마지막 폴 → creditsLeft:1040, {state:3, bytes:2613641, videoUrl:null}', () => {
    const v = parseVideoStatusResponse(samplePayload('jwpduf'))
    expect(v).toEqual({ creditsLeft: 1040, records: [{ mediaId: UUID11, state: 3, bytes: 2613641, videoUrl: null }] })
  })
  it('S4 as29s 레코드 → videoUrl ^https://flow-content.google/video/ + bytes', () => {
    const r = parseMediaRecord(samplePayload('as29s'))
    expect(r).toMatchObject({ mediaId: UUID11, state: 3, bytes: 2613641 })
    expect(r.videoUrl).toMatch(/^https:\/\/flow-content\.google\/video\//)
  })
  it('videoUrl 호스트가 flow-content.google 이 아니면 shape [7][0][8] (서명은 메시지에 없다)', () => {
    const p = samplePayload('as29s')
    p[7][0][8] = 'https://evil.example/video/x?Signature=SIGSECRET'
    let err
    try { parseMediaRecord(p) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcShapeError)
    expect(err).toMatchObject({ rpcid: 'as29s', path: '[7][0][8]' })
    expect(err.message).not.toContain('SIGSECRET')
  })
  it('[0] 이 문자열이 아니면 shape [0]; 상태 없음([5][8] 삭제) → state:null', () => {
    const bad = samplePayload('as29s'); bad[0] = null
    expect(() => parseMediaRecord(bad)).toThrow(FlowRpcShapeError)
    const noState = samplePayload('as29s'); delete noState[5][8]
    expect(parseMediaRecord(noState)).toMatchObject({ mediaId: UUID11, state: null })
  })
  it('parseVideoStatusResponse: [2] 가 배열이 아니면 shape jwpduf@[2]; 빈 배열 → records:[]; 레코드 경로는 [2][i]…', () => {
    expect(() => parseVideoStatusResponse([null, null, null])).toThrow(/jwpduf response shape changed at \[2\]/)
    expect(parseVideoStatusResponse([null, null, []])).toEqual({ creditsLeft: null, records: [] })
    const p = samplePayload('jwpduf'); p[2][0][0] = 5
    let err
    try { parseVideoStatusResponse(p) } catch (e) { err = e }
    expect(err).toMatchObject({ rpcid: 'jwpduf', path: '[2][0][0]' })
  })
  it('mediaStateToStatus: 6·2 → pending, 3 → complete, 9·null → unknown', () => {
    expect(mediaStateToStatus(6)).toBe('pending')
    expect(mediaStateToStatus(2)).toBe('pending')
    expect(mediaStateToStatus(3)).toBe('complete')
    expect(mediaStateToStatus(9)).toBe('unknown')
    expect(mediaStateToStatus(null)).toBe('unknown')
  })
})

describe('M2-1 modelKeyMatches — 카탈로그 표 기반 진리표(HTrJv 사실)', () => {
  const OMNI = 'Omni Flash', FAST = 'Veo 3.1 - Fast', LITE = 'Veo 3.1 - Lite', QUALITY = 'Veo 3.1 - Quality'
  const truthy = [
    ['abra_t2v_6s', { model: OMNI, duration: 6, ratio: '9:16', resolution: '720p' }],
    ['abra_t2v_6s', { model: OMNI, duration: 6, ratio: '16:9' }],
    ['veo_3_1_t2v', { model: QUALITY, duration: 8, ratio: '16:9' }],
    ['veo_3_1_t2v_fast_ultra_relaxed', { model: FAST, duration: 8, ratio: '16:9' }],
    ['veo_3_1_t2v_fast_6s', { model: FAST, duration: 6, ratio: '9:16' }],
    ['veo_3_1_t2v_fast_portrait_ultra_relaxed', { model: FAST, duration: 8, ratio: '9:16' }],
    ['abra_t2v_6s_360p', { model: OMNI, duration: 6, ratio: '16:9', resolution: '360p' }],
    ['veo_3_1_t2v_lite', { model: LITE, duration: 8 }],
    ['veo_3_1_t2v_lite_4s', { model: LITE, duration: 4 }],
    ['veo_3_1_t2v_lite_6s', { model: LITE, duration: 6 }],
    // M2-R1 F13(B7): 카탈로그(HTrJv, S 11행)에 있는 키만 — portrait 형제 판정은 **등급별**(Lite 8s 엔 portrait 형제가 없다 → 9:16 요청도 이 키로 답한다),
    //   Quality 6s 도 형제 없음, 큐 토큰은 위치·조합 무관 중립(`_ultra` 단독, `_6s_relaxed`, `_portrait_ultra`). t2v 키엔 `_low_priority` 가 없다(미발명).
    ['veo_3_1_t2v_lite', { model: LITE, duration: 8, ratio: '9:16' }],
    ['veo_3_1_t2v_quality_6s', { model: QUALITY, duration: 6, ratio: '9:16' }],
    ['veo_3_1_t2v_fast_ultra', { model: FAST, duration: 8, ratio: '16:9' }],
    ['veo_3_1_t2v_fast_6s_relaxed', { model: FAST, duration: 6, ratio: '16:9' }],
    ['veo_3_1_t2v_fast_portrait_ultra', { model: FAST, duration: 8, ratio: '9:16' }],
  ]
  const falsy = [
    ['abra_r2v_6s', { model: OMNI, duration: 6, ratio: '16:9' }],
    ['abra_i2v_6s', { model: OMNI, duration: 6, ratio: '16:9' }],
    ['abra_t2v_6s_360p', { model: OMNI, duration: 6, ratio: '16:9', resolution: '720p' }],
    ['abra_t2v_6s', { model: OMNI, duration: 8 }],
    ['veo_3_1_t2v_fast_ultra_relaxed', { model: QUALITY, duration: 8 }],
    ['veo_3_1_t2v_fast_ultra_relaxed', { model: FAST, duration: 8, ratio: '9:16' }],
    ['veo_3_1_t2v_quality_6s', { model: FAST, duration: 6 }],
    ['veo_3_1_t2v_lite_6s', { model: FAST, duration: 6 }],
    ['veo_3_1_t2v', { model: LITE, duration: 8 }],
  ]
  it.each(truthy)('true: %s ↔ %o', (key, want) => { expect(modelKeyMatches(key, want)).toBe(true) })
  it.each(falsy)('false: %s ↔ %o', (key, want) => { expect(modelKeyMatches(key, want)).toBe(false) })
  it('fail-closed: 모르는 토큰·모르는 모델 라벨·길이 없음·1080p 요청은 전부 false', () => {
    expect(modelKeyMatches('abra_t2v_6s_hdr', { model: OMNI, duration: 6 })).toBe(false)
    expect(modelKeyMatches('abra_edit', { model: OMNI, duration: 8 })).toBe(false)
    expect(modelKeyMatches('veo_3_1_t2v', { model: 'veo-3', duration: 8 })).toBe(false)
    expect(modelKeyMatches('abra_t2v_6s', { model: OMNI })).toBe(false)
    expect(modelKeyMatches('abra_t2v_6s', { model: OMNI, duration: 6, resolution: '1080p' })).toBe(false)
    expect(modelKeyMatches(null, { model: OMNI, duration: 6 })).toBe(false)
  })
  it('표시 라벨 변형: 패널 라벨 "Omni 1.1 Flash" 와 abra_* 내부키도 Omni 로 본다', () => {
    expect(modelKeyMatches('abra_t2v_6s', { model: 'Omni 1.1 Flash', duration: 6 })).toBe(true)
    expect(modelKeyMatches('abra_t2v_6s', { model: 'abra_t2v_6s', duration: 6 })).toBe(true)
  })
})

// M2-R1 F12(A12): 렌더러 `error:'rpc-shape:<rpcid>@<path>'` 의 경로엔 숫자가 든다 — §3 "error 문구의 숫자 금지" 의 **명시 예외**(코드 변경 없음).
//   예외가 성립하는 조건을 핀한다: 경로 인덱스는 한두 자리라 `\b40[13]\b`·`\b5\d\d\b`(isFlowAuthError 의 401/403, HTTP 5xx 오인) 를 만들 수 없다.
//   정적(소스의 [n] 리터럴 전부 < 100 — jwpduf 의 동적 [2][i] 는 id 당 1회 폴이라 i=0) + 동적(실제 shape 실패 문구의 모든 숫자 < 100).
describe('M2-R1 F12 rpc-shape 경로 인덱스 < 100 (숫자 금지 규칙의 예외 조건)', () => {
  const SRC = ['electron/flow-rpc-protocol.js', 'electron/ipc/flow-angular.js', 'electron/flow-rpc-router.js']
  it('정적: 프로토콜·핸들러·라우터 소스의 [n] 리터럴은 전부 < 100', () => {
    let total = 0
    for (const rel of SRC) {
      const src = readFileSync(fileURLToPath(new URL('../../' + rel, import.meta.url)), 'utf8')
      const idx = [...src.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))
      total += idx.length
      for (const n of idx) expect(n, `${rel} [${n}]`).toBeLessThan(100)
    }
    expect(total).toBeGreaterThan(20)
  })
  it('동적: 실제 shape 실패들의 rpc-shape 문구 — 숫자 전부 < 100, \\b40[13]\\b·\\b5\\d\\d\\b 불일치, auth 오진 없음', () => {
    const errors = []
    const grab = (fn) => { try { fn() } catch (e) { errors.push(e) } }
    grab(() => parseImageGenerateResponse([[[UUID5, null, '<uuid#6>', null, null, null, [[null, 1, null, null, null, null, 1, 'x', 29, null, null, 'y', null, 'https://flow-content.google/image/<uuid#5>?Signature=S', 3, null, null, UUID5]]]]]))
    grab(() => { const p = samplePayload('YhhmEf'); delete p[3][0][7][0][12]; parseVideoSubmitResponse(p) })
    grab(() => parseVideoStatusResponse([null, null, null]))
    grab(() => { const p = samplePayload('jwpduf'); p[2][0][0] = 5; parseVideoStatusResponse(p) })
    grab(() => { const p = samplePayload('as29s'); p[7][0][8] = 'https://evil.example/v'; parseMediaRecord(p) })
    grab(() => parseBatchexecuteResponse('garbage', 'nzlxg'))
    // M3-1: 새 shape 경로(maseQ @[0][0] · MZZa6b 모델키)도 같은 조건
    grab(() => { const p = s3Payload(4); p[0][0] = 'not-a-uuid'; parseUploadResponse(p) })
    grab(() => { const p = s3Payload(10); delete p[3][0][7][0][12]; parseVideoSubmitResponse(p, 'MZZa6b') })
    expect(errors).toHaveLength(8)
    for (const err of errors) {
      expect(err).toBeInstanceOf(FlowRpcShapeError)
      const res = rpcErrorToRendererResult(err)
      expect(res.error).toMatch(/^rpc-shape:[A-Za-z0-9]+@/)
      for (const n of (res.error.match(/\d+/g) || []).map(Number)) expect(n, res.error).toBeLessThan(100)
      expect(res.error).not.toMatch(/\b40[13]\b|\b5\d\d\b/)
      expect(isFlowAuthError(res)).toBe(false)
      expect(markFlowAuthFailure(res)).not.toHaveProperty('authFailed')
    }
  })
})

// ─── M3-1 레퍼런스(요청 refs·멘션 · 업로드 maseQ · r2v MZZa6b · 되돌림 · r2v 모델키) ─────────────────────────────────
//   픽스처 = 2026-09-25 M3 샘플(S3#n — tests/fixtures/flow-m3-samples.js). U(n) = maskedUuid(n) 의 줄임.
//   레퍼런스 = 칩 순서의 중복 없는 목록, 멘션 = **중복을 보존한 순서열**(PR §4 — 같은 미디어 두 번 멘션 = 레퍼런스 1개·멘션 2개).
const U = maskedUuid
const inner = (n) => decodeFReqInner(s3RequestBody(n)).inner

describe('M3-1 extractSubmitRefs — 요청 본문의 레퍼런스·멘션 id(검증 불가면 null)', () => {
  it.each([
    ['S3#9 ogiZ0b 레퍼런스 2 + 인라인 멘션 1', 'ogiZ0b', 9, { refs: [U(2), U(3)], mentions: [U(2)] }],
    ['S3#3 ogiZ0b 레퍼런스 1, 멘션 없음', 'ogiZ0b', 3, { refs: [U(2)], mentions: [] }],
    ['S3#10 MZZa6b 칩만(평문 프롬프트)', 'MZZa6b', 10, { refs: [U(2)], mentions: [] }],
    ['S3#17 MZZa6b 인라인 멘션', 'MZZa6b', 17, { refs: [U(2)], mentions: [U(2)] }],
    ['S3#19 ogiZ0b 같은 미디어 두 번 멘션 — 멘션 중복 보존', 'ogiZ0b', 19, { refs: [U(46)], mentions: [U(46), U(46)] }],
    ['S3#20 MZZa6b 같은 미디어 두 번 멘션 — 멘션 중복 보존', 'MZZa6b', 20, { refs: [U(52)], mentions: [U(52), U(52)] }],
    ['S3#14 YhhmEf 대조군(레퍼런스 자리 없음)', 'YhhmEf', 14, { refs: [], mentions: [] }],
  ])('%s', (_l, rpcid, n, want) => {
    expect(s3(n).rpcid).toBe(rpcid)
    expect(extractSubmitRefs(rpcid, inner(n))).toEqual(want)
    // 공백 + 변형 본문도 같은 값
    expect(extractSubmitRefs(rpcid, decodeFReqInner(s3RequestBody(n, { plus: true })).inner)).toEqual(want)
  })

  it('09-24 S1(레퍼런스 없는 ogiZ0b — [1][0][2] = null) → {refs:[], mentions:[]}', () => {
    const i = decodeFReqInner(reencodeRequestBody(sample('ogiZ0b').reqBody)).inner
    expect(i[1][0][2]).toBeNull()
    expect(extractSubmitRefs('ogiZ0b', i)).toEqual({ refs: [], mentions: [] })
  })

  it('결과는 id 만 — 라벨(파일명)·프롬프트 텍스트 없음', () => {
    for (const [rpcid, n] of [['ogiZ0b', 9], ['MZZa6b', 17], ['ogiZ0b', 19], ['MZZa6b', 20]]) {
      const s = JSON.stringify(extractSubmitRefs(rpcid, inner(n)))
      for (const bad of ['king.jpg', 'image.png', 'walks', 'queen', 'garden']) expect(s, `S3#${n}`).not.toContain(bad)
    }
  })

  it('모양이 다르면 null(검증 불가 — 빈 배열과 구분): [1][0][2] 문자열 · 비-UUID 레퍼런스/멘션 id · 멘션 세그먼트 모양', () => {
    const strRefs = inner(9); strRefs[1][0][2] = 'x'
    expect(extractSubmitRefs('ogiZ0b', strRefs)).toBeNull()
    const badRef = inner(9); badRef[1][0][2][1][0] = 'not-a-uuid'
    expect(extractSubmitRefs('ogiZ0b', badRef)).toBeNull()
    const badMention = inner(9); badMention[1][0][8][0][0][1][0][0] = 'king.jpg'
    expect(extractSubmitRefs('ogiZ0b', badMention)).toBeNull()
    const badSeg = inner(9); badSeg[1][0][8][0][0] = [null, 'x']
    expect(extractSubmitRefs('ogiZ0b', badSeg)).toBeNull()
    const vBadRef = inner(10); vBadRef[0][0][1][0][1] = 'not-a-uuid'
    expect(extractSubmitRefs('MZZa6b', vBadRef)).toBeNull()
    const vStrRefs = inner(17); vStrRefs[0][0][1] = 'abra_r2v_4s'
    expect(extractSubmitRefs('MZZa6b', vStrRefs)).toBeNull()
    const vBadMention = inner(17); vBadMention[0][0][0][2][0][0][1][0][0] = null
    expect(extractSubmitRefs('MZZa6b', vBadMention)).toBeNull()
  })

  it('항목이 여럿(x2)이면 항목마다 같아야 한다 — 같으면 그 값, 다르면 null', () => {
    const same = inner(9); same[1].push(JSON.parse(JSON.stringify(same[1][0])))
    expect(extractSubmitRefs('ogiZ0b', same)).toEqual({ refs: [U(2), U(3)], mentions: [U(2)] })
    const diffRefs = inner(9); const second = JSON.parse(JSON.stringify(diffRefs[1][0])); second[2].pop(); diffRefs[1].push(second)
    expect(extractSubmitRefs('ogiZ0b', diffRefs)).toBeNull()
    const diffMentions = inner(19); const m2 = JSON.parse(JSON.stringify(diffMentions[1][0])); m2[8][0].splice(2, 1); diffMentions[1].push(m2)
    expect(extractSubmitRefs('ogiZ0b', diffMentions)).toBeNull()
  })

  it('모르는 rpcid · 깨진 inner · 빈 항목 → null (throw 없음)', () => {
    expect(extractSubmitRefs('jwpduf', inner(9))).toBeNull()
    expect(extractSubmitRefs('maseQ', inner(9))).toBeNull()
    expect(extractSubmitRefs('ogiZ0b', null)).toBeNull()
    expect(extractSubmitRefs('ogiZ0b', [null, []])).toBeNull()
    expect(extractSubmitRefs('MZZa6b', [[]])).toBeNull()
    expect(extractSubmitRefs('MZZa6b', 'x')).toBeNull()
  })
})

describe('M3-1 extractSubmitPrompts — MZZa6b(= YhhmEf 경로) · 멘션 세그먼트는 건너뛰고 텍스트만', () => {
  it('("MZZa6b", S3#10) → ["The king walks slowly toward the camera"]', () => {
    expect(extractSubmitPrompts('MZZa6b', inner(10))).toEqual(['The king walks slowly toward the camera'])
  })
  it('("MZZa6b", S3#17) → [" walks toward the camera"] (멘션 라벨 없음)', () => {
    expect(extractSubmitPrompts('MZZa6b', inner(17))).toEqual([' walks toward the camera'])
  })
  it('("ogiZ0b", S3#9) 정규화 → "and a queen in a garden"; S3#19 정규화 → "walks with in a garden"', () => {
    expect(normalizePrompt(extractSubmitPrompts('ogiZ0b', inner(9))[0])).toBe('and a queen in a garden')
    expect(normalizePrompt(extractSubmitPrompts('ogiZ0b', inner(19))[0])).toBe('walks with in a garden')
  })
})

describe('M3-1 parseUploadResponse — maseQ 응답 → {mediaId} (파일명 없음)', () => {
  it('S3#4(붙여넣기) → {mediaId:U3}, S3#2(파일 대화상자) → {mediaId:U2}', () => {
    expect(parseUploadResponse(s3Payload(4))).toEqual({ mediaId: U(3) })
    expect(parseUploadResponse(s3Payload(2))).toEqual({ mediaId: U(2) })
    expect(parseUploadResponse(parseBatchexecuteResponse(s3(4).respBody, 'maseQ'))).toEqual({ mediaId: U(3) })
  })
  it('결과에 image.png · king.jpg · image/ 없음', () => {
    for (const n of [2, 4]) {
      const s = JSON.stringify(parseUploadResponse(s3Payload(n)))
      for (const bad of ['image.png', 'king.jpg', 'image/']) expect(s).not.toContain(bad)
    }
  })
  it('[1][3][4] 가 다른 사본 · [0][0] 비-UUID → "maseQ response shape changed at [0][0]" (메시지에 값 없음)', () => {
    const other = s3Payload(4); other[1][3][4] = U(9)
    expect(() => parseUploadResponse(other)).toThrow(/maseQ response shape changed at \[0\]\[0\]/)
    const bad = s3Payload(4); bad[0][0] = 'image.png'
    let err
    try { parseUploadResponse(bad) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcShapeError)
    expect(err).toMatchObject({ rpcid: 'maseQ', path: '[0][0]' })
    expect(err.message).not.toContain('image.png')
    expect(() => parseUploadResponse(null)).toThrow(/maseQ response shape changed at \[0\]\[0\]/)
  })
  it('[1][3][4] 가 없으면 [0][0] 만으로 성공(있을 때만 같아야 한다)', () => {
    const p = s3Payload(4); p.length = 1
    expect(parseUploadResponse(p)).toEqual({ mediaId: U(3) })
  })
})

describe('M3-1 parseVideoSubmitResponse(payload, "MZZa6b") — YhhmEf 와 같은 모양 + refEcho([3][0][5][6][1][1][j][2])', () => {
  it('S3#10 → {mediaId:U30, modelKey:"abra_r2v_4s", creditsLeft:904, refEcho:[U2]}', () => {
    expect(parseVideoSubmitResponse(s3Payload(10), 'MZZa6b')).toMatchObject({ mediaId: U(30), modelKey: 'abra_r2v_4s', creditsLeft: 904, refEcho: [U(2)], state: 6, warnings: [] })
  })
  it('S3#15 → U40 · veo_3_1_r2v_fast_portrait · 864', () => {
    expect(parseVideoSubmitResponse(s3Payload(15), 'MZZa6b')).toMatchObject({ mediaId: U(40), modelKey: 'veo_3_1_r2v_fast_portrait', creditsLeft: 864, refEcho: [U(2)] })
  })
  it('S3#20 → U57 · 850 · refEcho:[U52] (같은 미디어 두 번 멘션이어도 되돌림 하나); S3#17 → U45 · 857 · 텍스트 메아리만', () => {
    expect(parseVideoSubmitResponse(s3Payload(20), 'MZZa6b')).toMatchObject({ mediaId: U(57), creditsLeft: 850, refEcho: [U(52)] })
    expect(parseVideoSubmitResponse(s3Payload(17), 'MZZa6b')).toMatchObject({ mediaId: U(45), creditsLeft: 857, refEcho: [U(2)], echo: [' walks toward the camera'] })
  })
  it('[3][0][7][0][12] 삭제 → "MZZa6b response shape changed at [3][0][7][0][12]" + rejectedMediaId:U30', () => {
    const p = s3Payload(10); delete p[3][0][7][0][12]
    let err
    try { parseVideoSubmitResponse(p, 'MZZa6b') } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcShapeError)
    expect(err.message).toBe('MZZa6b response shape changed at [3][0][7][0][12]')
    expect(err).toMatchObject({ rpcid: 'MZZa6b', rejectedMediaId: U(30) })
    expect(rpcErrorToRendererResult(err)).toEqual({ success: false, errorKind: 'flow-rpc-error', error: 'rpc-shape:MZZa6b@[3][0][7][0][12]', rejectedMediaId: U(30) })
  })
  it('되돌림 삭제 → 성공 + refEcho:null; 되돌림 id 가 UUID 가 아니면 null', () => {
    const p = s3Payload(10); delete p[3][0][5][6][1][1]
    expect(parseVideoSubmitResponse(p, 'MZZa6b')).toMatchObject({ mediaId: U(30), refEcho: null })
    const q = s3Payload(10); q[3][0][5][6][1][1][0][2] = 'king.jpg'
    expect(parseVideoSubmitResponse(q, 'MZZa6b').refEcho).toBeNull()
  })
  it('rpcid 생략 = YhhmEf(기존 호출자 무변경)', () => {
    expect(parseVideoSubmitResponse(samplePayload('YhhmEf'), 'YhhmEf')).toEqual(parseVideoSubmitResponse(samplePayload('YhhmEf')))
    const p = samplePayload('YhhmEf'); delete p[3][0][7][0][12]
    expect(() => parseVideoSubmitResponse(p)).toThrow(/^YhhmEf response shape changed at \[3\]\[0\]\[7\]\[0\]\[12\]$/)
  })
})

describe('M3-1 parseImageGenerateResponse — results[i].refEcho([0][i][6][0][15][3][0][j][2])', () => {
  it('S3#9 → [U2,U3] · S3#3 → [U2] · S3#19 → [U46] · 09-24 S1 → null', () => {
    expect(parseImageGenerateResponse(s3Payload(9)).results[0].refEcho).toEqual([U(2), U(3)])
    expect(parseImageGenerateResponse(s3Payload(3)).results[0].refEcho).toEqual([U(2)])
    expect(parseImageGenerateResponse(s3Payload(19)).results[0].refEcho).toEqual([U(46)])
    expect(parseImageGenerateResponse(samplePayload('ogiZ0b')).results[0].refEcho).toBeNull()
  })
  it('되돌림 id 가 UUID 가 아니면 null(검증 불가 — 성공은 유지)', () => {
    const p = s3Payload(9); p[0][0][6][0][15][3][0][1][2] = 'queen.jpg'
    const r = parseImageGenerateResponse(p).results[0]
    expect(r.refEcho).toBeNull()
    expect(r.mediaId).toBe(U(24))
  })
})

describe('M3-1 modelKeyMatches — r2v 진리표(want.kind:"r2v", CAT 키만) · kind 생략 = t2v', () => {
  const OMNI = 'Omni Flash', FAST = 'Veo 3.1 - Fast', LITE = 'Veo 3.1 - Lite', QUALITY = 'Veo 3.1 - Quality'
  const truthy = [
    ['abra_r2v_4s', { model: OMNI, duration: 4, ratio: '9:16', resolution: '720p', kind: 'r2v' }],
    ['abra_r2v_6s_360p', { model: OMNI, duration: 6, ratio: '16:9', resolution: '360p', kind: 'r2v' }],
    ['veo_3_1_r2v_fast_portrait', { model: FAST, duration: 8, ratio: '9:16', kind: 'r2v' }],
    ['veo_3_1_r2v_fast_landscape', { model: FAST, duration: 8, ratio: '16:9', kind: 'r2v' }],
    ['veo_3_1_r2v_fast_portrait_ultra_relaxed', { model: FAST, duration: 8, ratio: '9:16', kind: 'r2v' }],
  ]
  const falsy = [
    ['abra_r2v_4s', { model: OMNI, duration: 4, ratio: '9:16', resolution: '720p' }],
    ['abra_t2v_4s', { model: OMNI, duration: 4, ratio: '9:16', kind: 'r2v' }],
    ['veo_3_1_r2v_fast_portrait', { model: FAST, duration: 8, ratio: '16:9', kind: 'r2v' }],
    ['veo_3_1_r2v_fast_landscape', { model: FAST, duration: 8, ratio: '9:16', kind: 'r2v' }],
    ['veo_3_1_r2v_lite', { model: LITE, duration: 8, kind: 'r2v' }],
    ['abra_r2v_4s', { model: OMNI, duration: 6, kind: 'r2v' }],
    ['abra_i2v_4s', { model: OMNI, duration: 4, ratio: '9:16', kind: 'r2v' }],
    // 방향 토큰 필수(Veo r2v) · Quality r2v 는 CAT 에 없음 · landscape 는 t2v 문법에 없음 · 모르는 kind
    ['veo_3_1_r2v_fast', { model: FAST, duration: 8, ratio: '16:9', kind: 'r2v' }],
    ['veo_3_1_r2v', { model: QUALITY, duration: 8, ratio: '16:9', kind: 'r2v' }],
    ['veo_3_1_t2v_fast_landscape', { model: FAST, duration: 8, ratio: '16:9' }],
    ['abra_r2v_4s', { model: OMNI, duration: 4, ratio: '9:16', kind: 'i2v' }],
  ]
  it.each(truthy)('true: %s ↔ %o', (key, want) => { expect(modelKeyMatches(key, want)).toBe(true) })
  it.each(falsy)('false: %s ↔ %o', (key, want) => { expect(modelKeyMatches(key, want)).toBe(false) })
  it('t2v 는 kind:"t2v" 명시와 생략이 같다', () => {
    expect(modelKeyMatches('veo_3_1_t2v_fast_portrait_ultra_relaxed', { model: FAST, duration: 8, ratio: '9:16', kind: 't2v' })).toBe(true)
    expect(modelKeyMatches('abra_t2v_6s', { model: OMNI, duration: 6, kind: 't2v' })).toBe(true)
  })
})
