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

  const flowAPI = {
    getAccessToken: vi.fn().mockResolvedValue('token'),
    clearTokenCache: vi.fn(),
    submitGenerationDOM: vi.fn().mockResolvedValue({ success: true, generationId: 'g-1' }),
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
    flowAPI,
    addPendingSave: vi.fn(),
    openSettings: vi.fn(),
    t: (k) => k,
    generationQueue: null
  }))
  // result.current is the hook's return object — expose it directly to callers
  hookHandle = result

  return { result, setRefCalls, flowAPI }
}

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
      flowAPI: { getAccessToken: vi.fn().mockResolvedValue('token') },
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
    expect(result.current.stoppingRefs).toBe(false)
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
