import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation.js'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('not used')),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('../../src/services/styleService', () => ({
  presetTagForStyleId: vi.fn(() => null),
  resolveSceneStyle: vi.fn((prompt) => ({ styledPrompt: prompt, appliedStyle: null })),
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/utils/sceneFilters', () => ({
  filterPendingScenes: vi.fn((scenes) => scenes),
}))

vi.mock('../../src/firebase/functions', () => ({
  consumeBatchDownload: vi.fn().mockResolvedValue({ charged: false }),
}))

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const flowRoute = () => ({ mode: 'flow', sessionTarget: 'flow' })
const chatgptRoute = () => ({ mode: 'flow', sessionTarget: 'chatgpt' })

const renderRunningFlowAutomation = ({ flowEffectGate }) => {
  const events = []
  const started = deferred()
  const stopRequested = deferred()
  const genAPI = {
    submitGeneration: vi.fn(async () => {
      events.push('flow:start')
      started.resolve()
      await flowEffectGate.promise
      return { success: false, error: 'cancelled' }
    }),
    checkGeneration: vi.fn(),
    collectGeneration: vi.fn(),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('token'),
  }
  const scenesHook = {
    scenes: [{ id: 'scene-1', prompt: 'portrait', status: 'pending' }],
    references: [],
    updateScene: vi.fn(),
    getMatchingReferences: vi.fn(() => []),
    updateReferences: vi.fn(),
  }
  const hook = renderHook(() => useAutomation(
    genAPI, scenesHook, null, null, null, (key) => key,
    null, null, null, 'flow', true,
  ))

  act(() => {
    void hook.result.current.start({
      projectName: 'route-quiesce', saveMode: 'memory',
      flowPacingMinMs: 0, flowPacingMaxMs: 0,
    })
  })

  const sendReceipt = vi.fn()
  const automation = {
    waitUntilStopRequested: () => stopRequested.promise,
  }
  const routeBridge = {
    sendReceipt,
    requestFromMain: async (request) => {
      await started.promise
      events.push('route-quiesce')
      act(() => {
        events.push('flow:stop-requested')
        hook.result.current.stop()
      })
      const idlePromise = hook.result.current.awaitIdle?.()
      if (!idlePromise) {
        events.push('flow:idle')
        sendReceipt(request)
        events.push('route-quiesce-receipt')
        stopRequested.resolve()
        return
      }
      stopRequested.resolve()
      await idlePromise
      events.push('flow:idle')
      sendReceipt(request)
      events.push('route-quiesce-receipt')
    },
  }
  return { automation, routeBridge, events }
}

it('does not acknowledge route quiesce until real renderer-owned Flow automation is stopped and idle', async () => {
  const flowEffectGate = deferred()
  const { automation, routeBridge, events } = renderRunningFlowAutomation({ flowEffectGate })
  const pending = routeBridge.requestFromMain({ requestId: 'route-1', from: flowRoute(), to: chatgptRoute() })
  await automation.waitUntilStopRequested()
  expect(events).toEqual(['flow:start', 'route-quiesce', 'flow:stop-requested'])
  expect(routeBridge.sendReceipt).not.toHaveBeenCalled()
  flowEffectGate.resolve()
  await pending
  expect(events).toEqual(['flow:start', 'route-quiesce', 'flow:stop-requested', 'flow:idle', 'route-quiesce-receipt'])
})
