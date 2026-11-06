import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useScenes } from '../../src/hooks/useScenes'
import { useAutomation } from '../../src/hooks/useAutomation'
import { useMcpServer } from '../../src/hooks/useMcpServer'
import { __resetFlowSafetyForTests } from '../../src/utils/flowSafetyStop'

vi.mock('../../src/firebase/functions', () => ({ consumeBatchDownload: vi.fn() }))
vi.mock('../../src/components/Toast', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
const t = k => k
const paid = { generationId: 'paid-before-queue', retryBlocked: true, status: 'error', reason: 'download-timeout',
  error: 'download-timeout', errorKind: 'flow-image-ownership-unproven' }
let mcpUpdate
beforeEach(() => {
  __resetFlowSafetyForTests()
  window.electronAPI = { onMcpUpdate: fn => { mcpUpdate = fn; return () => {} } }
})

function mount({ auth, queued = true } = {}) {
  let task
  const queue = { enqueue: vi.fn(async next => { task = next }) }
  const genAPI = { mode: 'flow', getAccessToken: vi.fn(auth || (async () => 'session')),
    submitGeneration: vi.fn(async () => ({ success: false, error: 'must not submit' })),
    clearGenerations: vi.fn(), cancelGeneration: vi.fn() }
  const hook = renderHook(() => {
    const scenes = useScenes()
    const batch = useAutomation(genAPI, scenes, null, null, null, t, null, queued ? queue : null, null, 'flow')
    useMcpServer({ settings: {}, mode: 'flow', scenes: scenes.scenes, setScenes: scenes.setScenes,
      references: [], automationState: batch, videoAutomation: {}, generatingRefs: [], audioReviews: [] })
    return { scenes, batch }
  })
  act(() => hook.result.current.scenes.setScenes([{ id: 's1', prompt: 'p', status: 'pending' }]))
  return { ...hook, genAPI, execute: () => task.execute() }
}

it('rechecks MCP-updated submission when a queued batch executes', async () => {
  const h = mount()
  await act(async () => h.result.current.batch.start({ projectName: 'p', saveMode: 'none' }))
  act(() => mcpUpdate({ type: 'update-scene', index: 0, fields: paid }))
  expect(h.result.current.scenes.scenes[0]).toMatchObject(paid)
  await act(async () => h.execute())
  expect(h.genAPI.submitGeneration).not.toHaveBeenCalled()
  expect(h.result.current.scenes.scenes[0]).toMatchObject(paid)
})

it.each([false, true])('rechecks persisted submission after async preparation before batch submit: force=%s', async force => {
  let release
  const h = mount({ queued: false, auth: () => new Promise(resolve => { release = resolve }) })
  if (force) act(() => h.result.current.scenes.updateScene('s1', { status: 'done' }))
  let running
  await act(async () => { running = h.result.current.batch.start({ projectName: 'p', saveMode: 'none', force }) })
  act(() => mcpUpdate({ type: 'update-scene', index: 0, fields: paid }))
  await act(async () => { release('session'); await running })
  expect(h.genAPI.submitGeneration).not.toHaveBeenCalled()
  expect(h.result.current.scenes.scenes[0]).toMatchObject(paid)
})
