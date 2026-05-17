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

function setupHook({ references, flowOverrides = {}, statefulRefs = false }) {
  // statefulRefs: setReferences가 실제로 상태를 갱신하도록 — hook을 재렌더해서
  //   referencesRef.current 가 React 경로로도 최신화되는지 (또는 동기 미러가
  //   필요한지) 검증할 때 사용.
  let setReferences = vi.fn()
  let rerenderRef = { current: null }
  let liveRefs = references

  const submitOrder = []
  const submitCalls = []
  const flowAPI = {
    getAccessToken: vi.fn().mockResolvedValue('token'),
    clearTokenCache: vi.fn(),
    submitGenerationDOM: vi.fn(async (prompt, styleRefImages) => {
      submitOrder.push(prompt)
      submitCalls.push({ prompt, styleRefImages })
      return { success: true, generationId: `g-${submitOrder.length}` }
    }),
    // generations complete immediately so both phases drain fast
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'img', mediaId: 'm' }] }),
    uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'm', caption: '' }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    ...flowOverrides
  }

  if (statefulRefs) {
    setReferences = vi.fn((updater) => {
      liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
      rerenderRef.current?.()
    })
  }

  const { result, rerender } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'project', imageBatchCount: 1 },
    references: liveRefs,
    setReferences,
    flowAPI,
    addPendingSave: vi.fn(),
    openSettings: vi.fn(),
    t: (k) => k,
    generationQueue: null
  }))
  rerenderRef.current = () => rerender()

  return { result, flowAPI, submitOrder, submitCalls }
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

  it('non-style phase submits the character ref WITH the fresh style card mediaId', async () => {
    // P2 회귀: _processAndSaveImage가 mediaId를 setReferences로만 써서,
    //   같은 batch flow의 non-style phase가 React 재렌더 전 stale한
    //   referencesRef.current를 읽으면 style 카드의 mediaId 없이 제출됨.
    const { result, submitCalls } = setupHook({
      statefulRefs: true,
      references: [
        { id: 1, type: 'style', prompt: 'a style', status: 'pending' },
        { id: 2, type: 'character', prompt: 'a hero', status: 'pending' }
      ],
      flowOverrides: {
        // style 카드 업로드가 알려진 mediaId 산출
        uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'style-media-xyz', caption: '' })
      }
    })

    await runBatch(result)

    // 첫 제출 = style phase (style 카드 자체), 둘째 = non-style phase (character)
    expect(submitCalls.length).toBe(2)
    const charSubmit = submitCalls.find(c => c.prompt.includes('a hero'))
    expect(charSubmit).toBeTruthy()
    // 2번째 인자(styleRefImages)에 방금 만든 style 카드의 mediaId가 실려야 함
    expect(Array.isArray(charSubmit.styleRefImages)).toBe(true)
    expect(charSubmit.styleRefImages.some(img => img.mediaId === 'style-media-xyz')).toBe(true)
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
