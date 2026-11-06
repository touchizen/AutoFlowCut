import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useSceneGeneration } from '../../src/hooks/useSceneGeneration'
import { useMcpServer } from '../../src/hooks/useMcpServer'
import { __resetFlowSafetyForTests } from '../../src/utils/flowSafetyStop'

vi.mock('../../src/utils/guards', () => ({ checkFolderPermission: async () => ({ ok: true }), checkAuthToken: async () => true, checkFlowProjectReady: () => ({ ok: true }) }))
vi.mock('../../src/services/imageFinalize', () => ({ finalizeGeneratedImage: async () => ({ success: true, sceneUpdate: { status: 'done' } }) }))
vi.mock('../../src/components/Toast', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
const paid = { id: 's1', prompt: 'p', status: 'error', generationId: 'paid-1', retryBlocked: true,
  errorKind: 'flow-unusual-activity', error: 'flow-unusual-activity', errorParams: { reason: 'detected' } }
const t = k => k
beforeEach(__resetFlowSafetyForTests)

function setup({ queued = false, scene = paid, deferred = false } = {}) {
  const genAPI = { mode: 'flow', generateImage: vi.fn(async () => ({ success: true, images: [{ base64: 'X' }] })) }
  const scenesHook = { references: [], getMatchingReferences: () => [], updateScene: vi.fn() }
  let task
  const queue = queued ? { enqueue: vi.fn(async next => { task = next; if (!deferred) return next.execute() }) } : null
  const hook = renderHook(({ scenes }) => {
    const single = useSceneGeneration({ settings: { saveMode: 'none' }, scenes, scenesHook, genAPI, t, generationQueue: queue })
    useMcpServer({ settings: {}, scenes, references: [], mode: 'flow', handleGenerateScene: single.handleGenerateScene,
      automationState: {}, videoAutomation: {}, generatingRefs: [], audioReviews: [] })
    return single
  }, { initialProps: { scenes: [structuredClone(scene)] } })
  return { ...hook, genAPI, scenesHook, queue, execute: () => task.execute() }
}

it.each([false, true])('blocks individual retry after restart before enqueue or engine work: queue=%s', async queued => {
  const h = setup({ queued })
  let result
  await act(async () => { result = await h.result.current.handleGenerateScene('s1', undefined, { generationId: null, retryBlocked: false }) })
  expect(h.genAPI.generateImage).not.toHaveBeenCalled()
  expect(h.scenesHook.updateScene).not.toHaveBeenCalled()
  if (queued) expect(h.queue.enqueue).not.toHaveBeenCalled()
  expect(result).toMatchObject({ success: false, retryBlocked: true, generationId: 'paid-1', reason: 'detected' })
})

it.each([false, true])('MCP shares the persisted submission rejection: queue=%s', async queued => {
  const h = setup({ queued })
  let result
  await act(async () => { result = await window.__mcpGenerateScene('s1', 'none') })
  expect(h.genAPI.generateImage).not.toHaveBeenCalled()
  expect(result).toMatchObject({ success: false, retryBlocked: true, generationId: 'paid-1' })
})

it('rechecks the latest persisted scene when a previously admitted queue item runs', async () => {
  const h = setup({ queued: true, deferred: true, scene: { id: 's1', prompt: 'p', status: 'pending' } })
  await act(async () => { await h.result.current.handleGenerateScene('s1') })
  h.rerender({ scenes: [structuredClone(paid)] })
  let result
  await act(async () => { result = await h.execute() })
  expect(h.genAPI.generateImage).not.toHaveBeenCalled()
  expect(result).toMatchObject({ retryBlocked: true, generationId: 'paid-1' })
})

it('allows a scene whose preserved block has been explicitly cleared by recovery', async () => {
  const h = setup({ scene: { ...paid, retryBlocked: false } })
  await act(async () => { await h.result.current.handleGenerateScene('s1') })
  expect(h.genAPI.generateImage).toHaveBeenCalledOnce()
})
