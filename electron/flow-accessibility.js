// All reads are OS accessibility reads; input goes to this Electron view only.
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isFlowDetectionText } from './flow-safety.js'
const run = promisify(execFile)
const projectURL = /^https:\/\/flow\.google\.com\/project\/[0-9a-f-]{36}\/?$/
export function* walkAX(node) {
  if (!node || typeof node.role !== 'string' || !Array.isArray(node.children))
    throw new Error('flow-accessibility-invalid')
  yield node
  for (const child of node.children) yield* walkAX(child)
}
export function hasAccessibleWarning(root) {
  // An editable prompt can quote the warning. Ignore all its descendants.
  function visit(node) {
    if (/^(TextArea|TextField|Edit)$/.test(node.role)) return ''
    const own = [...new Set([node.name, node.description, node.value].filter(Boolean))].join(' ')
    const children = node.children.map(visit).filter(Boolean).join(' ')
    // Test the accessible name and rendered text separately: combining the
    // name and value of every leaf can duplicate words in a split notice.
    if ([own, children].some(isFlowDetectionText)) throw warning
    return (children || own).slice(0, 2400)
  }
  const warning = new Error()
  try {
    visit(root)
    return false
  } catch (e) {
    if (e === warning) return true
    throw e
  }
}
export function blockFlowPageScripts(wc) {
  for (const key of ['executeJavaScript', 'executeJavaScriptInIsolatedWorld']) {
    Object.defineProperty(wc, key, {
      value: async () => {
        throw new Error('flow-page-script-disabled')
      },
    })
  }
}
export function createFlowAccessibility(directory, onWarning, physicalBounds) {
  async function helper(action, arg, extra = []) {
    const mac = process.platform === 'darwin'
    if (!mac && process.platform !== 'win32') throw new Error('flow-accessibility-platform')
    const args = [action, String(process.pid), arg, ...extra]
    const exe = mac
      ? path.join(directory, 'ax')
      : path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    try {
      return (
        await run(
          exe,
          mac
            ? args
            : [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                path.join(directory, 'uia.ps1'),
                ...args,
              ],
          { timeout: 15000, maxBuffer: 6e6, windowsHide: true },
        )
      ).stdout
    } catch (e) {
      throw new Error(
        mac && e.code === 2
          ? 'flow-accessibility-permission-required'
          : 'flow-accessibility-' + action + '-unavailable' + (Number.isInteger(e.code) ? '-' + e.code : ''),
      )
    }
  }
  const pending = new WeakMap()
  async function snapshot(wc, { home = false } = {}) {
    const url = wc.getURL()
    if (!projectURL.test(url) && !(home && /^https:\/\/flow\.google\.com\/?$/.test(url)))
      throw new Error('flow-project-not-open')
    let entry = pending.get(wc)
    if (entry?.url !== url) {
      const promise = helper(
        'snapshot',
        url.replace(/\/$/, ''),
        process.platform === 'win32' && physicalBounds ? [physicalBounds(wc)] : [],
      ).then((raw) => {
        const root = JSON.parse(raw)
        if (root.role !== 'WebArea' || wc.isDestroyed() || wc.getURL() !== url)
          throw new Error('flow-document-changed')
        if (hasAccessibleWarning(root)) {
          onWarning?.()
          throw new Error('flow-unusual-activity')
        }
        return root
      })
      entry = { url, promise }
      pending.set(wc, entry)
      promise
        .finally(() => {
          if (pending.get(wc) === entry) pending.delete(wc)
        })
        .catch(() => {})
    }
    return entry.promise
  }
  async function click(
    view,
    choose,
    { beforeDispatch, onDispatched, dispatchGuard, validateSnapshot, home = false } = {},
  ) {
    const wc = view.webContents,
      url = wc.getURL()
    if (beforeDispatch && !(await beforeDispatch())) return { success: false }
    const root = await snapshot(wc, { home }),
      node = choose(root)
    if (!node?.enabled || !node.rect || !root.rect || (validateSnapshot && !validateSnapshot(root)))
      throw new Error('flow-control-unavailable')
    const [l, t, w, h] = node.rect,
      [x, y, rw, rh] = root.rect,
      { width, height } = view.getBounds()
    const cx = ((l + w / 2 - x) * width) / rw,
      cy = ((t + h / 2 - y) * height) / rh
    if (!(w > 0 && h > 0 && cx >= 0 && cy >= 0 && cx < width && cy < height))
      throw new Error('flow-control-offscreen')
    // No await between this document/ownership check and the view-targeted input.
    // The native input shield prevents another window's mouse from reaching this view.
    dispatchGuard?.()
    if (wc.isDestroyed() || wc.getURL() !== url) throw new Error('flow-document-changed')
    const point = { x: Math.floor(cx), y: Math.floor(cy) }
    wc.sendInputEvent({ type: 'mouseMove', ...point })
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    try {
      onDispatched?.()
    } finally {
      wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    }
    return { success: true }
  }
  return { snapshot, click, openFile: (filename) => helper('open', filename) }
}
