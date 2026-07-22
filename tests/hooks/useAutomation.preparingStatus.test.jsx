import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation.js'
import { useGenerationQueue } from '../../src/hooks/useGenerationQueue.js'
import { fileSystemAPI } from '../../src/hooks/useFileSystem.js'
import { emitQuotaStop, __resetQuotaStopForTests } from '../../src/utils/quotaStop.js'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockResolvedValue({ success: true, data: 'ref-image' }),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('../../src/services/styleService', () => ({
  presetTagForStyleId: vi.fn(() => null),
  resolveSceneStyle: vi.fn(prompt => ({ styledPrompt: prompt, appliedStyle: null })),
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/utils/sceneFilters', () => ({
  filterPendingScenes: vi.fn(scenes => scenes),
}))

vi.mock('../../src/firebase/functions', () => ({
  consumeBatchDownload: vi.fn().mockResolvedValue({ charged: false }),
}))

const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

function makeFixtures(overrides = {}) {
  const styleRef = {
    id: 'style-1',
    name: 'look',
    type: 'style',
    prompt: 'look',
    data: 'ref-image',
    mediaId: null,
  }
  const scenesHook = {
    scenes: [{ id: 'scene-1', prompt: 'portrait', status: 'pending', image: 'old-image' }],
    references: [styleRef],
    updateScene: vi.fn(),
    getMatchingReferences: vi.fn(() => [styleRef]),
    updateReferences: vi.fn(),
    ...overrides.scenesHook,
  }
  const genAPI = {
    submitGeneration: vi.fn().mockResolvedValue({ success: false, error: 'test end' }),
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: false }),
    collectGeneration: vi.fn(),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'media-1' }),
    getAccessToken: vi.fn().mockResolvedValue('token'),
    ...overrides.genAPI,
  }
  return { scenesHook, genAPI }
}

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.clearAllMocks()
  fileSystemAPI.checkPermission.mockResolvedValue({ success: true })
  fileSystemAPI.readFileByPath.mockResolvedValue({ success: true, data: 'ref-image' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAutomation — preparing status', () => {
  it('큐 execute 뒤 folder/token은 preparing, 실제 upload는 uploading, 첫 scene submit 전에는 running이다', async () => {
    const folderGate = deferred()
    const tokenGate = deferred()
    const uploadGate = deferred()
    const submitGate = deferred()
    fileSystemAPI.checkPermission.mockReturnValueOnce(folderGate.promise)
    const { scenesHook, genAPI } = makeFixtures({
      genAPI: {
        getAccessToken: vi.fn(() => tokenGate.promise),
        uploadReference: vi.fn(() => uploadGate.promise),
        submitGeneration: vi.fn(() => submitGate.promise),
      },
    })
    const statusLog = []
    const hook = renderHook(() => {
      const automation = useAutomation(
        genAPI, scenesHook, null, null, null, key => key,
        null, null, null, 'flow', true,
      )
      statusLog.push(automation.status)
      return automation
    })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'project', saveMode: 'folder' })
      await Promise.resolve()
    })
    expect(hook.result.current.status).toBe('preparing')

    await act(async () => {
      folderGate.resolve({ success: true })
      for (let i = 0; i < 4; i++) await Promise.resolve()
    })
    expect(genAPI.getAccessToken).toHaveBeenCalledTimes(1)
    expect(hook.result.current.status).toBe('preparing')

    await act(async () => {
      tokenGate.resolve('token')
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(genAPI.uploadReference).toHaveBeenCalledTimes(1)
    expect(hook.result.current.status).toBe('uploading')

    await act(async () => {
      uploadGate.resolve({ success: true, mediaId: 'media-1' })
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
    expect(hook.result.current.status).toBe('running')

    await act(async () => {
      submitGate.resolve({ success: false, error: 'test end' })
      await startPromise
    })

    expect(statusLog.indexOf('preparing')).toBeLessThan(statusLog.indexOf('uploading'))
    expect(statusLog.indexOf('uploading')).toBeLessThan(statusLog.indexOf('running'))
  })

  it('quota-block 즉시 reject면 execute가 시작되지 않아 status가 ready에 남는다', async () => {
    const { scenesHook, genAPI } = makeFixtures()
    const hook = renderHook(() => {
      const queue = useGenerationQueue()
      const automation = useAutomation(
        genAPI, scenesHook, null, null, null, key => key,
        null, queue, null, 'flow', true,
      )
      return { ...automation, queue }
    })

    act(() => emitQuotaStop({ stopRequestedRef: { current: false }, scope: 'Test' }))
    await act(async () => {
      await hook.result.current.start({ projectName: 'project', saveMode: 'project' })
    })

    expect(hook.result.current.status).toBe('ready')
    expect(hook.result.current.isRunning).toBe(false)
    expect(genAPI.getAccessToken).not.toHaveBeenCalled()
  })

  it('clearQueue가 대기 중 scene batch를 reject하면 status가 ready에 남는다', async () => {
    const blocker = deferred()
    const { scenesHook, genAPI } = makeFixtures()
    const hook = renderHook(() => {
      const queue = useGenerationQueue()
      const automation = useAutomation(
        genAPI, scenesHook, null, null, null, key => key,
        null, queue, null, 'flow', true,
      )
      return { ...automation, queue }
    })

    act(() => {
      hook.result.current.queue.enqueue({
        type: 'reference',
        label: 'blocking job',
        execute: () => blocker.promise,
      })
    })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'project', saveMode: 'project' })
      await Promise.resolve()
    })
    expect(hook.result.current.queue.queueSize).toBe(1)

    await act(async () => {
      hook.result.current.queue.clearQueue('scene_batch')
      await startPromise
    })

    expect(hook.result.current.status).toBe('ready')
    expect(hook.result.current.isRunning).toBe(false)
    expect(genAPI.getAccessToken).not.toHaveBeenCalled()
  })
})
