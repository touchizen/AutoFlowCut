import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { registeredAsset, thumbnailKey, recordThumbnailKey } from './flow-registered-reference.js'
import { walkAX } from './flow-accessibility.js'
import { normalizePrompt } from './flow-rpc-protocol.js'
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const fail = (reason) => {
  throw new Error(reason)
}
const clean = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
function find(root, roles, test) {
  return [...walkAX(root)].filter((n) => roles.includes(n.role) && test(clean(n.name || n.value), n))
}
function one(root, roles, test, reason) {
  const found = find(root, roles, test)
  if (found.length !== 1) fail(reason)
  return found[0]
}
const buttons = ['Button', 'PopUpButton', 'ToggleButton', 'MenuItem']
export const editorNode = (r) =>
  one(
    r,
    ['TextArea', 'TextField'],
    (s) =>
      /^prompt$|무엇을 만들고|what (?:would you like|do you want) to (?:make|create)|describe what you want/i.test(
        s,
      ),
    'flow-editor-unavailable',
  )
export function assetRow(list, label) {
  // Chromium exposes a Korean option as AXMenuItem(value="file.jpg 이미지 선택되지 않음").
  // Prefer the actionable row over duplicate child text; never use a substring filename match.
  const match = (s) =>
    [label, label + ' 이미지', label + ' image'].some(
      (v) =>
        v.toLowerCase() ===
        s
          .replace(/\s+(?:선택되지 않음|선택 안 ?됨|선택됨|not selected|unselected|selected)$/i, '')
          .toLowerCase(),
    )
  const rows = find(list, ['MenuItem', 'ListItem', 'Option'], match)
  if (rows.length === 1) return rows[0]
  if (rows.length) fail('reference-asset-not-unique')
  return one(list, ['StaticText', 'Text'], match, 'reference-asset-not-unique')
}
export const newProjectNode = (r) =>
  one(
    r,
    ['Button'],
    (s) => /^(?:새 프로젝트|new project|create new project)$/i.test(s),
    'flow-new-project-unavailable',
  )
export const generationNode = (r) =>
  one(
    r,
    buttons,
    (s) => /^(생성 시작|start generation|generate|create)$/i.test(s),
    'flow-generate-button-ambiguous',
  )
const settings = (r) =>
  one(
    r,
    buttons,
    (s) => /^(설정 트리거|settings trigger|generation settings|settings)$/i.test(s),
    'flow-settings-trigger',
  )
const add = (r) =>
  one(
    r,
    buttons,
    (s) => /프롬프트 상자에 소재 추가|add (?:assets?|ingredients?|media) to (?:the )?prompt/i.test(s),
    'reference-add-unavailable',
  )
const picker = (r) =>
  find(r, ['List', 'ListBox'], (s) => /자산 목록|애셋 목록|asset list|assets list|media list/i.test(s))
const agentOff = (r) => {
  const n = one(
    r,
    ['CheckBox', 'ToggleButton', 'Button'],
    (s) => /^(에이전트|agent)$/i.test(s),
    'flow-agent-state-unavailable',
  )
  return n.role === 'Button' ? n.toggleState === false : [0, false].includes(n.selected)
}
const chips = (r) =>
  find(r, buttons, (s) => /^(소재|재료|ingredient|asset|reference)$/i.test(s)).map((n) => {
    const images = find(n, ['Image'], () => true)
    return { ready: images.length === 1 && !n.busy, key: images[0]?.mediaKey || '', node: n }
  })
const modelName = (s) =>
  clean(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}. -]/gu, '')
    .replace(/arrow_drop_down/g, '')
    .trim()
