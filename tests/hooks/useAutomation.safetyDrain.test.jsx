import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'
import { receiveFlowSafetyStop, __resetFlowSafetyForTests } from '../../src/utils/flowSafetyStop'

vi.mock('../../src/hooks/useFileSystem', () => ({ fileSystemAPI: {} }))
vi.mock('../../src/firebase/functions', () => ({ consumeBatchDownload: vi.fn() }))
vi.mock('../../src/components/Toast', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/services/imageFinalize', () => ({ processAsyncSceneResult: vi.fn(async () => true) }))
const stop = { success: false, errorKind: 'flow-unusual-activity', reason: 'detected', safetyStop: true, retryBlocked: true }
beforeEach(__resetFlowSafetyForTests)

it.each(['incomplete', 'collect-aborted', 'collect-throws', 'user-stop'])('preserves generation ID and safety reason for %s after detection', async kind => {
  let auto
  const genAPI = {
    getAccessToken: vi.fn(async () => 'session'),
    submitGeneration: vi.fn(async () => {
      receiveFlowSafetyStop(stop)
      if (kind === 'user-stop') auto.stop()
      return { success: true, generationId: 'paid-1' }
    }),
    checkGeneration: vi.fn(async () => ({ completed: kind !== 'incomplete' })),
    collectGeneration: vi.fn(async () => {
      if (kind === 'collect-throws') throw new Error('IPC unavailable')
      return { success: false, aborted: true, errorKind: 'aborted' }
    }),
    cancelGeneration: vi.fn(), clearGenerations: vi.fn(),
  }
  const scenes = [{ id: 's1', prompt: 'p', status: 'pending' }, { id: 's2', prompt: 'q', status: 'pending' }]
  const updateScene = vi.fn((id, patch) => Object.assign(scenes.find(s => s.id === id), patch))
  const { result } = renderHook(() => useAutomation(genAPI, { scenes, references: [], updateScene, getMatchingReferences: () => [] }, null, null, null, k => k, null, null, null, 'flow'))
  auto = result.current
  await act(async () => { await auto.start({ projectName: 'p', saveMode: 'none' }) })
  expect(scenes[0]).toMatchObject({ status: 'error', generationId: 'paid-1', errorKind: stop.errorKind, retryBlocked: true, errorParams: { reason: 'detected' } })
  expect(genAPI.submitGeneration).toHaveBeenCalledOnce()
  expect(genAPI.clearGenerations).not.toHaveBeenCalled()
  expect(result.current.status).toBe('error')
  if (kind === 'user-stop') {
    expect(genAPI.cancelGeneration).toHaveBeenCalledOnce()
    expect(genAPI.checkGeneration).not.toHaveBeenCalled()
  } else {
    expect(genAPI.cancelGeneration).not.toHaveBeenCalled()
    expect(genAPI.checkGeneration).toHaveBeenCalledOnce()
  }
})

it.each([{}, { sceneIds: ['s1'] }, { force: true }])('does not resubmit a preserved paid scene after restart: %j', async options => {
  const scene = { id: 's1', prompt: 'p', status: 'error', generationId: 'paid-1', retryBlocked: true, errorKind: stop.errorKind }
  const genAPI = {
    getAccessToken: vi.fn(async () => 'session'), submitGeneration: vi.fn(async () => ({ success: false, error: 'unexpected resubmit' })),
    clearGenerations: vi.fn(),
  }
  const { result } = renderHook(() => useAutomation(genAPI, { scenes: [scene], references: [], updateScene: vi.fn(), getMatchingReferences: () => [] }, null, null, null, k => k, null, null, null, 'flow'))
  await act(async () => { await result.current.start({ projectName: 'p', saveMode: 'none', ...options }) })
  expect(genAPI.submitGeneration).not.toHaveBeenCalled()
  expect(result.current.status).toBe('error')
})
