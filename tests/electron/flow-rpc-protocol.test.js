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
