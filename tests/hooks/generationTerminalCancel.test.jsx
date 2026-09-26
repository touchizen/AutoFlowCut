import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  consumeBatchDownload: vi.fn(),
  processAsyncSceneResult: vi.fn(),
  nextCancelScope: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}))

vi.mock('../../src/firebase/functions', () => ({
  consumeBatchDownload: (...args) => testState.consumeBatchDownload(...args),
}))

vi.mock('../../src/utils/cancelScope', () => ({
  nextCancelScope: (...args) => testState.nextCancelScope(...args),
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('unexpected read')),
  },
}))

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))

vi.mock('../../src/components/Toast', () => ({
  toast: {
    error: (...args) => testState.toastError(...args),
    info: (...args) => testState.toastInfo(...args),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('../../src/services/styleService', async (importOriginal) => ({
  ...(await importOriginal()),
  presetTagForStyleId: vi.fn(() => null),
  resolveSceneStyle: vi.fn((prompt) => ({ styledPrompt: prompt || 'prompt', appliedStyle: null })),
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: (...args) => testState.processAsyncSceneResult(...args),
}))

vi.mock('../../src/utils/sceneFilters', () => ({
  filterPendingScenes: vi.fn((scenes) => scenes),
}))

vi.mock('../../src/utils/imageProcessing', () => ({
  tryUpscaleImage: vi.fn(),
  extractThumbnailBase64: vi.fn().mockResolvedValue('thumb'),
}))

vi.mock('../../src/utils/urls', () => ({
  cleanBase64: vi.fn((value) => value),
  toDataURL: vi.fn((value) => value),
}))

vi.mock('../../src/config/defaults', () => ({
  STYLE_PRESETS: { styles: [{ id: 'p1', prompt_en: 'preset one' }] },
}))

import { useAutomation } from '../../src/hooks/useAutomation'
import { useGenerationQueue } from '../../src/hooks/useGenerationQueue'
import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'
import { useStyleThumbnails } from '../../src/hooks/useStyleThumbnails'
import {
  __resetQuotaStopForTests,
  subscribeQuotaStop,
} from '../../src/utils/quotaStop'

const ENGINE_METHODS = [
  'getAccessToken', 'clearTokenCache', 'listModels',
  'generateImage', 'submitGeneration', 'checkGeneration', 'collectGeneration', 'clearGenerations',
  'uploadReference', 'fetchMedia',
  'generateVideoT2V', 'generateVideoI2V', 'checkVideoStatus', 'downloadVideo',
  'upscaleVideo', 'upscaleImage', 'fetchGallery', 'listFlowProjects',
  'setStopRequested', 'cancelGeneration',
]

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function makeEngineMock(overrides = {}) {
  const api = Object.fromEntries(ENGINE_METHODS.map((name) => [name, vi.fn()]))
  Object.assign(api, {
    accessToken: null,
    projectId: null,
    mode: 'api',
    getAccessToken: vi.fn().mockResolvedValue('token'),
    clearTokenCache: vi.fn(),
    generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'image' }] }),
    submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'generation' }),
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: false }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'image' }] }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'media' }),
    cancelGeneration: vi.fn().mockResolvedValue({ success: true, aborted: 0 }),
  }, overrides)
  return api
}

const t = (key) => key
const authFailure = { success: false, authFailed: true, error: 'Auth expired' }
const quotaFailure = { success: false, error: 'Too Many Requests', errorKind: 'quota' }

