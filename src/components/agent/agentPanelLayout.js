export const AGENT_PANEL_MODES = Object.freeze(['floating', 'docked'])
export const DEFAULT_AGENT_DOCK_WIDTH = 400
export const MIN_AGENT_DOCK_WIDTH = 280
export const MAX_AGENT_DOCK_WIDTH = 720
export const MAX_AGENT_DOCK_RATIO = 0.6
export const MIN_AGENT_DOCK_CONTAINER_WIDTH = 600
export const MIN_AGENT_DOCK_CONTAINER_HEIGHT = 420

const clamp = (value, max) => Math.min(Math.max(value, 0), Math.max(max, 0))

export function clampAgentDockWidth(desiredPx, containerWidthPx) {
  const desired = typeof desiredPx === 'number' && Number.isFinite(desiredPx)
    ? desiredPx
    : DEFAULT_AGENT_DOCK_WIDTH
  const containerWidth = typeof containerWidthPx === 'number' && Number.isFinite(containerWidthPx)
    ? Math.max(0, containerWidthPx)
    : Number.POSITIVE_INFINITY
  const maxWidth = Math.max(
    MIN_AGENT_DOCK_WIDTH,
    Math.min(MAX_AGENT_DOCK_WIDTH, containerWidth * MAX_AGENT_DOCK_RATIO),
  )
  return Math.min(maxWidth, Math.max(MIN_AGENT_DOCK_WIDTH, desired))
}

export function normalizeAgentPanelMode(value) {
  if (value === 'slide') return 'docked'
  return AGENT_PANEL_MODES.includes(value) ? value : 'floating'
}

export function effectiveAgentPanelMode(_appMode, storedMode) {
  return normalizeAgentPanelMode(storedMode)
}

export function canDockInContainer(containerSize) {
  const width = containerSize?.width
  const height = containerSize?.height
  return Number.isFinite(width)
    && Number.isFinite(height)
    && width >= MIN_AGENT_DOCK_CONTAINER_WIDTH
    && height >= MIN_AGENT_DOCK_CONTAINER_HEIGHT
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
