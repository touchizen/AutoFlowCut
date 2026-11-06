// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { flowPagePolicy, installLegacyFlowHooks, shouldExposeFlowBridge } from '../../electron/flow-page-policy.js'

describe('Flow page mutation policy', () => {
  it('keeps required RPC capture but disables unused legacy mutation by default', () => {
    expect(flowPagePolicy({})).toEqual({ legacyMutation: false, rpcCapture: true })
    expect(flowPagePolicy({ AUTOFLOWCUT_FLOW_LEGACY_MUTATION: 'true' }).legacyMutation).toBe(false)
    expect(flowPagePolicy({ AUTOFLOWCUT_FLOW_LEGACY_MUTATION: '1' }).legacyMutation).toBe(true)
    expect(flowPagePolicy({ AUTOFLOWCUT_FLOW_RPC_CAPTURE: '0' }).rpcCapture).toBe(false)
    expect(flowPagePolicy({ AUTOFLOWCUT_FLOW_RPC_CAPTURE: '0', AUTOFLOWCUT_FLOW_LEGACY_MUTATION: '1' })).toEqual({ legacyMutation: false, rpcCapture: false })
  })
  it('does not execute any legacy page script without an explicit flag', async () => {
    const wc = { executeJavaScript: vi.fn() }
    await installLegacyFlowHooks(wc, {})
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })
  it('installs legacy mutation only for explicit compatibility use', async () => {
    const wc = { executeJavaScript: vi.fn().mockResolvedValue(undefined) }
    await installLegacyFlowHooks(wc, { AUTOFLOWCUT_FLOW_LEGACY_MUTATION: '1' })
    const scripts = wc.executeJavaScript.mock.calls.map(([s]) => s)
    expect(scripts).toHaveLength(2)
    expect(scripts[0]).toContain('window.fetch =')
    expect(scripts[1]).toContain('window.__autoflowcut_dump_settings__ =')
  })
  it('exposes the preload bridge only when main explicitly enabled capture or compatibility', () => {
    expect(shouldExposeFlowBridge([])).toBe(false)
    expect(shouldExposeFlowBridge(['--autoflowcut-flow-rpc-capture'])).toBe(true)
    expect(shouldExposeFlowBridge(['--autoflowcut-flow-legacy-mutation'])).toBe(true)
  })
})

describe('legacy DOM IPC policy', () => {
  it('blocks arbitrary page execution and legacy synthetic input by default', async () => {
    const { createFlowPagePolicyIPC } = await import('../../electron/flow-page-policy.js')
    const handlers = new Map()
    const proxy = createFlowPagePolicyIPC({ handle: (name, fn) => handlers.set(name, fn) }, flowPagePolicy({}))
    const handler = vi.fn(async () => ({ success: true }))
    for (const name of ['flow:dom-execute', 'flow:dom-send-prompt', 'flow:dom-click-enter-tool', 'flow:dump-settings', 'flow:apply-agent-defaults', 'flow:list-agent-models', 'flow:get-recaptcha-token']) {
      proxy.handle(name, handler)
      expect(await handlers.get(name)({}, {})).toMatchObject({ success: false, errorKind: 'flow-legacy-mutation-disabled' })
    }
    expect(handler).not.toHaveBeenCalled()
  })
  it('capture-free mode blocks all submission and reference mutation entrypoints', async () => {
    const { createFlowPagePolicyIPC } = await import('../../electron/flow-page-policy.js')
    const handlers = new Map()
    const proxy = createFlowPagePolicyIPC({ handle: (name, fn) => handlers.set(name, fn) }, flowPagePolicy({ AUTOFLOWCUT_FLOW_RPC_CAPTURE: '0' }))
    const handler = vi.fn(async () => ({ success: true }))
    for (const name of ['flow:generate-image', 'flow:generate-character', 'flow:generate-video-i2v', 'flow:generate-scene', 'flow:upload-reference', 'flow:upload-character-entity', 'flow:rename-character']) {
      proxy.handle(name, handler)
      expect(await handlers.get(name)({}, {})).toMatchObject({ success: false, errorKind: 'flow-dom-capture-unsupported' })
    }
    expect(handler).not.toHaveBeenCalled()
  })
  it('allows ordinary status reads and explicitly requested legacy compatibility', async () => {
    const { createFlowPagePolicyIPC } = await import('../../electron/flow-page-policy.js')
    const handlers = new Map()
    const proxy = createFlowPagePolicyIPC({ handle: (name, fn) => handlers.set(name, fn) }, flowPagePolicy({ AUTOFLOWCUT_FLOW_LEGACY_MUTATION: '1' }))
    const handler = vi.fn(async () => ({ success: true }))
    proxy.handle('flow:dom-execute', handler)
    expect(await handlers.get('flow:dom-execute')({}, {})).toEqual({ success: true })
    expect(handler).toHaveBeenCalledOnce()
  })
})
