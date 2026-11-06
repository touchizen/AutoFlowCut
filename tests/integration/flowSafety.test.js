// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createFlowSafetyIPC } from '../../electron/flow-safety-ipc.js'

function harness(options = {}) {
  const handlers = new Map()
  const send = vi.fn()
  let url = 'https://flow.google.com/project/p'
  const wc = { getURL: () => url, isDestroyed: () => false, executeJavaScriptInIsolatedWorld: vi.fn(async () => false) }
  const view = { webContents: wc }
  let now = 0
  const waits = []
  const h = createFlowSafetyIPC({ handle: (c, fn) => handlers.set(c, fn) }, {
    getFlowView: () => view, getMainWindow: () => ({ webContents: { send } }), getCurrentMode: () => 'flow',
    config: { minIntervalMs: 1000, jitterMs: 100, rpcErrorLimit: 3 },
    clock: () => now, random: () => 0.5, sleep: async ms => { waits.push(ms); now += ms },
    ...options,
  })
  return { ...h, handlers, send, wc, waits, move: () => { url = 'https://flow.google.com/project/other' } }
}

describe('Flow IPC safety integration', () => {
  it('uses isolated read-only probes and never submits through an explicit warning', async () => {
    const h = harness()
    h.wc.executeJavaScriptInIsolatedWorld.mockResolvedValue(true)
    const submit = vi.fn(async () => ({ success: true }))
    h.ipcMain.handle('flow:generate-image', submit)
    const r = await h.handlers.get('flow:generate-image')({}, {})
    expect(r).toMatchObject({ errorKind: 'flow-unusual-activity', retryBlocked: true })
    expect(submit).not.toHaveBeenCalled()
    expect(h.send).toHaveBeenCalledWith('flow-status', { safetyStop: r })
    expect(h.wc.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(998, expect.any(Array), true)
  })
  it('accepts a single-result isolated world response array', async () => {
    const h = harness()
    h.wc.executeJavaScriptInIsolatedWorld.mockResolvedValue([true])
    expect(await h.probe()).toMatchObject({ errorKind: 'flow-unusual-activity' })
  })
  it('spaces concurrent submitters globally and preserves returned generation ids', async () => {
    const h = harness()
    const entered = []
    h.ipcMain.handle('flow:generate-image', async (_, p) => { entered.push(p.id); return { success: true, generationId: p.id, submitted: true } })
    const submit = h.handlers.get('flow:generate-image')
    const [a, b] = await Promise.all([submit({}, { id: 'a' }), submit({}, { id: 'b' })])
    expect([a.generationId, b.generationId]).toEqual(['a', 'b'])
    expect(entered).toEqual(['a', 'b'])
    expect(h.waits.reduce((a, b) => a + b, 0)).toBe(1050)
  })
  it('counts async collect failures and blocks image/video/character retries', async () => {
    const h = harness({ config: { minIntervalMs: 1000, jitterMs: 0, rpcErrorLimit: 2 } })
    h.ipcMain.handle('flow:collect-generation', async () => ({ success: false, errorKind: 'flow-rpc-error', error: 'flow-rpc-error' }))
    const collect = h.handlers.get('flow:collect-generation')
    await collect({}, { generationId: 'a' })
    expect(await collect({}, { generationId: 'b' })).toMatchObject({ errorKind: 'flow-repeated-rpc-errors' })
    for (const channel of ['flow:generate-image', 'flow:generate-video-t2v', 'flow:generate-video-i2v', 'flow:generate-character', 'flow:generate-scene', 'flow:reroll-character']) {
      const submit = vi.fn()
      h.ipcMain.handle(channel, submit)
      expect(await h.handlers.get(channel)({}, {})).toMatchObject({ retryBlocked: true })
      expect(submit).not.toHaveBeenCalled()
    }
  })
  it('blocks compatibility scripts and reference mutations once safety is latched', async () => {
    const h = harness()
    h.safety.stop('flow-unusual-activity')
    for (const channel of ['flow:dom-execute', 'flow:dom-click-enter-tool', 'flow:apply-agent-defaults', 'flow:list-agent-models',
      'flow:get-recaptcha-token', 'flow:upload-reference', 'flow:upload-character-entity', 'flow:rename-character', 'flow:register-character-entity']) {
      const action = vi.fn(async () => ({ success: true }))
      h.ipcMain.handle(channel, action)
      expect(await h.handlers.get(channel)({}, {})).toMatchObject({ retryBlocked: true })
      expect(action).not.toHaveBeenCalled()
    }
  })
  it('read RPC failures do not trip the generation circuit breaker', async () => {
    const h = harness({ config: { minIntervalMs: 1000, jitterMs: 0, rpcErrorLimit: 1 } })
    h.ipcMain.handle('flow:check-video-status', async () => ({ success: false, errorKind: 'flow-rpc-error' }))
    expect(await h.handlers.get('flow:check-video-status')({}, {})).not.toHaveProperty('retryBlocked')
    expect(h.safety.blocked()).toBe(null)
  })
  it('detects a warning while a synchronous submit is still awaiting its response', async () => {
    vi.useFakeTimers()
    try {
      let finish
      let warning = false
      const h = harness({ onStop: () => finish({ success: false, errorKind: 'flow-rpc-error' }) })
      h.wc.executeJavaScriptInIsolatedWorld.mockImplementation(async () => warning)
      h.ipcMain.handle('flow:generate-character', () => new Promise(resolve => { finish = resolve }))
      const waiting = h.handlers.get('flow:generate-character')({}, {})
      await vi.advanceTimersByTimeAsync(0)
      warning = true
      await vi.advanceTimersByTimeAsync(2000)
      expect(await waiting).toMatchObject({ errorKind: 'flow-unusual-activity', retryBlocked: true })
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('completed video status resets the streak but repeated reads of the same video do not', async () => {
    const h = harness({ config: { minIntervalMs: 1000, jitterMs: 0, rpcErrorLimit: 2 } })
    h.ipcMain.handle('flow:collect-generation', async () => ({ success: false, errorKind: 'flow-rpc-error' }))
    h.ipcMain.handle('flow:check-video-status', async () => ({ success: true, statuses: [{ status: 'complete', mediaId: 'video' }] }))
    const collect = h.handlers.get('flow:collect-generation')
    const check = h.handlers.get('flow:check-video-status')
    await collect({}, { generationId: 'one' })
    await check({}, { generationIds: ['video'] })
    expect(await collect({}, { generationId: 'two' })).not.toHaveProperty('retryBlocked')
    await check({}, { generationIds: ['video'] })
    expect(await collect({}, { generationId: 'three' })).toMatchObject({ errorKind: 'flow-repeated-rpc-errors' })
  })
  it('classifies thrown neutral RPC errors as generation failures', async () => {
    const h = harness({ config: { minIntervalMs: 1000, jitterMs: 0, rpcErrorLimit: 1 } })
    h.ipcMain.handle('flow:generate-image', async () => { throw Object.assign(new Error('flow-rpc-error'), { errorKind: 'flow-rpc-error' }) })
    expect(await h.handlers.get('flow:generate-image')({}, {})).toMatchObject({ errorKind: 'flow-repeated-rpc-errors' })
  })
  it('cancels a queued spacing wait through the dedicated non-generating IPC', async () => {
    let h
    let cancel
    h = harness({ sleep: async () => { await cancel({}, {}) } })
    cancel = h.handlers.get('flow:safety-cancel-pending')
    expect(cancel).toBeTypeOf('function')
    const submit = vi.fn(async () => ({ success: true, submitted: true }))
    h.ipcMain.handle('flow:generate-image', submit)
    await h.handlers.get('flow:generate-image')({}, {})
    expect(await h.handlers.get('flow:generate-image')({}, {})).toMatchObject({ aborted: true })
    expect(submit).toHaveBeenCalledOnce()
  })
  it('navigation or clear-generations cancels spacing waits without resetting the latch', async () => {
    let h
    h = harness({ sleep: async () => h.move() })
    const submit = vi.fn(async () => ({ success: true, generationId: 'g', submitted: true }))
    h.ipcMain.handle('flow:generate-image', submit)
    await h.handlers.get('flow:generate-image')({}, {})
    expect(await h.handlers.get('flow:generate-image')({}, {})).toMatchObject({ aborted: true })
    expect(submit).toHaveBeenCalledTimes(1)
    h.safety.stop('flow-unusual-activity')
    h.ipcMain.handle('flow:clear-generations', async () => ({ success: true }))
    await h.handlers.get('flow:clear-generations')({}, {})
    expect(h.safety.blocked()).toMatchObject({ retryBlocked: true })
  })
  it('exposes cancellation to a generation already performing DOM setup, then clears its context', async () => {
    const h = harness()
    let begin
    let finish
    const started = new Promise(resolve => { begin = resolve })
    h.ipcMain.handle('flow:generate-image', async () => {
      begin()
      await new Promise(resolve => { finish = resolve })
      return { success: true, submitted: true }
    })
    const result = h.handlers.get('flow:generate-image')({}, {})
    await started
    try {
      expect(h.isCurrentCancelled).toBeTypeOf('function')
      expect(h.isCurrentCancelled()).toBe(false)
      h.move() // The handler may deliberately open its requested project before composing.
      expect(h.isCurrentCancelled()).toBe(false)
      h.cancelPending()
      expect(h.isCurrentCancelled()).toBe(true)
    } finally { finish(); await result }
    expect(h.isCurrentCancelled()).toBe(false)
  })

})
