/**
 * useReferenceGeneration — M2 targeted reference batch
 *
 * M2는 씬이 실제로 참조한 빈 카드만 생성한 뒤 구조화 결과를 await한다.
 * 따라서 선택 범위뿐 아니라 queue wrapper가 내부 결과를 그대로 반환하는지까지
 * 공개 API(handleGenerateAllRefs) 기준으로 검증한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

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
  cleanBase64: vi.fn(s => s),
  toDataURL: vi.fn(s => s),
}))

import { toast } from '../../src/components/Toast'
import { checkAuthToken } from '../../src/utils/guards'
import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

const RESULT_KEYS = [
  'ok',
  'outcome',
  'requestedKeys',
  'attemptedKeys',
  'succeededKeys',
  'skipped',
  'failed',
  'currentRefs',
].sort()

function expectBatchResultShape(batchResult) {
  expect(Object.keys(batchResult).sort()).toEqual(RESULT_KEYS)
  expect(typeof batchResult.ok).toBe('boolean')
  expect(typeof batchResult.outcome).toBe('string')
  expect(Array.isArray(batchResult.requestedKeys)).toBe(true)
  expect(Array.isArray(batchResult.attemptedKeys)).toBe(true)
  expect(Array.isArray(batchResult.succeededKeys)).toBe(true)
  expect(Array.isArray(batchResult.skipped)).toBe(true)
  expect(Array.isArray(batchResult.failed)).toBe(true)
  expect(Array.isArray(batchResult.currentRefs)).toBe(true)
}

function createPassthroughQueue() {
  let executeResult
  const enqueue = vi.fn(async job => {
    executeResult = await job.execute()
    return executeResult
  })
  return {
    generationQueue: { enqueue },
    getExecuteResult: () => executeResult,
  }
}

function setupHook({
  references,
  generationQueue = null,
  selectedStyleRefId = null,
  genOverrides = {},
  settingsOverrides = {},
  hookOverrides = {},
}) {
  let liveRefs = references.map(ref => ({ ...ref }))
  let generationNo = 0
  const submitOrder = []
  const submitCalls = []
  const setReferences = vi.fn(updater => {
    liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
  })
  const genAPI = {
    mode: 'api',
    getAccessToken: vi.fn().mockResolvedValue('token'),
    clearTokenCache: vi.fn(),
    generateImage: vi.fn().mockResolvedValue({
      success: true,
      images: [{ base64: 'generated-image', mediaId: 'generated-media' }],
    }),
    submitGeneration: vi.fn(async (prompt, styleRefImages, options) => {
      generationNo += 1
      submitOrder.push(prompt)
      submitCalls.push({ prompt, styleRefImages, options })
      return { success: true, generationId: `g-${generationNo}` }
    }),
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({
      success: true,
      images: [{ base64: 'generated-image', mediaId: 'generated-media' }],
    }),
    uploadReference: vi.fn().mockResolvedValue({
      success: true,
      mediaId: 'uploaded-media',
      caption: '',
    }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    ...genOverrides,
  }

  const stateLog = []
  const { result } = renderHook(() => {
    const value = useReferenceGeneration({
      settings: {
        saveMode: 'project',
        imageBatchCount: 1,
        concurrency: 5,
        ...settingsOverrides,
      },
      references: liveRefs,
      setReferences,
      genAPI,
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: key => key,
      selectedStyleRefId,
      generationQueue,
      ...hookOverrides,
    })
    stateLog.push({
      refBatchActive: value.refBatchActive,
      preparingRefs: value.preparingRefs,
      generatingRefs: value.generatingRefs,
    })
    return value
  })

  return {
    result,
    genAPI,
    setReferences,
    submitOrder,
    submitCalls,
    stateLog,
    getLiveRefs: () => liveRefs,
  }
}

const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

// batchOrder.test.jsx와 같은 방식으로 제출 게이트와 마지막 drain poll을 진행한다.
async function runBatch(result, overrideStyleId = null, options = {}) {
  vi.useFakeTimers()
  let batchPromise
  try {
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs(overrideStyleId, options)
    })
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16000)
      })
    }
    let batchResult
    await act(async () => {
      batchResult = await batchPromise
    })
    return batchResult
  } finally {
    vi.useRealTimers()
  }
}

async function callBatch(result, overrideStyleId = null, options = {}) {
  let batchResult
  await act(async () => {
    batchResult = await result.current.handleGenerateAllRefs(overrideStyleId, options)
  })
  return batchResult
}

beforeEach(() => {
  vi.clearAllMocks()
  checkAuthToken.mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useReferenceGeneration — targeted 선택', () => {
  it('1) targetRefKeys에 든 카드만 생성하고 같은 pool의 다른 pending 카드는 건드리지 않는다', async () => {
    const { result, submitOrder } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
        { id: 'other', type: 'character', prompt: 'other portrait', status: 'pending' },
      ],
    })

    await runBatch(result, null, { targetRefKeys: ['id:ghost'] })

    expect(submitOrder).toEqual(['ghost portrait'])
  })

  it('2) targeted 안에서도 style phase를 non-style phase보다 먼저 끝낸다', async () => {
    const { result, submitOrder } = setupHook({
      references: [
        { id: 'hero', type: 'character', prompt: 'hero portrait', status: 'pending' },
        { id: 'look', type: 'style', name: 'Watercolor', prompt: 'watercolor', status: 'pending' },
      ],
    })

    await runBatch(result, null, {
      targetRefKeys: ['id:hero', 'id:look'],
    })

    expect(submitOrder).toHaveLength(2)
    expect(submitOrder[0]).toBe('watercolor')
    expect(submitOrder[1]).toContain('hero portrait')
  })

  it('3) target key가 맞아도 mediaId가 이미 있으면 생성하지 않는다', async () => {
    const { result, genAPI } = setupHook({
      references: [
        {
          id: 'ghost',
          type: 'character',
          prompt: 'ghost portrait',
          mediaId: 'existing-media',
          status: 'pending',
        },
      ],
    })

    const batchResult = await callBatch(result, null, {
      targetRefKeys: ['id:ghost'],
    })

    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(batchResult).toMatchObject({ ok: true, outcome: 'noop' })
  })

  it('4) target 카드에 prompt가 없으면 skip하고 다른 pending 카드로 새지 않는다', async () => {
    const { result, genAPI } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: '', status: 'pending' },
        { id: 'other', type: 'character', prompt: 'other portrait', status: 'pending' },
      ],
    })

    const batchResult = await callBatch(result, null, {
      targetRefKeys: ['id:ghost'],
    })

    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(batchResult).toMatchObject({ ok: true, outcome: 'noop' })
  })

  it('5) target key가 pool에서 삭제됐으면 예외 없이 noop하고 다른 카드로 새지 않는다', async () => {
    const { result, genAPI } = setupHook({
      references: [
        { id: 'other', type: 'character', prompt: 'other portrait', status: 'pending' },
      ],
    })

    const batchResult = await callBatch(result, null, {
      targetRefKeys: ['id:deleted'],
    })

    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'noop',
      requestedKeys: ['id:deleted'],
    })
  })

  it('6) 빈 targetRefKeys 배열은 정상 targeted noop이다', async () => {
    const { result, genAPI } = setupHook({
      references: [
        { id: 'other', type: 'character', prompt: 'other portrait', status: 'pending' },
      ],
    })

    const batchResult = await callBatch(result, null, { targetRefKeys: [] })

    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expectBatchResultShape(batchResult)
    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'noop',
      requestedKeys: [],
    })
  })

  it('7) targetRefKeys:null은 imagePath/mediaId를 무시하는 기존 global pending 의미를 보존한다', async () => {
    const { result, submitOrder } = setupHook({
      references: [
        {
          id: 'image-path-only',
          type: 'character',
          prompt: 'image path pending',
          imagePath: '/legacy/image.png',
          status: 'pending',
        },
        {
          id: 'media-only',
          type: 'character',
          prompt: 'media pending',
          mediaId: 'legacy-media',
          status: 'pending',
        },
        {
          id: 'done-empty',
          type: 'character',
          prompt: 'done should stay skipped globally',
          status: 'done',
        },
      ],
    })

    await runBatch(result, null, { targetRefKeys: null })

    expect(submitOrder).toEqual(['image path pending', 'media pending'])
  })

  it('targeted는 status done만으로 이미지가 있다고 보지 않고 실제 빈 카드를 생성한다', async () => {
    const { result, submitOrder } = setupHook({
      references: [
        {
          id: 'ghost',
          type: 'character',
          prompt: 'done but empty',
          status: 'done',
        },
      ],
    })

    await runBatch(result, null, { targetRefKeys: ['id:ghost'] })

    expect(submitOrder).toEqual(['done but empty'])
  })
})

describe('useReferenceGeneration — targeted noop 토스트 정책', () => {
  it('8) targeted 대상이 전부 already-filled면 allRefsGenerated 토스트를 띄우지 않는다', async () => {
    const { result, genAPI } = setupHook({
      references: [
        {
          id: 'ghost',
          type: 'character',
          prompt: 'ghost portrait',
          data: 'existing-image',
          status: 'done',
        },
      ],
    })

    await callBatch(result, null, { targetRefKeys: ['id:ghost'] })

    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalledWith('toast.allRefsGenerated')
  })

  it('9) global batch 대상이 없으면 기존 allRefsGenerated 토스트를 한 번 띄운다', async () => {
    const { result, genAPI } = setupHook({
      references: [
        {
          id: 'ghost',
          type: 'character',
          prompt: 'ghost portrait',
          data: 'existing-image',
          status: 'done',
        },
      ],
    })

    await callBatch(result)

    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(toast.info).toHaveBeenCalledWith('toast.allRefsGenerated')
  })
})

describe('useReferenceGeneration — 구조화 결과 반환 경로', () => {
  it('10) generationQueue가 있으면 enqueue execute 결과 객체를 그대로 반환한다', async () => {
    const queue = createPassthroughQueue()
    const { result } = setupHook({
      references: [
        { id: 'other', type: 'character', prompt: 'other portrait', status: 'pending' },
      ],
      generationQueue: queue.generationQueue,
    })

    const batchResult = await callBatch(result, null, { targetRefKeys: [] })

    expect(queue.generationQueue.enqueue).toHaveBeenCalledTimes(1)
    expectBatchResultShape(batchResult)
    expect(batchResult).toBe(queue.getExecuteResult())
  })

  it('11) generationQueue가 없어도 non-noop 완료 결과와 authoritative currentRefs를 반환한다', async () => {
    const { result } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
    })

    const batchResult = await runBatch(result, null, {
      targetRefKeys: ['id:ghost'],
    })

    expectBatchResultShape(batchResult)
    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'completed',
      requestedKeys: ['id:ghost'],
    })
    expect(batchResult.currentRefs[0]).toMatchObject({
      id: 'ghost',
      status: 'done',
      mediaId: 'generated-media',
    })
  })

  it('12) enqueue rejection을 exception stage의 구조화 실패로 변환한다', async () => {
    const queueError = new Error('queue exploded')
    const generationQueue = {
      enqueue: vi.fn().mockRejectedValue(queueError),
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      generationQueue,
    })

    const batchResult = await callBatch(result, null, {
      targetRefKeys: ['id:ghost'],
    })

    expectBatchResultShape(batchResult)
    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'failed',
      requestedKeys: ['id:ghost'],
      failed: [
        {
          key: null,
          stage: 'exception',
          error: 'queue exploded',
        },
      ],
    })
    expect(warnSpy).toHaveBeenCalledWith(
      '[RefGen] Batch queue rejected:',
      'queue exploded',
    )
  })
})

describe('useReferenceGeneration — style pass-through', () => {
  it("13) queue 경유 preset:noir override를 그대로 적용한다", async () => {
    const queue = createPassthroughQueue()
    const { result, submitOrder } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      generationQueue: queue.generationQueue,
    })

    await runBatch(result, 'preset:noir', {
      targetRefKeys: ['id:ghost'],
    })

    expect(submitOrder).toEqual([
      'ghost portrait, Film noir style, high contrast black and white, dramatic shadows',
    ])
  })

  it("14) queue 경유 'none' sentinel을 null로 바꾸지 않고 무스타일로 적용한다", async () => {
    const queue = createPassthroughQueue()
    const { result, submitOrder } = setupHook({
      references: [
        {
          id: 'look',
          type: 'style',
          name: 'Watercolor',
          prompt: 'watercolor',
          data: 'style-image',
          status: 'done',
        },
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      generationQueue: queue.generationQueue,
    })

    await runBatch(result, 'none', {
      targetRefKeys: ['id:ghost'],
    })

    expect(submitOrder).toEqual(['ghost portrait'])
  })

  it('15) M2 호출은 null override로 Ref탭 auto-fallback을 타며 target 밖 카드와 씬 style을 섞지 않는다', async () => {
    const { result, submitOrder } = setupHook({
      references: [
        {
          id: 'look',
          type: 'style',
          name: 'Watercolor',
          prompt: 'watercolor',
          data: 'style-image',
          status: 'done',
        },
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
        { id: 'other', type: 'character', prompt: 'other portrait', status: 'pending' },
      ],
    })

    await runBatch(result, null, {
      targetRefKeys: ['id:ghost'],
      reason: 'm2-empty-reference-gate',
      // 씬 배치가 계산한 스타일이 options에 섞여 와도 ref batch는 절대 읽지 않는다.
      effectiveStyleId: 'preset:noir',
    })

    expect(submitOrder).toEqual(['ghost portrait, watercolor'])
    expect(submitOrder[0]).not.toContain('other portrait')
    expect(submitOrder[0]).not.toContain('Film noir')
  })
})

describe('useReferenceGeneration — Ref batch 전체 수명', () => {
  it('두 Flow character의 아이템 auth 창과 아이템 사이에도 refBatchActive가 끊기지 않는다', async () => {
    const firstItemAuth = deferred()
    const secondItemAuth = deferred()
    checkAuthToken
      .mockResolvedValueOnce(true)
      .mockReturnValueOnce(firstItemAuth.promise)
      .mockReturnValueOnce(secondItemAuth.promise)

    const { result, genAPI, stateLog } = setupHook({
      references: [
        { id: 'first', type: 'character', prompt: 'first portrait', status: 'pending' },
        { id: 'second', type: 'character', prompt: 'second portrait', status: 'pending' },
      ],
      genOverrides: { mode: 'flow' },
    })

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs(null, {
        targetRefKeys: ['id:first', 'id:second'],
      })
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })

    expect(checkAuthToken).toHaveBeenCalledTimes(2)
    expect(result.current.preparingRefs).toBe(false)
    expect(result.current.generatingRefs).toEqual([])
    expect(result.current.refBatchActive).toBe(true)

    await act(async () => {
      firstItemAuth.resolve(true)
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })

    expect(genAPI.generateImage).toHaveBeenCalledTimes(1)
    expect(checkAuthToken).toHaveBeenCalledTimes(3)
    expect(result.current.preparingRefs).toBe(false)
    expect(result.current.generatingRefs).toEqual([])
    expect(result.current.refBatchActive).toBe(true)

    await act(async () => {
      secondItemAuth.resolve(true)
      await batchPromise
    })

    const firstActive = stateLog.findIndex(state => state.refBatchActive === true)
    const lastActive = stateLog.findLastIndex(state => state.refBatchActive === true)
    expect(firstActive).toBeGreaterThanOrEqual(0)
    expect(stateLog.slice(firstActive, lastActive + 1).every(state => state.refBatchActive)).toBe(true)
    expect(result.current.refBatchActive).toBe(false)
    expect(result.current.preparingRefs).toBe(false)
  })

  it.each([
    ['permission 조기 실패', {
      settingsOverrides: { saveMode: 'folder' },
      arrange: async () => {
        const { fileSystemAPI } = await import('../../src/hooks/useFileSystem')
        fileSystemAPI.ensurePermission.mockResolvedValueOnce({ error: 'not_set' })
      },
    }],
    ['auth 조기 실패', {
      arrange: async () => { checkAuthToken.mockResolvedValueOnce(false) },
    }],
    ['unexpected throw', {
      settingsOverrides: { saveMode: 'folder' },
      arrange: async () => {
        const { fileSystemAPI } = await import('../../src/hooks/useFileSystem')
        fileSystemAPI.ensurePermission.mockRejectedValueOnce(new Error('permission IPC failed'))
      },
      rejects: true,
    }],
  ])('%s 뒤에는 lifecycle flags를 모두 정리한다', async (_label, scenario) => {
    await scenario.arrange()
    const { result } = setupHook({
      references: [{ id: 'target', type: 'scene', prompt: 'portrait', status: 'pending' }],
      settingsOverrides: scenario.settingsOverrides,
    })

    await act(async () => {
      const promise = result.current.handleGenerateAllRefs(null, { targetRefKeys: ['id:target'] })
      if (scenario.rejects) await expect(promise).rejects.toThrow('permission IPC failed')
      else await promise
    })

    expect(result.current.refBatchActive).toBe(false)
    expect(result.current.preparingRefs).toBe(false)
  })

  it('target 0건은 beforeBatchActivation 대기 중에도 두 lifecycle flag를 한 번도 켜지 않는다', async () => {
    const activationGate = deferred()
    const beforeBatchActivation = vi.fn(() => activationGate.promise)
    const { result, stateLog } = setupHook({
      references: [{ id: 'filled', type: 'scene', prompt: 'filled', data: 'image', status: 'done' }],
      hookOverrides: { beforeBatchActivation },
    })

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs(null, { targetRefKeys: ['id:filled'] })
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })

    expect(beforeBatchActivation).toHaveBeenCalledTimes(1)
    expect(result.current.refBatchActive).toBe(false)
    expect(result.current.preparingRefs).toBe(false)

    await act(async () => {
      activationGate.resolve()
      await batchPromise
    })
    expect(stateLog.some(state => state.refBatchActive || state.preparingRefs)).toBe(false)
  })

  it('queued Stop은 beforeBatchActivation에 진입하지 않고 두 lifecycle flag 없이 즉시 stopped 된다', async () => {
    const queueGate = deferred()
    const activationGate = deferred()
    const beforeBatchActivation = vi.fn(() => activationGate.promise)
    const generationQueue = {
      enqueue: vi.fn(async job => {
        await queueGate.promise
        return job.execute()
      }),
    }
    const { result, stateLog } = setupHook({
      references: [{ id: 'target', type: 'scene', prompt: 'portrait', status: 'pending' }],
      generationQueue,
      hookOverrides: { beforeBatchActivation },
    })

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs(null, { targetRefKeys: ['id:target'] })
      await Promise.resolve()
      result.current.stopGenerateAllRefs()
      queueGate.resolve()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })

    expect(beforeBatchActivation).not.toHaveBeenCalled()
    expect(result.current.refBatchActive).toBe(false)
    expect(result.current.preparingRefs).toBe(false)

    let batchResult
    await act(async () => {
      batchResult = await batchPromise
    })

    expect(batchResult.outcome).toBe('stopped')
    expect(stateLog.some(state => state.refBatchActive || state.preparingRefs)).toBe(false)
    expect(result.current.refBatchActive).toBe(false)
    expect(result.current.preparingRefs).toBe(false)
  })
})
