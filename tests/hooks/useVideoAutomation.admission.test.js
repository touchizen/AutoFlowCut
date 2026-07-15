import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildVideoItems, useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { makeBatchConsumeGate } from '../../src/hooks/batchConsumeGate'
import { batchStartGate } from '../../src/hooks/batchStartGate'
import { resolveProjectBatchId } from '../../src/utils/batchId'
import { consumeBatchDownload } from '../../src/firebase/functions'
import { downloadVideoBase64 } from '../../src/services/videoDownload'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    saveVideo: vi.fn().mockResolvedValue({ success: true, path: '/tmp/video.mp4' }),
  },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
vi.mock('../../src/services/videoDownload', () => ({
  downloadVideoBase64: vi.fn().mockResolvedValue({ success: true, base64: 'video-b64' }),
}))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({ model: 'veo-3.1-fast-generate-preview', seed: null })),
  buildVideoMetaPatch: vi.fn(() => ({})),
}))
vi.mock('../../src/firebase/functions', () => ({
  consumeBatchDownload: vi.fn().mockResolvedValue({ charged: true }),
}))
vi.mock('../../src/hooks/batchConsumeGate', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, makeBatchConsumeGate: vi.fn(actual.makeBatchConsumeGate) }
})
vi.mock('../../src/hooks/batchStartGate', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, batchStartGate: vi.fn(actual.batchStartGate) }
})
vi.mock('../../src/utils/batchId', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, resolveProjectBatchId: vi.fn(actual.resolveProjectBatchId) }
})

const validOptions = {
  mode: 't2v',
  scenes: [{ id: 'vscene_1', prompt: 'animate this scene' }],
  projectName: 'admission-project',
  saveMode: 'folder',
  videoModel: 'veo-3.1-fast-generate-preview',
  videoResolution: '720p',
}

function setupAdmission({
  subscriptionBatch,
  isAuthenticated = true,
  subscriptionStatus = 'active',
  appMode = 'api',
  flowProjectReady = true,
  generationQueue = null,
  getAccessToken = vi.fn().mockResolvedValue('api-key'),
  onPaywall = vi.fn(),
  onLoginRequired = vi.fn(),
  genAPIOverrides = {},
} = {}) {
  const genAPI = {
    generateVideoT2V: vi.fn().mockResolvedValue({ success: true, generationId: 'generation-1' }),
    generateVideoI2V: vi.fn(),
    checkVideoStatus: vi.fn().mockResolvedValue({
      success: true,
      statuses: [{ status: 'complete', mediaId: 'media-1', videoUrl: 'https://video.test/1' }],
    }),
    upscaleVideo: vi.fn(),
    fetchMedia: vi.fn(),
    getAccessToken,
    downloadVideo: vi.fn().mockResolvedValue({ success: true, base64: 'video-b64' }),
    ...genAPIOverrides,
  }
  const hook = renderHook(() => useVideoAutomation(
    genAPI,
    (key) => key,
    generationQueue,
    null,
    appMode,
    flowProjectReady,
    subscriptionBatch,
    onPaywall,
    isAuthenticated,
    onLoginRequired,
    subscriptionStatus,
  ))
  return { hook, genAPI, onPaywall, onLoginRequired }
}

async function admit(hook, options = validOptions) {
  expect(typeof hook.result.current.admitVideoBatch).toBe('function')
  let result
  await act(async () => {
    result = await hook.result.current.admitVideoBatch(options)
  })
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  consumeBatchDownload.mockResolvedValue({ charged: true })
  downloadVideoBase64.mockResolvedValue({ success: true, base64: 'video-b64' })
})

describe('useVideoAutomation.admitVideoBatch — slice 50 fail-closed entitlement', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['non-boolean batchUnlimited', { batchUnlimited: 'yes', batchRemaining: 1 }],
    ['invalid batchRemaining', { batchUnlimited: false, batchRemaining: Number.NaN }],
  ])('%s snapshot rejects before every billable/download side effect', async (_label, subscriptionBatch) => {
    const { hook, genAPI } = setupAdmission({ subscriptionBatch })

    expect(await admit(hook)).toEqual({ accepted: false, error: 'no-entitlement' })
    expect(genAPI.generateVideoT2V).not.toHaveBeenCalled()
    expect(consumeBatchDownload).not.toHaveBeenCalled()
    expect(genAPI.downloadVideo).not.toHaveBeenCalled()
    expect(downloadVideoBase64).not.toHaveBeenCalled()
    expect(resolveProjectBatchId).not.toHaveBeenCalled()
    expect(makeBatchConsumeGate).not.toHaveBeenCalled()
    if (subscriptionBatch == null) expect(batchStartGate).not.toHaveBeenCalled()
    else expect(batchStartGate).toHaveBeenCalledTimes(1)
  })
})

