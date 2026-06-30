/**
 * #R27-2: single-reference preflight window must be busy.
 *
 * _executeGenerateRef set generatingRefs only AFTER awaiting folder/ready/auth checks, leaving a
 * window where refBatchRunning (and thus Header disabled/modeBusy) didn't reflect it — a project/mode
 * switch could slip in and a stale generation would patch the current project's ref by reused index.
 * Fix: add the index to generatingRefs BEFORE the preflight awaits; release on every early return.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }) },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/utils/imageProcessing', () => ({
  tryUpscaleImage: vi.fn(), extractThumbnailBase64: vi.fn().mockResolvedValue('thumb'),
}))
vi.mock('../../src/utils/urls', () => ({ cleanBase64: vi.fn((s) => s), toDataURL: vi.fn((s) => s) }))

import * as guards from '../../src/utils/guards'
import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

function makeHook() {
  const refs = [{ id: 1, prompt: 'a portrait', type: 'character', status: 'pending' }]
  const genAPI = {
    getAccessToken: vi.fn().mockResolvedValue('token'),
    generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X', mediaId: 'm' }] }),
    clearTokenCache: vi.fn(),
  }
  const { result } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'memory', imageBatchCount: 1 },
    references: refs, setReferences: vi.fn(), genAPI,
    addPendingSave: vi.fn(), openSettings: vi.fn(), t: (k) => k, generationQueue: null,
  }))
  return { result, genAPI }
}

beforeEach(() => {
  vi.clearAllMocks()
  guards.checkAuthToken.mockResolvedValue(true)
  guards.checkFolderPermission.mockResolvedValue({ ok: true })
  guards.checkFlowProjectReady.mockReturnValue({ ok: true })
})

describe('#R27-2: single-ref preflight is busy', () => {
  it('generatingRefs includes the index while the auth preflight is still pending', async () => {
    let resolveAuth
    guards.checkAuthToken.mockReturnValue(new Promise((r) => { resolveAuth = r }))
    const { result, genAPI } = makeHook()

    let p
    await act(async () => {
      p = result.current.handleGenerateRef(0)
      await new Promise((r) => setTimeout(r, 0))  // flush past folder/ready, park at auth
    })

    expect(result.current.generatingRefs).toContain(0)
    expect(genAPI.generateImage).not.toHaveBeenCalled()

    await act(async () => { resolveAuth(true); await p })
  })

  it('releases generatingRefs when a preflight check fails (no stuck busy)', async () => {
    guards.checkFlowProjectReady.mockReturnValue({ ok: false })
    const { result, genAPI } = makeHook()

    await act(async () => { await result.current.handleGenerateRef(0) })

    expect(result.current.generatingRefs).not.toContain(0)
    expect(genAPI.generateImage).not.toHaveBeenCalled()
  })

  // #R28-4: batch — generatingRefs must already be set DURING the style-ref prepare upload, so
  //   refBatchRunning stays true across the window between preparingRefs=false and submit.
  it('batch sets generatingRefs during the style-ref prepare upload (no busy gap)', async () => {
    let resolveUpload
    const genAPI = {
      getAccessToken: vi.fn().mockResolvedValue('token'),
      mode: 'flow',
      uploadReference: vi.fn().mockReturnValue(new Promise((r) => { resolveUpload = r })),
      submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'g1' }),
      checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: false }),
      clearGenerations: vi.fn().mockResolvedValue(undefined),
    }
    const refs = [
      { id: 1, prompt: 'hero', type: 'character', status: 'pending' },
      { id: 2, prompt: 'noir', type: 'style', data: 'data:image/png;base64,X', mediaId: null, status: 'done' },
    ]
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'memory', imageBatchCount: 1, concurrency: 5 },
      references: refs, setReferences: vi.fn(), genAPI,
      addPendingSave: vi.fn(), openSettings: vi.fn(), t: (k) => k, generationQueue: null,
    }))

    let p
    await act(async () => {
      p = result.current.handleGenerateAllRefs('ref:2')
      await new Promise((r) => setTimeout(r, 0))  // park inside _prepareStyleRefs upload
    })

    // style upload pending → batch busy must already include the target index (index 0)
    expect(genAPI.uploadReference).toHaveBeenCalled()
    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(result.current.generatingRefs).toContain(0)

    await act(async () => {
      resolveUpload({ success: true, mediaId: 'sm' })
      result.current.stopGenerateAllRefs()
      await p
    })
  })
})
