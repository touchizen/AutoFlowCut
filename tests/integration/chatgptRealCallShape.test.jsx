/**
 * C1 regression net — the REAL scene-submission call shape against the REAL ChatGPT adapter.
 *
 * The App-gate test mocks the batch at the useAutomation seam and the engine tests only pass
 * aspectRatio in negative cases, so a renderer-side refusal of the app-default
 * `aspectRatio: '16:9'` (always present via useAppSettings) killed every real generation while
 * the whole suite stayed green. This test drives the real useAutomation hook with the real
 * createChatgptEngine and the real createChatgptGenerationAdapter, using the exact option
 * object App builds from settings, and asserts the submission actually reaches the adapter.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('must not be called')),
  },
}))
const { finalizeResults } = vi.hoisted(() => ({ finalizeResults: [] }))
vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn(async ({ result }) => {
    finalizeResults.push(result)
    return true
  }),
}))

import { useAutomation } from '../../src/hooks/useAutomation'
import { createChatgptEngine } from '../../src/engine/engineChatgpt.js'
import { createChatgptGenerationAdapter } from '../../electron/webtargets/chatgpt/generationAdapter.js'

const CDN = 'https://chatgpt.com/backend-api/estuary/content'
const ESTUARY_ID = 'real-chain-estuary-content-id'

function fnNameOf(script) {
  return String(script).trim().split('\n').pop().match(/window\.(__cg_\w+__)\(/)?.[1] || null
}

function realChainHarness() {
  const handlers = {
    __cg_baseline__: { imgs: [] },
    __cg_inject__: { textMatches: true, submitPresent: true },
    __cg_clickSubmit__: { clicked: true },
    __cg_submitAck__: { composerCleared: true, submitPresent: false, stillHasPrompt: false },
    __cg_poll__: { imgs: [{ src: `${CDN}?id=${ESTUARY_ID}&sig=fixture-secret`, complete: true, w: 1254, h: 1254 }] },
  }
  let elapsed = 0
  const executeInView = vi.fn(async (_view, script) => {
    const fn = fnNameOf(script)
    if (!(fn in handlers)) throw new Error(`unexpected page function: ${fn}`)
    return handlers[fn]
  })
  const fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => new Uint8Array([31, 41, 59]).buffer,
  }))
  const view = {
    webContents: {
      executeJavaScript: vi.fn(),
      getURL: vi.fn(() => 'https://chatgpt.com/c/real-chain'),
      session: { fetch },
    },
  }
  const fs = { mkdirSync: vi.fn(), writeFileSync: vi.fn() }
  const adapter = createChatgptGenerationAdapter({
    getView: () => view,
    ensureSession: vi.fn(async () => ({ status: 'ready', ready: true })),
    executeInView,
    generateOptions: {
      now: () => elapsed,
      sleep: async (ms) => { elapsed += ms },
      deadlineMs: 30,
      cadenceMs: 5,
    },
    fs,
    getOutputDir: () => '/real-chain-staging',
    now: () => 1700000000777,
    createId: () => 'real-chain-generation',
    logger: { info: vi.fn(), error: vi.fn() },
  })
  // Thin stand-in for the preload/IPC bridge: every renderer call lands on the REAL adapter.
  const electronAPI = {
    chatgptSubmitGeneration: vi.fn((request) => adapter.submit(request)),
    chatgptObserveGeneration: vi.fn((generationId) => adapter.observe(generationId)),
    chatgptCollectGeneration: vi.fn((generationId) => adapter.collect(generationId)),
    chatgptClearGenerations: vi.fn(() => adapter.clear()),
    chatgptCancelGenerations: vi.fn(() => adapter.cancelAll()),
    getSessionTargetStatus: vi.fn(async () => ({ target: 'chatgpt', status: 'ready', ready: true })),
  }
  return { adapter, electronAPI, executeInView, fs }
}

function makeScenesHook() {
  const scenes = [{ id: 'scene-real-chain', prompt: 'a copper lighthouse over a violet sea', status: 'pending' }]
  const updates = []
  return {
    updates,
    scenesHook: {
      scenes,
      references: [],
      updateScene: vi.fn((id, patch) => updates.push({ id, ...patch })),
      getMatchingReferences: vi.fn(() => []),
      updateReferences: vi.fn(),
    },
  }
}

// The exact option object App.jsx handleStart builds from useAppSettings defaults
// (aspectRatio '16:9' is a default, so it is ALWAYS a string on every submission).
const appDefaultStartOptions = (overrides = {}) => ({
  projectName: 'real-chain-project',
  saveMode: 'folder',
  concurrency: 5,
  flowPacingMinMs: 0,
  flowPacingMaxMs: 0,
  imageBatchCount: 1,
  imageUpscale: 'off',
  aspectRatio: '16:9',
  imageModel: 'gemini-3-pro-image-preview',
  imageProvider: 'google',
  generationSettings: {
    generation: { image: { provider: 'google' } },
    modelsByProvider: { google: 'gemini-3-pro-image-preview' },
  },
  selectedStyleRefId: null,
  seed: null,
  force: false,
  ...overrides,
})

describe('ChatGPT target — real call shape from settings through the real adapter', () => {
  it('a scene submission carrying the settings aspectRatio reaches the adapter and completes', async () => {
    finalizeResults.length = 0
    const h = realChainHarness()
    const { scenesHook, updates } = makeScenesHook()
    const engine = createChatgptEngine({ electronAPI: h.electronAPI })

    const { result } = renderHook(() => useAutomation(
      engine, scenesHook, null, null, null, (key) => key, null, null, null, 'flow', true,
    ))

    await act(async () => {
      await result.current.start(appDefaultStartOptions())
    })

    // Before the C1 fix this refused inside the renderer with
    // errorKind 'chatgpt-aspect-ratio-unmeasured' and never touched the adapter.
    expect(updates.filter((u) => u.status === 'error')).toEqual([])
    expect(h.executeInView).toHaveBeenCalled()
    expect(h.fs.writeFileSync).toHaveBeenCalledOnce()

    // The renderer-side result actually carries a usable image…
    expect(finalizeResults).toHaveLength(1)
    expect(finalizeResults[0].success).toBe(true)
    expect(finalizeResults[0].images?.[0]?.base64).toBeTruthy()
    // …and (C2) the estuary content id never crosses the IPC payload into the renderer.
    expect(JSON.stringify(finalizeResults[0])).not.toContain(ESTUARY_ID)

    // The C1 core: the IPC request itself no longer carries the settings plumbing.
    const request = h.electronAPI.chatgptSubmitGeneration.mock.calls[0][0]
    expect('aspectRatio' in request).toBe(false)
    expect('provider' in request).toBe(false)
    expect('model' in request).toBe(false)
  })

  it('an explicit seed opt-in is still refused through the same real chain', async () => {
    finalizeResults.length = 0
    const h = realChainHarness()
    const { scenesHook, updates } = makeScenesHook()
    const engine = createChatgptEngine({ electronAPI: h.electronAPI })

    const { result } = renderHook(() => useAutomation(
      engine, scenesHook, null, null, null, (key) => key, null, null, null, 'flow', true,
    ))

    await act(async () => {
      // seedLocked user: settings.seedNo is a number → seed rides the same option object.
      await result.current.start(appDefaultStartOptions({ seed: 271828 }))
    })

    expect(updates.filter((u) => u.status === 'error')).toEqual([
      expect.objectContaining({ id: 'scene-real-chain', errorKind: 'chatgpt-seed-unmeasured' }),
    ])
    expect(h.executeInView).not.toHaveBeenCalled()
    expect(finalizeResults).toHaveLength(0)
  })
})