describe('useVideoAutomation.admitVideoBatch — slice 38 rejection values', () => {
  it.each([
    ['login', {
      hookOptions: {
        subscriptionBatch: { batchRemaining: undefined, batchUnlimited: undefined },
        isAuthenticated: false,
      },
      options: validOptions,
    }],
    ['paywall', {
      hookOptions: {
        subscriptionBatch: { batchUnlimited: false, batchRemaining: 0 },
      },
      options: validOptions,
    }],
    ['loading', {
      hookOptions: {
        subscriptionBatch: { batchRemaining: undefined, batchUnlimited: undefined },
        subscriptionStatus: 'loading',
      },
      options: validOptions,
    }],
    ['no-api-key', {
      hookOptions: {
        subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
        getAccessToken: vi.fn().mockResolvedValue(null),
      },
      options: validOptions,
    }],
    ['no-items', {
      hookOptions: {
        subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      },
      options: { ...validOptions, scenes: [] },
    }],
  ])('%s rejects by value without pipeline or modal callbacks', async (error, { hookOptions, options }) => {
    const { hook, genAPI, onPaywall, onLoginRequired } = setupAdmission(hookOptions)

    expect(await admit(hook, options)).toEqual({ accepted: false, error })
    expect(genAPI.generateVideoT2V).not.toHaveBeenCalled()
    expect(genAPI.checkVideoStatus).not.toHaveBeenCalled()
    expect(consumeBatchDownload).not.toHaveBeenCalled()
    expect(genAPI.downloadVideo).not.toHaveBeenCalled()
    expect(downloadVideoBase64).not.toHaveBeenCalled()
    expect(resolveProjectBatchId).not.toHaveBeenCalled()
    expect(makeBatchConsumeGate).not.toHaveBeenCalled()
    expect(onPaywall).not.toHaveBeenCalled()
    expect(onLoginRequired).not.toHaveBeenCalled()
  })

  it('returns the product login gate before reading malformed entitlement fields', async () => {
    const readBatchRemaining = vi.fn(() => undefined)
    const readBatchUnlimited = vi.fn(() => undefined)
    const productLoggedOutSnapshot = {}
    Object.defineProperties(productLoggedOutSnapshot, {
      batchRemaining: { enumerable: true, get: readBatchRemaining },
      batchUnlimited: { enumerable: true, get: readBatchUnlimited },
    })
    const { hook } = setupAdmission({
      subscriptionBatch: productLoggedOutSnapshot,
      isAuthenticated: false,
    })

    expect(await admit(hook)).toEqual({ accepted: false, error: 'login' })
    expect(readBatchRemaining).not.toHaveBeenCalled()
    expect(readBatchUnlimited).not.toHaveBeenCalled()
  })

  it.each([
    ['a resolved scene disappeared', [
      { id: 'opaque-1', rendererSceneId: 'opaque-1', ordinal: 1, prompt: 'first' },
      { id: 'opaque-3', rendererSceneId: 'opaque-3', ordinal: 3, prompt: 'third' },
    ]],
    ['a resolved scene lost its prompt', [
      { id: 'opaque-1', rendererSceneId: 'opaque-1', ordinal: 1, prompt: 'first' },
      { id: 'opaque-2', rendererSceneId: 'opaque-2', ordinal: 2, prompt: '' },
      { id: 'opaque-3', rendererSceneId: 'opaque-3', ordinal: 3, prompt: 'third' },
    ]],
  ])('rejects partial-scenes before billing when %s', async (_label, scenes) => {
    const { hook, genAPI } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
    })

    expect(await admit(hook, {
      ...validOptions,
      scenes,
      approvedSceneCount: 3,
    })).toEqual({ accepted: false, error: 'partial-scenes' })
    expect(genAPI.generateVideoT2V).not.toHaveBeenCalled()
    expect(genAPI.checkVideoStatus).not.toHaveBeenCalled()
    expect(consumeBatchDownload).not.toHaveBeenCalled()
    expect(resolveProjectBatchId).not.toHaveBeenCalled()
    expect(makeBatchConsumeGate).not.toHaveBeenCalled()
  })

  it('keeps total shrink fail-closed as no-items', async () => {
    const { hook } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
    })

    expect(await admit(hook, {
      ...validOptions,
      scenes: [],
      approvedSceneCount: 3,
    })).toEqual({ accepted: false, error: 'no-items' })
  })
})

