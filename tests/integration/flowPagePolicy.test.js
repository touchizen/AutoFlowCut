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
  it('routes capture-free image/video through the passive native collector, with invalid input gates before UI work', () => {
    const angular = read('electron/ipc/flow-angular.js')
    expect(angular).toContain('deps.isRpcCaptureEnabled?.() === false) return generatePassiveImage(payload, onSubmission, beforeSubmit)')
    expect(angular).toContain("return generatePassiveImage(payload, onSubmission, null, i2v ? 'i2v' : withRefs ? 'r2v' : 't2v')")
    expect(angular).toContain("if (!payload.resolution) return kindResult('flow-settings-not-applied', { reason: 'resolution-missing' })")
  })
})

it('capture-free mode still rejects invalid video inputs before touching Flow UI', async () => {
  const { createFlowAngular } = await import('../../electron/ipc/flow-angular.js')
  let touched = false
  const angular = createFlowAngular({
    isRpcCaptureEnabled: () => false,
    getFlowView: () => { touched = true; throw new Error('must not touch page') },
    pendingGenerations: new Map(),
  })
  expect(await angular.generateVideoT2V({ prompt: 'p' })).toMatchObject({
    success: false, errorKind: 'flow-settings-not-applied', reason: 'resolution-missing',
  })
  expect(await angular.generateVideoI2V({ prompt: 'p' })).toMatchObject({
    success: false, errorKind: 'flow-i2v-start-frame-missing',
  })
  expect(touched).toBe(false)
})
