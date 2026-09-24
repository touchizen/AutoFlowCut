// @vitest-environment node
//
// M1-1 — flow.google.com batchexecute 프로토콜 파서(순수). 픽스처는 2026-09-24 실측 샘플(마스킹)을
// fs 로 읽고, 요청 본문은 브라우저 인코딩으로 재인코딩한다(reqBody 는 캡처 시 이미 디코드돼 있다).
// 위치 핀은 docs/handoffs/evidence/2026-09-24-flow-batchexecute-rpcids.md 의 검증표 그대로 —
// 스키마 적응 없음: 위치가 바뀌면 FlowRpcShapeError 로 닫힌다(입력 내용은 메시지에 싣지 않는다).
import { describe, it, expect } from 'vitest'
import {
  FlowRpcError, FlowRpcShapeError,
  parseBatchexecuteResponse, parseImageGenerateResponse,
  decodeFReqInner, extractSubmitPrompts, normalizePrompt, ratioOk,
  rpcErrorToRendererResult, describeMediaUrl,
  parseVideoSubmitRequest, parseVideoSubmitResponse, parseMediaRecord, parseVideoStatusResponse,
  mediaStateToStatus, modelKeyMatches,
} from '../../electron/flow-rpc-protocol.js'
import { isFlowAuthError, markFlowAuthFailure } from '../../src/engine/engineFlow.js'
import { isQuotaExhaustedError } from '../../src/utils/quotaStop.js'
import {
  sample, reencodeRequestBody, samplePayload, respBodyWithPayload, respBodyFailure,
} from '../fixtures/flow-batchexecute-samples.js'

const UUID5 = '<uuid#5>'
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
    expect(results[0].url).toMatch(/^https:\/\/flow-content\.google\/image\/<uuid#5>\?/)
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
const UUID11 = '<uuid#11>'
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