describe('useVideoAutomation.admitVideoBatch — Flow readiness', () => {
  it('rejects a production Flow batch before token, pipeline, or billing setup when the project is not ready', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('api-key')
    const { hook, genAPI } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      appMode: 'flow',
      flowProjectReady: false,
      getAccessToken,
    })

    expect(await admit(hook)).toEqual({ accepted: false, error: 'loading' })
    expect(getAccessToken).not.toHaveBeenCalled()
    expect(genAPI.generateVideoT2V).not.toHaveBeenCalled()
    expect(genAPI.checkVideoStatus).not.toHaveBeenCalled()
    expect(consumeBatchDownload).not.toHaveBeenCalled()
    expect(genAPI.downloadVideo).not.toHaveBeenCalled()
    expect(downloadVideoBase64).not.toHaveBeenCalled()
    expect(resolveProjectBatchId).not.toHaveBeenCalled()
    expect(makeBatchConsumeGate).not.toHaveBeenCalled()
  })
})

describe('useVideoAutomation.admitVideoBatch — slice 39 detached acceptance', () => {
  it('preserves resolved rendererSceneId/ordinal and uses ordinal for the save id without scene id synthesis', () => {
    const items = buildVideoItems('t2v', {
      scenes: [{
        id: 'opaque-renderer-id', rendererSceneId: 'opaque-renderer-id', ordinal: 7, prompt: 'animate',
      }],
    }, { appMode: 'api' })

    expect(items).toEqual([expect.objectContaining({
      id: 'opaque-renderer-id',
      rendererSceneId: 'opaque-renderer-id',
      ordinal: 7,
      videoSaveId: 't2v_7',
    })])
  })

  it('returns operationId before the detached pipeline submits', async () => {
    const { hook, genAPI } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
    })

    let result
    await act(async () => {
      result = await hook.result.current.admitVideoBatch(validOptions)
      expect(result).toEqual({ accepted: true, operationId: expect.any(String) })
      expect(genAPI.generateVideoT2V).not.toHaveBeenCalled()
      expect(hook.result.current.getVideoStatus(result.operationId)).toEqual({
        operationId: result.operationId,
        status: 'queued',
        progress: { done: 0, total: 1, failed: 0, phase: 'queued' },
      })
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(genAPI.generateVideoT2V).toHaveBeenCalledTimes(1)
  })
})

