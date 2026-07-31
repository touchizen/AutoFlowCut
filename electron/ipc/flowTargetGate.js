/**
 * P1 target-aware fail-closed gate for Flow remote side effects.
 *
 * When the route is login-mode-but-ChatGPT-target (mode='flow', sessionTarget='chatgpt'),
 * every remote Google-Flow side effect must be refused before the handler body runs and
 * before the Flow view is looked up. Read-only channels and main-local state (e.g.
 * flow:set-startup-project) are intentionally out of scope for P1.
 */

export const FLOW_INACTIVE_RESULT = Object.freeze({
  success: false,
  error: 'Flow inactive (API mode)',
})

export const FLOW_SIDE_EFFECT_CHANNELS = new Set([
  'flow:extract-token', 'flow:get-recaptcha-token', 'flow:apply-agent-defaults',
  'flow:generate-image', 'flow:clear-generations', 'flow:dom-download-video',
  'flow:upload-reference', 'flow:upscale-image',
  'flow:generate-video-t2v', 'flow:generate-video-i2v', 'flow:upscale-video',
  'flow:generate-character', 'flow:reroll-character', 'flow:generate-scene',
  'flow:refresh-composer', 'flow:register-character-entity',
  'flow:rename-character', 'flow:upload-character-entity',
  'flow:dom-navigate', 'flow:compose-navigate-wait', 'flow:open-project',
  'flow:new-project', 'flow:dom-execute', 'flow:dom-click-enter-tool',
  'flow:dom-send-prompt', 'flow:dom-show-flow',
  'flow:report-response', 'flow:set-agent-mode',
  'flow:list-agent-models', 'flow:validate-token',
  'flow:list-projects', 'flow:fetch-gallery',
])

export const FLOW_READ_ONLY_CHANNELS = new Set([
  'flow:check-video-status',
  'flow:extract-project-id',
  'flow:check-generation', 'flow:collect-generation',
  'flow:fetch-media', 'flow:download-video-url',
  'flow:dom-get-url', 'flow:dump-settings',
  'flow:dom-snapshot-blobs', 'flow:dom-scan-images', 'flow:dom-blob-to-base64',
])

export function flowSideEffectAllowed(deps) {
  const mode = deps.getCurrentMode ? deps.getCurrentMode() : 'flow'
  const target = deps.getSessionTarget ? deps.getSessionTarget() : 'flow'
  return mode === 'flow' && target === 'flow'
}

export function guardFlowSideEffect(deps, handler) {
  return (event, ...args) => {
    if (!flowSideEffectAllowed(deps)) return { ...FLOW_INACTIVE_RESULT }
    return handler(event, ...args)
  }
}

export function gateFlowSideEffectIpc(ipcMain, deps) {
  return {
    ...ipcMain,
    handle(channel, handler) {
      return ipcMain.handle(
        channel,
        FLOW_SIDE_EFFECT_CHANNELS.has(channel) ? guardFlowSideEffect(deps, handler) : handler,
      )
    },
  }
}
