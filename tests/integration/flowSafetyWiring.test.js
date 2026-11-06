// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
const main = fs.readFileSync(new URL('../../electron/main.js', import.meta.url), 'utf8')

describe('main safety and page policy composition', () => {
  it('protects all four Flow IPC modules with the same main-process gate', () => {
    expect(main).toContain('const flowSafety = createFlowSafetyIPC(ipcMain,')
    expect(main).toContain('createFlowPagePolicyIPC(flowSafety.ipcMain, FLOW_PAGE_POLICY)')
    for (const module of ['FlowAPI', 'Video', 'Character', 'Dom']) {
      expect(main).toContain(`register${module}IPC(flowPolicyIPC, flowAPIDeps)`)
    }
  })
  it('preserves submitted jobs and protects submit dispatch when a warning arrives during DOM setup', () => {
    expect(main).not.toContain('settleGen(gen, { error: result.error, errorKind: result.errorKind })')
    expect(main).toContain('isFlowSafetyBlocked: () => !!flowSafety.safety.blocked() || flowSafety.isCurrentCancelled()')
    expect(main).toContain('trustedClickOnFlowView: createGuardedFlowClick(')
  })
  it('selects native settings for the application generation path by default', () => {
    expect(main).toContain('nativeFlowSettings: !FLOW_PAGE_POLICY.legacyMutation')
    const angular = fs.readFileSync(new URL('../../electron/ipc/flow-angular.js', import.meta.url), 'utf8')
    expect(angular.match(/nativeInput: deps.nativeFlowSettings/g)).toHaveLength(2)
  })
})
