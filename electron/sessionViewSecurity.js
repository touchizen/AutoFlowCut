/**
 * Reserved session view security policy (target-agnostic foundation).
 *
 * A reserved session view is an empty shell — no URL load, no page selectors, no
 * navigation/automation code. It exists only so the route/layout plumbing has
 * something concrete to attach. It must never receive the Flow preload or any
 * Flow security exception (contextIsolation/sandbox/webSecurity stay locked down,
 * no `preload` key at all).
 *
 * A future session target supplies its own partition and measured-minimum origin
 * set. Navigation is allowed only to those origins and is compared by parsed
 * origin, never by substring match. window-open is always denied — never handed
 * to the external browser. Every permission request/check is denied.
 */

export function reservedSessionWebPreferences(partition) {
  if (typeof partition !== 'string' || !partition) {
    throw new TypeError('reservedSessionWebPreferences requires a partition')
  }
  return {
    partition,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
  }
}

export function isReservedNavigationAllowed(rawUrl, allowedOrigins) {
  if (!Array.isArray(allowedOrigins)) return false
  try { return allowedOrigins.includes(new URL(rawUrl).origin) } catch { return false }
}

// Origin only, never the raw URL — reserved-session URLs carry signed paths/queries.
function toLoggableOrigin(rawUrl) {
  try { return new URL(rawUrl).origin } catch { return '<invalid-origin>' }
}

export function installReservedSessionSecurity(view, electronSession, { allowedOrigins } = {}) {
  if (!Array.isArray(allowedOrigins)) {
    throw new TypeError('installReservedSessionSecurity requires allowedOrigins')
  }
  // Every blocked exit logs — a silently prevented main-frame hop leaves the view blank
  // with zero diagnostics. `kind` distinguishes will-navigate from will-redirect so the
  // sequence of a login/challenge hop is readable in the terminal.
  const guardNavigation = (kind) => (event, url) => {
    if (isReservedNavigationAllowed(url, allowedOrigins)) return
    event.preventDefault()
    console.warn('[ReservedSession] Blocked main-frame navigation', { kind, origin: toLoggableOrigin(url) })
  }
  const guardFrameNavigation = (details) => {
    if (isReservedNavigationAllowed(details.url, allowedOrigins)) return
    details.preventDefault()
    console.warn('[ReservedSession] Blocked frame navigation', { origin: toLoggableOrigin(details.url) })
  }
  view.webContents.on('will-navigate', guardNavigation('will-navigate'))
  view.webContents.on('will-redirect', guardNavigation('will-redirect'))
  view.webContents.on('will-frame-navigate', guardFrameNavigation)
  // A failed load looks identical to a blocked navigation from the outside (blank view) —
  // log it distinctly so the two get different fixes. errorDescription is a Chromium net
  // error name (e.g. ERR_NAME_NOT_RESOLVED), never page/user content.
  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.warn('[ReservedSession] did-fail-load', {
      errorCode, errorDescription, isMainFrame, origin: toLoggableOrigin(validatedURL),
    })
  })
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  electronSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  electronSession.setPermissionCheckHandler(() => false)
}
