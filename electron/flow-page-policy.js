import { FLOW_PAGE_INJECTION } from './flow-page-injection.js'
import { FLOW_SETTINGS_DUMPER } from './flow-settings-dumper.js'

// RPC capture is still required for UUID/response ownership on the current asb gallery.
// The unused legacy wrapper (including request mutation) is never installed by default.
export function flowPagePolicy(env = {}) {
  return {
    legacyMutation: env.AUTOFLOWCUT_FLOW_LEGACY_MUTATION === '1',
    rpcCapture: env.AUTOFLOWCUT_FLOW_RPC_CAPTURE !== '0',
  }
}

export function shouldExposeFlowBridge(argv) {
  return argv.includes('--autoflowcut-flow-rpc-capture') || argv.includes('--autoflowcut-flow-legacy-mutation')
}

export async function installLegacyFlowHooks(webContents, env) {
  if (!flowPagePolicy(env).legacyMutation) return
  await webContents.executeJavaScript(FLOW_PAGE_INJECTION)
  await webContents.executeJavaScript(FLOW_SETTINGS_DUMPER)
}
