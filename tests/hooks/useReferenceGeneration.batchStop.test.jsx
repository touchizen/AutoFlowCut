/**
 * useReferenceGeneration — batch stop semantics
 *
 * Regression: when the user stops the batch during the collection phase,
 * pending refs must NOT be marked as `error / Timed out` (that hides the
 * fact that it was a user cancellation). They should be reverted to the
 * idle `pending` state so they remain re-runnable on the next batch.
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
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
import { useGenerationQueue } from '../../src/hooks/useGenerationQueue'
import { checkAuthToken } from '../../src/utils/guards'
import { toast } from '../../src/components/Toast'

const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

function setupHook({ checkGenerationImpl }) {
  const refs = [{ id: 1, prompt: 'a portrait', type: 'character', status: 'pending' }]
  const setRefCalls = []
  const setReferences = (updater) => {
    if (typeof updater === 'function') {
      const synthetic = [{ id: 1, prompt: 'a portrait', type: 'character', status: 'generating' }]
      setRefCalls.push(updater(synthetic))
    }
  }

  let hookHandle

  const genAPI = {
    getAccessToken: vi.fn().mockResolvedValue('token'),
    clearTokenCache: vi.fn(),
    submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'g-1' }),
    checkGeneration: vi.fn(async () => {
      await checkGenerationImpl?.(hookHandle)
      return { success: true, completed: false }
    }),
    clearGenerations: vi.fn().mockResolvedValue(undefined)
  }

  const { result } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'project', imageBatchCount: 1 },
    references: refs,
    setReferences,
    genAPI,
    addPendingSave: vi.fn(),
    openSettings: vi.fn(),
    t: (k) => k,
    generationQueue: null
  }))
  // result.current is the hook's return object — expose it directly to callers
  hookHandle = result

  return { result, setRefCalls, genAPI }
}

describe('useReferenceGeneration — queued batch stop semantics', () => {
  it('individual-only 생성 중 stop은 batch stopping latch를 만들지 않는다', async () => {
    const individualResult = deferred()
    const refs = [{
      id: 'solo',
      prompt: 'solo portrait',
      type: 'scene',
      status: 'pending',
    }]
    const genAPI = {
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      generateImage: vi.fn(() => individualResult.promise),
    }
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'project', imageBatchCount: 1 },
      references: refs,
      setReferences: vi.fn(),
      genAPI,
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: key => key,
      generationQueue: null,
    }))

    let individualPromise
    await act(async () => {
      individualPromise = result.current.handleGenerateRef(0)
      for (let i = 0; i < 5; i++) await Promise.resolve()
      result.current.stopGenerateAllRefs()
    })

    expect(result.current.generatingRefs).toEqual([0])
    expect(result.current.stoppingRefs).toBe(false)

    await act(async () => {
      individualResult.resolve({
        success: true,
        images: [{ base64: 'solo-image', mediaId: 'solo-media' }],
      })
      await individualPromise
    })
  })

  it('stale stop을 버린 새 batch는 실행 중 stopping UI도 즉시 해제한다', async () => {
    const submitResult = deferred()
    const refs = [{
      id: 'fresh',
      prompt: 'fresh portrait',
      type: 'scene',
      status: 'pending',
    }]
    const genAPI = {
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      submitGeneration: vi.fn(() => submitResult.promise),
      clearGenerations: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'project', imageBatchCount: 1 },
      references: refs,
      setReferences: vi.fn(),
      genAPI,
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: key => key,
      generationQueue: null,
    }))

    let batchPromise
    await act(async () => {
      result.current.stopGenerateAllRefs()
      batchPromise = result.current.handleGenerateAllRefs(null, {
        targetRefKeys: ['id:fresh'],
      })
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })

    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
    expect(result.current.preparingRefs).toBe(false)
    expect(result.current.refBatchActive).toBe(true)
    expect(result.current.generatingRefs).toEqual([0])
    expect(result.current.stoppingRefs).toBe(false)

    await act(async () => {
      submitResult.resolve({
        success: false,
        error: 'submit finished',
      })
      await batchPromise
    })
    expect(result.current.refBatchActive).toBe(false)
  })

  it('batch enqueue 전에 남은 stop은 새 batch 시작에서 stale로 버리고 정상 실행한다', async () => {
    const refs = [{
      id: 'fresh',
      prompt: 'fresh portrait',
      type: 'scene',
      status: 'pending',
    }]
    const genAPI = {
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      submitGeneration: vi.fn().mockResolvedValue({
        success: false,
        error: 'submit reached',
      }),
      clearGenerations: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'project', imageBatchCount: 1 },
      references: refs,
      setReferences: vi.fn(),
      genAPI,
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: key => key,
      generationQueue: null,
    }))

    let batchResult
    await act(async () => {
      result.current.stopGenerateAllRefs()
      batchResult = await result.current.handleGenerateAllRefs(null, {
        targetRefKeys: ['id:fresh'],
      })
    })

    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'failed',
      requestedKeys: ['id:fresh'],
      failed: [{
        key: 'id:fresh',
        stage: 'submit',
        error: 'submit reached',
      }],
    })
    expect(result.current.stoppingRefs).toBe(false)
  })

  it('individual job 뒤에 대기 중인 batch는 먼저 들어온 stop을 삼키지 않고 stopped로 끝낸다', async () => {
    const individualResult = deferred()
    let liveRefs = [
      { id: 'first', prompt: 'first portrait', type: 'scene', status: 'pending' },
      { id: 'second', prompt: 'second portrait', type: 'scene', status: 'pending' },
    ]
    const setReferences = vi.fn(updater => {
      liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
    })
    const genAPI = {
      mode: 'api',
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      generateImage: vi.fn(() => individualResult.promise),
      submitGeneration: vi.fn().mockResolvedValue({
        success: false,
        error: 'queued batch should not submit',
      }),
      clearGenerations: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => {
      const generationQueue = useGenerationQueue()
      const refs = useReferenceGeneration({
        settings: { saveMode: 'project', imageBatchCount: 1 },
        references: liveRefs,
        setReferences,
        genAPI,
        addPendingSave: vi.fn(),
        openSettings: vi.fn(),
        t: key => key,
        generationQueue,
      })
      return { ...refs, generationQueue }
    })

    let individualPromise
    await act(async () => {
      individualPromise = result.current.handleGenerateRef(0)
      await Promise.resolve()
    })
    expect(genAPI.generateImage).toHaveBeenCalledTimes(1)

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs(null, {
        targetRefKeys: ['id:second'],
      })
      await Promise.resolve()
    })

    // Batch execute는 앞선 individual job 뒤에 대기 중이라 lifecycle state가 아직 비어 있다.
    // 이 창에서도 외부(App gate busy) Stop이 callback에 도달하면 queued stop version이 소비돼야 한다.
    expect(result.current.preparingRefs).toBe(false)
    expect(result.current.refBatchActive).toBe(false)
    expect(result.current.generatingRefs).toEqual([0])

    act(() => result.current.stopGenerateAllRefs())
    expect(result.current.stoppingRefs).toBe(true)

    await act(async () => {
      individualResult.resolve({
        success: true,
        images: [{ base64: 'first-image', mediaId: 'first-media' }],
      })
      await individualPromise
    })

    let batchResult
    await act(async () => {
      batchResult = await batchPromise
    })

    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'stopped',
      requestedKeys: ['id:second'],
      attemptedKeys: [],
      succeededKeys: [],
      failed: [],
    })
    expect(result.current.stoppingRefs).toBe(false)
  })

  it('scene job 뒤에 queued된 batch는 lifecycle flags가 비어 있어도 gate Stop으로 stopped 된다', async () => {
    const sceneResult = deferred()
    const refs = [{
      id: 'queued-ref',
      prompt: 'queued portrait',
      type: 'scene',
      status: 'pending',
    }]
    const genAPI = {
      mode: 'api',
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      submitGeneration: vi.fn().mockResolvedValue({
        success: false,
        error: 'queued batch should not submit',
      }),
      clearGenerations: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => {
      const generationQueue = useGenerationQueue()
      const refGeneration = useReferenceGeneration({
        settings: { saveMode: 'project', imageBatchCount: 1 },
        references: refs,
        setReferences: vi.fn(),
        genAPI,
        addPendingSave: vi.fn(),
        openSettings: vi.fn(),
        t: key => key,
        generationQueue,
      })
      return { ...refGeneration, generationQueue }
    })

    let scenePromise
    await act(async () => {
      scenePromise = result.current.generationQueue.enqueue({
        type: 'image',
        label: 'Scene regeneration',
        execute: () => sceneResult.promise,
      })
      await Promise.resolve()
    })

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs(null, {
        targetRefKeys: ['id:queued-ref'],
      })
      await Promise.resolve()
    })

    // 실제 회귀 창: scene job만 실행 중이라 ref batch lifecycle state는 아직 하나도 켜지지 않는다.
    expect(result.current.preparingRefs).toBe(false)
    expect(result.current.refBatchActive).toBe(false)
    expect(result.current.generatingRefs).toEqual([])
    expect(result.current.stoppingRefs).toBe(false)

    act(() => result.current.stopGenerateAllRefs())
    expect(result.current.stoppingRefs).toBe(true)

    await act(async () => {
      sceneResult.resolve({ success: true })
      await scenePromise
    })

    let batchResult
    await act(async () => {
      batchResult = await batchPromise
    })

    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'stopped',
      requestedKeys: ['id:queued-ref'],
      attemptedKeys: [],
      succeededKeys: [],
      failed: [],
    })
    expect(result.current.stoppingRefs).toBe(false)
  })

  it('stop 직후 실행된 noop batch도 stoppingRefs를 남기지 않는다', async () => {
    const refs = [{
      id: 'filled',
      prompt: 'filled portrait',
      type: 'scene',
      status: 'done',
      data: 'existing-image',
    }]
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'project', imageBatchCount: 1 },
      references: refs,
      setReferences: vi.fn(),
      genAPI: {},
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: key => key,
      generationQueue: null,
    }))

    let batchResult
    await act(async () => {
      result.current.stopGenerateAllRefs()
      batchResult = await result.current.handleGenerateAllRefs(null, {
        targetRefKeys: ['id:filled'],
      })
    })

    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'noop',
      requestedKeys: ['id:filled'],
    })
    expect(result.current.stoppingRefs).toBe(false)
  })
})

describe('useReferenceGeneration — prepare-phase stop cleanup (P1)', () => {
  // 회귀 컨텍스트:
  //   _executeBatchRefs의 prepare 단계(폴더 권한/auth check)에서 MCP가 stopGenerateAllRefs()를
  //   호출 → stoppingRefs=true. 이때 폴더 권한/auth가 실패해 조기 return하면 setPreparingRefs(false)만
  //   호출하고 stoppingRefs는 영구히 true로 stuck. 다음 MCP 호출이 waitForStopped 30s timeout
  //   타고, UI도 'stopping' 상태에 갇히는 회귀. 모든 early return에서 stoppingRefs도 false로 정리.

  it('folder permission 조기 return 시 stoppingRefs 정리됨', async () => {
    // 새 모듈 import (mock 재초기화 회피)
    const { useReferenceGeneration } = await import('../../src/hooks/useReferenceGeneration')
    const { fileSystemAPI } = await import('../../src/hooks/useFileSystem')

    // folder permission이 not_set 반환하기 직전 stop을 트리거
    let hookHandle
    fileSystemAPI.ensurePermission.mockImplementationOnce(async () => {
      // 외부 stop 호출 시뮬레이션 (MCP path)
      if (hookHandle) hookHandle.current.stopGenerateAllRefs()
      return { error: 'not_set' }
    })

    const refs = [{ id: 1, prompt: 'a portrait', type: 'character', status: 'pending' }]
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'folder', imageBatchCount: 1 },
      references: refs,
      setReferences: vi.fn(),
      genAPI: { getAccessToken: vi.fn().mockResolvedValue('token') },
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: (k) => k,
      generationQueue: null
    }))
    hookHandle = result

    await act(async () => {
      await result.current.handleGenerateAllRefs()
    })

    // P1 fix: cleanupPrepareAndReturn이 두 플래그 모두 false로
    expect(result.current.preparingRefs).toBe(false)
    expect(result.current.refBatchActive).toBe(false)
    expect(result.current.stoppingRefs).toBe(false)
  })

  it('prepare 단계 unexpected throw 시에도 flags 정리됨 (P2 v3: try/finally lifecycle)', async () => {
    // 회귀 컨텍스트: 이전 cleanupPrepareAndReturn은 명시적 early return만 cover. 예상 못한
    // throw (IPC reject, network error 등)에선 flag가 stuck 되어 refBatchRunning 영구 true.
    // try/finally로 전체 lifecycle을 감싸 어떤 종료 경로든 flag 정리.

    const { useReferenceGeneration } = await import('../../src/hooks/useReferenceGeneration')
    const { fileSystemAPI } = await import('../../src/hooks/useFileSystem')

    // ensurePermission이 throw (예: IPC handler 죽음)
    fileSystemAPI.ensurePermission.mockImplementationOnce(async () => {
      throw new Error('IPC handler died')
    })

    const refs = [{ id: 1, prompt: 'a portrait', type: 'character', status: 'pending' }]
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'folder', imageBatchCount: 1 },
      references: refs,
      setReferences: vi.fn(),
      genAPI: { getAccessToken: vi.fn().mockResolvedValue('token') },
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: (k) => k,
      generationQueue: null
    }))

    // throw가 caller로 전파될 수 있음 — try로 감싸서 무시
    await act(async () => {
      try { await result.current.handleGenerateAllRefs() } catch {}
    })

    // 핵심 가드: throw에도 flags가 false로 정리됨
    expect(result.current.preparingRefs).toBe(false)
    expect(result.current.refBatchActive).toBe(false)
    expect(result.current.stoppingRefs).toBe(false)
  })
})

describe('useReferenceGeneration — Flow no-token guidance', () => {
  it('single reference generation stores Flow login guidance, not generic auth text', async () => {
    checkAuthToken.mockResolvedValueOnce(false)
    const refs = [{ id: 1, prompt: 'a portrait', type: 'character', status: 'pending' }]
    const setRefCalls = []
    const setReferences = (updater) => {
      if (typeof updater === 'function') setRefCalls.push(updater(refs))
    }

    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'project', imageBatchCount: 1 },
      references: refs,
      setReferences,
      genAPI: { mode: 'flow', getAccessToken: vi.fn().mockResolvedValue(null), clearTokenCache: vi.fn() },
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: (k) => ({
        'toast.flowLoginRequired': 'Flow 창에서 로그인해주세요.',
        'status.loginRequired': 'API 키가 필요합니다.',
      }[k] || k),
      generationQueue: null,
    }))

    let res
    await act(async () => {
      res = await result.current.handleGenerateRef(0)
    })

    expect(res.authError).toBe(true)
    const authState = setRefCalls.find(state =>
      state.some(r => r.id === 1 && r.status === 'error')
    )
    expect(authState?.[0]?.errorMessage).toContain('Flow 창에서 로그인해주세요.')
    expect(authState?.[0]?.errorMessage).not.toContain('API 키')
  })

  it('batch reference generation warns with Flow login guidance when token preflight fails', async () => {
    checkAuthToken.mockResolvedValueOnce(false)
    const refs = [{ id: 1, prompt: 'a portrait', type: 'character', status: 'pending' }]

    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'project', imageBatchCount: 1 },
      references: refs,
      setReferences: vi.fn(),
      genAPI: { mode: 'flow', getAccessToken: vi.fn().mockResolvedValue(null), clearTokenCache: vi.fn() },
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: (k) => ({
        'toast.flowLoginRequired': 'Flow 창에서 로그인해주세요.',
        'status.loginRequired': 'API 키가 필요합니다.',
      }[k] || k),
      generationQueue: null,
    }))

    await act(async () => {
      await result.current.handleGenerateAllRefs()
    })

    expect(toast.warning).toHaveBeenCalledWith('Flow 창에서 로그인해주세요.')
  })
})

describe('useReferenceGeneration — stop during batch', () => {
  it('does NOT mark stopped refs as error/Timed out', async () => {
    vi.useFakeTimers()

    const { result, setRefCalls } = setupHook({
      checkGenerationImpl: (handle) => {
        // Trigger user stop on the very first poll
        handle.current.stopGenerateAllRefs()
      }
    })

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs()
    })

    await act(async () => {
      // Advance through the 3-second polling sleep so checkGeneration runs
      await vi.advanceTimersByTimeAsync(4000)
    })

    await act(async () => {
      await batchPromise
    })

    vi.useRealTimers()

    // Bug repro: any state where stopped index has status='error' / 'Timed out'
    const errorState = setRefCalls.find(state =>
      state.some(r => r.id === 1 && r.status === 'error' && r.errorMessage === 'Timed out')
    )
    expect(errorState).toBeUndefined()
    expect(result.current.preparingRefs).toBe(false)
    expect(result.current.refBatchActive).toBe(false)
  })

  it('reverts stopped refs to pending status with no errorMessage', async () => {
    vi.useFakeTimers()

    const { result, setRefCalls } = setupHook({
      checkGenerationImpl: (handle) => {
        handle.current.stopGenerateAllRefs()
      }
    })

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })

    await act(async () => {
      await batchPromise
    })

    vi.useRealTimers()

    // The cleanup branch must reset to pending (re-runnable) without errorMessage
    const revertedState = setRefCalls.find(state =>
      state.some(r => r.id === 1 && r.status === 'pending' && (r.errorMessage == null))
    )
    expect(revertedState).toBeTruthy()
  })

  it('#R23-5: checkGeneration authFailed stops batch (dispatches flow-login-expired, no Timed out)', async () => {
    vi.useFakeTimers()
    const authEvents = []
    const onAuthExpired = () => authEvents.push(1)
    window.addEventListener('flow-login-expired', onAuthExpired)

    const { result, setRefCalls, genAPI } = setupHook({})
    // checkGeneration surfaces a dead-token sentinel during collection polling
    genAPI.checkGeneration.mockResolvedValue({
      success: false, authFailed: true, error: 'Auth expired — please re-login to Flow',
    })

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs()
    })
    // a single poll cycle is enough — must NOT need the 180s timeout
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    await act(async () => { await batchPromise })

    window.removeEventListener('flow-login-expired', onAuthExpired)
    vi.useRealTimers()

    expect(authEvents.length).toBeGreaterThanOrEqual(1)
    // not a generic 'Timed out' error
    const timedOut = setRefCalls.find(state =>
      state.some(r => r.id === 1 && r.status === 'error' && r.errorMessage === 'Timed out')
    )
    expect(timedOut).toBeUndefined()
    // #R24-4: auth-stop must NOT silently revert to clean pending — it marks errorKind:'auth'
    //   so dead auth isn't hidden behind a re-runnable pending state.
    const authMarked = setRefCalls.find(state =>
      state.some(r => r.id === 1 && r.status === 'error' && r.errorKind === 'auth')
    )
    expect(authMarked).toBeTruthy()
    const silentPending = setRefCalls.find(state =>
      state.some(r => r.id === 1 && r.status === 'pending' && r.errorMessage == null)
    )
    expect(silentPending).toBeUndefined()
  })

  it('check auth origin만 auth error로 남고 취소된 미수집 sibling은 pending으로 복원한다', async () => {
    vi.useFakeTimers()
    let liveRefs = [
      { id: 'sibling', prompt: 'sibling', type: 'scene', status: 'pending' },
      { id: 'origin', prompt: 'origin', type: 'scene', status: 'pending' },
    ]
    const setReferences = vi.fn(updater => {
      liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
    })
    let generationNo = 0
    let checkNo = 0
    const genAPI = {
      mode: 'api',
      cancelGeneration: vi.fn().mockResolvedValue({ success: true, aborted: 2 }),
      submitGeneration: vi.fn(async () => ({ success: true, generationId: `g-${++generationNo}` })),
      checkGeneration: vi.fn(async () => {
        checkNo += 1
        if (checkNo === 1) return { success: true, completed: false }
        return { success: false, authFailed: true, error: 'Auth expired' }
      }),
      collectGeneration: vi.fn(),
      clearGenerations: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'project', imageBatchCount: 1, concurrency: 5 },
      references: liveRefs,
      setReferences,
      genAPI,
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: key => key,
      generationQueue: null,
    }))

    let batchPromise
    act(() => { batchPromise = result.current.handleGenerateAllRefs() })
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    let batchResult
    await act(async () => { batchResult = await batchPromise })

    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(2)
    expect(genAPI.cancelGeneration).toHaveBeenCalledTimes(1)
    expect(batchResult.outcome).toBe('stopped')
    expect(liveRefs.find(ref => ref.id === 'origin')).toMatchObject({
      status: 'error', errorKind: 'auth',
    })
    expect(liveRefs.find(ref => ref.id === 'sibling')).toMatchObject({
      status: 'pending', errorMessage: null, errorKind: null,
    })
    vi.useRealTimers()
  })

  it('#R25-5: submit authFailed marks the failed ref errorKind:auth (not just pendingQueue refs)', async () => {
    const refs = [{ id: 1, prompt: 'a portrait', type: 'character', status: 'pending' }]
    const setRefCalls = []
    const setReferences = (updater) => {
      if (typeof updater === 'function') {
        setRefCalls.push(updater([{ id: 1, prompt: 'a portrait', type: 'character', status: 'generating' }]))
      }
    }
    const genAPI = {
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      submitGeneration: vi.fn().mockResolvedValue({ success: false, authFailed: true, error: 'Auth expired' }),
      checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: false }),
      clearGenerations: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'project', imageBatchCount: 1 },
      references: refs, setReferences, genAPI,
      addPendingSave: vi.fn(), openSettings: vi.fn(), t: (k) => k, generationQueue: null,
    }))

    await act(async () => { await result.current.handleGenerateAllRefs() })

    const authMarked = setRefCalls.find(state =>
      state.some(r => r.id === 1 && r.status === 'error' && r.errorKind === 'auth')
    )
    expect(authMarked).toBeTruthy()
  })

  it('still marks refs as error/Timed out when no stop was requested (genuine timeout)', async () => {
    vi.useFakeTimers()

    const { result, setRefCalls } = setupHook({
      // Never trigger stop — let Phase 2 hit its 180s timeout
      checkGenerationImpl: () => {}
    })

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs()
    })

    await act(async () => {
      // Drive past the 180-second maxWait
      await vi.advanceTimersByTimeAsync(200000)
    })

    await act(async () => {
      await batchPromise
    })

    vi.useRealTimers()

    // Genuine timeout path: still gets the error/Timed out marking
    const errorState = setRefCalls.find(state =>
      state.some(r => r.id === 1 && r.status === 'error' && r.errorMessage === 'Timed out')
    )
    expect(errorState).toBeTruthy()
  })
})
