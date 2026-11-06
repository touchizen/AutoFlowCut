// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8')

describe('runtime Flow hook policy wiring', () => {
  it('gates all bootstrap legacy wrappers and setters in main', () => {
    const main = read('electron/main.js')
    expect(main).toContain('installLegacyFlowHooks(view.webContents, process.env)')
    expect(main).not.toMatch(/executeJavaScript\(FLOW_PAGE_INJECTION\)/)
    expect(main).not.toMatch(/executeJavaScript\(FLOW_SETTINGS_DUMPER\)/)
    expect(main).toContain('if (!FLOW_PAGE_POLICY.rpcCapture) return')
    expect(main).toContain('if (!FLOW_PAGE_POLICY.legacyMutation) return')
    expect(main).toContain('isRpcCaptureEnabled: () => FLOW_PAGE_POLICY.rpcCapture')
  })
  it('does not expose a main world bridge in a capture-free view', () => {
    const main = read('electron/main.js')
    const preload = read('electron/flow-preload.js')
    expect(main).toContain("'--autoflowcut-flow-rpc-capture'")
    expect(preload).toMatch(/if \(shouldExposeFlowBridge\(process.argv\)\)/)
  })
  it('refuses disabled RPC capture before an angular generation can mutate the page', () => {
    const angular = read('electron/ipc/flow-angular.js')
    expect(angular).toContain('deps.isRpcCaptureEnabled?.() === false')
    expect(angular).toContain('flow-dom-capture-unsupported')
  })
})

it('disabled capture refuses actual image/video handlers without page reads, edits or submit', async () => {
  const { createFlowAngular } = await import('../../electron/ipc/flow-angular.js')
  let touched = false
  const angular = createFlowAngular({
    isRpcCaptureEnabled: () => false,
    getFlowView: () => { touched = true; throw new Error('must not touch page') },
    pendingGenerations: new Map(),
  })
  for (const action of ['generateImage', 'generateVideoT2V', 'generateVideoI2V']) {
    expect(await angular[action]({ prompt: 'p' })).toMatchObject({
      success: false, errorKind: 'flow-dom-capture-unsupported', retryBlocked: true,
    })
  }
  expect(touched).toBe(false)
})