describe('useVideoAutomation Stage A structural invariants', () => {
  const source = readFileSync(path.resolve(__dirname, '../../src/hooks/useVideoAutomation.js'), 'utf8')
  const pipelineStart = source.indexOf('const runVideoPipeline')
  const pipelineEnd = source.indexOf('const runLegacyStart = useCallback', pipelineStart)
  const admittedRunnerStart = source.indexOf('const runAdmittedVideoBatch')
  const admittedRunnerEnd = source.indexOf('const admitVideoBatch', admittedRunnerStart)
  const admissionStart = source.indexOf('const admitVideoBatch')
  const admissionEnd = source.indexOf('const getVideoStatus', admissionStart)
  const pipelineSource = source.slice(
    pipelineStart,
    pipelineEnd,
  )
  const admittedRunnerSource = source.slice(
    admittedRunnerStart,
    admittedRunnerEnd,
  )
  const admissionSource = source.slice(
    admissionStart,
    admissionEnd,
  )

  it('keeps batch identity creation physically outside both pipeline runners', () => {
    expect(pipelineStart).toBeGreaterThanOrEqual(0)
    expect(pipelineEnd).toBeGreaterThan(pipelineStart)
    expect(admittedRunnerStart).toBeGreaterThanOrEqual(0)
    expect(admittedRunnerEnd).toBeGreaterThan(admittedRunnerStart)
    for (const runnerSource of [pipelineSource, admittedRunnerSource]) {
      expect(runnerSource).not.toContain('resolveProjectBatchId(')
      expect(runnerSource).not.toContain('makeBatchConsumeGate(')
    }
  })

  it('contains no admission no-op consume gate fallback', () => {
    expect(admissionStart).toBeGreaterThanOrEqual(0)
    expect(admissionEnd).toBeGreaterThan(admissionStart)
    expect(admissionSource).not.toMatch(/ensure\s*:\s*async\s*\(\)\s*=>\s*\(\{\s*ok\s*:\s*true/)
  })

  it('pins admission validation and identity creation order', () => {
    const busyCheck = admissionSource.indexOf('if (admissionBusyRef.current)')
    const busySet = admissionSource.indexOf('admissionBusyRef.current = true')
    const nullEntitlement = admissionSource.indexOf('if (subscriptionBatch == null)')
    const startGate = admissionSource.indexOf('batchStartGate(')
    const gateDecision = admissionSource.indexOf("if (gate.action !== 'proceed')")
    const malformedSnapshot = admissionSource.indexOf('const validSnapshot')
    // Stage B agent는 official engine의 getAccessToken을 선택할 수 있다. 호출 대상보다 이 await가
    // item/batch identity 생성 전에 있다는 순서를 pin한다.
    const tokenPreflight = admissionSource.indexOf('const token = await')
    const itemBuild = admissionSource.indexOf('buildVideoItems(')
    const batchIdentity = admissionSource.indexOf('resolveProjectBatchId(')
    const consumeGate = admissionSource.indexOf('makeBatchConsumeGate(')

    expect([
      busyCheck,
      busySet,
      nullEntitlement,
      startGate,
      gateDecision,
      malformedSnapshot,
      tokenPreflight,
      itemBuild,
      batchIdentity,
      consumeGate,
    ].every(index => index >= 0)).toBe(true)
    expect(busyCheck).toBeLessThan(busySet)
    expect(busySet).toBeLessThan(nullEntitlement)
    expect(nullEntitlement).toBeLessThan(startGate)
    expect(startGate).toBeLessThan(gateDecision)
    expect(gateDecision).toBeLessThan(malformedSnapshot)
    expect(malformedSnapshot).toBeLessThan(tokenPreflight)
    expect(tokenPreflight).toBeLessThan(itemBuild)
    expect(itemBuild).toBeLessThan(batchIdentity)
    expect(batchIdentity).toBeLessThan(consumeGate)
  })
})

describe('useVideoAutomation.admitVideoBatch — slice 40 context identity', () => {
  it('passes the admission batchId and exact consumeGate object through download ensure', async () => {
    const { hook } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
    })
    let downloadEnsureReceiver = null
    const admittedGate = {
      ensure: vi.fn(function () {
        downloadEnsureReceiver = this
        return Promise.resolve({ ok: true })
      }),
    }
    makeBatchConsumeGate.mockReturnValueOnce(admittedGate)

    let result
    await act(async () => {
      result = await hook.result.current.admitVideoBatch(validOptions)
    })
    expect(result).toEqual({ accepted: true, operationId: expect.any(String) })

    const admittedBatchId = resolveProjectBatchId.mock.results[0].value.batchId

    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve()
    })

    expect(makeBatchConsumeGate.mock.calls[0][0]).toBe(admittedBatchId)
    expect(admittedGate.ensure).toHaveBeenCalledTimes(1)
    expect(downloadEnsureReceiver).toBe(admittedGate)
    expect(downloadVideoBase64).toHaveBeenCalledTimes(1)
  })
})

