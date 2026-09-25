// @vitest-environment node
//
// M1-3 — 프로덕션 캡처 주입(항상 켜짐). 페이지의 XMLHttpRequest 를 감싸 제출 RPC(ogiZ0b/YhhmEf) 의
// send 와 loadend 를 flowReportResponse 로 보고한다. 관측만 — 요청 본문은 절대 바꾸지 않는다.
//   send   → {kind:'batchexecute-send', doc, rpcid, rpcids, seq, prompts, sentAt, refs, mentions}   (M3-2: maseQ 는 refs·mentions 없이 prompts:[])
//   loadend→ {kind:'batchexecute', doc, seq, status, responseText, endedAt}
// doc 은 문서마다 새 32hex nonce(같은 문서 재주입은 유지), seq 는 문서 안 카운터 — {doc, seq} 가 상관키.
import { describe, it, expect, vi } from 'vitest'
import vm from 'node:vm'
import { FLOW_RPC_CAPTURE_INJECTION, FLOW_RPC_CAPTURE_ALLOWLIST } from '../../electron/flow-rpc-capture.js'
import { sample, reencodeRequestBody, maskedUuid } from '../fixtures/flow-batchexecute-samples.js'
import { s3, s3RequestBody } from '../fixtures/flow-m3-samples.js'

const NOW_MS = 1790240102500
const BATCH = 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute'
const PROMPT = '궁정안에 있는 왕'

class FakeXHR {
  constructor() { this._l = {}; this.responseType = ''; this.status = 0; this.responseText = ''; this.calls = [] }
  open(method, url) { this.calls.push(['open', method, url]) }
  setRequestHeader(k, v) { this.calls.push(['header', k, v]) }
  send(body) { this.calls.push(['send', body]) }
  addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn) }
  _finish(status, text) { this.status = status; this.responseText = text; for (const fn of this._l.loadend || []) fn.call(this) }
}

function makePage({ electronAPI = { flowReportResponse: vi.fn(() => Promise.resolve({ ok: true })) }, href = 'https://flow.google.com/project/abc' } = {}) {
  // 문서마다 XMLHttpRequest 가 따로 있다(브라우저) — 컨텍스트마다 자기 prototype 을 가진 서브클래스.
  class PageXHR extends FakeXHR {}
  const windowObject = { XMLHttpRequest: PageXHR, location: { href }, electronAPI }
  // M3-2: 본문 디코드(decodeFReqInner 의 new URLSearchParams(body))를 센다 — maseQ 본문은 디코드되면 안 된다. URL 의 searchParams 는 이 전역을 안 쓴다.
  const decodes = []
  class CountingURLSearchParams extends URLSearchParams {
    constructor(init) { super(init); if (typeof init === 'string') decodes.push(init.length) }
  }
  const context = vm.createContext({
    window: windowObject, location: windowObject.location, console: { log() {}, warn() {}, error() {} },
    Date: { now: () => NOW_MS }, URL, URLSearchParams: CountingURLSearchParams, JSON, String, Object,
  })
  const inject = () => vm.runInContext(FLOW_RPC_CAPTURE_INJECTION, context)
  inject()
  const reports = () => (electronAPI ? electronAPI.flowReportResponse.mock.calls.map((c) => c[0]) : [])
  const post = (url, body) => { const x = new windowObject.XMLHttpRequest(); x.open('POST', url); x.setRequestHeader('X-Same-Domain', '1'); x.send(body); return x }
  return { windowObject, context, inject, reports, post, decodes }
}

const imageBody = () => reencodeRequestBody(sample('ogiZ0b').reqBody)

