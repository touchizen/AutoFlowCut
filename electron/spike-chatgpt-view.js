// chatgpt.com 용 standalone WebContentsView. makeFlowView 에서 생성/console-forward 만
// 선별 복사하고 Flow 전용 결합(webSecurity:false·flow-preload·labs.google·flow-status·
// projectId·webRequest·landing 자동클릭 등)은 복사하지 않는다(스펙 §3-A forbid).
export const CHATGPT_URL = 'https://chatgpt.com'
export const CHATGPT_ORIGIN = 'https://chatgpt.com'

export function isAliveAndOnOrigin(view) {
  if (!view || view.webContents.isDestroyed()) return false
  try {
    return new URL(view.webContents.getURL() || 'about:blank').origin === CHATGPT_ORIGIN
  } catch {
    return false
  }
}

// idempotent: 살아있고 chatgpt.com origin이면 재사용(재-loadURL 금지 — D/T/F 상태 소실 방지).
// 아니면(없음/파괴/blank/off-origin) 새로 만든다. makeView는 attach 전 loadURL(CHATGPT_URL)까지 수행.
export function ensureChatgptView(state, deps) {
  const { makeView, isAliveAndOnOrigin: alive = isAliveAndOnOrigin } = deps
  if (alive(state.view)) return state.view
  state.view = makeView()
  return state.view
}

export function ensureVisibleAndFocused(view, mainWindow, _deps = {}) {
  mainWindow.contentView.addChildView(view)
  const wb = mainWindow.getBounds()
  view.setBounds({ x: 0, y: 0, width: wb.width, height: wb.height })
  mainWindow.focus()
  view.webContents.focus()
}