describe('useVideoAutomation.admitVideoBatch — slice 41 billing identity and race', () => {
  it('consumes one normal batch once even when two completed videos download', async () => {
    let submitCount = 0
    const { hook } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      genAPIOverrides: {
        generateVideoT2V: vi.fn().mockImplementation(async () => ({
          success: true,
          generationId: `generation-${++submitCount}`,
        })),
        checkVideoStatus: vi.fn().mockImplementation(async (generationIds) => ({
          success: true,
          statuses: generationIds.map((id) => ({
            status: 'complete',
            mediaId: `media-${id}`,
            videoUrl: `https://video.test/${id}`,
          })),
        })),
      },
    })
    const twoScenes = {
      ...validOptions,
      scenes: [
        { id: 'vscene_1', prompt: 'first' },
        { id: 'vscene_2', prompt: 'second' },
      ],
    }

    expect(await admit(hook, twoScenes)).toEqual({ accepted: true, operationId: expect.any(String) })
    await act(async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve()
    })

    expect(consumeBatchDownload).toHaveBeenCalledTimes(1)
    expect(downloadVideoBase64).toHaveBeenCalledTimes(2)
  })

  it('reuses the same project batchId for an isRetry re-admission', async () => {
    const { hook } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
    })

    const first = await admit(hook)
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve()
    })
    const retry = await admit(hook, { ...validOptions, isRetry: true })
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve()
    })

    expect(first).toEqual({ accepted: true, operationId: expect.any(String) })
    expect(retry).toEqual({ accepted: true, operationId: expect.any(String) })
    expect(retry.operationId).not.toBe(first.operationId)
    expect(makeBatchConsumeGate.mock.calls[1][0]).toBe(makeBatchConsumeGate.mock.calls[0][0])
  })

  it('rejects a concurrent admission as busy before the first token preflight resolves', async () => {
    let resolveToken
    const getAccessToken = vi.fn(() => new Promise((resolve) => { resolveToken = resolve }))
    const { hook } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      getAccessToken,
    })

    let firstPromise
    let second
    await act(async () => {
      firstPromise = hook.result.current.admitVideoBatch(validOptions)
      second = await hook.result.current.admitVideoBatch(validOptions)
    })

    expect(second).toEqual({ accepted: false, error: 'busy' })
    expect(resolveProjectBatchId).not.toHaveBeenCalled()
    expect(makeBatchConsumeGate).not.toHaveBeenCalled()

    let first
    await act(async () => {
      resolveToken('api-key')
      first = await firstPromise
    })
    expect(first).toEqual({ accepted: true, operationId: expect.any(String) })
    expect(resolveProjectBatchId).toHaveBeenCalledTimes(1)
    expect(makeBatchConsumeGate).toHaveBeenCalledTimes(1)
  })
})

