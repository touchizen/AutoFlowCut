// @vitest-environment node
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
}))

import { prepareNativeReferences } from '../../electron/flow-passive-references.js'
import { attachAsset, clearComposer } from '../../electron/flow-reference-driver.js'
import { restoreClipboard, snapshotClipboard, writeUploadImage } from '../../electron/flow-clipboard.js'

const SOURCE = Buffer.from('source-image-bytes')
const PNG = Buffer.from('clipboard-png-bytes')
const SOURCE_PIXELS = Buffer.from([1, 2, 3, 4, 5, 6])
const NEW_MEDIA = '00000099-0000-4000-8000-000000000099'

function harness({ mismatch = null } = {}) {
  let uploaded = false
  let uploadAttempted = false
  let verifyPixels
  const collector = {
    assertReady: vi.fn(() => { if (uploadAttempted && !uploaded) throw new Error('upload-pixels-unproven') }),
    finish: vi.fn(async () => ({ mediaId: NEW_MEDIA })),
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
  const wc = {
    session: {}, isFocused: () => true, focus: vi.fn(), sendInputEvent: vi.fn(),
    paste: vi.fn(() => { uploadAttempted = true; uploaded = verifyPixels(PNG) }),
  }
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
  const states = () => ({ activeInEditor: true, pickerOpen: false,
    chips: uploaded
      ? [{ mediaId: 'old-media', busy: false }, { mediaId: NEW_MEDIA, busy: false }]
      : [{ mediaId: 'old-media', busy: false }] })
  const read = vi.fn(async script => script === 'CHIP_SNAPSHOT'
    ? { chips: [{ token: 'old-token' }] }
    : states())
  const ctx = { deps, wc, read, guard: vi.fn(), aborted: () => false, lease, project: 'project-1' }
  const pre = { projectId: 'project-1', refs: [{ bytes: SOURCE, sha: 'source-sha' }] }
  const plan = { segments: [{ t: 'text', text: 'a styled scene' }], attach: [0] }
  return { ctx, pre, plan, collector, lease, deps, wc, read }
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
