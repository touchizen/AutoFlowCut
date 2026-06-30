/**
 * useVideoAutomation — Flow mode preserves the selected Flow model id in metadata (#R26-4).
 *
 * normalizeVideoModel maps to official Veo hyphen ids (correct for API mode, which actually
 * sends the model to the Veo API). In Flow mode the user picks Flow underscore ids
 * (veo_3_1_*); normalizing them corrupts metadata into a default API model that doesn't
 * match the Flow generation. Flow mode must keep the selected id; API mode must normalize.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }) },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({})),
  buildVideoMetaPatch: vi.fn(() => ({})),
}))

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function makeHook(appMode) {
  const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
  const checkVideoStatus = vi.fn().mockResolvedValue({ success: true, statuses: [{ generationId: 'gen-1', status: 'pending' }] })
  const genAPI = {
    generateVideoT2V,
    generateVideoI2V: vi.fn(),
    checkVideoStatus,
    downloadVideo: vi.fn(),
    upscaleVideo: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('token'),
  }
  const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, appMode, true))
  return { hook }
}

async function runT2V(hook, onItemUpdate, videoModel) {
  let p
  await act(async () => {
    p = hook.result.current.start({
      mode: 't2v',
      scenes: [{ id: 'vscene_v1', prompt: 'p', targetDuration: 8 }],
      projectName: 'test', saveMode: 'memory',
      videoModel, aspectRatio: '16:9', duration: 8, seed: null, videoResolution: '720p',
      onItemUpdate,
    })
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(20 * 1000) })
  await act(async () => { hook.result.current.stop() })
  await act(async () => { await vi.advanceTimersByTimeAsync(30 * 1000) })
  await p
}

describe('useVideoAutomation — Flow model metadata (#R26-4)', () => {
  it('Flow mode keeps the selected Flow underscore model id in metadata', async () => {
    const { hook } = makeHook('flow')
    const onItemUpdate = vi.fn()
    await runT2V(hook, onItemUpdate, 'veo_3_1_t2v_quality_ultra_relaxed')

    expect(onItemUpdate).toHaveBeenCalledWith(
      'vscene_v1', 'generating',
      expect.objectContaining({ model: 'veo_3_1_t2v_quality_ultra_relaxed' })
    )
  })

  it('API mode normalizes the same id to the official Veo model name', async () => {
    const { hook } = makeHook('api')
    const onItemUpdate = vi.fn()
    await runT2V(hook, onItemUpdate, 'veo_3_1_t2v_quality_ultra_relaxed')

    expect(onItemUpdate).toHaveBeenCalledWith(
      'vscene_v1', 'generating',
      expect.objectContaining({ model: 'veo-3.1-generate-preview' })
    )
  })
})
