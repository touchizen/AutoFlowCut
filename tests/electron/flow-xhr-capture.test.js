/**
 * flow-xhr-capture — Flow 페이지의 XMLHttpRequest 를 몽키패치해 요청/응답을 main 으로 보내는 진단 주입.
 *
 * 2026-09-23 실기: 새 flow.google.com 은 생성 RPC 를 fetch 가 아니라 **XHR**(batchexecute)로 보내
 * 기존 fetch 몽키패치가 아무것도 못 봤다(캡처 0건). 이 주입은 AUTOFLOWCUT_NET_TRACE=1 일 때만
 * main 이 실행하며, 생성 로직엔 손대지 않는다(관측만).
 */
import { describe, it, expect, vi } from 'vitest'
import vm from 'node:vm'
import { FLOW_XHR_CAPTURE_INJECTION, shouldTraceXhrUrl, serializeXhrBody, XHR_TRACE_MAX_BODY } from '../../electron/flow-xhr-capture.js'
import { FLOW_PAGE_INJECTION } from '../../electron/flow-page-injection.js'

class FakeXHR {
  constructor() { this._l = {}; this.responseType = ''; this.status = 0; this.responseText = ''; this.calls = [] }
  open(method, url) { this.calls.push(['open', method, url]) }
  setRequestHeader(k, v) { this.calls.push(['header', k, v]) }
  send(body) { this.calls.push(['send', body]) }
  addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn) }
  _finish(status, text) {
    this.status = status
    this.responseText = text
    for (const fn of this._l.loadend || []) fn.call(this)
  }
}

function makePage({ electronAPI = { flowReportXhr: vi.fn(() => Promise.resolve({ ok: true })) }, href = 'https://flow.google.com/project/abc', wiz } = {}) {
  const windowObject = { XMLHttpRequest: FakeXHR, location: { href }, electronAPI }
  if (wiz) windowObject.WIZ_global_data = wiz
  const context = vm.createContext({
    window: windowObject, location: windowObject.location, console: { log() {}, warn() {}, error() {} },
    Date, URL, JSON, String, Object,
  })
  vm.runInContext(FLOW_XHR_CAPTURE_INJECTION, context)
  return { windowObject, context, reports: electronAPI && electronAPI.flowReportXhr }
}

describe('shouldTraceXhrUrl — Google 계열만, 로깅·reCAPTCHA 노이즈 제외', () => {
  const base = 'https://flow.google.com/project/x'
  it('flow.google.com batchexecute / googleapis / *.google CDN 은 추적', () => {
    expect(shouldTraceXhrUrl('https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=A', base)).toBe(true)
    expect(shouldTraceXhrUrl('/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=A', base)).toBe(true)
    expect(shouldTraceXhrUrl('https://aisandbox-pa.googleapis.com/v1/credits', base)).toBe(true)
    expect(shouldTraceXhrUrl('https://flow-content.google/image/abc', base)).toBe(true)
  })
  it('play.google.com/log · clients6(ogads) · recaptcha · 비-Google 은 제외', () => {
    expect(shouldTraceXhrUrl('https://play.google.com/log?format=json', base)).toBe(false)
    expect(shouldTraceXhrUrl('https://ogads-pa.clients6.google.com/$rpc/x', base)).toBe(false)
    expect(shouldTraceXhrUrl('https://www.google.com/recaptcha/enterprise/clr?k=1', base)).toBe(false)
    expect(shouldTraceXhrUrl('https://example.com/api', base)).toBe(false)
    expect(shouldTraceXhrUrl('garbage://', base)).toBe(false)
  })
})

describe('serializeXhrBody — 본문을 문자열로', () => {
  it('string 그대로, URLSearchParams 는 toString, null 은 null', () => {
    expect(serializeXhrBody('f.req=1&at=2')).toBe('f.req=1&at=2')
    expect(serializeXhrBody(new URLSearchParams({ 'f.req': '[1]', at: 'x' }))).toBe('f.req=%5B1%5D&at=x')
    expect(serializeXhrBody(null)).toBeNull()
    expect(serializeXhrBody(undefined)).toBeNull()
  })
  it('바이너리는 값 대신 크기 표식', () => {
    expect(serializeXhrBody(new Uint8Array(5))).toBe('<binary 5 bytes>')
    expect(serializeXhrBody(new ArrayBuffer(7))).toBe('<binary 7 bytes>')
  })
})

