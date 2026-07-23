/**
 * useReferenceGeneration — M2 structured batch result stage aggregation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const coordinatorMocks = vi.hoisted(() => ({
  runFlowCharacterOperation: vi.fn(),
  runFlowComposerRefresh: vi.fn(),
}))

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
  cleanBase64: vi.fn(value => value),
  toDataURL: vi.fn(value => value),
}))

vi.mock('../../src/utils/flowCharacterCoordinator', () => ({
  runFlowCharacterOperation: coordinatorMocks.runFlowCharacterOperation,
  runFlowComposerRefresh: coordinatorMocks.runFlowComposerRefresh,
}))

import {
  checkAuthToken,
  checkFlowProjectReady,
} from '../../src/utils/guards'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'
import { tryUpscaleImage } from '../../src/utils/imageProcessing'
import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

function setupHook({
  references,
  settingsOverrides = {},
  genOverrides = {},
  flowProjectReady = true,
  electronAPIOverrides = {},
}) {
  window.electronAPI = {
    ...(window.electronAPI || {}),
    refreshFlowComposer: vi.fn().mockResolvedValue({ success: true }),
    ...electronAPIOverrides,
  }
  let liveRefs = references.map(ref => ({ ...ref }))
  let generationNo = 0
  const setReferences = vi.fn(updater => {
    liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
  })
  const genAPI = {
    mode: 'api',
    getAccessToken: vi.fn().mockResolvedValue('token'),
    clearTokenCache: vi.fn(),
    generateImage: vi.fn().mockResolvedValue({
      success: true,
      images: [{ base64: 'direct-image', mediaId: 'direct-media' }],
    }),
    submitGeneration: vi.fn(async () => {
      generationNo += 1
      return { success: true, generationId: `g-${generationNo}` }
    }),
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({
      success: true,
      images: [{ base64: 'collected-image', mediaId: 'collected-media' }],
    }),
    uploadReference: vi.fn().mockResolvedValue({
      success: true,
      mediaId: 'uploaded-media',
      caption: '',
    }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    ...genOverrides,
  }

  const { result, rerender } = renderHook(() => useReferenceGeneration({
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
    selectedStyleRefId: null,
    generationQueue: null,
    flowProjectReady,
    flowProjectId: 'flow-project',
  }))

  return {
    result,
    genAPI,
    getLiveRefs: () => liveRefs,
    replaceLiveRefs: nextRefs => {
      liveRefs = nextRefs.map(ref => ({ ...ref }))
      rerender()
    },
  }
}

async function callBatch(result, targetRefKeys) {
  let batchResult
  await act(async () => {
    batchResult = await result.current.handleGenerateAllRefs(null, { targetRefKeys })
  })
  return batchResult
}

const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

async function runTimedBatch(result, targetRefKeys) {
  vi.useFakeTimers()
  let batchPromise
  try {
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs(null, { targetRefKeys })
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

let previousElectronAPI

beforeEach(() => {
  previousElectronAPI = window.electronAPI
  vi.clearAllMocks()
  checkAuthToken.mockResolvedValue(true)
  checkFlowProjectReady.mockReturnValue({ ok: true })
  fileSystemAPI.ensurePermission.mockResolvedValue({
    hasPermission: true,
    name: 'test',
  })
  coordinatorMocks.runFlowCharacterOperation.mockImplementation(({ task }) => task())
  coordinatorMocks.runFlowComposerRefresh.mockImplementation(() => (
    window.electronAPI?.refreshFlowComposer?.()
  ))
})

afterEach(() => {
  window.electronAPI = previousElectronAPI
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useReferenceGeneration — structured batch result', () => {
  it('1) target 2건 전부 성공하면 attempted/succeeded key와 completed 결과를 반환한다', async () => {
    const { result } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
        { id: 'hero', type: 'character', prompt: 'hero portrait', status: 'pending' },
      ],
    })

    const batchResult = await runTimedBatch(result, ['id:ghost', 'id:hero'])

    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'completed',
      requestedKeys: ['id:ghost', 'id:hero'],
      attemptedKeys: ['id:ghost', 'id:hero'],
      succeededKeys: ['id:ghost', 'id:hero'],
      skipped: [],
      failed: [],
    })
  })

  it('2) 실행 시점에 이미 채워진 target은 already-filled로 skip하고 나머지 성공을 막지 않는다', async () => {
    const { result } = setupHook({
      references: [
        {
          id: 'filled',
          type: 'character',
          prompt: 'filled portrait',
          data: 'existing-image',
          status: 'done',
        },
        { id: 'empty', type: 'character', prompt: 'empty portrait', status: 'pending' },
      ],
    })

    const batchResult = await runTimedBatch(result, ['id:filled', 'id:empty'])

    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'completed',
      succeededKeys: ['id:empty'],
      skipped: [{ key: 'id:filled', stage: 'already-filled' }],
      failed: [],
    })
  })

  it('3) 실행 시점에 prompt가 사라진 target은 missing-prompt로 skip하고 batch 자체는 성공한다', async () => {
    const { result, genAPI } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: '', status: 'pending' },
      ],
    })

    const batchResult = await callBatch(result, ['id:ghost'])

    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'noop',
      skipped: [{ key: 'id:ghost', stage: 'missing-prompt' }],
      failed: [],
    })
  })

  it('4) 실행 시점 pool에 없는 target key는 not-found로 skip한다', async () => {
    const { result, genAPI } = setupHook({
      references: [
        { id: 'other', type: 'character', prompt: 'other portrait', status: 'pending' },
      ],
    })

    const batchResult = await callBatch(result, ['id:deleted'])

    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'noop',
      skipped: [{ key: 'id:deleted', stage: 'not-found' }],
      failed: [],
    })
  })

  it('5) submit 실패는 해당 key의 submit stage 실패로 반환한다', async () => {
    const { result } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      genOverrides: {
        submitGeneration: vi.fn().mockResolvedValue({
          success: false,
          error: 'submit exploded',
        }),
      },
    })

    const batchResult = await callBatch(result, ['id:ghost'])

    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'failed',
      succeededKeys: [],
      failed: [{
        key: 'id:ghost',
        stage: 'submit',
        error: 'submit exploded',
      }],
    })
  })

  it('6) Flow character coordinator busy는 해당 key의 busy stage 실패로 반환한다', async () => {
    coordinatorMocks.runFlowCharacterOperation.mockResolvedValueOnce({
      busy: true,
      error: 'coordinator busy',
    })
    const { result } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      genOverrides: { mode: 'flow' },
    })

    const batchResult = await callBatch(result, ['id:ghost'])

    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'failed',
      succeededKeys: [],
      failed: [{
        key: 'id:ghost',
        stage: 'busy',
        error: 'coordinator busy',
      }],
    })
  })

  it('7) collect 후처리 예외는 pending ref key의 collect stage 실패로 반환한다', async () => {
    const collectError = new Error('collect exploded')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      genOverrides: {
        collectGeneration: vi.fn().mockRejectedValue(collectError),
      },
    })

    const batchResult = await runTimedBatch(result, ['id:ghost'])

    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'failed',
      succeededKeys: [],
      failed: [{
        key: 'id:ghost',
        stage: 'collect',
        error: 'collect exploded',
      }],
    })
  })

  it('8) stop 없이 pendingQueue가 남으면 해당 key의 timeout stage 실패로 반환한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      genOverrides: {
        checkGeneration: vi.fn().mockResolvedValue({
          success: true,
          completed: false,
        }),
      },
    })

    const batchResult = await runTimedBatch(result, ['id:ghost'])

    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'failed',
      succeededKeys: [],
      failed: [{
        key: 'id:ghost',
        stage: 'timeout',
        error: 'Timed out',
      }],
    })
  })

  it('9) 폴더 권한 거부는 batch-wide permission 실패 1건이며 submit하지 않는다', async () => {
    fileSystemAPI.ensurePermission.mockResolvedValueOnce({
      hasPermission: false,
      error: 'permission denied',
    })
    const { result, genAPI } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      settingsOverrides: { saveMode: 'folder' },
    })

    const batchResult = await callBatch(result, ['id:ghost'])

    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'failed',
      failed: [{
        key: null,
        stage: 'permission',
        error: 'permission denied',
      }],
    })
  })

  it('10) auth 토큰 실패는 batch-wide auth 실패 1건이다', async () => {
    checkAuthToken.mockResolvedValueOnce(false)
    const { result } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
    })

    const batchResult = await callBatch(result, ['id:ghost'])

    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'failed',
      failed: [{
        key: null,
        stage: 'auth',
        error: expect.any(String),
      }],
    })
  })

  it('11) Flow project 미준비는 batch-wide flow-ready 실패 1건이다', async () => {
    checkFlowProjectReady.mockReturnValueOnce({
      ok: false,
      error: 'Flow project unavailable',
    })
    const { result } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      flowProjectReady: false,
    })

    const batchResult = await callBatch(result, ['id:ghost'])

    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'failed',
      failed: [{
        key: null,
        stage: 'flow-ready',
        error: 'Flow project unavailable',
      }],
    })
  })

  it('12) collection 중 user stop은 timeout 실패가 아니라 stopped 결과다', async () => {
    const { result, genAPI } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      genOverrides: {
        checkGeneration: vi.fn().mockResolvedValue({
          success: true,
          completed: false,
        }),
      },
    })
    genAPI.checkGeneration.mockImplementation(async () => {
      result.current.stopGenerateAllRefs()
      return { success: true, completed: false }
    })

    const batchResult = await runTimedBatch(result, ['id:ghost'])

    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'stopped',
      failed: [],
    })
  })

  it('13) 성공 결과의 currentRefs는 동기 패치된 mediaId를 반영한 authoritative 배열이다', async () => {
    const { result, getLiveRefs } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      genOverrides: {
        collectGeneration: vi.fn().mockResolvedValue({
          success: true,
          images: [{ base64: 'fresh-image', mediaId: 'fresh-media' }],
        }),
      },
    })

    const batchResult = await runTimedBatch(result, ['id:ghost'])

    expect(batchResult.currentRefs).toEqual(getLiveRefs())
    expect(batchResult.currentRefs[0]).toMatchObject({
      id: 'ghost',
      status: 'done',
      data: 'fresh-image',
      mediaId: 'fresh-media',
    })
  })

  it('14) Flow character 성공 결과의 entityId/workflowId가 currentRefs에 실린다', async () => {
    const { result } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      genOverrides: {
        mode: 'flow',
        generateImage: vi.fn().mockResolvedValue({
          success: true,
          images: [{ base64: 'character-image', mediaId: 'character-media' }],
          entityId: 'entity-ghost',
          workflowId: 'workflow-ghost',
          registered: true,
        }),
      },
    })

    const batchResult = await callBatch(result, ['id:ghost'])

    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'completed',
      succeededKeys: ['id:ghost'],
    })
    expect(batchResult.currentRefs[0]).toMatchObject({
      id: 'ghost',
      status: 'done',
      mediaId: 'character-media',
      entityId: 'entity-ghost',
      workflowId: 'workflow-ghost',
    })
  })

  it('15) 앞 target이 삭제돼 index가 당겨져도 non-target을 제출/덮어쓰지 않고 삭제 target을 not-found로 남긴다', async () => {
    let replaceLiveRefs
    let deleted = false
    const { result, genAPI, getLiveRefs, replaceLiveRefs: replace } = setupHook({
      references: [
        { id: 'vanished', type: 'scene', prompt: 'vanished prompt', status: 'pending' },
        { id: 'survivor', type: 'scene', prompt: 'survivor prompt', status: 'pending' },
        { id: 'outside', type: 'scene', prompt: 'outside prompt', data: 'keep-image', mediaId: 'keep-media', status: 'done' },
      ],
      settingsOverrides: { concurrency: 1 },
      genOverrides: {
        checkGeneration: vi.fn(async generationId => {
          if (!deleted && generationId === 'g-1') {
            deleted = true
            replaceLiveRefs([
              { id: 'survivor', type: 'scene', prompt: 'survivor prompt', status: 'pending' },
              { id: 'outside', type: 'scene', prompt: 'outside prompt', data: 'keep-image', mediaId: 'keep-media', status: 'done' },
            ])
          }
          return { success: true, completed: true }
        }),
        collectGeneration: vi.fn(async generationId => ({
          success: true,
          images: [{
            base64: `${generationId}-image`,
            mediaId: `${generationId}-media`,
          }],
        })),
      },
    })
    replaceLiveRefs = replace

    const batchResult = await runTimedBatch(result, ['id:vanished', 'id:survivor'])

    expect(genAPI.submitGeneration.mock.calls.map(([, , opts]) => opts.ref.id))
      .toEqual(['vanished', 'survivor'])
    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'completed',
      requestedKeys: ['id:vanished', 'id:survivor'],
      attemptedKeys: ['id:vanished', 'id:survivor'],
      succeededKeys: ['id:survivor'],
      skipped: [{ key: 'id:vanished', stage: 'not-found' }],
      failed: [],
    })
    expect(getLiveRefs()).toEqual([
      expect.objectContaining({
        id: 'survivor',
        data: 'g-2-image',
        mediaId: 'g-2-media',
        status: 'done',
      }),
      expect.objectContaining({
        id: 'outside',
        data: 'keep-image',
        mediaId: 'keep-media',
        status: 'done',
      }),
    ])
  })

  it('16) batch 중 reorder돼도 pending 결과와 다음 submit을 각각 target key의 현재 index로 해석한다', async () => {
    let replaceLiveRefs
    let reordered = false
    const { result, genAPI, getLiveRefs, replaceLiveRefs: replace } = setupHook({
      references: [
        { id: 'first', type: 'scene', prompt: 'first prompt', status: 'pending' },
        { id: 'second', type: 'scene', prompt: 'second prompt', status: 'pending' },
        { id: 'outside', type: 'scene', prompt: 'outside prompt', data: 'keep-image', mediaId: 'keep-media', status: 'done' },
      ],
      settingsOverrides: { concurrency: 1 },
      genOverrides: {
        checkGeneration: vi.fn(async generationId => {
          if (!reordered && generationId === 'g-1') {
            reordered = true
            replaceLiveRefs([
              { id: 'second', type: 'scene', prompt: 'second prompt', status: 'pending' },
              { id: 'outside', type: 'scene', prompt: 'outside prompt', data: 'keep-image', mediaId: 'keep-media', status: 'done' },
              { id: 'first', type: 'scene', prompt: 'first prompt', status: 'generating' },
            ])
          }
          return { success: true, completed: true }
        }),
        collectGeneration: vi.fn(async generationId => ({
          success: true,
          images: [{
            base64: `${generationId}-image`,
            mediaId: `${generationId}-media`,
          }],
        })),
      },
    })
    replaceLiveRefs = replace

    const batchResult = await runTimedBatch(result, ['id:first', 'id:second'])

    expect(genAPI.submitGeneration.mock.calls.map(([, , opts]) => opts.ref.id))
      .toEqual(['first', 'second'])
    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'completed',
      attemptedKeys: ['id:first', 'id:second'],
      succeededKeys: ['id:first', 'id:second'],
      skipped: [],
      failed: [],
    })
    expect(getLiveRefs()).toEqual([
      expect.objectContaining({
        id: 'second',
        data: 'g-2-image',
        mediaId: 'g-2-media',
      }),
      expect.objectContaining({
        id: 'outside',
        data: 'keep-image',
        mediaId: 'keep-media',
      }),
      expect.objectContaining({
        id: 'first',
        data: 'g-1-image',
        mediaId: 'g-1-media',
      }),
    ])
  })

  it('17) batch 중 reorder된 target 결과 정리가 아직 생성 중인 sibling의 submit marker를 지우지 않는다', async () => {
    let firstDone = false
    let siblingDone = false
    let reordered = false
    const { result, genAPI, replaceLiveRefs } = setupHook({
      references: [
        { id: 'first', type: 'scene', prompt: 'first prompt', status: 'pending' },
        { id: 'second', type: 'scene', prompt: 'second prompt', status: 'pending' },
      ],
      settingsOverrides: { concurrency: 2 },
      genOverrides: {
        checkGeneration: vi.fn(async generationId => {
          if (genAPI.submitGeneration.mock.calls.length < 2) {
            return { success: true, completed: false }
          }
          if (!reordered) {
            reordered = true
            replaceLiveRefs([
              { id: 'second', type: 'scene', prompt: 'second prompt', status: 'generating' },
              { id: 'first', type: 'scene', prompt: 'first prompt', status: 'generating' },
            ])
          }
          if (generationId === 'g-1') {
            return { success: true, completed: firstDone }
          }
          return { success: true, completed: siblingDone }
        }),
        collectGeneration: vi.fn(async generationId => ({
          success: true,
          images: [{
            base64: `${generationId}-image`,
            mediaId: `${generationId}-media`,
          }],
        })),
      },
    })

    vi.useFakeTimers()
    let batchPromise
    try {
      await act(async () => {
        batchPromise = result.current.handleGenerateAllRefs(null, {
          targetRefKeys: ['id:first', 'id:second'],
        })
      })
      expect(result.current.generatingRefs).toEqual([0, 1])

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(result.current.generatingRefs).toEqual([0, 1])

      firstDone = true
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(result.current.generatingRefs).toEqual([1])

      await act(async () => {
        siblingDone = true
        await vi.advanceTimersByTimeAsync(3000)
        await batchPromise
      })
    } finally {
      siblingDone = true
      vi.useRealTimers()
    }
  })

  it('18) style prepare 중 reorder돼 submit index가 바뀌어도 marker를 추가한 index만 정리한다', async () => {
    const secondStyleUpload = deferred()
    let uploadNo = 0
    let submitNo = 0
    const { result, genAPI, getLiveRefs, replaceLiveRefs } = setupHook({
      references: [
        { id: 'first', type: 'scene', prompt: 'first prompt', status: 'pending' },
        { id: 'second', type: 'scene', prompt: 'second prompt', status: 'pending' },
        {
          id: 'look',
          type: 'style',
          name: 'Look',
          prompt: 'look prompt',
          data: 'style-image',
          status: 'done',
        },
      ],
      settingsOverrides: { concurrency: 2 },
      genOverrides: {
        mode: 'flow',
        uploadReference: vi.fn(async () => {
          uploadNo += 1
          if (uploadNo === 1) {
            return { success: false, error: 'first upload skipped' }
          }
          return secondStyleUpload.promise
        }),
        submitGeneration: vi.fn(async () => {
          submitNo += 1
          return submitNo === 1
            ? { success: true, generationId: 'g-1' }
            : { success: false, error: 'second submit failed' }
        }),
        checkGeneration: vi.fn().mockResolvedValue({
          success: true,
          completed: false,
        }),
      },
    })

    vi.useFakeTimers()
    let batchPromise
    try {
      await act(async () => {
        batchPromise = result.current.handleGenerateAllRefs('ref:look', {
          targetRefKeys: ['id:first', 'id:second'],
        })
        for (let i = 0; i < 10; i++) await Promise.resolve()
      })
      expect(genAPI.uploadReference).toHaveBeenCalledTimes(2)
      expect(result.current.generatingRefs).toEqual([0, 1])

      await act(async () => {
        const [first, second, look] = getLiveRefs()
        replaceLiveRefs([second, first, look])
      })
      await act(async () => {
        secondStyleUpload.resolve({
          success: true,
          mediaId: 'style-media',
          caption: '',
        })
        for (let i = 0; i < 10; i++) await Promise.resolve()
      })

      expect(genAPI.submitGeneration).toHaveBeenCalledTimes(2)
      expect(result.current.generatingRefs).toEqual([0])

      await act(async () => {
        result.current.stopGenerateAllRefs()
        await vi.advanceTimersByTimeAsync(4000)
        await batchPromise
      })
    } finally {
      secondStyleUpload.resolve({
        success: true,
        mediaId: 'style-media',
        caption: '',
      })
      vi.useRealTimers()
    }
  })

  it('19) reorder로 두 in-flight target이 같은 busy index를 공유해도 먼저 끝난 target이 marker를 지우지 않는다', async () => {
    const firstStyleUpload = deferred()
    let uploadNo = 0
    let submitNo = 0
    const { result, genAPI, getLiveRefs, replaceLiveRefs } = setupHook({
      references: [
        { id: 'first', type: 'scene', prompt: 'first prompt', status: 'pending' },
        { id: 'second', type: 'scene', prompt: 'second prompt', status: 'pending' },
        {
          id: 'look',
          type: 'style',
          name: 'Look',
          prompt: 'look prompt',
          data: 'style-image',
          status: 'done',
        },
      ],
      settingsOverrides: { concurrency: 2 },
      genOverrides: {
        mode: 'flow',
        uploadReference: vi.fn(async () => {
          uploadNo += 1
          if (uploadNo === 1) return firstStyleUpload.promise
          return {
            success: true,
            mediaId: 'style-media',
            caption: '',
          }
        }),
        submitGeneration: vi.fn(async () => {
          submitNo += 1
          return submitNo === 1
            ? { success: true, generationId: 'g-1' }
            : { success: false, error: 'second submit failed' }
        }),
        checkGeneration: vi.fn().mockResolvedValue({
          success: true,
          completed: false,
        }),
      },
    })

    vi.useFakeTimers()
    let batchPromise
    try {
      await act(async () => {
        batchPromise = result.current.handleGenerateAllRefs('ref:look', {
          targetRefKeys: ['id:first', 'id:second'],
        })
        for (let i = 0; i < 5; i++) await Promise.resolve()
      })
      expect(genAPI.uploadReference).toHaveBeenCalledTimes(1)
      expect(result.current.generatingRefs).toEqual([0])

      await act(async () => {
        const [first, second, look] = getLiveRefs()
        replaceLiveRefs([second, first, look])
      })
      await act(async () => {
        firstStyleUpload.resolve({
          success: false,
          error: 'first upload skipped',
        })
        for (let i = 0; i < 15; i++) await Promise.resolve()
      })

      expect(genAPI.submitGeneration).toHaveBeenCalledTimes(2)
      expect(result.current.generatingRefs).toEqual([0])

      await act(async () => {
        result.current.stopGenerateAllRefs()
        await vi.advanceTimersByTimeAsync(4000)
        await batchPromise
      })
    } finally {
      firstStyleUpload.resolve({
        success: false,
        error: 'first upload skipped',
      })
      vi.useRealTimers()
    }
  })

  it('Flow 혼합 batch에서 delete로 direct character와 충돌해도 async sibling marker를 유지한다', async () => {
    const directFinished = deferred()
    const firstSiblingCheck = deferred()
    let siblingDone = false
    let checkNo = 0
    coordinatorMocks.runFlowCharacterOperation.mockImplementationOnce(async ({ task }) => {
      const directResult = await task()
      directFinished.resolve()
      return directResult
    })
    const {
      result,
      genAPI,
      getLiveRefs,
      replaceLiveRefs,
    } = setupHook({
      references: [
        {
          id: 'outside',
          type: 'scene',
          prompt: 'outside prompt',
          data: 'keep-image',
          mediaId: 'keep-media',
          status: 'done',
        },
        { id: 'sibling', type: 'scene', prompt: 'sibling prompt', status: 'pending' },
        { id: 'character', type: 'character', prompt: 'character prompt', status: 'pending' },
      ],
      settingsOverrides: { concurrency: 2 },
      genOverrides: {
        mode: 'flow',
        submitGeneration: vi.fn().mockResolvedValue({
          success: true,
          generationId: 'g-sibling',
        }),
        checkGeneration: vi.fn(() => {
          checkNo += 1
          if (checkNo === 1) return firstSiblingCheck.promise
          return Promise.resolve({ success: true, completed: siblingDone })
        }),
        generateImage: vi.fn().mockResolvedValue({
          success: true,
          images: [{
            base64: 'character-image',
            mediaId: 'character-media',
          }],
        }),
        collectGeneration: vi.fn().mockResolvedValue({
          success: true,
          images: [{
            base64: 'sibling-image',
            mediaId: 'sibling-media',
          }],
        }),
      },
    })

    vi.useFakeTimers()
    let batchPromise
    try {
      await act(async () => {
        batchPromise = result.current.handleGenerateAllRefs(null, {
          targetRefKeys: ['id:sibling', 'id:character'],
        })
        for (let i = 0; i < 15; i++) await Promise.resolve()
      })
      expect(genAPI.checkGeneration).toHaveBeenCalledTimes(1)
      expect(result.current.generatingRefs).toEqual([1])

      await act(async () => {
        const [, sibling, character] = getLiveRefs()
        replaceLiveRefs([sibling, character])
      })
      await act(async () => {
        firstSiblingCheck.resolve({ success: true, completed: false })
        await directFinished.promise
      })

      expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
      expect(genAPI.generateImage).toHaveBeenCalledTimes(1)
      expect(coordinatorMocks.runFlowCharacterOperation.mock.calls[0][0].refIndex).toBe(1)
      expect(result.current.generatingRefs).toEqual([1])

      siblingDone = true
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
        await batchPromise
      })
      expect(result.current.generatingRefs).toEqual([])
    } finally {
      siblingDone = true
      firstSiblingCheck.resolve({ success: true, completed: false })
      if (batchPromise) {
        try {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(4000)
            await batchPromise
          })
        } catch (_error) {}
      }
      vi.useRealTimers()
    }
  })

  it('20) submit 성공 후 후처리 중 삭제된 target은 succeeded가 아니라 not-found이며 이동한 카드를 건드리지 않는다', async () => {
    const outside = {
      id: 'outside',
      type: 'scene',
      prompt: 'outside prompt',
      data: 'keep-image',
      mediaId: 'keep-media',
      status: 'done',
    }
    const { result, genAPI, getLiveRefs, replaceLiveRefs } = setupHook({
      references: [
        { id: 'vanished', type: 'scene', prompt: 'vanished prompt', status: 'pending' },
        outside,
      ],
      settingsOverrides: { concurrency: 1 },
      genOverrides: {
        collectGeneration: vi.fn().mockResolvedValue({
          success: true,
          images: [{
            base64: 'vanished-image',
            mediaId: 'vanished-media',
          }],
        }),
      },
    })
    let releaseUpscale
    tryUpscaleImage.mockImplementationOnce(() => new Promise(resolve => {
      releaseUpscale = resolve
    }))

    vi.useFakeTimers()
    let batchPromise
    let batchResult
    try {
      await act(async () => {
        batchPromise = result.current.handleGenerateAllRefs(null, {
          targetRefKeys: ['id:vanished'],
        })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(tryUpscaleImage).toHaveBeenCalledTimes(1)

      await act(async () => {
        replaceLiveRefs([outside])
      })
      await act(async () => {
        releaseUpscale(null)
        await Promise.resolve()
      })
      for (let i = 0; i < 20; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(16000)
        })
      }
      await act(async () => {
        batchResult = await batchPromise
      })
    } finally {
      vi.useRealTimers()
    }

    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
    expect(genAPI.collectGeneration).toHaveBeenCalledTimes(1)
    expect(getLiveRefs()).toEqual([outside])
    expect(batchResult.currentRefs).toEqual([outside])
    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'completed',
      requestedKeys: ['id:vanished'],
      attemptedKeys: ['id:vanished'],
      succeededKeys: [],
      skipped: [{ key: 'id:vanished', stage: 'not-found' }],
      failed: [],
    })
  })

  it('대상이 없는 다음 batch는 이전 stop flag가 남아 있어도 정상 noop이다', async () => {
    const { result } = setupHook({
      references: [
        { id: 'filled', type: 'character', prompt: 'filled', data: 'image', status: 'done' },
      ],
    })

    await act(async () => {
      result.current.stopGenerateAllRefs()
    })
    const batchResult = await callBatch(result, ['id:filled'])

    expect(batchResult).toMatchObject({
      ok: true,
      outcome: 'noop',
      skipped: [{ key: 'id:filled', stage: 'already-filled' }],
      failed: [],
    })
  })

  it('collectGeneration이 실패 객체를 반환해도 collect stage 실패로 집계한다', async () => {
    const { result } = setupHook({
      references: [
        { id: 'ghost', type: 'character', prompt: 'ghost portrait', status: 'pending' },
      ],
      genOverrides: {
        collectGeneration: vi.fn().mockResolvedValue({
          success: false,
          error: 'collector rejected result',
        }),
      },
    })

    const batchResult = await runTimedBatch(result, ['id:ghost'])

    expect(batchResult).toMatchObject({
      ok: false,
      outcome: 'failed',
      succeededKeys: [],
      failed: [{
        key: 'id:ghost',
        stage: 'collect',
        error: 'collector rejected result',
      }],
    })
  })
})
