/**
 * Reserved (P1: ChatGPT) session view security policy.
 *
 * The reserved view is an empty shell in P1 — no URL load, no ChatGPT selectors,
 * no navigation/automation code. It exists only so the route/layout plumbing has
 * something concrete to attach. It must never receive the Flow preload or any
 * Flow security exception (contextIsolation/sandbox/webSecurity stay locked down,
 * no `preload` key at all).
 *
 * Navigation is allowed only to the measured-minimum origin set (chatgpt.com +
 * auth.openai.com) and is compared by parsed origin, never by substring match.
 * window-open is always denied — never handed to the external browser. Every
 * permission request/check is denied.
 */

export const RESERVED_SESSION_PARTITION = 'persist:chatgpt'
export const RESERVED_ALLOWED_ORIGINS = Object.freeze([
  'https://chatgpt.com',
  'https://auth.openai.com',
])

export function reservedSessionWebPreferences() {
  return {
    partition: RESERVED_SESSION_PARTITION,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
  }
}

export function isReservedNavigationAllowed(rawUrl) {
  try { return RESERVED_ALLOWED_ORIGINS.includes(new URL(rawUrl).origin) } catch { return false }
}

export function installReservedSessionSecurity(view, electronSession) {
  const guardNavigation = (event, url) => { if (!isReservedNavigationAllowed(url)) event.preventDefault() }
  const guardFrameNavigation = (details) => {
    if (isReservedNavigationAllowed(details.url)) return
    details.preventDefault()
    let origin = '<invalid-origin>'
    try { origin = new URL(details.url).origin } catch { /* Never log the unparsed URL. */ }
    console.warn('[ReservedSession] Blocked frame navigation', { origin })
  }
  view.webContents.on('will-navigate', guardNavigation)
  view.webContents.on('will-redirect', guardNavigation)
  view.webContents.on('will-frame-navigate', guardFrameNavigation)
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  electronSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  electronSession.setPermissionCheckHandler(() => false)
}