function modelMatches(label, want, video) {
  const actual = modelName(label),
    wanted = modelName(want)
  if (actual === wanted) return true
  if (!video) return false
  let i = 0
  const words = wanted.split(/\s+/)
  for (const word of actual.split(/\s+/)) if (word === words[i]) i++
  return i === words.length
}
const docCache = new WeakMap()
function uploadsFor(wc, url) {
  let old = docCache.get(wc)
  if (!old) {
    old = { url, entries: new Map() }
    docCache.set(wc, old)
    const clear = () => {
      old.url = null
      old.entries.clear()
    }
    for (const event of ['did-navigate', 'did-navigate-in-page', 'render-process-gone', 'destroyed'])
      wc.on(event, clear)
  }
  if (old.url !== url) {
    old.entries.clear()
    old.url = url
  }
  return old.entries
}
function leafText(n) {
  return clean(n.value || n.name)
}
export function matchesAccessiblePlan(root, segments, labels) {
  const editor = editorNode(root)
  const pieces = segments.map((s) => (s.t === 'text' ? s.text : labels[s.ref]))
  if (pieces.some((p) => typeof p !== 'string')) return false
  const quoted = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = segments
    .map((s, i) => quoted(pieces[i]).replace(/\s+/g, '\\s+') + (s.t === 'mention' ? '\\s*' : ''))
    .join('')
  const expected = clean(pieces.join(''))
  if (
    !expected ||
    (clean(editor.value) !== expected &&
      !new RegExp('^' + body + '$').test(String(editor.value || '').trimEnd()))
  )
    return false
  const leaves = [...walkAX(editor)].filter((n) => n.role === 'StaticText' && !n.children.length)
  const mentions = leaves.filter((n) => labels.includes(leafText(n))).map(leafText)
  const expectedMentions = segments.filter((s) => s.t === 'mention').map((s) => labels[s.ref])
  return JSON.stringify(mentions) === JSON.stringify(expectedMentions)
}
export async function accessiblePage(ax, wc) {
  const url = wc.getURL(),
    r = await ax.snapshot(wc)
  if (wc.getURL() !== url) fail('flow-document-changed')
  const hasComposer =
    find(r, ['TextArea', 'TextField'], (n) => /무엇을 만들고|prompt|what .* (?:create|make)/i.test(n))
      .length === 1
  return {
    url,
    hasComposer,
    interactiveCount: find(
      r,
      [...buttons, 'RadioButton', 'TextArea', 'TextField', 'CheckBox', 'Tab', 'Link'],
      () => true,
    ).length,
  }
}
export async function composeAccessible({
  view,
  ax,
  guard,
  pre,
  plan,
  targets,
  lease,
  deps,
  payload,
  project,
  videoKind,
}) {
  const wc = view.webContents
  const read = async () => {
    guard()
    const root = await ax.snapshot(wc)
    guard()
    return root
  }
  const click = async (choose) =>
    ax.click(view, choose, {
      dispatchGuard: guard,
      beforeDispatch: async () => {
        guard()
        return true
      },
    })
  const wait = async (test, reason, ms = 3500) => {
    const end = Date.now() + ms
    do {
      const result = test(await read())
      if (result) return result
      await pause(100)
    } while (Date.now() < end)
    fail(reason)
  }
  const pressEsc = () => {
    guard()
    if (deps.dismissNativePicker) return deps.dismissNativePicker(wc)
    for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'Escape' })
  }
  const initial = await read()
  editorNode(initial)
  if (!agentOff(initial) || picker(initial).length) fail('composer-not-clear')
  const removeButtons = (r) =>
    find(r, buttons, (s) =>
      /remove (?:asset|ingredient|reference)|소재 삭제|소재 제거|참조 이미지 삭제|레퍼런스 삭제/i.test(s),
    )
  if (chips(initial).length || removeButtons(initial).length) fail('composer-not-clear')
  if (videoKind === 'i2v') targets = { ...targets, input: 'frames' }
  if (!find(initial, ['RadioButton'], (s) => /^(이미지|image|동영상|video)$/i.test(s)).length)
    await click(settings)
  const radio = ['RadioButton', 'Tab', 'ToggleButton']
  async function chooseRadio(test, reason, optional = false) {
    const match = (r) => find(r, radio, test)
    const options = match(await read())
    if (!options.length && optional) return
    if (options.length !== 1) fail(reason)
    if (!options[0].selected) {
      await click((r) => one(r, radio, test, reason))
      await wait((r) => match(r).length === 1 && match(r)[0].selected, reason)
    }
  }
  await wait((r) => find(r, radio, () => true).length, 'settings-panel-missing')
  await chooseRadio(
    (s) => (targets.mode === 'image' ? /^(이미지|image)$/i.test(s) : /^(동영상|비디오|video)$/i.test(s)),
    'settings-mode',
  )
  const exactModel = (s) => modelMatches(s, targets.model, targets.mode === 'video')
  if (targets.model) {
    const modelButton = (r) =>
      one(
        r,
        buttons,
        (s) =>
          /모델 제품군 선택|select model family|select model|nano banana|imagen|veo|omni|gemini|나노 바나나/i.test(
            s,
          ),
        'settings-model-trigger',
      )
    const showsModel = (n) => [...walkAX(n)].some((x) => exactModel(x.name || x.value))
    const reflectsModel = (r) => showsModel(settings(r)) || showsModel(modelButton(r))
    if (!reflectsModel(await read())) {
      await click(modelButton)
      const option = (r) =>
        one(
          r,
          ['MenuItem', 'RadioButton', 'ListItem', 'Button', 'MenuItemRadio'],
          (s, n) => exactModel(s) || n.children.some((c) => exactModel(c.name || c.value)),
          'settings-model-not-offered',
        )
      await wait((r) => {
        try {
          return option(r)
        } catch {
          return false
        }
      }, 'settings-model-not-offered')
      await click(option)
      await wait((r) => reflectsModel(r), 'settings-model-not-applied')
    }
  }
  if (targets.ratio) await chooseRadio((s) => s.includes(targets.ratio), 'settings-aspect-ratio')
  await chooseRadio((s) => new RegExp('^[x×]\\s*' + targets.count + '$', 'i').test(s), 'settings-batch-count')
  if (targets.mode === 'video') {
    const fixed = /veo/i.test(targets.model || '')
    await chooseRadio(
      (s) => new RegExp('^' + targets.duration + '\\s*(초|s|sec|seconds)$', 'i').test(s),
      'settings-duration',
      fixed && targets.duration === 8,
    )
    await chooseRadio(
      (s) => s.toLowerCase().replace(/\s*(info|정보)$/, '') === String(targets.resolution).toLowerCase(),
      'settings-resolution',
      fixed && targets.resolution === '720p',
    )
    await chooseRadio(
      (s) =>
        targets.input === 'frames' ? /프레임|frames/i.test(s) : /소재|재료|애셋|ingredients|assets/i.test(s),
      'settings-video-input',
    )
  }
  await click(settings)
  await wait(
    (r) => !find(r, radio, (s) => /^(이미지|image|동영상|video)$/i.test(s)).length,
    'settings-panel-still-open',
  )
  wc.focus()
  await click(editorNode)
  let ed = editorNode(await read())
  if (!ed.focused) fail('reference-editor-not-focused')
  if (clean(ed.value)) {
    guard()
    wc.selectAll()
    wc.delete()
    await wait((r) => !clean(editorNode(r).value), 'editor-not-cleared')
  }
  const labels = [],
    ids = [],
    unique = uploadsFor(wc, wc.getURL()),
    chosen = new Map()
  const { segments, attach } = plan || { segments: [{ t: 'text', text: payload.prompt }], attach: [] }
  const registered = new Map()
  if (pre?.refs.some(ref => ref.mediaId)) {
    let listing
    guard()
    try { listing = await deps.nativeReadRpc(view, 'Zzl0ze', ['projects/' + project, null, null, null, [1]]) }
    catch { fail('reference-registered-list-unavailable') }
    guard()
    for (const ref of pre.refs) if (ref.mediaId)
      registered.set(ref.mediaId, registeredAsset(listing, project, ref.mediaId))
  }
  let dir
  try {
    for (const ref of pre?.refs || []) {
      if (ref.mediaId) {
        labels.push(registered.get(ref.mediaId).label)
        ids.push(ref.mediaId)
        continue
      }
      if (unique.has(ref.sha)) {
        const saved = unique.get(ref.sha)
        labels.push(saved.label)
        ids.push(saved.id)
        continue
      }
      const img = deps.nativeImage.createFromBuffer(ref.bytes)
      if (img.isEmpty()) fail('reference-decode')
      // Keep the user's original JPEG/PNG. Other decodable formats use PNG.
      const ext = ref.bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpg' : 'png'
      const fileBytes =
        ext === 'jpg' || ref.bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
          ? ref.bytes
          : img.toPNG()
      const bitmap = img.toBitmap(),
        size = img.getSize()
      const stem =
        (ref.name || 'Reference')
          .normalize('NFKC')
          .replace(/[^\p{L}\p{N}_-]/gu, '')
          .slice(0, 48) || 'Reference'
      dir ??= await mkdtemp(path.join(os.tmpdir(), 'autoflowcut-reference-'))
      const label = stem + '-' + randomBytes(6).toString('hex') + '.' + ext,
        file = path.join(dir, label)
      await writeFile(file, fileBytes, { mode: 0o600, flag: 'wx' })
      await click(add)
      const upload = (r) =>
        one(
          r,
          buttons,
          (s) => /^(미디어 업로드|upload media|upload image)$/i.test(s),
          'reference-upload-control',
        )
      const collector = await deps.startResponseCapture(wc.session, {
        signal: lease.signal,
        projectId: project,
      })
      let up
      try {
        guard()
        collector.assertReady()
        up = lease.armUpload((bytes) => {
          if (bytes.equals(fileBytes)) return true
          const other = deps.nativeImage.createFromBuffer(bytes),
            dim = other.getSize()
          return (
            !other.isEmpty() &&
            dim.width === size.width &&
            dim.height === size.height &&
            other.toBitmap().equals(bitmap)
          )
        })
        await click(upload)
        // A browser file panel belongs to the app process. Never send a path to the web editor.
        await pause(450)
        guard()
        const preventPageReturn = (event, input) => {
          if (input?.key === 'Enter') event.preventDefault()
        }
        const surfaces = new Set([wc, deps.getMainWindow?.()?.webContents].filter(Boolean))
        for (const surface of surfaces) surface.on('before-input-event', preventPageReturn)
        try {
          await ax.openFile(file)
        } finally {
          for (const surface of surfaces) surface.removeListener('before-input-event', preventPageReturn)
        }
        const until = Date.now() + 60000
        while (!up.state().complete) {
          guard()
          collector.assertReady()
          if (Date.now() > until) fail('reference-upload-timeout')
          await pause(150)
        }
        const { mediaId } = await collector.finish(up.state().url, {
          rpcid: 'maseQ',
          projectId: project,
          filename: up.state().filename,
          expectedFilename: label,
        })
        guard()
        unique.set(ref.sha, { label, id: mediaId })
        labels.push(label)
        ids.push(mediaId)
      } finally {
        up?.release()
        await collector.cancel()
      }
      if (picker(await read()).length) {
        pressEsc()
        await wait((r) => !picker(r).length, 'reference-picker-not-closed')
      }
    }
    const chooseAsset = async (index, inline) => {
      const before = chips(await read())
      if (before.length !== chosen.size || before.some((c) => !c.ready)) fail('reference-chips-changed')
      if (inline) {
        guard()
        await wc.insertText('@')
      } else if (videoKind === 'i2v') {
        await click((r) =>
          one(r, buttons, (s) => /^(시작(?: 프레임)?|start(?: frame)?)$/i.test(s), 'start-frame-unavailable'),
        )
      } else await click(add)
      await wait((r) => picker(r).length === 1, 'reference-picker-missing')
      const target = (r) => {
        const lists = picker(r)
        if (lists.length !== 1) fail('reference-picker-ambiguous')
        return assetRow(lists[0], labels[index])
      }
      const existing = registered.get(ids[index])
      if (existing) {
        // The picker virtualizes older assets. Search only its own named input,
        // never the global header search or the prompt.
        const fields = r => find(r, ['TextField', 'TextArea', 'SearchField', 'Edit'],
          name => /^(?:애셋|에셋|자산|소재) 검색$|^search (?:assets|media)$/i.test(name))
        if (fields(await read()).length) {
          const field = r => {
            const hits = fields(r)
            if (picker(r).length !== 1 || hits.length !== 1) fail('reference-registered-search-unavailable')
            return hits[0]
          }
          await click(field)
          const focused = field(await read())
          if (!focused.focused) fail('reference-registered-search-unavailable')
          guard()
          if (focused.value) wc.selectAll()
          await wc.insertText(existing.label)
          await wait(r => {
            const f = field(r)
            return f.focused && clean(f.value) === clean(existing.label) &&
              (() => { try { return target(r) } catch { return false } })()
          }, 'reference-registered-row-unavailable')
        }
      }
      await click(target)
      if (picker(await read()).length)
        await click((r) =>
          one(r, buttons, (s) => /^(프롬프트에 추가|add to prompt)$/i.test(s), 'reference-add-to-prompt'),
        )
      await wait((r) => !picker(r).length, 'reference-not-inserted')
      const known = chosen.has(ids[index]),
        observed = await wait((r) => {
          const items = chips(r)
          return items.length === chosen.size + (known ? 0 : 1) && items.every((c) => c.ready) && items
        }, 'reference-chip-not-added')
      // The exact picker row is unique to this verified upload. Prefer a thumbnail
      // media UUID when exposed; otherwise bind the one-chip change inside the shield.
      const oldKeys = new Set(before.map((c) => c.key).filter(Boolean))
      const fresh = observed.filter((c) => c.key && !oldKeys.has(c.key))
      if (!known && fresh.length > 1) fail('reference-chips-changed')
      if (fresh[0]?.key.startsWith('media:') && fresh[0].key !== 'media:' + ids[index])
        fail('reference-media-id-mismatch')
      chosen.set(ids[index], known ? chosen.get(ids[index]) : fresh[0]?.key || '')
    }
    wc.focus()
    await click(editorNode)
    const mentions = []
    for (const seg of segments) {
      if (seg.t === 'text') {
        if (seg.text) {
          guard()
          await wc.insertText(seg.text)
        }
      } else {
        await chooseAsset(seg.ref, true)
        mentions.push(ids[seg.ref])
      }
    }
    for (const i of new Set(attach)) if (!mentions.includes(ids[i])) await chooseAsset(i, false)
    // right-click metadata can move focus; verify after the whole prompt is written,
    // and again at the last pre-submit gate. Never infer an opaque chip's ID by position.
    const recordKeys = new Map()
    const verifyRegisteredChips = async r => {
      const items = chips(r)
      const missing = [...registered.values()].filter(a => !items.some(c => c.key === 'media:' + a.id))
      if (!missing.length) return
      const keys = []
      for (let i = 0; i < items.length; i++) {
        if (items[i].key.startsWith('media:')) continue
        if (items[i].key.startsWith('asb:')) { keys.push(items[i].key); continue }
        const image = root => {
          const current = chips(root)
          if (current.length !== items.length || !current[i]?.ready || current[i].key !== items[i].key)
            fail('reference-registered-thumbnail-unavailable')
          return find(current[i].node, ['Image'], () => true)[0]
        }
        guard()
        const url = await ax.imageSource(view, image, guard)
        guard()
        keys.push(thumbnailKey(url))
      }
      for (const asset of missing) {
        let key = 'media:' + asset.id
        if (!keys.includes(key)) {
          if (!keys.some(k => k?.startsWith('asb:'))) fail('reference-registered-thumbnail-unverified')
          if (!recordKeys.has(asset.id)) {
            const rec = await deps.nativeReadRpc(view, 'as29s', [asset.id])
            guard()
            recordKeys.set(asset.id, recordThumbnailKey(rec, asset, project))
          }
          key = recordKeys.get(asset.id)
          if (!key?.startsWith('asb:')) fail('reference-registered-thumbnail-unverified')
        }
        if (keys.filter(k => k === key).length !== 1) fail('reference-registered-thumbnail-unverified')
        keys.splice(keys.indexOf(key), 1)
      }
    }
    const matchesRoot = (r) => {
      const attached = chips(r),
        keys = new Set(attached.map((c) => c.key).filter(Boolean))
      if (attached.some((c) => c.key.startsWith('media:') && !ids.includes(c.key.slice(6)))) return false
      if (
        attached.length !== new Set(ids).size ||
        chosen.size !== attached.length ||
        attached.some((c) => !c.ready) ||
        [...chosen.values()].some((key) => key && !keys.has(key))
      )
        return false
      if (videoKind === 'i2v') {
        // A filled first slot and the empty end-slot trigger must coexist.
        const end = find(r, buttons, (s) => /^(종료|끝|마지막)(?: 프레임)?$|^end(?: frame)?$/i.test(s))
        const start = find(r, buttons, (s) => /^(시작(?: 프레임)?|start(?: frame)?)$/i.test(s))
        if (
          end.length !== 1 ||
          find(end[0], ['Image'], () => true).length ||
          start.some((n) => !find(n, ['Image'], () => true).length)
        )
          return false
      }
      return (
        agentOff(r) &&
        !picker(r).length &&
        matchesAccessiblePlan(r, segments, labels) &&
        generationNode(r).enabled
      )
    }
    return {
      matches: async () => {
        const root = await read()
        if (!matchesRoot(root)) return false
        try { await verifyRegisteredChips(root) }
        catch (e) {
          guard()
          if (e.message === 'flow-unusual-activity') throw e
          fail('reference-registered-thumbnail-unverified')
        }
        return true
      },
      matchesRoot,
      refs: [...new Set(ids)],
      mentions,
      text: normalizePrompt(segments.filter((s) => s.t === 'text').map((s) => s.text)),
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true })
  }
}
