import { findPromptEditor, readEditorText } from './flow-composer-dom.js'
import { normalizePrompt } from './flow-rpc-protocol.js'

export const NATIVE_INPUT_WORLD = 997
const EDITOR_STATE = `(function () {
  const editor = (${findPromptEditor.toString()})(document);
  return { focused: !!editor && (document.activeElement === editor || editor.contains(document.activeElement)),
    text: (${readEditorText.toString()})(document) };
})()`

// Page scripts only READ DOM in an isolated world. Input uses Chromium's native
// editing/input methods; no value setter, execCommand or dispatched DOM event.
export async function typeFlowText(webContents, text, { append = false, isAborted = () => false } = {}) {
  const initialUrl = webContents.getURL?.()
  const alive = () => webContents.getURL?.() === initialUrl && !isAborted() && !webContents.isDestroyed() && webContents.isFocused()
  const read = async () => {
    let timer
    try {
      const value = await Promise.race([
        webContents.executeJavaScriptInIsolatedWorld(NATIVE_INPUT_WORLD, [{ code: EDITOR_STATE }]),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 2000) }),
      ])
      return Array.isArray(value) ? value[0] : value
    } finally { clearTimeout(timer) }
  }
  const fail = reason => ({ ok: false, reason })
  try {
    if (!alive()) return fail('input-aborted')
    const before = await read()
    if (!alive() || !before?.focused) return fail('editor-not-focused')
    const value = String(text ?? '')
    if (!append) webContents.selectAll()
    if (!alive()) return fail('input-aborted')
    // char events never press Enter or an accelerator. Non-ASCII and multiline
    // text use the native IME commit path, which preserves Unicode verbatim.
    if (/^[\x20-\x7e]+$/.test(value)) {
      for (const keyCode of value) {
        if (!alive()) return fail('input-aborted')
        webContents.sendInputEvent({ type: 'char', keyCode })
      }
    } else {
      await webContents.insertText(value)
    }
    if (!alive()) return fail('input-aborted')
    const after = await read()
    if (!alive() || !after?.focused) return fail('editor-not-focused')
    const actual = normalizePrompt(after.text || '')
    const expected = append ? normalizePrompt(String(before.text || '') + value) : normalizePrompt(value)
    const matches = actual === expected
    return matches ? { ok: true } : fail('text-mismatch')
  } catch (_) { return fail('native-input-failed') }
}
