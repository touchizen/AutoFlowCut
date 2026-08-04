import { describe, expect, it } from 'vitest'
import { createCancelRegistry } from '../../../../electron/api/providers/cancelRegistry.js'

describe('createCancelRegistry', () => {
  it.each([undefined, null, '', 7, {}, []])('scope %j는 엔트리 없이 no-op 등록/취소한다', (scope) => {
    const registry = createCancelRegistry()

    const registration = registry.register(scope)

    expect(registration.signal).toBeUndefined()
    expect(typeof registration.release).toBe('function')
    expect(() => registration.release()).not.toThrow()
    expect(registry.cancel(scope)).toEqual({ aborted: 0 })
    expect(registry.isCancelled(scope)).toBe(false)
  })

  it('같은 scope의 모든 controller를 취소하고 cancel 뒤 release도 멱등이다', () => {
    const registry = createCancelRegistry()
    const first = registry.register('run:one')
    const second = registry.register('run:one')

    expect(first.signal.aborted).toBe(false)
    expect(second.signal.aborted).toBe(false)
    expect(registry.cancel('run:one')).toEqual({ aborted: 2 })
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(registry.isCancelled('run:one')).toBe(true)
    expect(() => {
      first.release()
      first.release()
      second.release()
      second.release()
    }).not.toThrow()
    expect(registry.cancel('run:one')).toEqual({ aborted: 0 })
  })

  it('release는 해당 controller만 지우고 마지막 release에서 빈 bucket을 삭제한다', () => {
    const registry = createCancelRegistry()
    const first = registry.register('run:release')
    const second = registry.register('run:release')

    first.release()
    first.release()
    expect(registry.cancel('run:release')).toEqual({ aborted: 1 })
    expect(first.signal.aborted).toBe(false)
    expect(second.signal.aborted).toBe(true)

    const only = registry.register('run:empty')
    only.release()
    only.release()
    expect(registry.cancel('run:empty')).toEqual({ aborted: 0 })
    expect(only.signal.aborted).toBe(false)
  })

  it('이미 취소된 scope 등록은 bucket 없이 즉시 aborted signal을 반환한다', () => {
    const registry = createCancelRegistry()
    registry.cancel('run:late')

    const late = registry.register('run:late')

    expect(late.signal.aborted).toBe(true)
    expect(() => {
      late.release()
      late.release()
    }).not.toThrow()
    expect(registry.cancel('run:late')).toEqual({ aborted: 0 })
  })

  it('cancelled tombstone을 설정된 상한의 FIFO로 축출한다', () => {
    const registry = createCancelRegistry({ maxCancelledScopes: 2 })

    registry.cancel('run:a')
    registry.cancel('run:b')
    registry.cancel('run:c')

    expect(registry.isCancelled('run:a')).toBe(false)
    expect(registry.isCancelled('run:b')).toBe(true)
    expect(registry.isCancelled('run:c')).toBe(true)
    const reusedEvictedScope = registry.register('run:a')
    expect(reusedEvictedScope.signal.aborted).toBe(false)
    reusedEvictedScope.release()
  })
})
