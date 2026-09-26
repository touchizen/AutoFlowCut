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
import { useGenerationQueue } from '../../src/hooks/useGenerationQueue'
import { toast } from '../../src/components/Toast'

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
  it('single A preflight + single B queued 상태의 Stop은 두 captured run을 취소하고 둘 다 생성 호출 전에 끝낸다', async () => {
    let resolveAuth
    guards.checkAuthToken.mockReturnValueOnce(new Promise(resolve => { resolveAuth = resolve }))
    const refs = [
      { id: 'a', prompt: 'A portrait', type: 'scene', status: 'pending' },
      { id: 'b', prompt: 'B portrait', type: 'scene', status: 'pending' },
    ]
    const genAPI = {
      mode: 'api',
      cancelGeneration: vi.fn().mockResolvedValue({ success: true, aborted: 0 }),
      generateImage: vi.fn(),
    }
    const { result } = renderHook(() => {
      const generationQueue = useGenerationQueue()
      return useReferenceGeneration({
        settings: { saveMode: 'memory', imageBatchCount: 1 },
        references: refs,
        setReferences: vi.fn(),
        genAPI,
        addPendingSave: vi.fn(),
        openSettings: vi.fn(),
        t: key => key,
        generationQueue,
      })
    })

    let first
    let second
    act(() => {
      first = result.current.handleGenerateRef(0)
      second = result.current.handleGenerateRef(1)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(guards.checkAuthToken).toHaveBeenCalledTimes(1)

    act(() => result.current.stopGenerateAllRefs())
    resolveAuth(true)
    let firstResult
    let secondResult
    await act(async () => {
      firstResult = await first
      secondResult = await second
    })

    expect(genAPI.generateImage).not.toHaveBeenCalled()
    expect(genAPI.cancelGeneration).toHaveBeenCalledTimes(2)
    const scopes = genAPI.cancelGeneration.mock.calls.map(([scope]) => scope)
    expect(new Set(scopes).size).toBe(2)
    expect(scopes.every(scope => /^refs:/.test(scope))).toBe(true)
    expect(firstResult).toMatchObject({ success: false, aborted: true, errorKind: 'aborted' })
    expect(secondResult).toMatchObject({ success: false, aborted: true, errorKind: 'aborted' })
    expect(result.current.generatingRefs).toEqual([])
  })

  it('old single의 늦은 finally는 새 single run을 지우지 않아 Stop이 새 scope를 취소한다', async () => {
    const firstResult = { resolve: null, promise: null }
    firstResult.promise = new Promise(resolve => { firstResult.resolve = resolve })
    const secondResult = { resolve: null, promise: null }
    secondResult.promise = new Promise(resolve => { secondResult.resolve = resolve })
    const genAPI = {
      mode: 'api',
      cancelGeneration: vi.fn().mockResolvedValue({ success: true, aborted: 1 }),
      generateImage: vi.fn()
        .mockReturnValueOnce(firstResult.promise)
        .mockReturnValueOnce(secondResult.promise),
    }
    const refs = [
      { id: 'a', prompt: 'A portrait', type: 'scene', status: 'pending' },
      { id: 'b', prompt: 'B portrait', type: 'scene', status: 'pending' },
    ]
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'memory', imageBatchCount: 1 },
      references: refs,
      setReferences: vi.fn(),
      genAPI,
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: key => key,
      generationQueue: null,
    }))

    let first
    let second
    act(() => {
      first = result.current.handleGenerateRef(0)
      second = result.current.handleGenerateRef(1)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    const secondScope = genAPI.generateImage.mock.calls[1][2].cancelScope

    firstResult.resolve({ success: false, error: 'first failed' })
    await act(async () => { await first })
    act(() => result.current.stopGenerateAllRefs())

    expect(genAPI.cancelGeneration).toHaveBeenCalledTimes(1)
    expect(genAPI.cancelGeneration).toHaveBeenCalledWith(secondScope)
    secondResult.resolve({ success: false, error: 'Operation aborted', errorKind: 'aborted', aborted: true })
    await act(async () => { await second })
  })

  it('single direct abort는 generating 전에 캡처한 lifecycle 5필드만 복원한다', async () => {
    let liveRefs = [{
      id: 'done-ref',
      prompt: 'regenerate',
      type: 'scene',
      status: 'done',
      errorMessage: 'old warning',
      errorKind: 'legacy',
      generatingStartedAt: 10,
      generatingEndedAt: 20,
      data: 'paid-old-image',
      styleId: 'preset:old',
    }]
    const setReferences = vi.fn(updater => {
      liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
    })
    const genAPI = {
      mode: 'api',
      cancelGeneration: vi.fn(),
      generateImage: vi.fn().mockResolvedValue({
        success: false,
        error: 'Operation aborted',
        errorKind: 'aborted',
        aborted: true,
      }),
    }
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'memory', imageBatchCount: 1 },
      references: liveRefs,
      setReferences,
      genAPI,
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: key => key,
      generationQueue: null,
    }))

    let generated
    await act(async () => { generated = await result.current.handleGenerateRef(0) })

    expect(generated).toMatchObject({ success: false, aborted: true })
    expect(liveRefs[0]).toMatchObject({
      status: 'done',
      errorMessage: 'old warning',
      errorKind: 'legacy',
      generatingStartedAt: 10,
      generatingEndedAt: 20,
      data: 'paid-old-image',
      styleId: 'preset:old',
    })
    expect(result.current.generatingRefs).toEqual([])
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('양성 대조군: single direct 비-abort 실패는 error 마킹과 toast를 유지한다', async () => {
    let liveRefs = [{ id: 'bad', prompt: 'fail', type: 'scene', status: 'pending' }]
    const setReferences = vi.fn(updater => {
      liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
    })
    const genAPI = {
      mode: 'api',
      cancelGeneration: vi.fn(),
      generateImage: vi.fn().mockResolvedValue({ success: false, error: 'provider failed', errorKind: 'transient' }),
    }
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'memory', imageBatchCount: 1 },
      references: liveRefs,
      setReferences,
      genAPI,
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: key => key,
      generationQueue: null,
    }))

    await act(async () => { await result.current.handleGenerateRef(0) })

    expect(liveRefs[0]).toMatchObject({ status: 'error', errorMessage: 'provider failed', errorKind: 'transient' })
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

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

  it('gate Stop issued during Flow character item auth preflight ends the batch stopped', async () => {
    let resolveItemAuth
    guards.checkAuthToken
      .mockResolvedValueOnce(true) // batch-level auth preflight
      .mockReturnValueOnce(new Promise((resolve) => { resolveItemAuth = resolve }))

    const refs = [{ id: 1, prompt: 'a portrait', type: 'character', status: 'pending' }]
    const genAPI = {
      mode: 'flow',
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      generateImage: vi.fn().mockResolvedValue({ success: false, error: 'after preflight' }),
      clearGenerations: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'memory', imageBatchCount: 1 },
      references: refs, setReferences: vi.fn(), genAPI,
      addPendingSave: vi.fn(), openSettings: vi.fn(), t: (k) => k, generationQueue: null,
    }))

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs(null, {
        targetRefKeys: ['id:1'],
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(guards.checkAuthToken).toHaveBeenCalledTimes(2)
    expect(result.current.preparingRefs).toBe(false)
    expect(result.current.generatingRefs).toEqual([])

    act(() => result.current.stopGenerateAllRefs())
    expect(result.current.stoppingRefs).toBe(true)

    let batchResult
    await act(async () => {
      resolveItemAuth(true)
      batchResult = await batchPromise
    })

    expect(batchResult.outcome).toBe('stopped')
    expect(result.current.stoppingRefs).toBe(false)
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
