export const AGENT_PANEL_MODES = Object.freeze(['floating', 'slide'])

const clamp = (value, max) => Math.min(Math.max(value, 0), Math.max(max, 0))

export function normalizeAgentPanelMode(value) {
  return AGENT_PANEL_MODES.includes(value) ? value : 'floating'
}

export function effectiveAgentPanelMode(appMode, storedMode) {
  return appMode === 'flow' ? 'floating' : normalizeAgentPanelMode(storedMode)
}

export function clampAgentPanelPosition({
  clientX,
  clientY,
  offsetX,
  offsetY,
  containerRect,
  panelRect,
}) {
  return {
    left: clamp(clientX - containerRect.left - offsetX, containerRect.width - panelRect.width),
    top: clamp(clientY - containerRect.top - offsetY, containerRect.height - panelRect.height),
  }
}

export function reclampAgentPanelPosition({ position, containerRect, panelRect }) {
  if (!position) return null
  return {
    left: clamp(position.left, containerRect.width - panelRect.width),
    top: clamp(position.top, containerRect.height - panelRect.height),
  }
}

export function floatingPanelBox({ width, height }) {
  return {
    width: Math.min(420, Math.max(0, width - 36)),
    maxHeight: Math.min(640, Math.max(0, height - 36)),
  }
}
