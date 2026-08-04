import { useCallback, useMemo, useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'
import { useGenAPI } from '../../src/hooks/useGenAPI'
import { createEngineApi } from '../../src/engine/engineApi'

const mocks = vi.hoisted(() => ({
  processAsyncSceneResult: vi.fn(),
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn(),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: (...args) => mocks.processAsyncSceneResult(...args),
}))

vi.mock('../../src/firebase/functions', () => ({
  consumeBatchDownload: vi.fn().mockResolvedValue({ allowed: true, consumed: true }),
}))

function deferred() {
  let resolve
  const promise = new Promise(res => { resolve = res })
  return { promise, resolve }
}

function useAutomationHarness({ collectEntered, collectGate } = {}) {
  const rawGenAPI = useGenAPI()
  const baseEngine = createEngineApi(rawGenAPI)
  const engine = useMemo(() => {
    if (!collectEntered || !collectGate) return baseEngine
    return {
      ...baseEngine,
      collectGeneration: async (generationId) => {
        collectEntered.resolve()
        await collectGate.promise
        return baseEngine.collectGeneration(generationId)
      },
    }
  }, [baseEngine, collectEntered, collectGate])
  const [scenes, setScenes] = useState([
    { id: 's1', prompt: 'draw', status: 'pending', error: null, errorKind: null, image: 'old-image' },
  ])
  const updateScene = useCallback((id, patch) => {
    setScenes(current => current.map(scene => scene.id === id ? { ...scene, ...patch } : scene))
  }, [])
  const scenesHook = useMemo(() => ({
    scenes,
    references: [],
    updateScene,
    updateReferences: () => {},
    getMatchingReferences: () => [],
  }), [scenes, updateScene])
  const automation = useAutomation(
    engine,
    scenesHook,
    null,
    null,
    null,
    key => key,
    null,
    null,
    null,
    'api',
  )
  return { automation, scenes }
}

function start(hook) {
  let promise
  act(() => {
    promise = hook.result.current.automation.start({
      projectName: 'cancel-test',
      saveMode: 'memory',
      concurrency: 1,
    })
  })
  return promise
}

beforeEach(() => {
  window.electronAPI.genaiGetKeyStatus.mockResolvedValue({ hasKey: true })
  window.electronAPI.genaiCancel.mockResolvedValue({ success: true, aborted: 1 })
  mocks.processAsyncSceneResult.mockImplementation(async ({ scene, result, updateScene }) => {
    if (!result.success) {
      updateScene(scene.id, { status: 'error', error: result.error, errorKind: result.errorKind ?? null })
      return false
    }
    updateScene(scene.id, { status: 'done', error: null, errorKind: null })
    return true
  })
})

describe('useAutomation generation cancel — real useGenAPI → engineApi facade', () => {
  it('user Stop은 현재 run scope를 정확히 한 번 취소하고 submit에 같은 scope를 전달한다', async () => {
    const image = deferred()
    window.electronAPI.genaiGenerateImage.mockReturnValueOnce(image.promise)
    const hook = renderHook(() => useAutomationHarness())
    const startPromise = start(hook)
    await waitFor(() => expect(window.electronAPI.genaiGenerateImage).toHaveBeenCalledTimes(1))
    const scope = window.electronAPI.genaiGenerateImage.mock.calls[0][0].cancelScope

    act(() => {
      hook.result.current.automation.stop()
      hook.result.current.automation.stop()
    })

    expect(scope).toMatch(/^scenes:/)
    expect(window.electronAPI.genaiCancel).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.genaiCancel).toHaveBeenCalledWith({ scope })
    image.resolve({ success: false, error: 'Operation aborted', errorKind: 'aborted', aborted: true })
    await act(async () => { await startPromise })
    expect(hook.result.current.automation.isRunning).toBe(false)
  })

  it('collectCompleted 진행 중 Stop으로 받은 abort는 pending 복원되고 실패 처리·카운트가 없다', async () => {
    const collectEntered = deferred()
    const collectGate = deferred()
    window.electronAPI.genaiGenerateImage.mockResolvedValueOnce({
      success: false,
      error: 'Operation aborted',
      errorKind: 'aborted',
      aborted: true,
    })
    const hook = renderHook(() => useAutomationHarness({ collectEntered, collectGate }))
    const startPromise = start(hook)
    await collectEntered.promise

    act(() => hook.result.current.automation.stop())
    collectGate.resolve()
    await act(async () => { await startPromise })

    expect(mocks.processAsyncSceneResult).not.toHaveBeenCalled()
    expect(hook.result.current.scenes[0]).toMatchObject({
      status: 'pending',
      error: null,
      errorKind: null,
    })
    expect(hook.result.current.automation.progress.errorCount).toBe(0)
    expect(hook.result.current.automation.isRunning).toBe(false)
  })

  it('양성 대조군: 같은 collect sink의 비-abort 실패는 error 마킹·카운트가 유지된다', async () => {
    const collectEntered = deferred()
    const collectGate = deferred()
    window.electronAPI.genaiGenerateImage.mockResolvedValueOnce({
      success: false,
      error: 'provider failed',
      errorKind: 'transient',
    })
    const hook = renderHook(() => useAutomationHarness({ collectEntered, collectGate }))
    const startPromise = start(hook)
    await collectEntered.promise
    collectGate.resolve()
    await act(async () => { await startPromise })

    expect(mocks.processAsyncSceneResult).toHaveBeenCalledTimes(1)
    expect(hook.result.current.scenes[0]).toMatchObject({
      status: 'error',
      error: 'provider failed',
      errorKind: 'transient',
    })
    expect(hook.result.current.automation.progress.errorCount).toBe(1)
  })
})