describe('FLOW_XHR_CAPTURE_INJECTION — XHR open/setRequestHeader/send 를 감싸 loadend 에 보고', () => {
  it('batchexecute POST: method·url·헤더·요청본문·status·응답본문을 source:"xhr" 로 보고', () => {
    const { windowObject, reports } = makePage()
    const xhr = new windowObject.XMLHttpRequest()
    xhr.open('post', '/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=AbC&_reqid=1')
    xhr.setRequestHeader('X-Same-Domain', '1')
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8')
    xhr.send('f.req=%5B%5D&at=TOKEN&')
    expect(reports).not.toHaveBeenCalled()  // 응답 전엔 보고 없음
    xhr._finish(200, ")]}'\n\n12\n[[\"wrb.fr\"]]\n")
    expect(reports).toHaveBeenCalledTimes(1)
    const p = reports.mock.calls[0][0]
    expect(p).toMatchObject({
      source: 'xhr', method: 'POST', status: 200,
      // 페이지는 상대경로로 열지만 보고는 절대 URL 로 — main 의 rpcids 추출·호스트 요약이 그걸 전제한다.
      url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=AbC&_reqid=1',
      reqHeaders: { 'X-Same-Domain': '1', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      reqBody: 'f.req=%5B%5D&at=TOKEN&',
      respBody: ")]}'\n\n12\n[[\"wrb.fr\"]]\n",
      respTruncated: false,
    })
    expect(typeof p.reqStartedAt).toBe('number')
    // 원래 XHR 동작은 그대로 지나간다
    expect(xhr.calls).toEqual([
      ['open', 'post', '/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=AbC&_reqid=1'],
      ['header', 'X-Same-Domain', '1'],
      ['header', 'Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8'],
      ['send', 'f.req=%5B%5D&at=TOKEN&'],
    ])
  })

  it('추적 대상이 아닌 URL(play.google.com/log)은 보고하지 않지만 요청은 그대로 나간다', () => {
    const { windowObject, reports } = makePage()
    const xhr = new windowObject.XMLHttpRequest()
    xhr.open('POST', 'https://play.google.com/log?format=json')
    xhr.send('x')
    xhr._finish(200, 'ok')
    expect(reports).not.toHaveBeenCalled()
    expect(xhr.calls).toEqual([['open', 'POST', 'https://play.google.com/log?format=json'], ['send', 'x']])
  })

  it('두 번 실행해도 한 번만 감싼다(SPA 네비마다 재주입 — 보고 1회)', () => {
    const { windowObject, context, reports } = makePage()
    vm.runInContext(FLOW_XHR_CAPTURE_INJECTION, context)
    const xhr = new windowObject.XMLHttpRequest()
    xhr.open('POST', '/_/x/data/batchexecute?rpcids=A')
    xhr.send('b')
    xhr._finish(200, 'r')
    expect(reports).toHaveBeenCalledTimes(1)
  })

  it('responseType json 은 JSON 문자열로, 응답이 MAX 를 넘으면 잘라내고 respTruncated', () => {
    const { windowObject, reports } = makePage()
    const a = new windowObject.XMLHttpRequest()
    a.open('GET', 'https://aisandbox-pa.googleapis.com/v1/credits')
    a.responseType = 'json'
    a.send()
    a.response = { credits: 3 }
    a._finish(200, '')
    expect(reports.mock.calls[0][0].respBody).toBe('{"credits":3}')

    const b = new windowObject.XMLHttpRequest()
    b.open('POST', '/_/x/data/batchexecute?rpcids=B')
    b.send('q')
    b._finish(200, 'z'.repeat(XHR_TRACE_MAX_BODY + 10))
    const p = reports.mock.calls[1][0]
    expect(p.respBody.length).toBe(XHR_TRACE_MAX_BODY)
    expect(p.respTruncated).toBe(true)
  })

  it('electronAPI 가 없거나 invoke 가 reject 돼도 페이지가 터지지 않는다', () => {
    const noApi = makePage({ electronAPI: undefined })
    const x = new noApi.windowObject.XMLHttpRequest()
    x.open('POST', '/_/x/data/batchexecute?rpcids=A'); x.send('b')
    expect(() => x._finish(200, 'r')).not.toThrow()

    const rejecting = makePage({ electronAPI: { flowReportXhr: vi.fn(() => Promise.reject(new Error('nope'))) } })
    const y = new rejecting.windowObject.XMLHttpRequest()
    y.open('POST', '/_/x/data/batchexecute?rpcids=A'); y.send('b')
    expect(() => y._finish(200, 'r')).not.toThrow()
  })

  it('WIZ_global_data 가 있으면 1회 source:"wiz" 로 보고(at/f.sid/bl 의 출처)', () => {
    const { context, reports } = makePage({ wiz: { SNlM0e: 'AT_TOKEN', FdrFJe: '123', cfb2h: 'boq_x' } })
    vm.runInContext(FLOW_XHR_CAPTURE_INJECTION, context)  // 재실행해도 1회
    const wizCalls = reports.mock.calls.filter(([p]) => p.source === 'wiz')
    expect(wizCalls).toHaveLength(1)
    expect(JSON.parse(wizCalls[0][0].wiz)).toEqual({ SNlM0e: 'AT_TOKEN', FdrFJe: '123', cfb2h: 'boq_x' })
  })
})

describe('FLOW_PAGE_INJECTION — window.__autoflowcut_net_trace__ 가 켜지면 fetch 캡처도 같은 채널로', () => {
  async function runFetch(traceOn) {
    const flowReportXhr = vi.fn(() => Promise.resolve({ ok: true }))
    const response = { status: 200, clone: () => ({ text: () => Promise.resolve('{"ok":1}') }) }
    const windowObject = {
      fetch: () => Promise.resolve(response),
      electronAPI: { flowReportXhr, flowReportResponse: vi.fn(() => Promise.resolve()) },
      __autoflowcut_net_trace__: traceOn,
    }
    const context = vm.createContext({
      window: windowObject, console: { log() {}, warn() {}, error() {} }, setTimeout: () => 0, Date, URL,
      location: { href: 'https://flow.google.com/project/x' },
    })
    vm.runInContext(FLOW_PAGE_INJECTION, context)
    await windowObject.fetch('https://flow-content.google/image/abc', { method: 'GET' })
    await new Promise((r) => setImmediate(r))
    return flowReportXhr
  }
  it('켜져 있으면 source:"fetch" 로 보고', async () => {
    const r = await runFetch(true)
    expect(r).toHaveBeenCalledTimes(1)
    expect(r.mock.calls[0][0]).toMatchObject({ source: 'fetch', method: 'GET', url: 'https://flow-content.google/image/abc', status: 200, respBody: '{"ok":1}' })
  })
  it('꺼져 있으면 보고 없음(기존 동작 유지)', async () => {
    expect(await runFetch(false)).not.toHaveBeenCalled()
  })
})
