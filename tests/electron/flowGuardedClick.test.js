// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createGuardedFlowClick } from '../../electron/flow-guarded-click.js'

describe('latched Flow submit dispatch guard', () => {
  it('does not start any click after safety stop', async () => {
    const click = vi.fn()
    expect(await createGuardedFlowClick(click, () => true)('selector')).toMatchObject({ success: false })
    expect(click).not.toHaveBeenCalled()
  })
  it('rechecks the latch after the original async editor/chip guard', async () => {
    let blocked = false
    let dispatched = false
    const click = async (_selector, opts) => {
      if (await opts.beforeDispatch()) dispatched = true
      return { success: dispatched }
    }
    const beforeDispatch = async () => { blocked = true; return true }
    const guarded = createGuardedFlowClick(click, () => blocked)
    expect(await guarded('selector', { beforeDispatch })).toMatchObject({ success: false })
    expect(dispatched).toBe(false)
  })
  it('preserves existing false guards and allows healthy clicks', async () => {
    const click = vi.fn(async (_selector, opts) => ({ success: await opts.beforeDispatch() }))
    const guarded = createGuardedFlowClick(click, () => false)
    expect(await guarded('selector', { beforeDispatch: async () => false })).toEqual({ success: false })
    expect(await guarded('selector')).toEqual({ success: true })
  })
})
