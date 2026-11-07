// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../electron/flow-clipboard.js', () => ({
  snapshotClipboard: vi.fn(() => ({ fileCopy: false, text: 'prior' })),
  writeUploadImage: vi.fn(() => ({ image: true })),
  restoreClipboard: vi.fn(),
}))
vi.mock('../../electron/flow-composer-refs.js', () => ({
  composerStateJs: () => 'COMPOSER_STATE',
  READ_CHIP_SNAPSHOT_JS: 'CHIP_SNAPSHOT',
}))
vi.mock('../../electron/flow-composer-dom.js', () => ({ findPromptEditor: () => 'PROMPT_EDITOR' }))
vi.mock('../../electron/flow-reference-driver.js', () => ({
  clearComposer: vi.fn(async () => ({ ok: true })),
  insertMention: vi.fn(async () => ({ ok: true })),
  attachAsset: vi.fn(async () => ({ ok: true })),
  scanUploadedAssets: vi.fn(async (_ctx, { wantIds = [] } = {}) => ({ ok: true, ids: wantIds, tab: 'upload', reopened: 0 })),
}))

import { prepareNativeReferences } from '../../electron/flow-passive-references.js'
import { attachAsset, clearComposer, insertMention, scanUploadedAssets } from '../../electron/flow-reference-driver.js'
import { refMediaCache } from '../../electron/flow-ref-media-cache.js'
import { restoreClipboard, snapshotClipboard, writeUploadImage } from '../../electron/flow-clipboard.js'

const SOURCE = Buffer.from('source-image-bytes')
const PNG = Buffer.from('clipboard-png-bytes')
const SOURCE_PIXELS = Buffer.from([1, 2, 3, 4, 5, 6])
const NEW_MEDIA = '00000099-0000-4000-8000-000000000099'
const FRESH_MEDIA = '00000099-0000-4000-8000-000000000100'