describe('FLOW_RPC_CAPTURE_INJECTION — send / loadend 보고', () => {
  it('허용 목록은 제출 RPC 셋(ogiZ0b·YhhmEf·MZZa6b) + 업로드 maseQ (M3-2)', () => {
    expect([...FLOW_RPC_CAPTURE_ALLOWLIST].sort()).toEqual(['MZZa6b', 'YhhmEf', 'maseQ', 'ogiZ0b'])
  })

  it('ogiZ0b send → batchexecute-send {doc 32hex, rpcid, rpcids, seq 1, prompts, sentAt 초}', () => {
    const page = makePage()
    page.post(BATCH + '?rpcids=ogiZ0b&source-path=%2Fproject%2Fabc&bl=B&f.sid=S&hl=ko&_reqid=1&rt=c', imageBody())
    const [ev] = page.reports()
    expect(ev).toEqual({
      kind: 'batchexecute-send', doc: expect.stringMatching(/^[0-9a-f]{32}$/), rpcid: 'ogiZ0b', rpcids: ['ogiZ0b'],
      seq: 1, prompts: [PROMPT], sentAt: 1790240102.5, refs: [], mentions: [],   // M3-2: 레퍼런스 없는 요청 = 빈 목록(추가 외 무변경)
    })
    expect(ev.multi).toBeUndefined()
  })

  it('공백을 + 로 보낸 본문도 같은 prompts', () => {
    const page = makePage()
    page.post(BATCH + '?rpcids=ogiZ0b', reencodeRequestBody(sample('ogiZ0b').reqBody, { plus: true }))
    expect(page.reports()[0].prompts).toEqual([PROMPT])
  })

  it('loadend → batchexecute {doc 같은 값, seq 1, status 200, responseText, endedAt}; 두 페이로드에 at·레퍼런스 blob 없음', () => {
    const page = makePage()
    const xhr = page.post(BATCH + '?rpcids=ogiZ0b', imageBody())
    xhr._finish(200, sample('ogiZ0b').respBody)
    const [sendEv, endEv] = page.reports()
    expect(endEv).toEqual({
      kind: 'batchexecute', doc: sendEv.doc, rpcid: 'ogiZ0b', seq: 1, status: 200,
      responseText: sample('ogiZ0b').respBody, endedAt: 1790240102.5,
    })
    for (const ev of [sendEv, endEv]) {
      const s = JSON.stringify(ev)
      expect(s).not.toContain('SECRET')
      expect(s).not.toContain('<b64')
    }
  })

  it('send 본문은 그대로 나간다(관측만) — 상대경로로 열어도 잡는다', () => {
    const page = makePage()
    const body = imageBody()
    const xhr = page.post('/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b', body)
    expect(xhr.calls.find((c) => c[0] === 'send')).toEqual(['send', body])
    expect(page.reports()).toHaveLength(1)
  })

  it('seq 는 문서 안에서 send 마다 +1, doc 은 고정', () => {
    const page = makePage()
    page.post(BATCH + '?rpcids=ogiZ0b', imageBody())
    page.post(BATCH + '?rpcids=YhhmEf', reencodeRequestBody(sample('YhhmEf').reqBody))
    const evs = page.reports()
    expect(evs.map((e) => e.seq)).toEqual([1, 2])
    expect(evs[1]).toMatchObject({ rpcid: 'YhhmEf', doc: evs[0].doc, prompts: ['왕이 궁전 내부를 산책하는 영상'] })
  })

  it('jwpduf(허용 목록 밖)·비-batchexecute·GET 은 보고하지 않는다', () => {
    const page = makePage()
    page.post(BATCH + '?rpcids=jwpduf', 'f.req=%5B%5D&at=SECRET&')
    page.post('https://play.google.com/log?format=json', 'x')
    const x = new page.windowObject.XMLHttpRequest(); x.open('GET', BATCH + '?rpcids=ogiZ0b'); x.send(null)
    expect(page.reports()).toHaveLength(0)
  })

  it('멀티 rpcids → multi:true (rpcid 는 허용 목록 첫 항목, rpcids 전부)', () => {
    const page = makePage()
    page.post(BATCH + '?rpcids=DA4VGb,ogiZ0b,YhhmEf', imageBody())
    expect(page.reports()[0]).toMatchObject({ rpcid: 'ogiZ0b', rpcids: ['DA4VGb', 'ogiZ0b', 'YhhmEf'], multi: true })
  })

  it('본문이 깨졌거나 문자열이 아니어도 send 는 보고된다(prompts []) — 라우터가 단일 후보 바인딩으로 처리', () => {
    const page = makePage()
    page.post(BATCH + '?rpcids=ogiZ0b', 'f.req=%7Bbroken&at=SECRET&')
    page.post(BATCH + '?rpcids=ogiZ0b', new Uint8Array(3))
    expect(page.reports().map((e) => e.prompts)).toEqual([[], []])
  })
})

