// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createTargetRegistry } from '../../../electron/webtargets/index.js'

describe('session target registry', () => {
  it('uses a null-prototype table and own-property lookup', () => {
    const exampleTarget = { createView() {}, createAdapter() {} }
    const registry = createTargetRegistry({ exampleTarget })

    expect(Object.getPrototypeOf(registry.table)).toBe(null)
    expect(registry.has('exampleTarget')).toBe(true)
    expect(registry.has('toString')).toBe(false)
    expect(registry.get('toString')).toBeNull()
  })

  it('delegates view and adapter creation only to an own target definition', () => {
    const exampleTarget = {
      createView: vi.fn((label) => ({ label, kind: 'view' })),
      createAdapter: vi.fn((label) => ({ label, kind: 'adapter' })),
    }
    const registry = createTargetRegistry({ exampleTarget })

    expect(registry.createView('exampleTarget', 'positive-view')).toEqual({
      label: 'positive-view', kind: 'view',
    })
    expect(registry.createAdapter('exampleTarget', 'positive-adapter')).toEqual({
      label: 'positive-adapter', kind: 'adapter',
    })
    expect(exampleTarget.createView).toHaveBeenCalledOnce()
    expect(exampleTarget.createAdapter).toHaveBeenCalledOnce()

    expect(registry.createView('__proto__', 'must-not-run')).toBeNull()
    expect(registry.createAdapter('toString', 'must-not-run')).toBeNull()
    expect(exampleTarget.createView).toHaveBeenCalledOnce()
    expect(exampleTarget.createAdapter).toHaveBeenCalledOnce()
  })
})