describe('useVideoAutomation cross-path mutual exclusion', () => {
  it('agent cleanup clears snapshots without stopping or unpausing a legacy-owned pipeline', async () => {
    const { hook, genAPI } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 3 },
    })

    // 제품 경로로 agent operation을 하나 끝내 Map에 terminal snapshot을 남긴다.
    const accepted = await admit(hook)
    await act(async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve()
    })
    expect(hook.result.current.getVideoStatus(accepted.operationId).status).toBe('done')

    // 같은 hook의 legacy UI start가 runOwner를 실제로 소유한 상태에서 submit을 붙잡는다.
    let resolveLegacySubmit
    genAPI.generateVideoT2V.mockClear()
    genAPI.generateVideoT2V.mockImplementationOnce(() => new Promise((resolve) => {
      resolveLegacySubmit = resolve
    }))
    genAPI.checkVideoStatus.mockClear()
    downloadVideoBase64.mockClear()
    let legacyPromise
    await act(async () => {
      legacyPromise = hook.result.current.start({ ...validOptions, projectName: 'legacy-project' })
      for (let i = 0; i < 10 && !resolveLegacySubmit; i++) await Promise.resolve()
    })
    expect(genAPI.generateVideoT2V).toHaveBeenCalledOnce()

    act(() => { hook.result.current.togglePause() })
    expect(hook.result.current.isPaused).toBe(true)
    act(() => { hook.result.current.abortAndClearVideoOperations() })

    // Agent store는 언제나 지우지만 legacy가 소유한 공유 stop/pause state는 바꾸면 안 된다.
    expect(hook.result.current.getVideoStatus(accepted.operationId).error).toBe('context-lost')
    expect(hook.result.current.isPaused).toBe(true)

    act(() => { hook.result.current.togglePause() })
    let legacySummary
    await act(async () => {
      resolveLegacySubmit({ success: true, generationId: 'legacy-generation' })
      for (let i = 0; i < 40; i++) await Promise.resolve()
      legacySummary = await legacyPromise
    })

    expect(genAPI.checkVideoStatus).toHaveBeenCalled()
    expect(downloadVideoBase64).toHaveBeenCalledOnce()
    expect(legacySummary).toMatchObject({
      completed: 1,
      failed: 0,
      stopped: false,
      terminalError: null,
    })
  })

  it('rejects agent admission while a legacy UI pipeline is running', async () => {
    let resolveSubmit
    const pendingSubmit = new Promise((resolve) => { resolveSubmit = resolve })
    const generateVideoT2V = vi.fn(() => pendingSubmit)
    const { hook } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      genAPIOverrides: { generateVideoT2V },
    })

    let legacyPromise
    await act(async () => {
      legacyPromise = hook.result.current.start(validOptions)
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(generateVideoT2V).toHaveBeenCalledTimes(1)

    const agentResult = await admit(hook)
    await act(async () => {
      resolveSubmit({ success: true, generationId: 'legacy-generation' })
      for (let i = 0; i < 40; i++) await Promise.resolve()
      await legacyPromise
    })

    expect(agentResult).toEqual({ accepted: false, error: 'busy' })
    expect(generateVideoT2V).toHaveBeenCalledTimes(1)
    expect(resolveProjectBatchId).toHaveBeenCalledTimes(1)
    expect(makeBatchConsumeGate).toHaveBeenCalledTimes(1)
  })

  it('blocks legacy start in the same-tick gap after agent acceptance', async () => {
    let resolveSubmit
    const pendingSubmit = new Promise((resolve) => { resolveSubmit = resolve })
    const generateVideoT2V = vi.fn(() => pendingSubmit)
    const { hook } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      genAPIOverrides: { generateVideoT2V },
    })

    let agentResult
    let legacyPromise
    await act(async () => {
      agentResult = await hook.result.current.admitVideoBatch(validOptions)
      legacyPromise = hook.result.current.start(validOptions)
    })
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })

    resolveSubmit({ success: true, generationId: 'agent-generation' })
    await act(async () => {
      for (let i = 0; i < 40; i++) await Promise.resolve()
      await legacyPromise
    })

    expect(agentResult).toEqual({ accepted: true, operationId: expect.any(String) })
    expect(generateVideoT2V).toHaveBeenCalledTimes(1)
    expect(resolveProjectBatchId).toHaveBeenCalledTimes(1)
    expect(makeBatchConsumeGate).toHaveBeenCalledTimes(1)
  })

  it('rejects the public queued legacy start before enqueue while an agent pipeline is running', async () => {
    let resolveSubmit
    const generateVideoT2V = vi.fn(() => new Promise((resolve) => { resolveSubmit = resolve }))
    const generationQueue = { enqueue: vi.fn().mockResolvedValue(undefined) }
    const { hook } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      generationQueue,
      genAPIOverrides: { generateVideoT2V },
    })

    const agentResult = await admit(hook)
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(generateVideoT2V).toHaveBeenCalledTimes(1)

    await act(async () => {
      await hook.result.current.start(validOptions)
    })

    expect(agentResult).toEqual({ accepted: true, operationId: expect.any(String) })
    expect(generationQueue.enqueue).not.toHaveBeenCalled()

    await act(async () => {
      resolveSubmit({ success: true, generationId: 'agent-generation' })
      for (let i = 0; i < 40; i++) await Promise.resolve()
    })
  })
})