function harness({ mismatch = null, mediaIds = [NEW_MEDIA, FRESH_MEDIA] } = {}) {
  let uploaded = false
  let uploadAttempted = false
  let editorText = ''
  let currentMediaId = mediaIds[0]
  let uploadIndex = 0
  let verifyPixels
  const collector = {
    assertReady: vi.fn(() => { if (uploadAttempted && !uploaded) throw new Error('upload-pixels-unproven') }),
    finish: vi.fn(async () => {
      currentMediaId = mediaIds[uploadIndex++] || FRESH_MEDIA
      return { mediaId: currentMediaId }
    }),
    cancel: vi.fn(async () => {}),
  }
  const lease = {
    signal: new AbortController().signal,
    armUpload: vi.fn(verify => {
      verifyPixels = verify
      return {
        state: () => ({ complete: uploaded, id: uploaded ? 31 : null, url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=maseQ' }),
        release: vi.fn(),
      }
    }),
  }
  const wc = Object.assign(new EventEmitter(), {
    session: {}, isFocused: () => true, focus: vi.fn(), sendInputEvent: vi.fn(),
    insertText: vi.fn(text => { editorText += text }),
    paste: vi.fn(() => { uploadAttempted = true; uploaded = verifyPixels(PNG) }),
  })
  const deps = {
    nativeImage: { createFromBuffer: vi.fn(bytes => {
      const original = Buffer.from(bytes).equals(SOURCE)
      const pixels = original ? SOURCE_PIXELS : mismatch === 'pixels' ? Buffer.from([9, 9, 9, 9, 9, 9]) : SOURCE_PIXELS
      const size = original || mismatch !== 'dimensions' ? { width: 2, height: 1 } : { width: 3, height: 1 }
      return { isEmpty: () => false, getSize: () => size, toBitmap: () => pixels }
    }) },
    clipboard: {},
    startResponseCapture: vi.fn(async () => collector),
    trustedClickOnFlowView: vi.fn(async () => ({ success: true })),
    typeFlowText: vi.fn(async () => ({ ok: true })),
  }
  const states = () => ({ activeInEditor: true, pickerOpen: false, editorText,
    chips: uploaded
      ? [{ mediaId: 'old-media', busy: false }, { mediaId: currentMediaId, busy: false }]
      : [{ mediaId: 'old-media', busy: false }] })
  const read = vi.fn(async script => script === 'CHIP_SNAPSHOT'
    ? { chips: [{ token: 'old-token' }] }
    : states())
  const ctx = { deps, wc, read, guard: vi.fn(), aborted: () => false, lease, project: 'project-1' }
  const pre = { projectId: 'project-1', refs: [{ bytes: SOURCE, sha: 'a'.repeat(64) }] }
  const plan = { segments: [{ t: 'text', text: 'a styled scene' }], attach: [0] }
  return { ctx, pre, plan, collector, lease, deps, wc, read,
    resetComposer: () => { uploaded = false; uploadAttempted = false; editorText = '' } }
}

describe('passive native reference image upload pixel ownership', () => {
  it('proves pasted pixels and returns only the maseQ-owned media ID into the material strip', async () => {
    vi.clearAllMocks()
    const h = harness()
    await expect(prepareNativeReferences(h.ctx, h.pre, h.plan)).resolves.toEqual({
      tokens: expect.any(Object), refs: [NEW_MEDIA], mentions: [], text: 'a styled scene',
    })
    expect(h.lease.armUpload).toHaveBeenCalledOnce()
    expect(h.collector.finish).toHaveBeenCalledWith(expect.stringContaining('rpcids=maseQ'), { rpcid: 'maseQ', projectId: 'project-1' })
    expect(h.deps.startResponseCapture).toHaveBeenCalledOnce()
    expect(h.wc.paste).toHaveBeenCalledOnce()
    expect(attachAsset).not.toHaveBeenCalled()
    expect(clearComposer).toHaveBeenCalledOnce()
    expect(snapshotClipboard).toHaveBeenCalledOnce()
    expect(writeUploadImage).toHaveBeenCalledOnce()
    expect(restoreClipboard).toHaveBeenCalledOnce()
    expect(h.collector.cancel).toHaveBeenCalledOnce()
  })

  it.each(['pixels', 'dimensions'])('rejects a pasted image with mismatched %s before accepting upload ownership', async mismatch => {
    vi.clearAllMocks()
    const h = harness({ mismatch })
    await expect(prepareNativeReferences(h.ctx, h.pre, h.plan)).rejects.toThrow('upload-pixels-unproven')
    expect(h.collector.finish).not.toHaveBeenCalled()
    expect(attachAsset).not.toHaveBeenCalled()
    expect(h.collector.cancel).toHaveBeenCalledOnce()
  })
})

describe('passive references reuse only proven same-document uploads', () => {
  const styled = { segments: [{ t: 'text', text: 'green notebook, cup palette style' }], attach: [0] }
  const inline = { segments: [{ t: 'text', text: 'green notebook ' }, { t: 'mention', ref: 0 }], attach: [] }

  it('same WebContents, document and project: scans Upload, reuses the unique cached ID for one @ and never pastes twice', async () => {
    vi.clearAllMocks()
    refMediaCache.clear()
    const h = harness()
    scanUploadedAssets.mockImplementation(async (_ctx, { wantIds = [] } = {}) => ({
      ok: true, ids: wantIds.length ? [NEW_MEDIA] : [], tab: 'upload', reopened: 0,
    }))

    const first = await prepareNativeReferences(h.ctx, h.pre, styled)
    h.resetComposer()
    const second = await prepareNativeReferences(h.ctx, h.pre, inline)

    expect(first.refs).toEqual([NEW_MEDIA])
    expect(second).toMatchObject({ refs: [NEW_MEDIA], mentions: [NEW_MEDIA] })
    expect(h.wc.paste).toHaveBeenCalledOnce()
    expect(h.collector.finish).toHaveBeenCalledOnce()
    expect(h.deps.startResponseCapture).toHaveBeenCalledOnce()
    expect(scanUploadedAssets).toHaveBeenLastCalledWith(expect.anything(), { wantIds: [NEW_MEDIA] })
    expect(insertMention).toHaveBeenCalledOnce()
    expect(insertMention).toHaveBeenCalledWith(expect.anything(), NEW_MEDIA, 0)
  })

  it.each([
    ['another WebContents', 'new-wc'],
    ['another project', 'new-project'],
    ['a newly navigated document', 'new-document'],
    ['an Upload list missing the cached ID', 'missing'],
    ['an Upload list with duplicate IDs', 'duplicate'],
  ])('%s requires a newly pixel-proven paste', async (_label, cause) => {
    vi.clearAllMocks()
    refMediaCache.clear()
    const h = harness()
    scanUploadedAssets.mockImplementation(async (_ctx, { wantIds = [] } = {}) => ({
      ok: true,
      ids: cause === 'missing' ? [] : cause === 'duplicate' ? [NEW_MEDIA, NEW_MEDIA] : wantIds,
      tab: 'upload', reopened: 0,
    }))
    await prepareNativeReferences(h.ctx, h.pre, styled)
    h.resetComposer()

    let next = h
    if (cause === 'new-wc') next = harness({ mediaIds: [FRESH_MEDIA] })
    if (cause === 'new-project') next.ctx.project = 'project-2'
    if (cause === 'new-document') h.wc.emit('did-navigate')

    const result = await prepareNativeReferences(next.ctx, next.pre, inline)
    expect(result.mentions).toEqual([FRESH_MEDIA])
    if (next === h) expect(h.wc.paste).toHaveBeenCalledTimes(2)
    else {
      expect(h.wc.paste).toHaveBeenCalledOnce()
      expect(next.wc.paste).toHaveBeenCalledOnce()
    }
    if (next === h) expect(h.collector.finish).toHaveBeenCalledTimes(2)
    else expect(next.collector.finish).toHaveBeenCalledOnce()
  })
})
