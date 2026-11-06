import { FLOW_PAGE_INJECTION } from './flow-page-injection.js'
import { FLOW_SETTINGS_DUMPER } from './flow-settings-dumper.js'

// RPC capture is still required for UUID/response ownership on the current asb gallery.
// The unused legacy wrapper (including request mutation) is never installed by default.
export function flowPagePolicy(env = {}) {
  const rpcCapture = env.AUTOFLOWCUT_FLOW_RPC_CAPTURE !== '0'
  return {
    legacyMutation: rpcCapture && env.AUTOFLOWCUT_FLOW_LEGACY_MUTATION === '1',
    rpcCapture,
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

const LEGACY_DOM = new Set(['flow:dom-execute', 'flow:dom-send-prompt', 'flow:dom-click-enter-tool',
  'flow:dump-settings', 'flow:apply-agent-defaults', 'flow:list-agent-models', 'flow:get-recaptcha-token'])
const CAPTURE_REQUIRED = new Set(['flow:generate-image', 'flow:generate-video-t2v', 'flow:generate-video-i2v',
  'flow:generate-character', 'flow:reroll-character', 'flow:generate-scene', 'flow:upload-reference',
  'flow:upload-character-entity', 'flow:register-character-entity', 'flow:rename-character',
  'flow:upscale-image', 'flow:upscale-video', 'flow:dom-download-video'])

// Generic DOM/debug IPC cannot bypass the default-off legacy policy.
export function createFlowPagePolicyIPC(ipcMain, policy) {
  const proxy = Object.create(ipcMain)
  proxy.handle = (channel, handler) => ipcMain.handle(channel, (...args) => {
    if (LEGACY_DOM.has(channel) && !policy.legacyMutation) {
      return { success: false, errorKind: 'flow-legacy-mutation-disabled', error: 'flow-legacy-mutation-disabled', retryBlocked: true }
    }
    if (CAPTURE_REQUIRED.has(channel) && !policy.rpcCapture) {
      return { success: false, errorKind: 'flow-dom-capture-unsupported', error: 'flow-dom-capture-unsupported', retryBlocked: true }
    }
    return handler(...args)
  })
  return proxy
}
