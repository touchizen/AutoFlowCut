import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useRouteQuiesceBridge } from '../../src/App.jsx'
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
const apiRoute = () => ({ mode: 'api', sessionTarget: 'flow' })

const renderRunningFlowAutomation = ({ flowEffectGate, startMethod = 'start' }) => {
  const events = []
  const started = deferred()
  const stopRequested = deferred()
  let requestFromMain
  const sendReceipt = vi.fn(() => events.push('route-quiesce-receipt'))
  const electronAPI = {
    onRouteQuiesceRequest: vi.fn((callback) => {
      requestFromMain = callback
      return vi.fn()
    }),
    sendRouteQuiesceReceipt: sendReceipt,
  }
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
    setStopRequested: vi.fn(),
  }
  const scenesHook = {
    scenes: [{ id: 'scene-1', prompt: 'portrait', status: startMethod === 'retryErrors' ? 'error' : 'pending' }],
    references: [],
    updateScene: vi.fn(),
    getMatchingReferences: vi.fn(() => []),
    updateReferences: vi.fn(),
  }
  const hook = renderHook(() => {
    const automation = useAutomation(
      genAPI, scenesHook, null, null, null, (key) => key,
      null, null, null, 'flow', true,
    )
    const ownerRef = useRef(null)
    ownerRef.current = {
      stop: () => {
        events.push('flow:stop-requested')
        automation.stop()
        stopRequested.resolve()
      },
      awaitIdle: async () => {
        await automation.awaitIdle()
        events.push('flow:idle')
      },
    }
    useRouteQuiesceBridge(ownerRef, electronAPI)
    return automation
  })

  let initialPromise
  act(() => {
    const options = {
      projectName: 'route-quiesce', saveMode: 'memory',
      flowPacingMinMs: 0, flowPacingMaxMs: 0,
    }
    initialPromise = startMethod === 'retry'
      ? hook.result.current.retryScene('scene-1', options)
      : startMethod === 'retryErrors'
        ? hook.result.current.retryErrors(options)
        : hook.result.current.start(options)
  })

  const automation = {
    waitUntilStopRequested: () => stopRequested.promise,
    initialPromise: () => initialPromise,
  }
  const routeBridge = {
    sendReceipt,
    requestFromMain: async (request) => {
      await started.promise
      events.push('route-quiesce')
      await act(async () => requestFromMain(request))
    },
  }
  return { automation, routeBridge, events, genAPI }
}

it('does not acknowledge route quiesce until real renderer-owned Flow automation is stopped and idle', async () => {
  const flowEffectGate = deferred()
  const { automation, routeBridge, events } = renderRunningFlowAutomation({ flowEffectGate })
  const pending = routeBridge.requestFromMain({ requestId: 'route-1', from: flowRoute(), to: apiRoute() })
  await automation.waitUntilStopRequested()
  expect(events).toEqual(['flow:start', 'route-quiesce', 'flow:stop-requested'])
  expect(routeBridge.sendReceipt).not.toHaveBeenCalled()
  flowEffectGate.resolve()
  await pending
  expect(events).toEqual(['flow:start', 'route-quiesce', 'flow:stop-requested', 'flow:idle', 'route-quiesce-receipt'])
})

it.each([
  ['retryScene', 'retry'],
  ['retryErrors', 'retryErrors'],
])('tracks %s in awaitIdle so a retry cannot outlive the renderer quiesce receipt', async (_label, startMethod) => {
  const flowEffectGate = deferred()
  const { automation, routeBridge, events } = renderRunningFlowAutomation({ flowEffectGate, startMethod })
  const pending = routeBridge.requestFromMain({ requestId: 'route-retry', from: flowRoute(), to: apiRoute() })

  await automation.waitUntilStopRequested()
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(events).toEqual(['flow:start', 'route-quiesce', 'flow:stop-requested'])
  expect(routeBridge.sendReceipt).not.toHaveBeenCalled()

  flowEffectGate.resolve()
  await Promise.all([automation.initialPromise(), pending])
  expect(events).toEqual(['flow:start', 'route-quiesce', 'flow:stop-requested', 'flow:idle', 'route-quiesce-receipt'])
})

