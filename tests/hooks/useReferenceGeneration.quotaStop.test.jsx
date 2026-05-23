/**
 * useReferenceGeneration — quota stop during collect-path leak regression
 *
 * Review finding: useReferenceGeneration의 _executeBatchRefs 안에서
 * `await collectCompleted()` 가 quota 를 감지해 stopRequestedRef=true 로 만들어도,
 * 같은 iteration 의 그 다음 라인 (`await flowAPI.submitGenerationDOM(...)`) 이 stop
 * 재확인 없이 그대로 실행돼 ref 가 하나 더 submit 되는 leak 가 있었다.
 *
 * Fix: collectCompleted 직후 `if (stopRequestedRef.current) break` 추가.
 *
 * 이 테스트는 collect-path quota 감지 후 추가 submit 이 일어나지 않음을 검증한다.
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('../../src/utils/imageProcessing', () => ({
  tryUpscaleImage: vi.fn(),
  extractThumbnailBase64: vi.fn().mockResolvedValue('thumb'),
}))

vi.mock('../../src/utils/urls', () => ({
  cleanBase64: vi.fn((s) => s),
  toDataURL: vi.fn((s) => s),
}))

import { subscribeQuotaStop, __resetQuotaStopForTests } from '../../src/utils/quotaStop'
import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

const quotaShowMock = vi.fn()

describe('useReferenceGeneration — quota stop in collect path', () => {
  it('collectCompleted 가 quota 감지 후 다음 ref 가 submit 되지 않는다', async () => {
    vi.useFakeTimers()
    __resetQuotaStopForTests()
    quotaShowMock.mockClear()
    subscribeQuotaStop(quotaShowMock)

    const refs = [
      { id: 1, prompt: 'a', type: 'character', status: 'pending' },
      { id: 2, prompt: 'b', type: 'character', status: 'pending' },
      { id: 3, prompt: 'c', type: 'character', status: 'pending' },
    ]

    // 1st submit success — 그 다음 iteration 의 collectCompleted 에서 quota.
    let submitCallCount = 0
    const submitGenerationDOM = vi.fn(async () => {
      submitCallCount++
      return { success: true, generationId: `gen-${submitCallCount}` }
    })
    const checkGeneration = vi.fn().mockResolvedValue({ success: true, completed: true })
    const collectGeneration = vi.fn().mockResolvedValue({
      success: false,
      error: 'Resource has been exhausted (e.g. check quota).',
    })

    const flowAPI = {
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      submitGenerationDOM,
      checkGeneration,
      collectGeneration,
      clearGenerations: vi.fn().mockResolvedValue(undefined),
    }

    const { result } = renderHook(() =>
      useReferenceGeneration({
        settings: { saveMode: 'project', imageBatchCount: 1 },
        references: refs,
        setReferences: vi.fn(),
        flowAPI,
        addPendingSave: vi.fn(),
        openSettings: vi.fn(),
        t: (k) => k,
        generationQueue: null,
      })
    )

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs()
    })

    // Phase 1 inter-submit waits + Phase 2 polling — 충분히 advance.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000)
    })
    await act(async () => {
      await batchPromise
    })

    vi.useRealTimers()

    // 핵심 가드: submit 이 첫 1번만 일어남. 두 번째 iteration 의 collectCompleted 에서
    // quota 감지 → stopRequestedRef=true → 추가 submit (line 506) 안 일어남.
    expect(submitCallCount).toBe(1)
    expect(quotaShowMock).toHaveBeenCalledTimes(1)
  })
})
