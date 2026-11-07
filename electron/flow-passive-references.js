import { snapshotClipboard, writeUploadImage, restoreClipboard } from './flow-clipboard.js'
import { composerStateJs, READ_CHIP_SNAPSHOT_JS } from './flow-composer-refs.js'
import { clearComposer, insertMention, attachAsset } from './flow-reference-driver.js'
import { normalizePrompt } from './flow-rpc-protocol.js'
import { findPromptEditor } from './flow-composer-dom.js'
import { createMediaTokenRegistry } from './flow-media-tokens.js'

const EDITOR = `(${findPromptEditor.toString()})(document)`
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const fail = reason => { throw new Error(reason) }

async function pasteReference(ctx, ref) {
  const { deps, wc, read, guard, lease, project, tokens } = ctx
  const state = () => read(composerStateJs(tokens.map))
  const before = await state()
  if (!before?.activeInEditor) fail('reference-editor-not-active')
  if (before.pickerOpen || !Array.isArray(before.chips) || before.chips.some(c => c.busy || !c.mediaId)) fail('reference-chips-not-ready')
  const old = before.chips.map(c => c.mediaId)
  const base = await read(READ_CHIP_SNAPSHOT_JS)
  if (base?.chips?.length !== old.length) fail('reference-chips')
  const img = deps.nativeImage.createFromBuffer(ref.bytes)
  if (img.isEmpty()) fail('reference-decode')
  const pixels = img.toBitmap(), size = img.getSize()
  const collector = await deps.startResponseCapture(wc.session, { signal: lease.signal })
  let up, saved, written, restoreTimer
  const restore = () => { if (written) { restoreClipboard(deps.clipboard, saved, written); written = null } }
  try {
    guard()
    const now = await state()
    if (!wc.isFocused()) fail('reference-window-not-focused')
    if (!now?.activeInEditor || now.pickerOpen) fail('reference-editor-changed')
    saved = snapshotClipboard(deps.clipboard)
    if (saved.fileCopy) fail('clipboard-busy')
    collector.assertReady()
    // Chromium encodes pasted images as PNG, including when the source was JPEG.
    // Compare decoded pixels; encoder metadata/compression need not match.
    up = lease.armUpload(bytes => {
      const other = deps.nativeImage.createFromBuffer(bytes)
      const dim = other.getSize()
      return !other.isEmpty() && dim.width === size.width && dim.height === size.height && pixels.equals(other.toBitmap())
    })
    written = writeUploadImage(deps.clipboard, img)
    guard()
    wc.paste()
    restoreTimer = setTimeout(restore, 5000)
    const until = Date.now() + 60000
    while (!up.state().complete) {
      guard(); collector.assertReady()
      if (up.state().id != null) restore()
      if (Date.now() > until) fail('reference-upload-timeout')
      await pause(100)
    }
    restore()
    const { mediaId } = await collector.finish(up.state().url, { rpcid: 'maseQ', projectId: project })
    const ready = Date.now() + 15000
    while (Date.now() < ready) {
      const st = await state()
      if (st?.chips?.length === old.length + 1 && !st.pickerOpen && st.chips.every(c => !c.busy)
          && old.every(id => st.chips.some(c => c.mediaId === id))) {
        if (st.chips.some(c => c.mediaId === mediaId) && !old.includes(mediaId)) return mediaId
        const snap = await read(READ_CHIP_SNAPSHOT_JS)
        if (snap?.chips?.length === old.length + 1 && !snap.chips.some(c => c.busy)) {
          const left = snap.chips.map(c => c.token)
          for (const c of base.chips) { const i = left.indexOf(c.token); if (i < 0) fail('reference-chips'); left.splice(i, 1) }
          if (left.length === 1 && left[0] && tokens.adopt(mediaId, left[0]) !== 'ok') fail('reference-token-conflict')
        }
      }
      await pause(100)
    }
    fail('reference-chip-missing')
  } finally {
    clearTimeout(restoreTimer); restore(); up?.release()
    await collector.cancel()
  }
}

// All page reads in ctx are isolated; input/clipboard actions are native.
// Map only images pasted and proven during this composition.
export async function prepareNativeReferences(ctx, pre, plan) {
  const { wc, read, guard, aborted, deps } = ctx
  const tokens = createMediaTokenRegistry()
  const click = (js, opts) => deps.trustedClickOnFlowView(js, { ...opts, beforeDispatch: async () => { guard(); return !aborted() } })
  const focus = async () => {
    guard(); wc.focus()
    if (!(await click(EDITOR, { required: true, step: 'refs-caret' }))?.success) fail('reference-caret-click')
    const until = Date.now() + 1200
    while (!(await read(composerStateJs(tokens.map)))?.activeInEditor && Date.now() < until) await pause(50)
  }
  let firstInput = true
  const append = async text => {
    guard()
    // The clear/picker action transfers focus. Refocus the empty editor once;
    // subsequent segments use the native caret left by typing/choosing a mention.
    if (firstInput || !(await read(composerStateJs(tokens.map)))?.activeInEditor) await focus()
    firstInput = false
    const before = await read(composerStateJs(tokens.map))
    guard()
    if (!wc.isFocused() || !before?.activeInEditor || before.pickerOpen) fail('reference-append-focus')
    await wc.insertText(text)
    const end = Date.now() + 1500
    // ProseMirror inserts a separator after a mention. The final structured
    // gate compares all text and ID segments; don't mistake that space for a lost insert.
    const matches = st => [before.editorText + text, before.editorText + ' ' + text]
      .some(v => normalizePrompt(st?.editorText) === normalizePrompt(v))
    do {
      const st = await read(composerStateJs(tokens.map))
      if (matches(st)) return { ok: true }
      await pause(50)
    } while (Date.now() < end)
    return { ok: false, reason: text === '@' ? 'reference-at-not-inserted' : 'reference-segment-not-inserted' }
  }
  const driver = { exec: read, trustedClick: click, mediaTokens: tokens.map, tokenEpoch: tokens.epoch,
    isAborted: aborted, append, escape: () => {
      guard(); for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'Escape' })
    } }
  const ensure = r => { if (!r?.ok) fail(r?.reason || 'reference-compose') }
  const byHash = new Map()
  ensure(await clearComposer(driver))
  for (const ref of pre.refs) {
    if (byHash.has(ref.sha)) continue
    await focus()
    byHash.set(ref.sha, await pasteReference({ ...ctx, tokens }, ref))
  }
  const id = index => byHash.get(pre.refs[index].sha)
  const refs = [...byHash.values()]
  const inline = plan.segments.some(s => s.t === 'mention')
  if (inline) ensure(await clearComposer(driver))
  const mentions = []
  // Attached-only references stay in the material strip. The caller uses the
  // same full-prompt replace/readback as a plain image after the paste settles.
  for (const s of inline ? plan.segments : []) {
    if (s.t === 'text') { if (s.text) ensure(await append(s.text)) }
    else { mentions.push(id(s.ref)); ensure(await insertMention(driver, id(s.ref), s.ref)) }
  }
  if (inline) for (const i of new Set(plan.attach)) {
    if (!mentions.includes(id(i))) ensure(await attachAsset(driver, id(i), i))
  }
  return { tokens: tokens.map, refs, mentions, text: normalizePrompt(plan.segments.filter(s => s.t === 'text').map(s => s.text)) }
}
