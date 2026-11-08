import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFlowEngine } from '../../src/engine/engineFlow'
import { useGenerationQueue } from '../../src/hooks/useGenerationQueue'
import { useFlowEvents } from '../../src/hooks/useFlowEvents'
import { __resetFlowSafetyForTests, receiveFlowSafetyStop } from '../../src/utils/flowSafetyStop'
import { toast } from '../../src/components/Toast'
import { I18nProvider } from '../../src/hooks/useI18n'
import { createFlowSafetyIPC } from '../../electron/flow-safety-ipc'

const stop = { success: false, errorKind: 'flow-unusual-activity', error: 'flow-unusual-activity', safetyStop: true, retryBlocked: true }
beforeEach(() => { __resetFlowSafetyForTests(); vi.restoreAllMocks() })
describe('Flow renderer stop integration', () => {
  it('receives main stop, blocks image and video retry IPC, and preserves reads', async () => {
    let mainStatus
    Object.assign(window.electronAPI, {
      onFlowStatus: fn => { mainStatus = fn; return () => {} },
      flowGenerateImage: vi.fn(), flowGenerateVideoT2V: vi.fn(), flowCheckGeneration: vi.fn(async () => ({ success: true })),
    })
    const { result } = renderHook(() => useFlowEngine())
    act(() => mainStatus({ safetyStop: stop }))
    expect(await result.current.generateImage('p')).toMatchObject({ retryBlocked: true })
    expect(await result.current.submitGeneration('p')).toMatchObject({ retryBlocked: true })
    expect(await result.current.generateVideoT2V('p')).toMatchObject({ retryBlocked: true })
    expect(window.electronAPI.flowGenerateImage).not.toHaveBeenCalled()
    expect(window.electronAPI.flowGenerateVideoT2V).not.toHaveBeenCalled()
    await result.current.checkGeneration('existing')
    expect(window.electronAPI.flowCheckGeneration).toHaveBeenCalled()
    act(() => result.current.setStopRequested(false))
    expect(await result.current.generateImage('p')).toMatchObject({ retryBlocked: true })
  })
  it('forwards user cancellation to the non-generating main guard', async () => {
    window.electronAPI.flowCancelPending = vi.fn(async () => ({ success: true, aborted: 1 }))
    const { result } = renderHook(() => useFlowEngine())
    expect(await result.current.cancelGeneration('scope')).toEqual({ success: true, aborted: 1 })
    expect(window.electronAPI.flowCancelPending).toHaveBeenCalledOnce()
    delete window.electronAPI.flowCancelPending
  })
  it('clears pending Flow queue entries while preserving API work', async () => {
    const { result } = renderHook(() => useGenerationQueue())
    let finish
    const busy = new Promise(resolve => { finish = resolve })
    let pendingFlow
    const flowExecute = vi.fn()
    const apiExecute = vi.fn(async () => 'api')
    let apiDone
    act(() => {
      result.current.enqueue({ mode: 'api', type: 'busy', execute: () => busy })
      pendingFlow = result.current.enqueue({ mode: 'flow', type: 'scene_batch', execute: flowExecute }).catch(e => e)
      apiDone = result.current.enqueue({ mode: 'api', type: 'scene_batch', execute: apiExecute })
    })
    act(() => { receiveFlowSafetyStop(stop) })
    expect(await pendingFlow).toMatchObject({ alreadySurfaced: true })
    await act(async () => { finish('done'); await apiDone })
    expect(flowExecute).not.toHaveBeenCalled()
    expect(apiExecute).toHaveBeenCalledOnce()
    const retry = await result.current.enqueue({ mode: 'flow', type: 'retry', execute: vi.fn() }).catch(e => e)
    expect(retry).toMatchObject({ retryBlocked: true, alreadySurfaced: false })
  })
  it('notifies the user once with a translated persistent warning', () => {
    const warn = vi.spyOn(toast, 'warning')
    renderHook(() => useFlowEvents({ mode: 'flow', onLoginExpired: vi.fn() }), { wrapper: I18nProvider })
    act(() => { receiveFlowSafetyStop(stop); receiveFlowSafetyStop(stop) })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toMatch(/unusual activity|비정상적인 활동/i)
    expect(warn.mock.calls[0][1]).toBe(0)
  })
  it('runs the serialized isolated detector through the IPC gate for split warnings and nested prompts', async () => {
    const handlers = new Map()
    const wc = {
      getURL: () => 'https://flow.google.com/project/p', isDestroyed: () => false,
      executeJavaScriptInIsolatedWorld: async (_world, scripts) => window.eval(scripts[0].code),
    }
    const h = createFlowSafetyIPC({ handle: (channel, handler) => handlers.set(channel, handler) }, {
      getFlowView: () => ({ webContents: wc }), config: { minIntervalMs: 1000, jitterMs: 0, rpcErrorLimit: 3 },
    })
    // Keep the view identity stable, as Electron does.
    const view = { webContents: wc }
    const stable = createFlowSafetyIPC({ handle: (channel, handler) => handlers.set(channel, handler) }, {
      getFlowView: () => view, config: { minIntervalMs: 1000, jitterMs: 0, rpcErrorLimit: 3 },
    })
    const submit = vi.fn(async () => ({ success: true, submitted: true }))
    stable.ipcMain.handle('flow:generate-image', submit)
    document.body.innerHTML = '<div><p>비정상적인 활동이 감지되었습니다.</p><p>페이지를 수정하는 브라우저 확장 프로그램으로 인해 문제가 발생할 수 있습니다.</p></div>'
    expect(await handlers.get('flow:generate-image')({}, {})).toMatchObject({ retryBlocked: true })
    expect(submit).not.toHaveBeenCalled()
    document.body.innerHTML = '<div role="dialog"><div contenteditable="true">비정상적인 활동이 감지되었습니다. 브라우저 확장 프로그램</div></div>'
    expect(await h.probe()).toBe(null)
  })

})
