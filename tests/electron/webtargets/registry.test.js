// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createTargetRegistry } from '../../../electron/webtargets/index.js'

describe('session target registry', () => {
  it('uses a null-prototype table and own-property lookup', () => {
    const chatgpt = { createView() {}, createAdapter() {} }
    const registry = createTargetRegistry({ chatgpt })

    expect(Object.getPrototypeOf(registry.table)).toBe(null)
    expect(registry.has('chatgpt')).toBe(true)
    expect(registry.has('toString')).toBe(false)
    expect(registry.get('toString')).toBeNull()
  })

  it('delegates view and adapter creation only to an own target definition', () => {
    const chatgpt = {
      createView: vi.fn((label) => ({ label, kind: 'view' })),
      createAdapter: vi.fn((label) => ({ label, kind: 'adapter' })),
    }
    const registry = createTargetRegistry({ chatgpt })

    expect(registry.createView('chatgpt', 'positive-view')).toEqual({
      label: 'positive-view', kind: 'view',
    })
    expect(registry.createAdapter('chatgpt', 'positive-adapter')).toEqual({
      label: 'positive-adapter', kind: 'adapter',
    })
    expect(chatgpt.createView).toHaveBeenCalledOnce()
    expect(chatgpt.createAdapter).toHaveBeenCalledOnce()

    expect(registry.createView('__proto__', 'must-not-run')).toBeNull()
    expect(registry.createAdapter('toString', 'must-not-run')).toBeNull()
    expect(chatgpt.createView).toHaveBeenCalledOnce()
    expect(chatgpt.createAdapter).toHaveBeenCalledOnce()
  })
})
