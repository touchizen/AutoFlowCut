// @vitest-environment node
//
// M1-2 — 앱이 직접 부르는 읽기 RPC(nzlxg 크레딧 · jwpduf 상태 · as29s 미디어) 클라이언트.
// 요청은 **페이지 컨텍스트의 XHR** 로 나간다(쿠키·at 은 페이지에 있고, 페이지 밖으로 나오지 않는다).
// 제출 RPC(ogiZ0b/YhhmEf, reCAPTCHA 토큰이 실림)는 허용 목록 밖 — 빌더도 클라이언트도 throw 한다.
import { describe, it, expect, vi } from 'vitest'
import vm from 'node:vm'
import {
  FLOW_RPC_ALLOWLIST, readWizGlobals, buildRpcRequest, FLOW_RPC_CALL_JS, callFlowRpc,
} from '../../electron/flow-rpc-client.js'
import { FlowRpcError } from '../../electron/flow-rpc-protocol.js'
import { sample, respBodyFailure } from '../fixtures/flow-batchexecute-samples.js'

const WIZ = { SNlM0e: 'A', FdrFJe: 'S', cfb2h: 'B', oPEP7c: 'someone@example.com' }

class FakeXHR {
  constructor() { this._l = {}; this.status = 0; this.responseText = ''; this.timeout = 0; this.calls = []; FakeXHR.instances.push(this) }
  open(method, url) { this.calls.push(['open', method, url]) }
  setRequestHeader(k, v) { this.calls.push(['header', k, v]) }
  send(body) { this.calls.push(['send', body]) }
  addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn) }
  _fire(type) { for (const fn of this._l[type] || []) fn.call(this) }
  _finish(status, text) { this.status = status; this.responseText = text; this._fire('loadend') }
  _timeout() { this.status = 0; this._fire('timeout'); this._fire('loadend') }
}
FakeXHR.instances = []

function makePage({ wiz = WIZ, lang = 'ko' } = {}) {
  FakeXHR.instances = []
  const windowObject = { XMLHttpRequest: FakeXHR, location: { pathname: '/project/x', href: 'https://flow.google.com/project/x' } }
  if (wiz) windowObject.WIZ_global_data = wiz
  const context = vm.createContext({
    window: windowObject, location: windowObject.location, XMLHttpRequest: FakeXHR,
    document: { documentElement: { lang } },
    console: { log() {}, warn() {}, error() {} },
    Date, URL, URLSearchParams, JSON, String, Object, Number,
  })
  return { windowObject, context, run: (rpcid, payloadJson) => vm.runInContext(FLOW_RPC_CALL_JS(rpcid, payloadJson), context) }
}

describe('허용 목록 — 읽기 RPC 셋만', () => {
  it('정확히 nzlxg · jwpduf · as29s', () => {
    expect([...FLOW_RPC_ALLOWLIST].sort()).toEqual(['as29s', 'jwpduf', 'nzlxg'])
  })
  // M3-15: 레퍼런스 업로드(maseQ — reCAPTCHA 토큰)·레퍼런스 영상 제출(MZZa6b — 과금)도 앱이 만들 수 없다(페이지가 UI 로 보낸 것을 캡처만 한다).
  const NOT_ALLOWED = ['ogiZ0b', 'YhhmEf', 'Zzl0ze', 'maseQ', 'MZZa6b']
  it.each(NOT_ALLOWED)('buildRpcRequest(%s) 는 throw /rpcid not allowed/', (rpcid) => {
    expect(() => buildRpcRequest({ rpcid, payload: [], wiz: readWizGlobals(WIZ), hl: 'ko', sourcePath: '/p', reqid: 1 }))
      .toThrow(/rpcid not allowed/)
  })
  it.each(NOT_ALLOWED)('callFlowRpc(%s) 도 throw /rpcid not allowed/ 이고 페이지를 건드리지 않는다', async (rpcid) => {
    const executeJavaScript = vi.fn()
    await expect(callFlowRpc({ webContents: { executeJavaScript } }, rpcid, [])).rejects.toThrow(/rpcid not allowed/)
    expect(executeJavaScript).not.toHaveBeenCalled()
  })
  it('FLOW_RPC_CALL_JS 도 허용 목록 밖이면 throw', () => {
    for (const rpcid of NOT_ALLOWED) expect(() => FLOW_RPC_CALL_JS(rpcid, '[]'), rpcid).toThrow(/rpcid not allowed/)
  })
})

