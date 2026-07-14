// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const composeMocks = vi.hoisted(() => ({
  injectComposeSegments: vi.fn(),
}))

vi.mock('../../../electron/flow-compose-mention.js', async (importOriginal) => ({
  ...(await importOriginal()),
  injectComposeSegments: composeMocks.injectComposeSegments,
}))

import { registerCharacterIPC } from '../../../electron/ipc/character.js'
import { registerVideoIPC } from '../../../electron/ipc/video.js'

const PID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const SEGMENTS = [{ type: 'mention', name: 'Zed2' }]

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, payload) => handlers.get(channel)({}, payload),
  }
}

function makeFlowView() {
  return {
    webContents: {
      executeJavaScript: vi.fn(async () => true),
      focus: vi.fn(),
      sendInputEvent: vi.fn(),
      getURL: () => `https://labs.google/fx/tools/flow/project/${PID}`,
    },
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    setBounds: vi.fn(),
  }
}

function commonDeps(flowView, {
  ensureAgentOffResult = { success: true },
  ensureAgentOnResult = { success: true },
} = {}) {
  return {
    getFlowView: () => flowView,
    getMainWindow: () => null,
    getCurrentMode: () => 'flow',
    getFlowAgentOn: () => false,
    ensureOnProjectComposer: vi.fn(async () => ({ ok: true })),
    configureFlowMode: vi.fn(async () => ({ success: true })),
    trustedClickOnFlowView: vi.fn(async () => ({ success: true })),
    setFlowPageInject: vi.fn(async () => ({ success: true })),
    clearFlowPageInject: vi.fn(async () => {}),
    getCapturedProjectId: () => PID,
    getPendingGeneration: () => null,
    setPendingGeneration: vi.fn(),
    getPendingVideoGeneration: () => null,
    setPendingVideoGeneration: vi.fn(),
    ensureAgentOff: vi.fn(async () => ensureAgentOffResult),
    ensureAgentOn: vi.fn(async () => ensureAgentOnResult),
  }
}

async function settle(promise) {
  await vi.runAllTimersAsync()
  return promise
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('mention failure routing through IPC callers', () => {
  it('scene keeps chip verification failure retryable without staleMention', async () => {
    composeMocks.injectComposeSegments.mockResolvedValueOnce({
      ok: false,
      errorKind: 'chip-verification-failed',
      error: 'Mention selection failed',
      mentionFailure: 'chip-verification-failed',
    })
    const ipc = makeIpcMain()
    const flowView = makeFlowView()
    registerCharacterIPC(ipc, commonDeps(flowView))

    const result = await settle(ipc.invoke('flow:generate-scene', {
      prompt: '@Zed2',
      segments: SEGMENTS,
      projectId: PID,
    }))

    expect(result).toMatchObject({
      success: false,
      retry: true,
      errorKind: 'chip-verification-failed',
      error: 'Mention selection failed',
      mentionFailure: 'chip-verification-failed',
    })
    expect(result).not.toHaveProperty('staleMention')
  })

  it('T2V keeps chip verification failure retryable without staleMention', async () => {
    composeMocks.injectComposeSegments.mockResolvedValueOnce({
      ok: false,
      errorKind: 'chip-verification-failed',
      error: 'Mention selection failed',
      mentionFailure: 'chip-verification-failed',
    })
    const ipc = makeIpcMain()
    const flowView = makeFlowView()
    registerVideoIPC(ipc, commonDeps(flowView))

    const result = await settle(ipc.invoke('flow:generate-video-t2v', {
      prompt: '@Zed2 walks',
      segments: SEGMENTS,
      projectId: PID,
    }))

    expect(result).toMatchObject({
      success: false,
      retry: true,
      errorKind: 'chip-verification-failed',
      error: 'Mention selection failed',
      mentionFailure: 'chip-verification-failed',
    })
    expect(result).not.toHaveProperty('staleMention')
  })

  it.each([
    ['scene', registerCharacterIPC, 'flow:generate-scene'],
    ['T2V', registerVideoIPC, 'flow:generate-video-t2v'],
  ])('%s forwards staleMention only when option-not-found supplied it', async (_label, register, channel) => {
    composeMocks.injectComposeSegments.mockResolvedValueOnce({
      ok: false,
      errorKind: 'option-not-found',
      error: 'Mention selection failed',
      mentionFailure: 'option-not-found',
      staleMention: 'Zed2',
    })
    const ipc = makeIpcMain()
    const flowView = makeFlowView()
    register(ipc, commonDeps(flowView))

    const result = await settle(ipc.invoke(channel, {
      prompt: '@Zed2 walks',
      segments: SEGMENTS,
      projectId: PID,
    }))

    expect(result).toMatchObject({
      success: false,
      retry: true,
      errorKind: 'option-not-found',
      error: 'Mention selection failed',
      mentionFailure: 'option-not-found',
      staleMention: 'Zed2',
    })
  })

  it('T2V returns a coded Agent OFF failure before composing the prompt', async () => {
    const ipc = makeIpcMain()
    const flowView = makeFlowView()
    registerVideoIPC(ipc, commonDeps(flowView, {
      ensureAgentOffResult: { success: false, state: 'still_on' },
    }))

    const result = await settle(ipc.invoke('flow:generate-video-t2v', {
      prompt: '@Zed2 walks',
      segments: SEGMENTS,
      projectId: PID,
    }))

    expect(result).toMatchObject({
      success: false,
      errorKind: 'flow-agent-off-failed',
      error: 'Could not turn Flow Agent off',
    })
    expect(composeMocks.injectComposeSegments).not.toHaveBeenCalled()
  })
})