async function runAutomationTerminal(kind) {
  let generationNo = 0
  let checkNo = 0
  const api = makeEngineMock({
    submitGeneration: vi.fn(async () => ({ success: true, generationId: `g-${++generationNo}` })),
    checkGeneration: vi.fn(async () => {
      checkNo += 1
      return checkNo === 1
        ? { success: true, completed: false }
        : { success: true, completed: true }
    }),
  })

  if (kind === 'check-auth') {
    api.checkGeneration.mockImplementation(async () => {
      checkNo += 1
      return checkNo === 1 ? { success: true, completed: false } : authFailure
    })
  } else if (kind === 'collect-auth') {
    api.collectGeneration.mockResolvedValue(authFailure)
  } else if (kind === 'submit-auth') {
    api.submitGeneration
      .mockResolvedValueOnce({ success: true, generationId: 'g-1' })
      .mockResolvedValueOnce(authFailure)
  } else if (kind === 'quota') {
    api.submitGeneration
      .mockResolvedValueOnce({ success: true, generationId: 'g-1' })
      .mockResolvedValueOnce(quotaFailure)
  }

  testState.consumeBatchDownload.mockResolvedValue(
    kind === 'consume-denied' ? { denied: true } : { charged: true },
  )

  const liveScenes = [
    { id: 's1', prompt: 'first', status: 'pending' },
    { id: 's2', prompt: 'second', status: 'pending' },
  ]
  const updateScene = vi.fn((id, patch) => {
    const scene = liveScenes.find((item) => item.id === id)
    if (scene) Object.assign(scene, patch)
  })
  const scenesHook = {
    scenes: liveScenes,
    references: [],
    updateScene,
    getMatchingReferences: vi.fn(() => []),
    updateReferences: vi.fn(),
  }
  const onPaywall = vi.fn()
  const { result } = renderHook(() => useAutomation(
    api,
    scenesHook,
    null,
    null,
    null,
    t,
    vi.fn(),
    null,
    null,
    'api',
    true,
    false,
    null,
    onPaywall,
  ))

  let operation
  act(() => {
    operation = result.current.start({
      projectName: 'terminal-cancel',
      saveMode: 'memory',
      concurrency: 2,
    })
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  await act(async () => { await operation })

  expect(api.submitGeneration).toHaveBeenCalledTimes(2)
  const sentScopes = api.submitGeneration.mock.calls.map((call) => call[2].cancelScope)
  expect(new Set(sentScopes)).toEqual(new Set([sentScopes[0]]))
  expect(api.cancelGeneration).toHaveBeenCalledTimes(1)
  expect(api.cancelGeneration).toHaveBeenCalledWith(sentScopes[0])
  expect(testState.nextCancelScope.mock.results.map(({ value }) => value)).toEqual([sentScopes[0]])

  const siblingId = 's1'
  expect(updateScene).toHaveBeenCalledWith(siblingId, {
    status: 'pending',
    error: null,
    errorKind: null,
  })

  if (kind === 'consume-denied') {
    expect(testState.consumeBatchDownload).toHaveBeenCalledTimes(1)
    expect(onPaywall).toHaveBeenCalledTimes(1)
    expect(liveScenes.find((scene) => scene.id === 's1')).toMatchObject({
      status: 'pending', error: null, errorKind: null,
    })
  }
}

async function runReferenceTerminal(kind) {
  const terminal = deferred()
  const api = makeEngineMock()
  const activeMethod = kind === 'single-auth' || kind === 'quota'
    ? api.generateImage
    : api.submitGeneration

  if (kind === 'submit-auth') {
    api.submitGeneration.mockImplementation(() => terminal.promise)
  } else if (kind === 'check-auth') {
    api.checkGeneration.mockImplementation(() => terminal.promise)
  } else if (kind === 'collect-auth') {
    api.checkGeneration.mockResolvedValue({ success: true, completed: true })
    api.collectGeneration.mockImplementation(() => terminal.promise)
  } else {
    api.generateImage.mockImplementation(() => terminal.promise)
  }

  let liveRefs = [
    { id: 'active', prompt: 'active prompt', type: 'scene', status: 'pending' },
    { id: 'queued', prompt: 'queued prompt', type: 'scene', status: 'pending' },
  ]
  const setReferences = vi.fn((updater) => {
    liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
  })
  const hook = renderHook(() => {
    const generationQueue = useGenerationQueue()
    const referenceGeneration = useReferenceGeneration({
      settings: {
        saveMode: 'project',
        imageBatchCount: 1,
        concurrency: 1,
        imageModel: 'test-model',
        generation: { image: { provider: 'google' } },
      },
      references: liveRefs,
      setReferences,
      genAPI: api,
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t,
      generationQueue,
    })
    return referenceGeneration
  })

  let activePromise
  act(() => {
    activePromise = kind === 'single-auth' || kind === 'quota'
      ? hook.result.current.handleGenerateRef(0)
      : hook.result.current.handleGenerateAllRefs(null, { targetRefKeys: ['id:active'] })
  })

  await vi.waitFor(() => expect(activeMethod).toHaveBeenCalledTimes(1))

  let queuedPromise
  act(() => {
    queuedPromise = hook.result.current.handleGenerateRef(1)
  })
  await act(async () => { await Promise.resolve() })

  const terminalMethod = kind === 'check-auth'
    ? api.checkGeneration
    : kind === 'collect-auth'
      ? api.collectGeneration
      : activeMethod
  if (kind === 'check-auth' || kind === 'collect-auth') {
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  }
  await vi.waitFor(() => expect(terminalMethod).toHaveBeenCalledTimes(1))

  const terminalResult = kind === 'quota' ? quotaFailure : authFailure
  await act(async () => {
    terminal.resolve(terminalResult)
    await activePromise
    await queuedPromise
  })

  const payloadCall = activeMethod.mock.calls[0]
  const activeScope = payloadCall[2].cancelScope
  const issuedScopes = testState.nextCancelScope.mock.results.map(({ value }) => value)
  expect(issuedScopes).toHaveLength(2)
  expect(activeScope).toBe(issuedScopes[0])
  expect(activeMethod).toHaveBeenCalledTimes(1)

  const cancelledScopes = api.cancelGeneration.mock.calls.map(([scope]) => scope)
  expect(cancelledScopes).toHaveLength(2)
  expect(new Set(cancelledScopes)).toEqual(new Set(issuedScopes))
  for (const scope of issuedScopes) {
    expect(cancelledScopes.filter((value) => value === scope)).toHaveLength(1)
  }
}

async function runStyleTerminal(kind) {
  const api = makeEngineMock({
    generateImage: vi.fn().mockResolvedValue(kind === 'auth' ? authFailure : quotaFailure),
  })
  const { result } = renderHook(() => useStyleThumbnails(api, {
    flowProjectReady: true,
    imageProvider: 'google',
    imageModel: 'test-model',
  }))

  await act(async () => {
    await result.current.generateThumbnails(['p1'], [], t)
  })

  const sentScope = api.generateImage.mock.calls[0][2].cancelScope
  expect(api.cancelGeneration).toHaveBeenCalledTimes(1)
  expect(api.cancelGeneration).toHaveBeenCalledWith(sentScope)
  expect(testState.nextCancelScope.mock.results.map(({ value }) => value)).toEqual([sentScope])
  if (kind === 'auth') expect(testState.toastError).toHaveBeenCalled()
}

const terminalCases = [
  ['Automation consume-denied', () => runAutomationTerminal('consume-denied')],
  ['Automation check-auth', () => runAutomationTerminal('check-auth')],
  ['Automation collect-auth', () => runAutomationTerminal('collect-auth')],
  ['Automation submit-auth', () => runAutomationTerminal('submit-auth')],
  ['Automation quota', () => runAutomationTerminal('quota')],
  ['Reference collect-auth (active + queued)', () => runReferenceTerminal('collect-auth')],
  ['Reference check-auth (active + queued)', () => runReferenceTerminal('check-auth')],
  ['Reference submit-auth (active + queued)', () => runReferenceTerminal('submit-auth')],
  ['Reference single-auth (active + queued)', () => runReferenceTerminal('single-auth')],
  ['Reference quota (active + queued)', () => runReferenceTerminal('quota')],
  ['Style auth', () => runStyleTerminal('auth')],
  ['Style quota', () => runStyleTerminal('quota')],
]

describe('terminal generation producers cancel their exact run scopes', () => {
  beforeEach(() => {
    __resetQuotaStopForTests()
    vi.useFakeTimers()
    let scopeNo = 0
    testState.nextCancelScope.mockImplementation((name) => `test:${name}:${++scopeNo}`)
    testState.consumeBatchDownload.mockResolvedValue({ charged: true })
    testState.processAsyncSceneResult.mockImplementation(async ({ gate }) => {
      const gateResult = await gate.ensure()
      return gateResult.ok
    })
    window.electronAPI = {
      loadStyleThumbnails: vi.fn().mockResolvedValue({ success: true, thumbnails: {} }),
    }
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    __resetQuotaStopForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each(terminalCases)('%s', async (_name, runCase) => {
    const quotaModal = vi.fn()
    const unsubscribe = subscribeQuotaStop(quotaModal)
    try {
      await runCase()
    } finally {
      unsubscribe()
    }
  }, 15_000)
})
