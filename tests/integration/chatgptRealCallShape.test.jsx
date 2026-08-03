/**
 * C1/C2 regression net — the REAL default settings through the REAL chain.
 *
 * Five "green suite, dead app" Criticals in this milestone shared one shape: a guard written
 * against a hand-shaped fixture that never matched what the app actually sends (dead first-run
 * picker, combo under native view, auth probe stub, aspectRatio refusal, seed refusal). Each
 * slipped through because unit fixtures defaulted the poisoned field to a passing value
 * (e.g. `seed: null` while the real useAppSettings default is seedLocked:true + numeric seedNo).
 *
 * This test refuses to hand-shape anything on that axis:
 *  - the settings object comes from the REAL useAppSettings hook (first-run defaults),
 *  - the start options come from the REAL buildImageStartOptions App.jsx calls,
 *  - the submission runs through the REAL useAutomation → createChatgptEngine →
 *    createChatgptGenerationAdapter chain,
 * and asserts the submission actually reaches the adapter's page evaluation and completes.
 * Any new refusal that fires on an app-default field breaks this test immediately.
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
import { useAppSettings } from '../../src/hooks/useAppSettings'
import { buildImageStartOptions } from '../../src/services/startOptions'
import { createChatgptEngine } from '../../src/engine/engineChatgpt.js'
import { createChatgptGenerationAdapter } from '../../electron/webtargets/chatgpt/generationAdapter.js'
import { createModeController } from '../../electron/ipc/mode.js'
import { createTargetRegistry } from '../../electron/webtargets/index.js'
import { createChatgptTarget } from '../../electron/webtargets/chatgpt/index.js'

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

// The REAL first-run settings object and the REAL App.jsx handleStart derivation — no field
// is hand-shaped, so a default value the guards refuse cannot hide behind a fixture again.
function realDefaultStartOptions(patchSettings = null) {
  window.localStorage.removeItem('autoflowcut_settings')
  const { result } = renderHook(() => useAppSettings())
  if (patchSettings) act(() => { result.current.setSettings((prev) => ({ ...prev, ...patchSettings })) })
  return buildImageStartOptions(result.current.settings, {
    projectName: 'real-chain-project',
    effectiveStyleId: null,
    force: false,
  })
}

describe('ChatGPT target — real default settings through the real adapter chain', () => {
  it('a stock-settings scene submission reaches the adapter and completes', async () => {
    finalizeResults.length = 0
    const h = realChainHarness()
    const { scenesHook, updates } = makeScenesHook()
    const notices = []
    const engine = createChatgptEngine({
      electronAPI: h.electronAPI,
      onUnmeasuredOptionsIgnored: () => notices.push('unmeasured-options-ignored'),
    })

    const startOptions = realDefaultStartOptions()
    // Reality check on the fixture itself: the app default is a NUMBER seed (seedLocked:true +
    // random seedNo) and a STRING aspect ratio — the exact values earlier waves' fixtures nulled.
    expect(Number.isFinite(startOptions.seed)).toBe(true)
    expect(startOptions.aspectRatio).toBe('16:9')
    expect(startOptions.imageBatchCount).toBe(1)

    const { result } = renderHook(() => useAutomation(
      engine, scenesHook, null, null, null, (key) => key, null, null, null, 'flow', true,
    ))

    await act(async () => {
      await result.current.start(startOptions)
    })

    // Before the C1 fixes this refused inside the renderer ('chatgpt-aspect-ratio-unmeasured'
    // in wave 2, 'chatgpt-seed-unmeasured' in wave 3) and never touched the adapter.
    expect(updates.filter((u) => u.status === 'error')).toEqual([])
    expect(h.executeInView).toHaveBeenCalled()
    expect(h.fs.writeFileSync).toHaveBeenCalledOnce()

    // The renderer-side result actually carries a usable image…
    expect(finalizeResults).toHaveLength(1)
    expect(finalizeResults[0].success).toBe(true)
    expect(finalizeResults[0].images?.[0]?.base64).toBeTruthy()
    // …and (C2) the estuary content id never crosses the IPC payload into the renderer.
    expect(JSON.stringify(finalizeResults[0])).not.toContain(ESTUARY_ID)

    // The C1 core: none of the settings plumbing rides the IPC request.
    const request = h.electronAPI.chatgptSubmitGeneration.mock.calls[0][0]
    expect('aspectRatio' in request).toBe(false)
    expect('seed' in request).toBe(false)
    expect('provider' in request).toBe(false)
    expect('model' in request).toBe(false)
    // One honest notice covers everything this target cannot control — not one per field.
    expect(notices).toEqual(['unmeasured-options-ignored'])
  })

  it('an explicit batch-count opt-in is still refused through the same real chain', async () => {
    finalizeResults.length = 0
    const h = realChainHarness()
    const { scenesHook, updates } = makeScenesHook()
    const engine = createChatgptEngine({
      electronAPI: h.electronAPI,
      onUnmeasuredOptionsIgnored: () => {},
    })

    // Non-default by explicit user choice — the only way batchCount !== 1 can happen.
    const startOptions = realDefaultStartOptions({ imageBatchCount: 4 })
    expect(startOptions.imageBatchCount).toBe(4)

    const { result } = renderHook(() => useAutomation(
      engine, scenesHook, null, null, null, (key) => key, null, null, null, 'flow', true,
    ))

    await act(async () => {
      await result.current.start(startOptions)
    })

    expect(updates.filter((u) => u.status === 'error')).toEqual([
      expect.objectContaining({ id: 'scene-real-chain', errorKind: 'chatgpt-batch-count-unmeasured' }),
    ])
    expect(h.executeInView).not.toHaveBeenCalled()
    expect(finalizeResults).toHaveLength(0)
  })
})

/**
 * Deeper fence: the same real-defaults submission, but through the REAL main-process layer.
 *
 * The harness above bridges the engine straight to the adapter, so a guard added inside the
 * main admission handler (trusted sender / dev gate / route-active / reference envelope /
 * owner-revision drift) would never be traversed — exactly the unfenced layer class.
 * Here nothing main-side is hand-shaped either:
 *  - createModeController registers the PRODUCTION 'chatgpt:*' IPC handlers,
 *  - createChatgptTarget builds the PRODUCTION adapter via its default createAdapter path
 *    (main.js-shaped options: fs + getOutputDir only, plus a virtual clock for the state
 *    machine), with session readiness coming from the REAL AUTH_PROBE against a fake page,
 *  - the electronAPI is channel-for-channel the preload mapping, invoking those registered
 *    handlers with the trusted renderer sender,
 *  - the route is entered through the real 'route:set' handler under a genuine opted-in
 *    dev gate (darwin + dev server + AUTOFLOWCUT_CHATGPT_P2=1).
 * Only Electron primitives (WebContentsView/webContents/ipcMain) are faked.
 */
