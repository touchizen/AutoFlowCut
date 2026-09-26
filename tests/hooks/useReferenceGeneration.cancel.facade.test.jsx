import { useMemo, useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('../../src/utils/imageProcessing', () => ({
  tryUpscaleImage: vi.fn(),
  extractThumbnailBase64: vi.fn().mockResolvedValue('thumb'),
}))

vi.mock('../../src/utils/urls', () => ({
  cleanBase64: vi.fn(value => value),
  toDataURL: vi.fn(value => value),
}))

import { checkAuthToken } from '../../src/utils/guards'
import { toast } from '../../src/components/Toast'
import { useGenAPI } from '../../src/hooks/useGenAPI'
import { createEngineApi } from '../../src/engine/engineApi'
import { useGenerationQueue } from '../../src/hooks/useGenerationQueue'
import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

function deferred() {
  let resolve
  const promise = new Promise(res => { resolve = res })
  return { promise, resolve }
}

function useHarness({ initialRefs, useQueue = false, collectEntered = null, collectGate = null, beforeBatchActivation = null }) {
  const rawGenAPI = useGenAPI()
  const baseEngine = createEngineApi(rawGenAPI)
  const engine = useMemo(() => ({
    mode: 'api',
    ...baseEngine,
    ...(collectEntered && collectGate ? {
      collectGeneration: async generationId => {
        collectEntered.resolve()
        await collectGate.promise
        return baseEngine.collectGeneration(generationId)
      },
    } : {}),
  }), [baseEngine, collectEntered, collectGate])
  const generationQueue = useGenerationQueue()
  const [references, setReferences] = useState(initialRefs)
  const refs = useReferenceGeneration({
    settings: { saveMode: 'project', imageBatchCount: 1, concurrency: 1 },
    references,
    setReferences,
    genAPI: engine,
    addPendingSave: vi.fn(),
    openSettings: vi.fn(),
    t: key => key,
    generationQueue: useQueue ? generationQueue : null,
    beforeBatchActivation,
  })
  return { refs, references }
}

beforeEach(() => {
  checkAuthToken.mockResolvedValue(true)
  window.electronAPI.genaiCancel.mockResolvedValue({ success: true, aborted: 0 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Reference cancel integration — real useGenAPI → engineApi facade', () => {
  it('batch Stop 후 재시작은 이전 tombstone과 충돌하지 않는 새 scope를 발급한다', async () => {
    const firstActivation = deferred()
    const secondActivation = deferred()
    const initialRefs = [{ id: 'restart', prompt: 'restart', type: 'scene', status: 'pending' }]
    const hook = renderHook(({ activation }) => useHarness({
      initialRefs,
      beforeBatchActivation: () => activation.promise,
    }), { initialProps: { activation: firstActivation } })

    let firstBatch
    act(() => {
      firstBatch = hook.result.current.refs.handleGenerateAllRefs(null, { targetRefKeys: ['id:restart'] })
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    act(() => hook.result.current.refs.stopGenerateAllRefs())
    firstActivation.resolve()
    await act(async () => { await firstBatch })

    hook.rerender({ activation: secondActivation })
    let secondBatch
    act(() => {
      secondBatch = hook.result.current.refs.handleGenerateAllRefs(null, { targetRefKeys: ['id:restart'] })
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    act(() => hook.result.current.refs.stopGenerateAllRefs())
    secondActivation.resolve()
    await act(async () => { await secondBatch })

    const scopes = window.electronAPI.genaiCancel.mock.calls.map(([{ scope }]) => scope)
    expect(scopes).toHaveLength(2)
    expect(scopes[0]).toMatch(/^refs:/)
    expect(scopes[1]).toMatch(/^refs:/)
    expect(scopes[1]).not.toBe(scopes[0])
  })

  it('Flow mount 뒤 API facade로 전환해도 오래된 Stop callback은 live API cancel을 사용한다', async () => {
    const auth = deferred()
    checkAuthToken.mockReturnValueOnce(auth.promise)
    const flowCancel = vi.fn().mockResolvedValue({ success: true, aborted: 0 })
    const initialRefs = [{ id: 'switch', prompt: 'switch', type: 'scene', status: 'pending' }]
    const hook = renderHook(({ mode }) => {
      const rawGenAPI = useGenAPI()
      const apiEngine = { mode: 'api', ...createEngineApi(rawGenAPI) }
      const flowEngine = {
        mode: 'flow',
        generateImage: vi.fn(),
        cancelGeneration: flowCancel,
      }
      const [references, setReferences] = useState(initialRefs)
      return useReferenceGeneration({
        settings: { saveMode: 'project', imageBatchCount: 1 },
        references,
        setReferences,
        genAPI: mode === 'api' ? apiEngine : flowEngine,
        addPendingSave: vi.fn(),
        openSettings: vi.fn(),
        t: key => key,
        generationQueue: null,
      })
    }, { initialProps: { mode: 'flow' } })

    hook.rerender({ mode: 'api' })
    let generation
    act(() => { generation = hook.result.current.handleGenerateRef(0) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    act(() => hook.result.current.stopGenerateAllRefs())
    auth.resolve(true)
    await act(async () => { await generation })

    expect(flowCancel).not.toHaveBeenCalled()
    expect(window.electronAPI.genaiCancel).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.genaiGenerateImage).not.toHaveBeenCalled()
  })

  it('A preflight + B queued Stop은 두 scope를 한 번씩 취소하고 renderer image IPC를 0회로 유지한다', async () => {
    const auth = deferred()
    checkAuthToken.mockReturnValueOnce(auth.promise)
    const hook = renderHook(() => useHarness({
      useQueue: true,
      initialRefs: [
        { id: 'a', prompt: 'A', type: 'scene', status: 'pending' },
        { id: 'b', prompt: 'B', type: 'scene', status: 'pending' },
      ],
    }))
    let first
    let second
    act(() => {
      first = hook.result.current.refs.handleGenerateRef(0)
      second = hook.result.current.refs.handleGenerateRef(1)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    act(() => hook.result.current.refs.stopGenerateAllRefs())
    auth.resolve(true)
    let firstResult
    let secondResult
    await act(async () => {
      firstResult = await first
      secondResult = await second
    })

    expect(window.electronAPI.genaiGenerateImage).not.toHaveBeenCalled()
    expect(window.electronAPI.genaiCancel).toHaveBeenCalledTimes(2)
    const scopes = window.electronAPI.genaiCancel.mock.calls.map(([{ scope }]) => scope)
    expect(new Set(scopes).size).toBe(2)
    expect(scopes.every(scope => /^refs:/.test(scope))).toBe(true)
    expect(firstResult).toMatchObject({ aborted: true, errorKind: 'aborted' })
    expect(secondResult).toMatchObject({ aborted: true, errorKind: 'aborted' })
    expect(hook.result.current.refs.generatingRefs).toEqual([])
  })

  it('single direct D4는 lifecycle snapshot을 복원하고 실패 toast를 금지한다', async () => {
    window.electronAPI.genaiGenerateImage.mockResolvedValueOnce({
      success: false,
      error: 'Operation aborted',
      errorKind: 'aborted',
      aborted: true,
    })
    const hook = renderHook(() => useHarness({
      initialRefs: [{
        id: 'done', prompt: 'redo', type: 'scene', status: 'done',
        errorMessage: 'old', errorKind: 'legacy', generatingStartedAt: 1, generatingEndedAt: 2,
        data: 'paid-old-image',
      }],
    }))

    await act(async () => { await hook.result.current.refs.handleGenerateRef(0) })

    expect(hook.result.current.references[0]).toMatchObject({
      status: 'done', errorMessage: 'old', errorKind: 'legacy',
      generatingStartedAt: 1, generatingEndedAt: 2, data: 'paid-old-image',
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(hook.result.current.refs.generatingRefs).toEqual([])
  })

  it('N4: single success가 Stop 뒤 도착해도 이미 과금된 결과를 폐기하지 않고 저장한다', async () => {
    const image = deferred()
    window.electronAPI.genaiGenerateImage.mockReturnValueOnce(image.promise)
    const hook = renderHook(() => useHarness({
      initialRefs: [{ id: 'salvage', prompt: 'salvage', type: 'scene', status: 'pending' }],
    }))
    let generation
    act(() => { generation = hook.result.current.refs.handleGenerateRef(0) })
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })

    act(() => hook.result.current.refs.stopGenerateAllRefs())
    image.resolve({
      success: true,
      images: [{ base64: 'PAID', mimeType: 'image/png' }],
    })
    await act(async () => { await generation })

    expect(hook.result.current.references[0]).toMatchObject({
      status: 'done',
      data: 'PAID',
    })
  })

  it('single 양성 대조군: 비-abort failure는 error와 toast를 유지한다', async () => {
    window.electronAPI.genaiGenerateImage.mockResolvedValueOnce({
      success: false,
      error: 'provider failed',
      errorKind: 'transient',
    })
    const hook = renderHook(() => useHarness({
      initialRefs: [{ id: 'bad', prompt: 'fail', type: 'scene', status: 'pending' }],
    }))

    await act(async () => { await hook.result.current.refs.handleGenerateRef(0) })

    expect(hook.result.current.references[0]).toMatchObject({
      status: 'error', errorMessage: 'provider failed', errorKind: 'transient',
    })
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('batch collect 진행 중 Stop의 D4는 consumed 처리되어 pending 복원·실패 누적 금지된다', async () => {
    vi.useFakeTimers()
    const collectEntered = deferred()
    const collectGate = deferred()
    window.electronAPI.genaiGenerateImage.mockResolvedValueOnce({
      success: false,
      error: 'Operation aborted',
      errorKind: 'aborted',
      aborted: true,
    })
    const hook = renderHook(() => useHarness({
      collectEntered,
      collectGate,
      initialRefs: [{ id: 'batch', prompt: 'batch', type: 'scene', status: 'pending' }],
    }))
    let batchPromise
    act(() => {
      batchPromise = hook.result.current.refs.handleGenerateAllRefs(null, { targetRefKeys: ['id:batch'] })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    await collectEntered.promise

    act(() => hook.result.current.refs.stopGenerateAllRefs())
    collectGate.resolve()
    let batchResult
    await act(async () => { batchResult = await batchPromise })

    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'stopped',
      succeededKeys: [],
      failed: [],
    })
    expect(hook.result.current.references[0]).toMatchObject({
      status: 'pending', errorMessage: null, errorKind: null,
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(hook.result.current.refs.generatingRefs).toEqual([])
    expect(hook.result.current.refs.refBatchActive).toBe(false)
  })

  it('batch 양성 대조군: 같은 collect sink의 비-abort failure는 failed/error/toast를 유지한다', async () => {
    vi.useFakeTimers()
    const collectEntered = deferred()
    const collectGate = deferred()
    window.electronAPI.genaiGenerateImage.mockResolvedValueOnce({
      success: false,
      error: 'provider failed',
      errorKind: 'transient',
    })
    const hook = renderHook(() => useHarness({
      collectEntered,
      collectGate,
      initialRefs: [{ id: 'batch-fail', prompt: 'batch', type: 'scene', status: 'pending' }],
    }))
    let batchPromise
    act(() => {
      batchPromise = hook.result.current.refs.handleGenerateAllRefs(null, { targetRefKeys: ['id:batch-fail'] })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    await collectEntered.promise
    collectGate.resolve()
    let batchResult
    await act(async () => { batchResult = await batchPromise })

    expect(batchResult.failed).toEqual([{ key: 'id:batch-fail', stage: 'collect', error: 'provider failed' }])
    expect(hook.result.current.references[0]).toMatchObject({
      status: 'error', errorMessage: 'provider failed', errorKind: 'transient',
    })
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})
