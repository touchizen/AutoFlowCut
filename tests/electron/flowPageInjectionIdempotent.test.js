import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import { FLOW_PAGE_INJECTION } from '../../electron/flow-page-injection.js'
import { FLOW_RPC_CAPTURE_INJECTION } from '../../electron/flow-rpc-capture.js'

// main 은 did-finish-load + did-navigate-in-page 마다 동일 스크립트를 같은 페이지(글로벌)
// 컨텍스트에서 executeJavaScript 로 재실행한다. top-level 어휘선언(const/let)이 IIFE 가드 밖에
// 있으면 2회차 실행이 redeclaration SyntaxError 로 가드 도달 전에 터진다. node:vm 의
// runInContext 도 동일 컨텍스트에 top-level 어휘선언을 영속시키므로 이 동작을 충실히 재현한다.
function makeContext() {
  const win = { fetch: function fetch() {} }
  return vm.createContext({
    window: win,
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0,
    Date,
  })
}

describe('FLOW_PAGE_INJECTION idempotency', () => {
  it('같은 컨텍스트에서 2회 실행해도 redeclaration 으로 throw 하지 않는다', () => {
    const ctx = makeContext()
    expect(() => vm.runInContext(FLOW_PAGE_INJECTION, ctx)).not.toThrow()
    expect(() => vm.runInContext(FLOW_PAGE_INJECTION, ctx)).not.toThrow()
  })

  it('재주입 후에도 fetch 패치 가드 플래그가 유지된다', () => {
    const ctx = makeContext()
    vm.runInContext(FLOW_PAGE_INJECTION, ctx)
    vm.runInContext(FLOW_PAGE_INJECTION, ctx)
    expect(ctx.window.__autoflowcut_fetch_patched__).toBe(true)
  })
})

// M1-3: batchexecute 캡처 주입도 세 자리(did-navigate-in-page/dom-ready/did-finish-load)에서 같은 문서에
// 재실행된다 — 같은 규칙.
describe('FLOW_RPC_CAPTURE_INJECTION idempotency', () => {
  function makeXhrContext() {
    class XHR { open() {} send() {} addEventListener() {} }
    const win = { XMLHttpRequest: XHR, location: { href: 'https://flow.google.com/project/x' } }
    return vm.createContext({ window: win, console: { log() {}, warn() {}, error() {} }, Date, URL, URLSearchParams, JSON, String, Object })
  }

  it('같은 컨텍스트에서 2회 실행해도 redeclaration 으로 throw 하지 않는다', () => {
    const ctx = makeXhrContext()
    expect(() => vm.runInContext(FLOW_RPC_CAPTURE_INJECTION, ctx)).not.toThrow()
    expect(() => vm.runInContext(FLOW_RPC_CAPTURE_INJECTION, ctx)).not.toThrow()
  })

  it('재주입 후에도 설치 플래그와 문서 nonce 가 유지된다', () => {
    const ctx = makeXhrContext()
    vm.runInContext(FLOW_RPC_CAPTURE_INJECTION, ctx)
    const doc = ctx.window.__autoflowcut_rpc_doc__
    expect(doc).toMatch(/^[0-9a-f]{32}$/)
    vm.runInContext(FLOW_RPC_CAPTURE_INJECTION, ctx)
    expect(ctx.window.__autoflowcut_rpc_capture__).toBe(true)
    expect(ctx.window.__autoflowcut_rpc_doc__).toBe(doc)
  })
})