describe('useVideoAutomation admitted context safety', () => {
  it('reports consume denial as terminal paywall instead of false success', async () => {
    consumeBatchDownload.mockResolvedValueOnce({ denied: true })
    const { hook, genAPI } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
    })

    const accepted = await admit(hook)
    await act(async () => {
      for (let i = 0; i < 40; i++) await Promise.resolve()
    })

    expect(consumeBatchDownload).toHaveBeenCalledTimes(1)
    expect(downloadVideoBase64).not.toHaveBeenCalled()
    expect(genAPI.downloadVideo).not.toHaveBeenCalled()
    expect(hook.result.current.getVideoStatus(accepted.operationId)).toEqual({
      operationId: accepted.operationId,
      status: 'error',
      error: 'paywall',
      progress: { done: 1, total: 1, failed: 1, phase: 'error' },
    })
  })

  it('drops late item patches after the current project identity changes', async () => {
    let resolveSubmit
    const generateVideoT2V = vi.fn(() => new Promise((resolve) => { resolveSubmit = resolve }))
    const onItemUpdate = vi.fn()
    let currentProject = { projectName: 'admission-project', projectEpoch: 1 }
    const { hook } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      genAPIOverrides: { generateVideoT2V },
    })
    const options = {
      ...validOptions,
      projectEpoch: 1,
      onItemUpdate,
      getCurrentProjectIdentity: () => currentProject,
    }

    expect(await admit(hook, options)).toEqual({ accepted: true, operationId: expect.any(String) })
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(generateVideoT2V).toHaveBeenCalledTimes(1)
    expect(onItemUpdate).toHaveBeenCalledWith('vscene_1', 'generating')

    currentProject = { projectName: 'other-project', projectEpoch: 2 }
    await act(async () => {
      resolveSubmit({ success: true, generationId: 'generation-late' })
      for (let i = 0; i < 30; i++) await Promise.resolve()
    })

    const latePatches = onItemUpdate.mock.calls.filter(([, itemStatus]) => itemStatus !== 'generating')
    expect(latePatches).toHaveLength(0)
  })

  it('resets admitted UI state and releases busy when the detached pipeline throws', async () => {
    const { hook } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      genAPIOverrides: {
        generateVideoT2V: vi.fn().mockRejectedValue(new Error('submit exploded')),
      },
    })

    const accepted = await admit(hook)
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve()
    })

    expect(hook.result.current.getVideoStatus(accepted.operationId)).toEqual(expect.objectContaining({
      operationId: accepted.operationId,
      status: 'error',
      error: 'submit exploded',
    }))
    expect(hook.result.current.isRunning).toBe(false)
    expect(hook.result.current.isPaused).toBe(false)
    expect(hook.result.current.status).toBe('error')
    expect(hook.result.current.statusMessage).toBe('submit exploded')

    expect(await admit(hook, { ...validOptions, scenes: [] }))
      .toEqual({ accepted: false, error: 'no-items' })
  })

  it('publishes queued/running/terminal snapshots from the same store used by getVideoStatus', async () => {
    const { hook } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
    })
    const listener = vi.fn()
    let unsubscribe
    act(() => {
      unsubscribe = hook.result.current.subscribeVideoStatus(listener)
    })

    const accepted = await admit(hook)
    expect(listener).toHaveBeenCalledWith(hook.result.current.getVideoStatus(accepted.operationId))

    await act(async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve()
    })
    const terminal = hook.result.current.getVideoStatus(accepted.operationId)
    expect(terminal.status).toBe('done')
    expect(listener).toHaveBeenLastCalledWith(terminal)

    act(() => unsubscribe())
    expect(typeof unsubscribe).toBe('function')
  })

  it('updates byte-free running progress after each settled video instead of waiting for terminal', async () => {
    let submitCount = 0
    let resolveSecondSubmit
    const generateVideoT2V = vi.fn(() => {
      submitCount++
      if (submitCount === 1) return Promise.resolve({ success: true, generationId: 'generation-1' })
      return new Promise((resolve) => { resolveSecondSubmit = resolve })
    })
    const { hook } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      genAPIOverrides: {
        generateVideoT2V,
        checkVideoStatus: vi.fn().mockResolvedValue({
          success: true,
          statuses: [{
            status: 'complete', mediaId: 'media-with-bytes', videoUrl: 'https://video.test/first',
            base64: 'MUST-NOT-ENTER-STATUS', video: { data: 'MUST-NOT-ENTER-EITHER' },
          }],
        }),
      },
    })
    const accepted = await admit(hook, {
      ...validOptions,
      concurrency: 1,
      scenes: [
        { id: 'vscene_1', prompt: 'first' },
        { id: 'vscene_2', prompt: 'second' },
      ],
    })

    await act(async () => {
      for (let i = 0; i < 30 && !resolveSecondSubmit; i++) await Promise.resolve()
    })

    const running = hook.result.current.getVideoStatus(accepted.operationId)
    expect(running).toEqual({
      operationId: accepted.operationId,
      status: 'running',
      progress: { done: 1, total: 2, failed: 0, phase: 'running' },
    })
    expect(JSON.stringify(running)).not.toMatch(/base64|video|data|MUST-NOT-ENTER/)

    act(() => { hook.result.current.abortAndClearVideoOperations() })
    await act(async () => {
      resolveSecondSubmit({ success: false, error: 'stopped' })
      for (let i = 0; i < 20; i++) await Promise.resolve()
    })
  })

  it('abortAndClearVideoOperations stops detached work, clears maps, and blocks late snapshot resurrection', async () => {
    let resolveSubmit
    const generateVideoT2V = vi.fn(() => new Promise((resolve) => { resolveSubmit = resolve }))
    const { hook, genAPI } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      genAPIOverrides: { generateVideoT2V },
    })
    const listener = vi.fn()
    act(() => { hook.result.current.subscribeVideoStatus(listener) })

    const accepted = await admit(hook)
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(generateVideoT2V).toHaveBeenCalledOnce()

    act(() => { hook.result.current.abortAndClearVideoOperations() })
    expect(hook.result.current.getVideoStatus(accepted.operationId)).toEqual({
      operationId: accepted.operationId,
      status: 'error',
      error: 'context-lost',
      progress: { done: 0, total: 0, failed: 1, phase: 'error' },
    })
    const eventsAfterClear = listener.mock.calls.length

    await act(async () => {
      resolveSubmit({ success: true, generationId: 'late-generation' })
      for (let i = 0; i < 30; i++) await Promise.resolve()
    })

    expect(hook.result.current.getVideoStatus(accepted.operationId).error).toBe('context-lost')
    expect(listener).toHaveBeenCalledTimes(eventsAfterClear)
    expect(genAPI.checkVideoStatus).not.toHaveBeenCalled()
    expect(downloadVideoBase64).not.toHaveBeenCalled()
  })
})

