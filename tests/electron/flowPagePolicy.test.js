// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { flowPagePolicy, installLegacyFlowHooks, shouldExposeFlowBridge } from '../../electron/flow-page-policy.js'

describe('Flow page mutation policy', () => {
  it('keeps required RPC capture but disables unused legacy mutation by default', () => {
    expect(flowPagePolicy({})).toEqual({ legacyMutation: false, rpcCapture: true })
    expect(flowPagePolicy({ AUTOFLOWCUT_FLOW_LEGACY_MUTATION: 'true' }).legacyMutation).toBe(false)
    expect(flowPagePolicy({ AUTOFLOWCUT_FLOW_LEGACY_MUTATION: '1' }).legacyMutation).toBe(true)
    expect(flowPagePolicy({ AUTOFLOWCUT_FLOW_RPC_CAPTURE: '0' }).rpcCapture).toBe(false)
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