describe('readWizGlobals', () => {
  it('SNlM0e(at) · FdrFJe(f.sid) · cfb2h(bl) 를 뽑는다 — 그 외 키(이메일 등)는 버린다', () => {
    expect(readWizGlobals(WIZ)).toEqual({ at: 'A', sid: 'S', bl: 'B' })
  })
  it('SNlM0e 누락 → /WIZ_global_data\\.SNlM0e missing/', () => {
    expect(() => readWizGlobals({ FdrFJe: 'S', cfb2h: 'B' })).toThrow(/WIZ_global_data\.SNlM0e missing/)
    expect(() => readWizGlobals(undefined)).toThrow(/WIZ_global_data\.SNlM0e missing/)
  })
  it('FdrFJe / cfb2h 누락도 각각 이름으로 닫힌다', () => {
    expect(() => readWizGlobals({ SNlM0e: 'A', cfb2h: 'B' })).toThrow(/WIZ_global_data\.FdrFJe missing/)
    expect(() => readWizGlobals({ SNlM0e: 'A', FdrFJe: 'S' })).toThrow(/WIZ_global_data\.cfb2h missing/)
  })
})

describe('buildRpcRequest — 실측 batchexecute 형식', () => {
  const req = buildRpcRequest({ rpcid: 'nzlxg', payload: [], wiz: { at: 'A', sid: 'S', bl: 'B' }, hl: 'ko', sourcePath: '/project/x', reqid: 7 })

  it('URL: /_/AiSandboxAngularFrontend/data/batchexecute + 쿼리 7개', () => {
    const u = new URL(req.url, 'https://flow.google.com')
    expect(u.pathname).toBe('/_/AiSandboxAngularFrontend/data/batchexecute')
    expect([...u.searchParams.keys()]).toEqual(['rpcids', 'source-path', 'bl', 'f.sid', 'hl', '_reqid', 'rt'])
    expect(u.searchParams.get('rpcids')).toBe('nzlxg')
    expect(u.searchParams.get('f.sid')).toBe('S')
    expect(u.searchParams.get('bl')).toBe('B')
    expect(u.searchParams.get('hl')).toBe('ko')
    expect(u.searchParams.get('_reqid')).toBe('7')
    expect(u.searchParams.get('rt')).toBe('c')
    expect(req.url).toContain('source-path=%2Fproject%2Fx')
  })

  it('본문: f.req=<enc [[[rpcid,"<payload>",null,"generic"]]]>&at=<at>&', () => {
    expect(req.body).toBe('f.req=' + encodeURIComponent('[[["nzlxg","[]",null,"generic"]]]') + '&at=A&')
  })

  it('헤더: X-Same-Domain:1 + form content-type', () => {
    expect(req.headers).toEqual({ 'X-Same-Domain': '1', 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' })
  })

  it('payload 는 JSON 문자열로 한 번 더 감싸 실린다(jwpduf 의 미디어 id 목록)', () => {
    const r = buildRpcRequest({ rpcid: 'jwpduf', payload: [null, null, [['m1']]], wiz: { at: 'A', sid: 'S', bl: 'B' }, hl: 'en', sourcePath: '/', reqid: 1 })
    const freq = new URLSearchParams(r.body).get('f.req')
    expect(JSON.parse(freq)).toEqual([[['jwpduf', '[null,null,[["m1"]]]', null, 'generic']]])
  })
})

describe('FLOW_RPC_CALL_JS — 페이지 컨텍스트 XHR(vm + FakeXHR)', () => {
  it('open/헤더/body 가 buildRpcRequest 와 일치하고 {status,text} 로 resolve 한다', async () => {
    const page = makePage()
    const p = page.run('nzlxg', '[]')
    const xhr = FakeXHR.instances[0]
    const expected = buildRpcRequest({ rpcid: 'nzlxg', payload: [], wiz: { at: 'A', sid: 'S', bl: 'B' }, hl: 'ko', sourcePath: '/project/x', reqid: 1 })
    expect(xhr.calls[0]).toEqual(['open', 'POST', expected.url])
    expect(xhr.calls).toContainEqual(['header', 'X-Same-Domain', '1'])
    expect(xhr.calls).toContainEqual(['header', 'Content-Type', 'application/x-www-form-urlencoded;charset=utf-8'])
    expect(xhr.calls[xhr.calls.length - 1]).toEqual(['send', expected.body])
    expect(xhr.timeout).toBe(30000)
    xhr._finish(200, sample('nzlxg').respBody)
    await expect(p).resolves.toEqual({ status: 200, text: sample('nzlxg').respBody })
  })

  it('_reqid 는 호출마다 +1', async () => {
    const page = makePage()
    page.run('nzlxg', '[]')
    page.run('jwpduf', '[null,null,[["m1"]]]')
    const urls = FakeXHR.instances.map((x) => new URL(x.calls[0][2], 'https://flow.google.com').searchParams.get('_reqid'))
    expect(urls).toEqual(['1', '2'])
    expect(page.windowObject.__autoflowcut_rpc_reqid__).toBe(2)
  })

  it('timeout → {status:0, error:"timeout"} (loadend 가 뒤따라도 한 번만 resolve)', async () => {
    const page = makePage()
    const p = page.run('nzlxg', '[]')
    FakeXHR.instances[0]._timeout()
    await expect(p).resolves.toEqual({ status: 0, error: 'timeout' })
  })

  it('WIZ_global_data 없음 → {status:0, error:"wiz-missing"} 이고 XHR 을 열지 않는다', async () => {
    const page = makePage({ wiz: null })
    await expect(page.run('nzlxg', '[]')).resolves.toEqual({ status: 0, error: 'wiz-missing' })
    expect(FakeXHR.instances).toHaveLength(0)
  })

  it('자기완결: 스크립트가 모듈 헬퍼를 이름으로 부르지 않는다(vm 컨텍스트에 없어도 동작했다) + 페이로드 JSON 그대로', () => {
    const js = FLOW_RPC_CALL_JS('as29s', '["m1"]')
    expect(js).toContain('"as29s"')
    expect(js).toContain('["m1"]')
    expect(js).not.toContain('flow-rpc-protocol')
  })
})

describe('callFlowRpc — executeJavaScript 결과 → payload | FlowRpcError', () => {
  const view = (result) => ({ webContents: { executeJavaScript: vi.fn(async () => (typeof result === 'function' ? result() : result)) } })

  it('성공: nzlxg → [1050,1,2,2,null,1050]; 스크립트에 rpcid·payload 가 실린다', async () => {
    const v = view({ status: 200, text: sample('nzlxg').respBody })
    await expect(callFlowRpc(v, 'nzlxg', [])).resolves.toEqual([1050, 1, 2, 2, null, 1050])
    const script = v.webContents.executeJavaScript.mock.calls[0][0]
    expect(script).toContain('"nzlxg"')
  })

  const failures = [
    ['실패 프레임 code 8', { status: 200, text: respBodyFailure('nzlxg', 8) }, { kind: 'rpc', code: 8 }],
    ['HTTP 401', { status: 401, text: 'SECRET_BODY_401' }, { kind: 'http', status: 401 }],
    ['status 0 (network)', { status: 0, error: 'xhr-error' }, { kind: 'network', status: 0, reason: 'xhr-error' }],
    ['timeout', { status: 0, error: 'timeout' }, { kind: 'network', status: 0, reason: 'timeout' }],
    ['wiz-missing', { status: 0, error: 'wiz-missing' }, { kind: 'network', status: 0, reason: 'wiz-missing' }],
    ['프레임 없음', { status: 200, text: ")]}'\n\n5\n[[\"di\",1]]\nSECRET_TAIL" }, { kind: 'shape' }],
    ['결과 없음(undefined)', undefined, { kind: 'network', status: 0 }],
  ]
  it.each(failures)('%s → FlowRpcError 이고 메시지에 본문 없음', async (_l, result, expected) => {
    let err
    try { await callFlowRpc(view(result), 'nzlxg', []) } catch (e) { err = e }
    expect(err).toBeInstanceOf(FlowRpcError)
    expect(err).toMatchObject(expected)
    expect(err.message).not.toMatch(/SECRET/)
  })

  it('executeJavaScript 가 reject 하면 kind:"network" reason:"execute-failed" (메시지 미전파)', async () => {
    const v = { webContents: { executeJavaScript: vi.fn(async () => { throw new Error('Script failed /Users/alice') }) } }
    let err
    try { await callFlowRpc(v, 'nzlxg', []) } catch (e) { err = e }
    expect(err).toMatchObject({ kind: 'network', status: 0, reason: 'execute-failed' })
    expect(err.message).not.toContain('alice')
  })
})