function realMainHarness() {
  const pageHandlers = {
    __cg_baseline__: { imgs: [] },
    __cg_inject__: { textMatches: true, submitPresent: true },
    __cg_clickSubmit__: { clicked: true },
    __cg_submitAck__: { composerCleared: true, submitPresent: false, stillHasPrompt: false },
    __cg_poll__: { imgs: [{ src: `${CDN}?id=${ESTUARY_ID}&sig=fixture-secret`, complete: true, w: 1254, h: 1254 }] },
  }
  let elapsed = 0
  const pageCalls = []
  const viewListeners = new Map()
  const fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => new Uint8Array([31, 41, 59]).buffer,
  }))
  const webContents = {
    session: { fetch },
    isLoading: () => false,
    loadURL: vi.fn(async () => {}),
    getURL: vi.fn(() => 'https://chatgpt.com/c/real-main'),
    on: vi.fn((name, listener) => {
      viewListeners.set(name, [...(viewListeners.get(name) || []), listener])
    }),
    removeListener: vi.fn(),
    focus: vi.fn(),
    sendInputEvent: vi.fn(),
    executeJavaScript: vi.fn(async (script) => {
      // The real target probes auth with AUTH_PROBE (the only script naming the login CTA).
      if (String(script).includes('login-button')) return { composer: true, loginCta: false }
      const fn = fnNameOf(script)
      if (!(fn in pageHandlers)) throw new Error(`unexpected page function: ${fn}`)
      pageCalls.push(fn)
      return pageHandlers[fn]
    }),
  }
  const chatgptView = { id: 'chatgpt-view', webContents }
  class FakeWebContentsView {
    constructor() { return chatgptView }
  }
  const fs = { mkdirSync: vi.fn(), writeFileSync: vi.fn() }
  const target = createChatgptTarget({
    WebContentsView: FakeWebContentsView,
    reservedSessionWebPreferences: () => ({ partition: 'persist:chatgpt' }),
    installReservedSessionSecurity: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    adapterOptions: {
      fs,
      getOutputDir: () => '/real-main-staging',
      now: () => 1700000000888,
      createId: () => 'real-main-generation',
      // Virtual clock for the measured state machine only — admission logic sees none of this.
      generateOptions: {
        now: () => elapsed,
        sleep: async (ms) => { elapsed += ms },
        deadlineMs: 30,
        cadenceMs: 5,
      },
    },
  })
  const registry = createTargetRegistry({ chatgpt: target })
  const rendererWebContents = { send: vi.fn() }
  const mainWindow = {
    webContents: rendererWebContents,
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  }
  const controller = createModeController(() => mainWindow, vi.fn(() => ({ id: 'flow-view' })), {
    createSessionView: (name) => {
      if (name === 'flow') return { id: 'flow-view' }
      const view = registry.createView(name)
      if (!view) throw new Error(`session-view-unavailable:${name}`)
      return view
    },
    targetRegistry: registry,
    // A genuine opted-in development run: darwin + vite dev server + AUTOFLOWCUT_CHATGPT_P2=1.
    chatgptDevGate: {
      platform: 'darwin',
      isPackaged: false,
      viteDevServerUrl: 'http://localhost:5173',
      chatgptP2Flag: '1',
    },
    updateViewBounds: vi.fn(),
    sessionJobs: Object.freeze({
      cancelAll: async () => target.createAdapter().cancelAll(),
      awaitIdle: async () => target.createAdapter().awaitIdle(),
    }),
    requireRendererQuiesce: true,
  })
  const handlers = {}
  controller.register({
    handle: (channel, handler) => { handlers[channel] = handler },
    on: vi.fn(),
  })
  const invoke = (channel, ...args) => handlers[channel]({ sender: rendererWebContents }, ...args)
  // Channel-for-channel the preload.js electronAPI mapping for this target.
  const electronAPI = {
    chatgptSubmitGeneration: vi.fn((request) => invoke('chatgpt:submit-generation', request)),
    chatgptObserveGeneration: vi.fn((generationId) => invoke('chatgpt:observe-generation', generationId)),
    chatgptCollectGeneration: vi.fn((generationId) => invoke('chatgpt:collect-generation', generationId)),
    chatgptClearGenerations: vi.fn(() => invoke('chatgpt:clear-generations')),
    chatgptCancelGenerations: vi.fn(() => invoke('chatgpt:cancel-generations')),
    getSessionTargetStatus: vi.fn((name) => invoke('session-target:get-status', name)),
  }
  const enterChatgptRoute = async () => {
    const routed = await invoke('route:set', { mode: 'flow', sessionTarget: 'chatgpt' })
    expect(routed).toMatchObject({ ok: true, route: { mode: 'flow', sessionTarget: 'chatgpt' } })
    // Electron fires did-finish-load after the initial URL load; the production listener then
    // runs the real auth probe and publishes 'ready' through the real status channel.
    for (const listener of viewListeners.get('did-finish-load') || []) listener()
    await vi.waitFor(async () => {
      const status = await electronAPI.getSessionTargetStatus('chatgpt')
      if (status?.ready !== true) throw new Error(`session not ready yet: ${status?.status}`)
    })
  }
  const leaveChatgptRoute = async () => {
    const result = await invoke('mode:set', { mode: 'api' })
    expect(result).toMatchObject({ ok: true, mode: 'api' })
  }
  return { electronAPI, handlers, invoke, fs, pageCalls, enterChatgptRoute, leaveChatgptRoute }
}

