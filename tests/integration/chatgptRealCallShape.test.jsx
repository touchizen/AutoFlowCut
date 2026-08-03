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