describe('FLOW_RPC_CAPTURE_INJECTION — 문서 nonce·멱등·안전', () => {
  it('새 vm 컨텍스트(새 문서) 는 다른 doc, seq 는 1 부터', () => {
    const a = makePage(); const b = makePage()
    a.post(BATCH + '?rpcids=ogiZ0b', imageBody())
    b.post(BATCH + '?rpcids=ogiZ0b', imageBody())
    expect(a.reports()[0].doc).not.toBe(b.reports()[0].doc)
    expect(b.reports()[0].seq).toBe(1)
  })

  it('같은 컨텍스트 재주입은 멱등 — doc 유지, 패치 1겹(send 1건 = 보고 1건)', () => {
    const page = makePage()
    const doc = page.windowObject.__autoflowcut_rpc_doc__
    expect(() => page.inject()).not.toThrow()
    expect(page.windowObject.__autoflowcut_rpc_doc__).toBe(doc)
    page.post(BATCH + '?rpcids=ogiZ0b', imageBody())
    expect(page.reports()).toHaveLength(1)
    expect(page.reports()[0].doc).toBe(doc)
  })

  it('설치 플래그 window.__autoflowcut_rpc_capture__ === true (핸들러의 클릭 전 프로브)', () => {
    const page = makePage()
    expect(page.windowObject.__autoflowcut_rpc_capture__).toBe(true)
  })

  it('XMLHttpRequest 가 없으면 플래그를 세우지 않는다(재시도 가능)', () => {
    const windowObject = { location: { href: 'https://flow.google.com/' } }
    const context = vm.createContext({ window: windowObject, console: { log() {} }, Date, URL, URLSearchParams, JSON, String, Object })
    expect(() => vm.runInContext(FLOW_RPC_CAPTURE_INJECTION, context)).not.toThrow()
    expect(windowObject.__autoflowcut_rpc_capture__).toBeUndefined()
  })

  it('electronAPI 없음 / 보고가 reject 해도 throw 하지 않는다', async () => {
    const none = makePage({ electronAPI: undefined })
    expect(() => none.post(BATCH + '?rpcids=ogiZ0b', imageBody())._finish(200, 'x')).not.toThrow()
    const rejecting = makePage({ electronAPI: { flowReportResponse: vi.fn(() => Promise.reject(new Error('ipc down'))) } })
    expect(() => rejecting.post(BATCH + '?rpcids=ogiZ0b', imageBody())._finish(200, 'x')).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(rejecting.reports()).toHaveLength(2)
  })

  it('자기완결: 직렬화된 헬퍼가 서로를 이름으로 부르지 않는다(컨텍스트에 모듈 없음) + 로그 접두 [Flow Inject]', () => {
    expect(FLOW_RPC_CAPTURE_INJECTION).toContain('[Flow Inject]')
    expect(FLOW_RPC_CAPTURE_INJECTION).not.toContain('require(')
    expect(FLOW_RPC_CAPTURE_INJECTION).not.toContain('import ')
  })
})