describe('useVideoAutomation agent official API engine pin — slices 47/48', () => {
  function officialAgentEngine(overrides = {}) {
    return {
      generateVideoT2V: vi.fn().mockResolvedValue({ success: true, generationId: 'official-operation' }),
      generateVideoI2V: vi.fn(),
      checkVideoStatus: vi.fn().mockResolvedValue({
        success: true,
        statuses: [{ status: 'complete', mediaId: 'official-video-uri', videoUrl: 'official-video-uri' }],
      }),
      getAccessToken: vi.fn().mockResolvedValue('byok'),
      downloadVideo: vi.fn().mockResolvedValue({ success: true, base64: 'official-video' }),
      fetchMedia: vi.fn(),
      upscaleVideo: vi.fn(),
      ...overrides,
    }
  }

  it('Flow mode/미준비 상태에서도 agent batch는 Flow mock이 아니라 official API engine을 탄다', async () => {
    const official = officialAgentEngine()
    const flowGenerate = vi.fn().mockResolvedValue({ success: true, generationId: 'flow-operation' })
    const flowToken = vi.fn().mockResolvedValue('flow-bearer')
    const { hook, genAPI } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      appMode: 'flow',
      flowProjectReady: false,
      getAccessToken: flowToken,
      genAPIOverrides: {
        generateVideoT2V: flowGenerate,
        agentVideoEngine: official,
      },
    })

    const accepted = await admit(hook, {
      ...validOptions,
      generationEngine: genAPI.agentVideoEngine,
      generationMode: 'api',
    })
    expect(accepted).toEqual({ accepted: true, operationId: expect.any(String) })
    await act(async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve()
    })

    expect(official.getAccessToken).toHaveBeenCalledOnce()
    expect(official.generateVideoT2V).toHaveBeenCalledOnce()
    expect(official.checkVideoStatus).toHaveBeenCalledOnce()
    expect(downloadVideoBase64).toHaveBeenCalledWith(
      official.downloadVideo,
      'official-video-uri',
      '720p',
    )
    expect(flowToken).not.toHaveBeenCalled()
    expect(flowGenerate).not.toHaveBeenCalled()
  })

  it('official BYOK key가 없으면 no-api-key이고 submit/consume은 0회다', async () => {
    const official = officialAgentEngine({ getAccessToken: vi.fn().mockResolvedValue(null) })
    const flowToken = vi.fn().mockResolvedValue('flow-bearer')
    const { hook, genAPI } = setupAdmission({
      subscriptionBatch: { batchUnlimited: false, batchRemaining: 2 },
      appMode: 'flow',
      flowProjectReady: true,
      getAccessToken: flowToken,
      genAPIOverrides: { agentVideoEngine: official },
    })

    await expect(admit(hook, {
      ...validOptions,
      generationEngine: genAPI.agentVideoEngine,
      generationMode: 'api',
    })).resolves.toEqual({ accepted: false, error: 'no-api-key' })

    expect(official.generateVideoT2V).not.toHaveBeenCalled()
    expect(flowToken).not.toHaveBeenCalled()
    expect(consumeBatchDownload).not.toHaveBeenCalled()
    expect(makeBatchConsumeGate).not.toHaveBeenCalled()
  })
})
