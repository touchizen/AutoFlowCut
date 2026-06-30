import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import { FLOW_PAGE_INJECTION } from '../../electron/flow-page-injection.js'

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
