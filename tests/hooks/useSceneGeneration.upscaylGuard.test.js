import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/utils/guards', () => ({
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn(() => ({ styledPrompt: 'styled prompt' })),
}))
vi.mock('../../src/services/imageFinalize', () => ({
  finalizeGeneratedImage: vi.fn().mockResolvedValue({ success: true, sceneUpdate: { status: 'done' } }),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/utils/quotaStop', () => ({
  isQuotaExhaustedError: vi.fn(() => false),
  emitQuotaStop: vi.fn(),
}))
vi.mock('../../src/utils/mentionParser', () => ({
  resolveMentions: vi.fn(() => ({ missing: [] })),
}))

import { useSceneGeneration } from '../../src/hooks/useSceneGeneration'
import { finalizeGeneratedImage } from '../../src/services/imageFinalize'
import { toast } from '../../src/components/Toast'
import { checkAuthToken, checkFolderPermission } from '../../src/utils/guards'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function makeProps(extra = {}) {
  return {
    settings: { imageModel: 'model', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory' },
    scenes: [{ id: 'scene_1', prompt: 'a hero' }],
    scenesHook: { references: [], updateScene: vi.fn(), getMatchingReferences: vi.fn(() => []) },
    genAPI: { generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }] }) },
    openSettings: vi.fn(),
    setSelectedScene: vi.fn(),
    t: (key) => key,
    generationQueue: null,
    flowProjectReady: true,
    upscaylRunning: false,
    ...extra,
  }
}

describe('useSceneGeneration Upscayl busy guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Upscayl 배치 실행 중에는 단일 씬 생성을 시작하지 않는다', async () => {
    const props = makeProps({ upscaylRunning: true })
    const { result } = renderHook(() => useSceneGeneration(props))

    await act(async () => { await result.current.handleGenerateScene('scene_1') })

    expect(checkFolderPermission).not.toHaveBeenCalled()
    expect(props.genAPI.generateImage).not.toHaveBeenCalled()
    expect(props.scenesHook.updateScene).not.toHaveBeenCalled()
    expect(result.current.generatingSceneId).toBeNull()
  })

  it('큐 대기 중 Upscayl이 시작되면 실제 실행 시점에도 생성을 거부한다', async () => {
    let queuedTask
    const generationQueue = {
      enqueue: vi.fn(async (task) => { queuedTask = task }),
    }
    const { result, rerender } = renderHook(
      ({ upscaylRunning }) => useSceneGeneration(makeProps({ generationQueue, upscaylRunning })),
      { initialProps: { upscaylRunning: false } },
    )

    await act(async () => { await result.current.handleGenerateScene('scene_1') })
    expect(generationQueue.enqueue).toHaveBeenCalledTimes(1)

    rerender({ upscaylRunning: true })
    await act(async () => { await queuedTask.execute() })

    expect(checkFolderPermission).not.toHaveBeenCalled()
  })

  it('auth await 중 Upscayl이 시작되면 status 변경과 엔진 호출 없이 busy로 거절한다', async () => {
    const authGate = deferred()
    checkAuthToken.mockReturnValueOnce(authGate.promise)
    const props = makeProps()
    const { result, rerender } = renderHook(
      ({ upscaylRunning }) => useSceneGeneration({ ...props, upscaylRunning }),
      { initialProps: { upscaylRunning: false } },
    )
    let generationPromise

    act(() => { generationPromise = result.current.handleGenerateScene('scene_1') })
    await waitFor(() => expect(checkAuthToken).toHaveBeenCalledTimes(1))

    rerender({ upscaylRunning: true })
    authGate.resolve(true)
    let response
    await act(async () => { response = await generationPromise })

    expect(response).toEqual({ success: false, error: 'busy' })
    expect(props.genAPI.generateImage).not.toHaveBeenCalled()
    expect(props.scenesHook.updateScene).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('videoAutomation.busy')
    expect(result.current.generatingSceneId).toBeNull()
  })

  it('사전 mention-sync await 중 Upscayl이 시작되면 status 변경과 엔진 호출 없이 busy로 거절한다', async () => {
    const mentionGate = deferred()
    const props = makeProps({
      genAPI: {
        mode: 'flow',
        generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }] }),
      },
      requestMentionSync: vi.fn(() => mentionGate.promise),
    })
    const { result, rerender } = renderHook(
      ({ upscaylRunning }) => useSceneGeneration({ ...props, upscaylRunning }),
      { initialProps: { upscaylRunning: false } },
    )
    let generationPromise

    act(() => { generationPromise = result.current.handleGenerateScene('scene_1') })
    await waitFor(() => expect(props.requestMentionSync).toHaveBeenCalledTimes(1))

    rerender({ upscaylRunning: true })
    mentionGate.resolve({ proceeded: true, refs: [] })
    let response
    await act(async () => { response = await generationPromise })

    expect(response).toEqual({ success: false, error: 'busy' })
    expect(props.genAPI.generateImage).not.toHaveBeenCalled()
    expect(props.scenesHook.updateScene).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('videoAutomation.busy')
    expect(result.current.generatingSceneId).toBeNull()
  })

  it('recovery mention-sync 중 Upscayl이 시작되면 두 번째 엔진만 막고 첫 실패를 정리한다', async () => {
    const recoveryGate = deferred()
    const unresolvedResult = {
      success: false,
      error: 'Unresolved @mention(s): hero',
      errorKind: 'unresolved-mentions',
      unresolvedNames: ['hero'],
    }
    const generateImage = vi.fn().mockResolvedValueOnce(unresolvedResult)
    const requestMentionSync = vi.fn()
      .mockResolvedValueOnce({ proceeded: true })
      .mockImplementationOnce(() => recoveryGate.promise)
    const props = makeProps({
      genAPI: { mode: 'flow', generateImage },
      requestMentionSync,
    })
    const { result, rerender } = renderHook(
      ({ upscaylRunning }) => useSceneGeneration({ ...props, upscaylRunning }),
      { initialProps: { upscaylRunning: false } },
    )
    let generationPromise

    act(() => { generationPromise = result.current.handleGenerateScene('scene_1') })
    await waitFor(() => {
      expect(generateImage).toHaveBeenCalledTimes(1)
      expect(requestMentionSync).toHaveBeenCalledTimes(2)
    })

    rerender({ upscaylRunning: true })
    recoveryGate.resolve({ proceeded: true, refs: [] })
    await act(async () => { await generationPromise })

    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(finalizeGeneratedImage).toHaveBeenCalledWith(expect.objectContaining({ result: unresolvedResult }))
    expect(toast.warning).toHaveBeenCalledWith('videoAutomation.busy')
    expect(result.current.generatingSceneId).toBeNull()
  })
})
