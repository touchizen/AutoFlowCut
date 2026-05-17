/**
 * useReferenceGeneration — batch generation order
 *
 * New behavior: the batch generates style refs FIRST as a complete phase
 * (so their mediaId is set), THEN generates the non-style refs (which pick
 * up the freshly-generated style card). If there are no style refs, the
 * batch behaves as before.
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true })
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' })
  }
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() }
}))

vi.mock('../../src/utils/imageProcessing', () => ({
  tryUpscaleImage: vi.fn(),
  extractThumbnailBase64: vi.fn().mockResolvedValue('thumb')
}))

vi.mock('../../src/utils/urls', () => ({
  cleanBase64: vi.fn(s => s),
  toDataURL: vi.fn(s => s)
}))

import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

function setupHook({ references }) {
  const setReferences = vi.fn()

  const submitOrder = []
  const flowAPI = {
    getAccessToken: vi.fn().mockResolvedValue('token'),
    clearTokenCache: vi.fn(),
    submitGenerationDOM: vi.fn(async (prompt) => {
      submitOrder.push(prompt)
      return { success: true, generationId: `g-${submitOrder.length}` }
    }),
    // generations complete immediately so both phases drain fast
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'img', mediaId: 'm' }] }),
    uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'm', caption: '' }),
    clearGenerations: vi.fn().mockResolvedValue(undefined)
  }

  const { result } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'project', imageBatchCount: 1 },
    references,
    setReferences,
    flowAPI,
    addPendingSave: vi.fn(),
    openSettings: vi.fn(),
    t: (k) => k,
    generationQueue: null
  }))

  return { result, flowAPI, submitOrder }
}

// Drives a batch run to completion, stepping through inter-submit delays and
// drain polls (mirrors batchStop.test.jsx).
async function runBatch(result) {
  vi.useFakeTimers()
  let batchPromise
  await act(async () => {
    batchPromise = result.current.handleGenerateAllRefs()
  })
  // step through inter-submit delays (7-15s) + drain polls (3s) generously
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000)
    })
  }
  await act(async () => {
    await batchPromise
  })
  vi.useRealTimers()
}

describe('useReferenceGeneration — batch order (style first)', () => {
  it('includes style refs in the batch (both style and character submitted)', async () => {
    const { result, flowAPI } = setupHook({
      references: [
        { id: 1, type: 'style', prompt: 'a style', status: 'pending' },
        { id: 2, type: 'character', prompt: 'a hero', status: 'pending' }
      ]
    })

    await runBatch(result)

    expect(flowAPI.submitGenerationDOM).toHaveBeenCalledTimes(2)
  })

  it('submits the style ref before the non-style ref', async () => {
    const { result, submitOrder } = setupHook({
      references: [
        { id: 1, type: 'style', prompt: 'a style', status: 'pending' },
        { id: 2, type: 'character', prompt: 'a hero', status: 'pending' }
      ]
    })

    await runBatch(result)

    const styleIdx = submitOrder.findIndex(p => p.includes('a style'))
    const charIdx = submitOrder.findIndex(p => p.includes('a hero'))
    expect(styleIdx).toBeGreaterThanOrEqual(0)
    expect(charIdx).toBeGreaterThanOrEqual(0)
    expect(styleIdx).toBeLessThan(charIdx)
  })

  it('with no style ref, still generates the non-style refs (behaves as before)', async () => {
    const { result, flowAPI } = setupHook({
      references: [
        { id: 1, type: 'character', prompt: 'a hero', status: 'pending' },
        { id: 2, type: 'character', prompt: 'a villain', status: 'pending' }
      ]
    })

    await runBatch(result)

    expect(flowAPI.submitGenerationDOM.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})
