import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STATE_KEY = '__autoflowcut_generation_cancel_v1__'

async function freshModule({ preserveState = false } = {}) {
  if (!preserveState) delete globalThis[STATE_KEY]
  vi.resetModules()
  return import('../../src/utils/cancelScope.js')
}

describe('cancelScope renderer state', () => {
  beforeEach(() => {
    delete globalThis[STATE_KEY]
  })

  afterEach(() => {
    delete globalThis[STATE_KEY]
  })

  it('같은 name도 session nonce와 증가 counter로 매번 다른 scope를 만든다', async () => {
    const { nextCancelScope } = await freshModule()

    const first = nextCancelScope('refs')
    const second = nextCancelScope('refs')

    expect(first).toMatch(/^refs:.+:1$/)
    expect(second).toMatch(/^refs:.+:2$/)
    expect(first).not.toBe(second)
    expect(first.split(':')[1]).toBe(second.split(':')[1])
  })

  it('HMR/module reset 뒤 versioned global state의 nonce/counter/cancelled entry를 보존한다', async () => {
    const firstModule = await freshModule()
    const firstScope = firstModule.nextCancelScope('scenes')
    const finish = firstModule.beginScopeSend(firstScope)
    firstModule.markScopeCancelled(firstScope)

    const reloadedModule = await freshModule({ preserveState: true })
    const secondScope = reloadedModule.nextCancelScope('scenes')

    expect(secondScope.split(':')[1]).toBe(firstScope.split(':')[1])
    expect(secondScope).toMatch(/:2$/)
    expect(reloadedModule.isScopeCancelled(firstScope)).toBe(true)
    finish()
    expect(reloadedModule.isScopeCancelled(firstScope)).toBe(false)
  })

  it('full renderer realm state가 사라지면 새 session nonce와 counter 1에서 시작한다', async () => {
    const firstModule = await freshModule()
    const firstScope = firstModule.nextCancelScope('styleThumbs')

    const secondModule = await freshModule()
    const secondScope = secondModule.nextCancelScope('styleThumbs')

    expect(secondScope).toMatch(/:1$/)
    expect(secondScope.split(':')[1]).not.toBe(firstScope.split(':')[1])
  })

  it('pending sender가 둘이면 하나를 release해도 tombstone을 유지하고 마지막 release에서 삭제한다', async () => {
    const {
      beginScopeSend,
      isScopeCancelled,
      markScopeCancelled,
      nextCancelScope,
    } = await freshModule()
    const scope = nextCancelScope('refs')
    const finishFirst = beginScopeSend(scope)
    const finishSecond = beginScopeSend(scope)

    markScopeCancelled(scope)
    expect(isScopeCancelled(scope)).toBe(true)
    finishFirst()
    finishFirst()
    expect(isScopeCancelled(scope)).toBe(true)
    finishSecond()
    finishSecond()
    expect(isScopeCancelled(scope)).toBe(false)
    expect(globalThis[STATE_KEY].scopes.size).toBe(0)
  })

  it.each([undefined, null, '', 1, {}, []])('invalid scope %j는 state를 변경하지 않는다', async (scope) => {
    const { beginScopeSend, isScopeCancelled, markScopeCancelled } = await freshModule()
    const beforeSize = globalThis[STATE_KEY].scopes.size
    const finish = beginScopeSend(scope)

    markScopeCancelled(scope)

    expect(isScopeCancelled(scope)).toBe(false)
    expect(globalThis[STATE_KEY].scopes.size).toBe(beforeSize)
    expect(() => {
      finish()
      finish()
    }).not.toThrow()
    expect(globalThis[STATE_KEY].scopes.size).toBe(beforeSize)
  })
})