describe('ChatGPT target — real default settings through the real main-process admission', () => {
  it('a stock-settings scene submission crosses the real IPC handlers and admission and completes', async () => {
    finalizeResults.length = 0
    const h = realMainHarness()
    await h.enterChatgptRoute()
    const { scenesHook, updates } = makeScenesHook()
    const notices = []
    const engine = createChatgptEngine({
      electronAPI: h.electronAPI,
      onUnmeasuredOptionsIgnored: () => notices.push('unmeasured-options-ignored'),
    })

    const startOptions = realDefaultStartOptions()
    expect(Number.isFinite(startOptions.seed)).toBe(true)
    expect(startOptions.aspectRatio).toBe('16:9')

    const { result } = renderHook(() => useAutomation(
      engine, scenesHook, null, null, null, (key) => key, null, null, null, 'flow', true,
    ))

    await act(async () => {
      await result.current.start(startOptions)
    })

    // A guard added in the main admission handler against any field this default run always
    // carries (prompt, referenceImages, batchCount:1, purpose) breaks this test immediately.
    expect(updates.filter((u) => u.status === 'error')).toEqual([])
    // The submission genuinely arrived: the real handler admitted it, the production adapter
    // drove the page submit click, and the estuary image was fetched and staged to disk.
    expect(h.pageCalls).toContain('__cg_clickSubmit__')
    expect(h.fs.writeFileSync).toHaveBeenCalledOnce()
    expect(finalizeResults).toHaveLength(1)
    expect(finalizeResults[0].success).toBe(true)
    expect(finalizeResults[0].images?.[0]?.base64).toBeTruthy()
    expect(JSON.stringify(finalizeResults[0])).not.toContain(ESTUARY_ID)
    expect(notices).toEqual(['unmeasured-options-ignored'])
  })

  it('the real trusted-sender and route-active admissions govern the same real-defaults traffic', async () => {
    finalizeResults.length = 0
    const h = realMainHarness()
    await h.enterChatgptRoute()

    // The trusted-sender admission is evaluated by the REAL handler: a foreign webContents
    // is refused before the adapter sees anything.
    const foreign = await h.handlers['chatgpt:submit-generation'](
      { sender: { send: vi.fn() } },
      { prompt: 'foreign sender must not submit', referenceImages: [] },
    )
    expect(foreign).toMatchObject({ success: false, errorKind: 'chatgpt-unauthorized-sender' })
    expect(h.pageCalls).toEqual([])

    // Positive control: on the active ChatGPT route the default-settings run completes…
    const engine = createChatgptEngine({
      electronAPI: h.electronAPI,
      onUnmeasuredOptionsIgnored: () => {},
    })
    const first = makeScenesHook()
    const firstOptions = realDefaultStartOptions()
    const firstRun = renderHook(() => useAutomation(
      engine, first.scenesHook, null, null, null, (key) => key, null, null, null, 'flow', true,
    ))
    await act(async () => {
      await firstRun.result.current.start(firstOptions)
    })
    expect(first.updates.filter((u) => u.status === 'error')).toEqual([])
    expect(finalizeResults).toHaveLength(1)

    // …then the user leaves the ChatGPT route, and the SAME real-defaults submission is
    // refused by the real route-active admission without ever touching the page again.
    await h.leaveChatgptRoute()
    const pageCallsBefore = h.pageCalls.length
    const second = makeScenesHook()
    const secondOptions = realDefaultStartOptions()
    const secondRun = renderHook(() => useAutomation(
      engine, second.scenesHook, null, null, null, (key) => key, null, null, null, 'flow', true,
    ))
    await act(async () => {
      await secondRun.result.current.start(secondOptions)
    })
    expect(second.updates.filter((u) => u.status === 'error')).toEqual([
      expect.objectContaining({ id: 'scene-real-chain', errorKind: 'chatgpt-route-inactive' }),
    ])
    expect(h.pageCalls.length).toBe(pageCallsBefore)
    expect(finalizeResults).toHaveLength(1)
  })
})
