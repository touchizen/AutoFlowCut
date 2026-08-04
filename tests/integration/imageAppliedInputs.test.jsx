import { useCallback, useMemo, useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppSettings } from '../../src/hooks/useAppSettings'
import { useGenAPI } from '../../src/hooks/useGenAPI'
import { createEngineApi } from '../../src/engine/engineApi'
import { useFlowEngine } from '../../src/engine/engineFlow'
import { useAutomation } from '../../src/hooks/useAutomation'

vi.mock('../../src/firebase/functions', () => ({
  consumeBatchDownload: vi.fn().mockResolvedValue({ denied: false, charged: false, unlimited: true }),
}))

const LOCKED_SEED = 4242
const TINY_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='
const translate = key => key

function useAppliedInputsHarness(mode) {
  const { settings } = useAppSettings()
  const rawGenAPI = useGenAPI({ getProjectName: () => settings.projectName })
  const apiEngine = createEngineApi(rawGenAPI)
  const flowEngine = useFlowEngine({ boundFlowProjectId: 'flow-project' })
  const engine = mode === 'flow' ? flowEngine : apiEngine

  const [scenes, setScenes] = useState([
    { id: 'scene_1', prompt: 'draw a cat', status: 'pending', error: null, errorKind: null },
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
    translate,
    null,
    null,
    null,
    mode,
    true,
  )

  return { automation, scenes, settings }
}

async function runLockedSeedBatch(hook) {
  const { settings } = hook.result.current
  const seed = settings.seedLocked && Number.isFinite(settings.seedNo) ? settings.seedNo : null
  await act(async () => {
    await hook.result.current.automation.start({
      projectName: settings.projectName,
      saveMode: settings.saveMode,
      imageBatchCount: 1,
      imageUpscale: 'off',
      aspectRatio: settings.aspectRatio,
      imageModel: settings.imageModel,
      imageProvider: settings.generation.image.provider,
      generationSettings: settings,
      seed,
      concurrency: 1,
    })
  })
}

function savedMetadata() {
  return window.electronAPI.saveResource.mock.calls.at(-1)?.[0]?.metadata
}

let OriginalImage

beforeEach(() => {
  localStorage.setItem('autoflowcut_settings', JSON.stringify({
    projectName: 'applied-inputs-integration',
    saveMode: 'folder',
    seedNo: LOCKED_SEED,
    seedLocked: true,
    imageModel: 'gemini-3.1-flash-image',
    generation: { image: { provider: 'google' } },
    modelsByProvider: { google: 'gemini-3.1-flash-image' },
  }))
  localStorage.setItem('workFolderPath', '/tmp/applied-inputs')
  localStorage.setItem('workFolderName', 'applied-inputs')

  OriginalImage = globalThis.Image
  class LoadedImage {
    naturalWidth = 1
    naturalHeight = 1
    set src(_value) { queueMicrotask(() => this.onload?.()) }
  }
  globalThis.Image = LoadedImage
  window.Image = LoadedImage

  window.electronAPI.saveWorkFolder = vi.fn().mockResolvedValue({ success: true })
  window.electronAPI.checkFolderExists.mockResolvedValue({ exists: true })
  window.electronAPI.saveResource.mockResolvedValue({ success: true, path: '/tmp/applied-inputs/scene_1.png' })
  window.electronAPI.genaiGetKeyStatus.mockResolvedValue({ hasKey: true, byProvider: { google: true } })

  window.electronAPI.flowExtractToken = vi.fn().mockResolvedValue({ success: true, token: 'flow-token' })
  window.electronAPI.flowValidateToken = vi.fn().mockResolvedValue({ valid: true })
  window.electronAPI.flowExtractProjectId = vi.fn().mockResolvedValue({ projectId: 'flow-project' })
  window.electronAPI.flowGenerateImage = vi.fn()
  window.electronAPI.flowCheckGeneration = vi.fn().mockResolvedValue({ success: true, completed: true })
  window.electronAPI.flowCollectGeneration = vi.fn()
  window.electronAPI.flowClearGenerations = vi.fn().mockResolvedValue({ success: true })
})

afterEach(() => {
  globalThis.Image = OriginalImage
  window.Image = OriginalImage
})

describe('image appliedInputs — settings → engine → automation → metadata integration', () => {
  it('API mode records null in both scene state and sidecar when locked seed was not applied', async () => {
    window.electronAPI.genaiGenerateImage.mockResolvedValue({
      success: true,
      images: [{ base64: TINY_BASE64, mimeType: 'image/png', dataUrl: TINY_BASE64 }],
      actualAspectRatio: null,
    })
    const hook = renderHook(() => useAppliedInputsHarness('api'))

    await runLockedSeedBatch(hook)

    expect(hook.result.current.scenes[0].seed).toBeNull()
    expect(savedMetadata().seed).toBeNull()
    expect(window.electronAPI.genaiGenerateImage.mock.calls[0][0]).not.toHaveProperty('seed')
  })

  it('Flow mode keeps the legacy locked seed in both scene state and sidecar when appliedInputs is absent', async () => {
    window.electronAPI.flowGenerateImage.mockResolvedValue({ success: true, generationId: 'flow-gen-1' })
    window.electronAPI.flowCollectGeneration.mockResolvedValue({
      success: true,
      images: [{ base64: TINY_BASE64, mediaId: 'flow-media-1' }],
    })
    const hook = renderHook(() => useAppliedInputsHarness('flow'))

    await runLockedSeedBatch(hook)

    expect(hook.result.current.scenes[0].seed).toBe(LOCKED_SEED)
    expect(savedMetadata().seed).toBe(LOCKED_SEED)
  })

  it('API mode preserves an echoed image seed of zero through useGenAPI and records it', async () => {
    window.electronAPI.genaiGenerateImage.mockResolvedValue({
      success: true,
      images: [{ base64: TINY_BASE64, mimeType: 'image/png', dataUrl: TINY_BASE64, seed: 0 }],
      actualAspectRatio: null,
    })
    const hook = renderHook(() => useAppliedInputsHarness('api'))

    await runLockedSeedBatch(hook)

    expect(hook.result.current.scenes[0].seed).toBe(0)
    expect(savedMetadata().seed).toBe(0)
  })
})