// M3-2 — 캡처 허용 목록에 MZZa6b(레퍼런스 영상 r2v 제출)·maseQ(레퍼런스 이미지 업로드). 제출 send 이벤트엔 요청의 레퍼런스·멘션 id(extractSubmitRefs —
//   id 만, 검증 불가면 null). maseQ 는 **본문을 디코드하지 않는다**(수 MB base64·파일명이 이벤트에 들어갈 길이 없다) — prompts:[] 만, loadend 는 기존대로 responseText.
describe('M3-2 FLOW_RPC_CAPTURE_INJECTION — MZZa6b·maseQ 와 refs/mentions', () => {
  const U = maskedUuid
  const url = (rpcid) => BATCH + '?rpcids=' + rpcid + '&source-path=%2Fproject%2Fabc&bl=B&f.sid=S&hl=ko&_reqid=1&rt=c'
  const sendOf = (n) => { const page = makePage(); page.post(url(s3(n).rpcid), s3RequestBody(n)); return page.reports()[0] }

  it('S3#10(MZZa6b) → send {rpcid:"MZZa6b", prompts:["The king…"], refs:[U2], mentions:[]}', () => {
    expect(sendOf(10)).toEqual({
      kind: 'batchexecute-send', doc: expect.stringMatching(/^[0-9a-f]{32}$/), rpcid: 'MZZa6b', rpcids: ['MZZa6b'], seq: 1,
      prompts: ['The king walks slowly toward the camera'], sentAt: 1790240102.5, refs: [U(2)], mentions: [],
    })
  })

  it.each([
    ['S3#17 MZZa6b 인라인 멘션', 17, { rpcid: 'MZZa6b', prompts: [' walks toward the camera'], refs: [U(2)], mentions: [U(2)] }],
    ['S3#9 ogiZ0b 레퍼런스 2 + 멘션', 9, { rpcid: 'ogiZ0b', prompts: [' and a queen in a garden'], refs: [U(2), U(3)], mentions: [U(2)] }],
    ['S3#19 ogiZ0b 같은 미디어 두 번 멘션', 19, { rpcid: 'ogiZ0b', refs: [U(46)], mentions: [U(46), U(46)] }],
    ['S3#20 MZZa6b 같은 미디어 두 번 멘션', 20, { rpcid: 'MZZa6b', refs: [U(52)], mentions: [U(52), U(52)] }],
    ['S3#14 YhhmEf 대조군(레퍼런스 없음)', 14, { rpcid: 'YhhmEf', prompts: ['The king raises his hand and smiles'], refs: [], mentions: [] }],
  ])('%s', (_l, n, want) => {
    const ev = sendOf(n)
    expect(ev).toMatchObject({ kind: 'batchexecute-send', seq: 1, ...want })
    // 라벨(파일명)은 이벤트 어디에도 없다
    expect(JSON.stringify(ev)).not.toMatch(/king\.jpg|image\.png|SECRET|<b64/)
  })

  it('S3#4(maseQ) → send {rpcid:"maseQ", prompts:[]} 뿐 — 본문을 디코드하지 않는다(길이 < 400, base64·파일명·mime·at 없음)', () => {
    const page = makePage()
    const body = s3RequestBody(4)
    expect(body).toContain('image.png')   // 픽스처 전제: 본문엔 파일명이 있다
    page.post(url('maseQ'), body)
    const [ev] = page.reports()
    expect(ev).toEqual({
      kind: 'batchexecute-send', doc: expect.stringMatching(/^[0-9a-f]{32}$/), rpcid: 'maseQ', rpcids: ['maseQ'], seq: 1,
      prompts: [], sentAt: 1790240102.5,
    })
    const s = JSON.stringify(ev)
    expect(s.length).toBeLessThan(400)
    for (const bad of ['<b64', 'image.png', 'image/png', 'SECRET']) expect(s).not.toContain(bad)
    expect(page.decodes).toEqual([])   // maseQ 본문은 URLSearchParams 로 한 번도 풀지 않는다
    page.post(url('ogiZ0b'), s3RequestBody(9))
    expect(page.decodes).toHaveLength(1)   // 대조: 제출 본문은 디코드한다
  })

  it('maseQ loadend 는 기존대로 responseText 를 싣는다(main 이 파싱만)', () => {
    const page = makePage()
    const xhr = page.post(url('maseQ'), s3RequestBody(4))
    xhr._finish(200, s3(4).respBody)
    const [sendEv, endEv] = page.reports()
    expect(endEv).toEqual({ kind: 'batchexecute', doc: sendEv.doc, rpcid: 'maseQ', seq: 1, status: 200, responseText: s3(4).respBody, endedAt: 1790240102.5 })
  })

  it('send 본문은 그대로 나간다(세 rpc — MZZa6b·maseQ·ogiZ0b)', () => {
    const page = makePage()
    for (const n of [10, 4, 9]) {
      const body = s3RequestBody(n)
      const xhr = page.post(url(s3(n).rpcid), body)
      expect(xhr.calls.find((c) => c[0] === 'send')).toEqual(['send', body])
    }
    expect(page.reports().map((e) => [e.rpcid, e.seq])).toEqual([['MZZa6b', 1], ['maseQ', 2], ['ogiZ0b', 3]])
  })

  it('깨진 본문 → refs·mentions null(검증 불가 — 빈 배열과 구분), prompts []', () => {
    const page = makePage()
    page.post(url('MZZa6b'), 'f.req=%7Bbroken&at=SECRET&')
    expect(page.reports()[0]).toMatchObject({ rpcid: 'MZZa6b', prompts: [], refs: null, mentions: null })
  })
})
