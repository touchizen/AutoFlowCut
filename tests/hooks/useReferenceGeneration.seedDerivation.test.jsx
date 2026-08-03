/**
 * useReferenceGeneration — 단건/배치 제출 seed 는 단일 공유 파생(startOptions.effectiveSeedFrom)을 쓴다.
 *
 * 앱 기본 settings 는 seedLocked:true + 숫자 seedNo. 이 파생이 경로마다 인라인 복제돼 있으면
 * 한쪽만 갱신돼 조용히 어긋난다. 여기서는 단건(handleGenerateRef → generateImage)과
 * 배치(handleGenerateAllRefs → submitGeneration) 두 제출 payload 모두에 파생 결과가 실제로
 * 실리는지 고정한다 — effectiveSeedFrom 이 변하면 두 경로가 함께 죽어야 한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }) },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
vi.mock('../../src/utils/imageProcessing', () => ({
  tryUpscaleImage: vi.fn(),
  extractThumbnailBase64: vi.fn().mockResolvedValue('thumb'),
}))
vi.mock('../../src/utils/urls', () => ({ cleanBase64: vi.fn(s => s), toDataURL: vi.fn(s => s) }))

import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

const HERO = { id: 2, type: 'character', name: '준호', prompt: 'hero', status: 'pending' }

function setupHook(settingsOverrides) {
  let liveRefs = [{ ...HERO }]
  const setReferences = vi.fn((updater) => {
    liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
  })
  const genAPI = {
    mode: 'api',
    getAccessToken: vi.fn().mockResolvedValue('token'),
    clearTokenCache: vi.fn(),
    generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'img', mediaId: 'm' }] }),
    submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'g-1' }),
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'img', mediaId: 'm' }] }),
    uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'm', caption: '' }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
  }
  const { result } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'memory', imageBatchCount: 1, ...settingsOverrides },
    references: liveRefs, setReferences, genAPI,
    addPendingSave: vi.fn(), openSettings: vi.fn(), t: (k) => k, generationQueue: null,
    selectedStyleRefId: null,
    selectedStyleRefIdRef: { current: null },
    scenes: [],
    scenesRef: null,
  }))
  return { result, genAPI }
}

async function runBatch(result) {
  vi.useFakeTimers()
  try {
    let batch
    await act(async () => { batch = result.current.handleGenerateAllRefs() })
    for (let i = 0; i < 20; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(16000) })
    }
    await act(async () => { await batch })
  } finally {
    vi.useRealTimers()
  }
}

describe('useReferenceGeneration — 제출 seed 는 공유 파생을 따른다', () => {
  it('단건 생성: 앱 기본형(seedLocked:true + 숫자 seedNo)의 숫자가 제출 옵션에 실린다', async () => {
    const locked = setupHook({ seedLocked: true, seedNo: 7777 })
    await act(async () => { await locked.result.current.handleGenerateRef(0, true) })
    expect(locked.genAPI.generateImage).toHaveBeenCalledOnce()
    expect(locked.genAPI.generateImage.mock.calls[0][2].seed).toBe(7777)

    const unlocked = setupHook({ seedLocked: false, seedNo: 7777 })
    await act(async () => { await unlocked.result.current.handleGenerateRef(0, true) })
    expect(unlocked.genAPI.generateImage.mock.calls[0][2].seed).toBeNull()
  })

  it('배치 생성: 같은 파생 결과가 submitGeneration 옵션에 실린다', async () => {
    const locked = setupHook({ seedLocked: true, seedNo: 4242 })
    await runBatch(locked.result)
    expect(locked.genAPI.submitGeneration).toHaveBeenCalled()
    expect(locked.genAPI.submitGeneration.mock.calls[0][2].seed).toBe(4242)

    const unlocked = setupHook({ seedLocked: false, seedNo: 4242 })
    await runBatch(unlocked.result)
    expect(unlocked.genAPI.submitGeneration.mock.calls[0][2].seed).toBeNull()
  })
})
