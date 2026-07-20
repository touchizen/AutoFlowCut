import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { DEFAULT_VIDEO_MODEL_ID } from '../../src/config/genModels'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }) },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/services/videoRecovery', () => ({
  retryVideoDownload: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({})),
  buildVideoMetaPatch: vi.fn(() => ({})),
}))
vi.mock('../../src/utils/framePairImages', () => ({
  resolveFrameImageBase64: vi.fn().mockResolvedValue('data:image/png;base64,start'),
}))

import { retryVideoDownload } from '../../src/services/videoRecovery'

const googleSettings = {
  generation: {
    video: {
      t2v: { provider: 'google' },
      i2v: { provider: 'google' },
    },
  },
  videoModelT2V: 'veo-3.1-fast-generate-preview',
  videoModelF2V: 'veo-3.1-fast-generate-preview',
}

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.clearAllMocks()
})

function makeGenAPI(overrides = {}) {
  return {
    generateVideoT2V: vi.fn(),
    generateVideoI2V: vi.fn(),
    checkVideoStatus: vi.fn(),
    downloadVideo: vi.fn(),
    upscaleVideo: vi.fn(),
    fetchMedia: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('token'),
    ...overrides,
  }
}

describe('useVideoAutomation — persisted generation provider', () => {
  it('D3: T2V download-only preflight and rebuilt item prefer persisted provider', async () => {
    const genAPI = makeGenAPI()
    const hook = renderHook(() => useVideoAutomation(genAPI, (key) => key, null))

    await act(async () => {
      await hook.result.current.start({
        mode: 't2v',
        scenes: [{
          id: 'vscene_1', prompt: 'p', status: 'error',
          generationId: 'gen:v1:grok-handle', mediaId: 'media-grok', videoPath: null,
          generationProvider: 'grok',
        }],
        generationSettings: googleSettings,
        projectName: 'test', saveMode: 'memory', videoResolution: '720p',
      })
    })

    expect(genAPI.getAccessToken).toHaveBeenCalledWith(false, false, 'grok')
    expect(retryVideoDownload.mock.calls[0][0].item.generationProvider).toBe('grok')
  })

  it('D3: I2V download-only preflight and rebuilt item prefer persisted provider', async () => {
    const genAPI = makeGenAPI()
    const hook = renderHook(() => useVideoAutomation(genAPI, (key) => key, null))

    await act(async () => {
      await hook.result.current.start({
        mode: 'i2v',
        framePairs: [{
          id: 'fp_1', prompt: 'p', startSceneId: 'scene_1', _startMediaId: 'media-start',
          status: 'error', generationId: 'gen:v1:fal-handle', mediaId: 'media-fal', videoPath: null,
          generationProvider: 'fal',
        }],
        generationSettings: googleSettings,
        projectName: 'test', saveMode: 'memory', videoResolution: '720p',
      })
    })

    expect(genAPI.getAccessToken).toHaveBeenCalledWith(false, false, 'fal')
    expect(retryVideoDownload.mock.calls[0][0].item.generationProvider).toBe('fal')
  })

  it('F6: google recovery with no canonical stored model falls back to the selected global model', async () => {
    const genAPI = makeGenAPI()
    const hook = renderHook(() => useVideoAutomation(genAPI, (key) => key, null))
    const selectedGlobalModel = 'veo-3.1-lite-generate-preview'

    await act(async () => {
      await hook.result.current.start({
        mode: 'i2v',
        framePairs: [{
          id: 'fp_1', prompt: 'p', startSceneId: 'scene_1', _startMediaId: 'media-start',
          status: 'error', generationId: 'gen:v1:google-handle', mediaId: 'media-google', videoPath: null,
          generationProvider: 'google', model: 'removed-google-model',
        }],
        generationSettings: {
          ...googleSettings,
          videoModelF2V: selectedGlobalModel,
        },
        projectName: 'test', saveMode: 'memory', videoResolution: '720p',
      })
    })

    expect(retryVideoDownload.mock.calls[0][0].item.model).toBe(selectedGlobalModel)
  })

  it('F6: cross-provider google override with no canonical model falls back to the google default', async () => {
    const genAPI = makeGenAPI({
      generateVideoT2V: vi.fn().mockResolvedValue({
        success: true,
        generationId: 'gen:v1:google-handle',
      }),
      checkVideoStatus: vi.fn().mockResolvedValue({
        success: true,
        statuses: [{ status: 'failed', error: 'stop after submit', errorKind: 'other' }],
      }),
    })
    const hook = renderHook(() => useVideoAutomation(genAPI, (key) => key, null))

    await act(async () => {
      await hook.result.current.start({
        mode: 't2v',
        scenes: [{
          id: 'vscene_1', prompt: 'p',
          generation: { video: { t2v: { provider: 'google', model: 'removed-google-model' } } },
        }],
        generationSettings: {
          generation: { video: { t2v: { provider: 'grok' } } },
          videoModelT2V: 'grok-imagine-video-1.5',
        },
        projectName: 'test', saveMode: 'memory', videoResolution: '720p',
      })
    })

    expect(genAPI.generateVideoT2V.mock.calls[0][1]).toBe(DEFAULT_VIDEO_MODEL_ID)
  })

  it('D3: submit-success patch persists the provider that submitted the item', async () => {
    const genAPI = makeGenAPI({
      generateVideoT2V: vi.fn().mockResolvedValue({
        success: true,
        generationId: 'gen:v1:grok-handle',
      }),
      checkVideoStatus: vi.fn().mockResolvedValue({
        success: true,
        statuses: [{ status: 'failed', error: 'stop after submit', errorKind: 'other' }],
      }),
    })
    const onItemUpdate = vi.fn()
    const hook = renderHook(() => useVideoAutomation(genAPI, (key) => key, null))

    await act(async () => {
      await hook.result.current.start({
        mode: 't2v',
        scenes: [{
          id: 'vscene_1', prompt: 'p',
          generation: { video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } } },
        }],
        generationSettings: googleSettings,
        projectName: 'test', saveMode: 'memory', videoResolution: '720p',
        onItemUpdate,
      })
    })

    expect(onItemUpdate).toHaveBeenCalledWith(
      'vscene_1',
      'generating',
      expect.objectContaining({ generationProvider: 'grok' }),
    )
  })

  it('D3: completed T2V regeneration uses the current provider instead of the persisted provider', async () => {
    const genAPI = makeGenAPI({
      generateVideoT2V: vi.fn().mockResolvedValue({
        success: true,
        generationId: 'gen:v1:google-new-handle',
      }),
      checkVideoStatus: vi.fn().mockResolvedValue({
        success: true,
        statuses: [{ status: 'failed', error: 'stop after submit', errorKind: 'other' }],
      }),
    })
    const hook = renderHook(() => useVideoAutomation(genAPI, (key) => key, null))

    await act(async () => {
      await hook.result.current.start({
        mode: 't2v',
        scenes: [{
          id: 'vscene_1', prompt: 'regenerate', status: 'complete',
          generationId: 'gen:v1:grok-old-handle', videoPath: '/old.mp4',
          generationProvider: 'grok',
        }],
        generationSettings: googleSettings,
        projectName: 'test', saveMode: 'memory', videoResolution: '720p',
      })
    })

    expect(genAPI.getAccessToken).toHaveBeenCalledWith(false, false, 'google')
    expect(genAPI.generateVideoT2V.mock.calls[0][7]).toEqual(
      expect.objectContaining({ provider: 'google' }),
    )
  })

  it('D3: completed I2V regeneration uses the current provider instead of the persisted provider', async () => {
    const genAPI = makeGenAPI({
      generateVideoI2V: vi.fn().mockResolvedValue({
        success: true,
        generationId: 'gen:v1:google-new-handle',
      }),
      checkVideoStatus: vi.fn().mockResolvedValue({
        success: true,
        statuses: [{ status: 'failed', error: 'stop after submit', errorKind: 'other' }],
      }),
    })
    const hook = renderHook(() => useVideoAutomation(genAPI, (key) => key, null))

    await act(async () => {
      await hook.result.current.start({
        mode: 'i2v',
        framePairs: [{
          id: 'fp_1', prompt: 'regenerate', startSceneId: 'scene_1',
          status: 'complete', generationId: 'gen:v1:fal-old-handle', videoPath: '/old.mp4',
          generationProvider: 'fal',
        }],
        generationSettings: googleSettings,
        projectName: 'test', saveMode: 'memory', videoResolution: '720p',
      })
    })

    expect(genAPI.getAccessToken).toHaveBeenCalledWith(false, false, 'google')
    expect(genAPI.generateVideoI2V.mock.calls[0][8]).toEqual(
      expect.objectContaining({ provider: 'google' }),
    )
  })
})
