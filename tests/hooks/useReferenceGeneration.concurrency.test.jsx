/**
 * useReferenceGeneration — concurrency gate
 *
 * 장시간 랜덤 딜레이 제거 + settings.concurrency 슬라이딩 윈도우 게이트 검증.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }) }
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

function makeRefs(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1, type: 'character', prompt: `p${i + 1}`, status: 'pending'
  }))
}

function setupHook({ references, concurrency = 5, genAPIOverrides = {} }) {
  const genAPI = {
    getAccessToken: vi.fn().mockResolvedValue('token'),
    clearTokenCache: vi.fn(),
    submitGeneration: vi.fn().mockImplementation(async () => ({
      success: true, generationId: `g-${Math.random()}`
    })),
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'img', mediaId: 'm' }] }),
    uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'm', caption: '' }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    ...genAPIOverrides
  }

  const { result } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'project', imageBatchCount: 1, concurrency },
    references,
    setReferences: vi.fn(),
    genAPI,
    addPendingSave: vi.fn(),
    openSettings: vi.fn(),
    t: (k) => k,
    generationQueue: null
  }))

  return { result, genAPI }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useReferenceGeneration — concurrency', () => {
  it('배치 제출 시 7000ms 이상 setTimeout 호출 없음 (랜덤 딜레이 제거)', async () => {
    const { result, genAPI } = setupHook({ references: makeRefs(3), concurrency: 5 })

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

    let batchPromise
    await act(async () => { batchPromise = result.current.handleGenerateAllRefs() })
    for (let i = 0; i < 20; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    }
    await act(async () => { await batchPromise })

    const largeSleeps = setTimeoutSpy.mock.calls.filter(([, delay]) => delay >= 7000)
    expect(largeSleeps).toHaveLength(0)
    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(3)
  })

  it('concurrency 가 비정상 문자열이어도 게이트 동작 (clampInt → 5)', { timeout: 15000 }, async () => {
    // 손상된 설정값("x") → Math.min(15,"x")=NaN → pendingQueue.length >= NaN 항상 false
    // → 게이트 무력화 → submit 폭주. clampInt('x',1,15,5)=5 로 폴백되면 5에서 막혀야 함.
    let allowComplete = false
    const checkGeneration = vi.fn().mockImplementation(async () => ({
      success: true, completed: allowComplete
    }))

    const { result, genAPI } = setupHook({
      references: makeRefs(6),
      concurrency: 'x',
      genAPIOverrides: { checkGeneration }
    })

    let batchPromise
    await act(async () => { batchPromise = result.current.handleGenerateAllRefs() })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

    // clampInt('x',1,15,5)=5 → 게이트가 5에서 막음. NaN 이면 6개 전부 폭주.
    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(5)

    // 드레인 — 나머지 완료시켜 batchPromise 종료
    allowComplete = true
    for (let i = 0; i < 20; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    }
    await act(async () => { await batchPromise })
  })

  it('concurrency=1 이면 첫 번째 항목 수집 전까지 두 번째 항목 제출 안 함', { timeout: 15000 }, async () => {
    // checkGeneration 으로 완료 타이밍 제어 — 처음엔 completed:false 반환,
    // 게이트가 GATE_POLL_MS(600ms) 타이머를 쓰므로 fake timer 로 제어 가능.
    let allowComplete = false
    const checkGeneration = vi.fn().mockImplementation(async () => ({
      success: true, completed: allowComplete
    }))

    const { result, genAPI } = setupHook({
      references: makeRefs(2),
      concurrency: 1,
      genAPIOverrides: { checkGeneration }
    })

    let batchPromise
    await act(async () => { batchPromise = result.current.handleGenerateAllRefs() })

    // 게이트가 첫 번째 poll 후 GATE_POLL_MS(600ms) 대기에 들어가도록 한 번 flush
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })

    // 아직 첫 번째만 제출됐어야 함 (두 번째는 게이트에서 대기 중)
    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)

    // 완료 허용 후 게이트 GATE_POLL_MS 통과시켜 수집 진행
    allowComplete = true
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

    // 이제 두 번째도 제출됐어야 함
    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(2)

    // 나머지 완료
    for (let i = 0; i < 15; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    }
    await act(async () => { await batchPromise })
  })
})
