import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'
import { __resetFlowSafetyForTests, receiveFlowSafetyStop } from '../../src/utils/flowSafetyStop'

vi.mock('../../src/hooks/useFileSystem', () => ({ fileSystemAPI: { checkPermission: vi.fn(async () => ({ success: true })) } }))
vi.mock('../../src/firebase/functions', () => ({ consumeBatchDownload: vi.fn() }))
vi.mock('../../src/components/Toast', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() } }))
const stop = { success: false, errorKind: 'flow-unusual-activity', safetyStop: true, retryBlocked: true }
beforeEach(__resetFlowSafetyForTests)

describe('Flow safety admission for every batch', () => {
  it('rejects image, video and reference retry entry points before preflight', async () => {
    const genAPI = { mode: 'flow', getAccessToken: vi.fn(async () => 'flow-session'), cancelGeneration: vi.fn() }
    const scenesHook = { scenes: [{ id: 's1', prompt: 'p', status: 'error', image: 'old' }], references: [], updateScene: vi.fn() }
    const { result } = renderHook(() => ({
      image: useAutomation(genAPI, scenesHook, null, null, null, k => k, null, null, null, 'flow', true),
      video: useVideoAutomation(genAPI, k => k, null, null, 'flow', true),
      ref: useReferenceGeneration({ settings: { projectName: 'p' }, references: [], setReferences: vi.fn(), genAPI, t: k => k }),
    }))
    act(() => receiveFlowSafetyStop(stop))
    await act(async () => {
      await result.current.image.start({ projectName: 'p' })
      await result.current.video.start({ projectName: 'p', scenes: [{ id: 'v1', prompt: 'p' }], mode: 't2v' })
      await result.current.ref.handleGenerateAllRefs()
    })
    expect(genAPI.getAccessToken).not.toHaveBeenCalled()
  })
})
