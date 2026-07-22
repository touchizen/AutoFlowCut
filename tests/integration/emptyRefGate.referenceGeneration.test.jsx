import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'
import { runEmptyRefGateFlow } from '../../src/services/emptyRefGate'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    ensurePermission: vi.fn().mockResolvedValue({
      hasPermission: true,
      name: 'test',
    }),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../../src/utils/imageProcessing', () => ({
  tryUpscaleImage: vi.fn(),
  extractThumbnailBase64: vi.fn().mockResolvedValue('thumb'),
}))

vi.mock('../../src/utils/urls', () => ({
  cleanBase64: vi.fn(value => value),
  toDataURL: vi.fn(value => value),
}))

afterEach(() => {
  vi.useRealTimers()
})

describe('empty reference gate + useReferenceGeneration integration', () => {
  it('busy Stop의 hook outcome:stopped가 gate failure까지 전달된다', async () => {
    vi.useFakeTimers()
    const emptyGhost = {
      id: 'ghost',
      name: 'Ghost',
      type: 'scene',
      prompt: 'a ghost portrait',
      status: 'pending',
    }
    let liveRefs = [emptyGhost]
    let hookResult
    const setReferences = vi.fn(updater => {
      liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
    })
    const genAPI = {
      mode: 'api',
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      submitGeneration: vi.fn().mockResolvedValue({
        success: true,
        generationId: 'g-1',
      }),
      checkGeneration: vi.fn(async () => {
        hookResult.current.stopGenerateAllRefs()
        return { success: true, completed: false }
      }),
      clearGenerations: vi.fn().mockResolvedValue(undefined),
    }
    const rendered = renderHook(() => useReferenceGeneration({
      settings: {
        saveMode: 'project',
        projectName: 'P',
        imageBatchCount: 1,
      },
      references: liveRefs,
      setReferences,
      genAPI,
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: key => key,
      generationQueue: null,
    }))
    hookResult = rendered.result

    let latch = false
    const failure = vi.fn(async () => {})
    const startScenes = vi.fn(async () => {})
    const deps = {
      getLiveScenes: () => [{
        id: 's1',
        prompt: '@Ghost',
        status: 'pending',
      }],
      getLiveRefs: () => liveRefs,
      getMode: () => 'flow',
      getProjectName: () => 'P',
      matchRefs: (scene, pool) => (
        (pool || []).filter(ref => scene.prompt.includes(`@${ref.name}`))
      ),
      subscriptionPreGate: vi.fn(async () => 'proceed'),
      setPendingLatch: vi.fn(on => { latch = on }),
      generateRefs: keys => hookResult.current.handleGenerateAllRefs(null, {
        force: false,
        targetRefKeys: keys,
        reason: 'm2-empty-reference-gate',
      }),
      openSyncGate: vi.fn(async () => ({
        proceeded: true,
        patchedRefs: null,
      })),
      canStartScenes: vi.fn(() => true),
      startScenes,
      toastM1Exclusions: vi.fn(),
      gateView: {
        confirm: vi.fn(async () => 'generate-first'),
        setBusy: vi.fn(),
        failure,
        close: vi.fn(),
      },
    }

    let flowPromise
    await act(async () => {
      flowPromise = runEmptyRefGateFlow({
        startMode: 'flow',
        projectName: 'P',
        force: false,
        initialTargetSceneIds: ['s1'],
        startOptionsWithoutSceneIds: {},
      }, deps)
      await Promise.resolve()
    })

    let outcome
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
      outcome = await flowPromise
    })

    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
    expect(deps.gateView.setBusy).toHaveBeenCalledTimes(1)
    expect(failure).toHaveBeenCalledWith({
      outcome: 'stopped',
      failures: [],
    })
    expect(outcome).toEqual({ started: false, reason: 'batch-stopped' })
    expect(startScenes).not.toHaveBeenCalled()
    expect(latch).toBe(false)
  })
})
